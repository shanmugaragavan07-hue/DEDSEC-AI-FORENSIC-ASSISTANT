import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import nodemailer from 'nodemailer';
import path from 'path';
import { DEFAULT_FACIAL_PROFILE } from './src/types.ts';
import type { FacialProfile, UserAccount } from './src/types.ts';
import {
  COMPOSITES_DIR,
  createSessionForUser,
  getAllPlans,
  getCaseByIdForUser,
  getCurrentMonthAiSpendInr,
  getSetting,
  getStyleReferences,
  getUserBySessionToken,
  hashOtp,
  hashPassword,
  isBootstrappedAdminEmail,
  listCasesForUser,
  mapUserRowToAccount,
  recordUsageLog,
  setSetting,
  sqlite,
  verifyPassword,
} from './src/server/db.ts';
import {
  applyRefinementDeltaFallback,
  extractStructuredFacialProfile,
  synthesizeGraphiteComposite,
  transcribeVoiceAudio,
  updateProfileForRefinement,
} from './src/server/aiEngine.ts';

declare global {
  namespace Express {
    interface Request {
      user?: UserAccount;
      sessionToken?: string;
    }
  }
}

function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function isLiveRazorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function isLiveCashfreeConfigured(): boolean {
  return Boolean(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY);
}

function getUpiQrConfig() {
  const imageUrl = getSetting('upi_qr_image_url', '/assets/aistudio/1000109412_84c02ce5.jpg');
  const vpa = getSetting('upi_vpa', 'shanmugaragavan15@okicici');
  const payeeName = getSetting('upi_payee_name', 'shanmuga ragavan');
  const enabled = getSetting('upi_qr_enabled', 'true') !== 'false';
  return {
    enabled,
    imageUrl,
    vpa,
    payeeName,
    automaticVerificationSupported: false,
  };
}

function mapPaymentRow(p: any) {
  return {
    id: p.id,
    userId: p.user_id,
    userEmail: p.user_email || undefined,
    userName: p.user_name || undefined,
    planId: p.plan_id,
    planName: p.plan_name || p.plan_id,
    gateway: p.gateway,
    orderId: p.order_id,
    paymentId: p.payment_id || null,
    upiUtr: p.upi_utr || null,
    amountInr: p.amount_inr,
    gatewayFeeInr: p.gateway_fee_inr,
    status: p.status,
    verifiedServerSide: Boolean(p.verified_server_side),
    submittedAt: p.submitted_at || null,
    reviewedAt: p.reviewed_at || null,
    reviewedBy: p.reviewed_by || null,
    adminNote: p.admin_note || null,
    createdAt: p.created_at,
  };
}

async function sendRealOtpEmail(toEmail: string, otpCode: string, purpose: string): Promise<void> {
  if (!isSmtpConfigured()) {
    throw new Error(
      'No SMTP email provider is configured on the server (SMTP_HOST / SMTP_USER / SMTP_PASS). Email OTP cannot be sent until an administrator configures an email service.'
    );
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const subjectMap: Record<string, string> = {
    verify_email: 'DEDSEC — Verify Your Email Address',
    login_2fa: 'DEDSEC — Your Two-Step Login Verification Code',
    reset_password: 'DEDSEC — Password Reset Verification Code',
  };

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: toEmail,
    subject: subjectMap[purpose] || 'DEDSEC — Security Verification Code',
    text: `Your DEDSEC verification code is: ${otpCode}\n\nThis code expires in 10 minutes. Never share this code with anyone.`,
  });
}

// In-memory sliding window rate limiter
const rateBuckets = new Map<string, number[]>();
function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const timestamps = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    rateBuckets.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  rateBuckets.set(key, timestamps);
  return true;
}

function extractToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return undefined;
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  const user = getUserBySessionToken(token);
  if (!user) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }
  if (user.accountStatus === 'suspended') {
    res.status(403).json({ error: 'This account has been suspended by an administrator.' });
    return;
  }
  req.user = user;
  req.sessionToken = token;
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.user || req.user.role !== 'admin') {
      res.status(403).json({ error: 'Administrator privileges required.' });
      return;
    }
    next();
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Preserve raw body for payment webhook HMAC verification
  app.use(
    express.json({
      limit: '18mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  // Serve generated composite images securely from disk
  app.get('/api/images/:filename', (req: Request, res: Response) => {
    const safeName = path.basename(String(req.params.filename || ''));
    if (!/^[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp)$/.test(safeName)) {
      res.status(400).json({ error: 'Invalid image identifier.' });
      return;
    }
    const filePath = path.join(COMPOSITES_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Composite image not found.' });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filePath);
  });

  // Public system capabilities & plans endpoint (no secrets exposed)
  app.get('/api/public/config', (_req: Request, res: Response) => {
    const upiQr = getUpiQrConfig();
    const autoGateway = isLiveRazorpayConfigured()
      ? 'razorpay'
      : isLiveCashfreeConfigured()
      ? 'cashfree'
      : null;
    const activeGateway = autoGateway || (upiQr.enabled ? 'upi_qr' : 'sandbox');
    res.json({
      plans: getAllPlans(false),
      styles: getStyleReferences(false),
      capabilities: {
        smtpConfigured: isSmtpConfigured(),
        livePaymentGatewayConfigured: activeGateway !== 'sandbox',
        automaticPaymentVerificationSupported: Boolean(autoGateway),
        activeGateway,
        razorpayKeyId: isLiveRazorpayConfigured() ? process.env.RAZORPAY_KEY_ID : null,
        upiQr,
      },
    });
  });

  // --- AUTHENTICATION & OTP ROUTES ---
  app.post('/api/auth/register', async (req: Request, res: Response) => {
    const ip = req.ip || 'local';
    if (!checkRateLimit(`auth:${ip}`, 12, 60_000)) {
      res.status(429).json({ error: 'Too many authentication attempts. Please wait a minute.' });
      return;
    }

    const { name, email, password, confirmPassword, acceptedTerms } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanName = String(name || '').trim();

    if (!cleanName || cleanName.length < 2) {
      res.status(400).json({ error: 'Please enter your full name (at least 2 characters).' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (!password || String(password).length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      return;
    }
    if (password !== confirmPassword) {
      res.status(400).json({ error: 'Password and confirmation password do not match.' });
      return;
    }
    if (!acceptedTerms) {
      res.status(400).json({ error: 'You must accept the DEDSEC Terms of Use and Privacy Policy.' });
      return;
    }

    const existing = sqlite.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email address already exists.' });
      return;
    }

    const userId = `usr_${crypto.randomUUID()}`;
    const role = isBootstrappedAdminEmail(cleanEmail) ? 'admin' : 'customer';
    const renewalDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    sqlite
      .prepare(`
        INSERT INTO users (
          id, name, email, password_hash, role, account_status, email_verified,
          two_factor_enabled, auth_provider, plan_id, subscription_status, used_generations, renewal_date, created_at
        ) VALUES (?, ?, ?, ?, ?, 'active', 0, 0, 'email', 'free_trial', 'active', 0, ?, ?)
      `)
      .run(userId, cleanName.slice(0, 100), cleanEmail, hashPassword(String(password)), role, renewalDate, now);

    // If SMTP is configured, send genuine email verification OTP right away
    let otpSent = false;
    if (isSmtpConfigured()) {
      try {
        const otpCode = String(crypto.randomInt(100000, 999999));
        sqlite
          .prepare(`
            INSERT INTO otp_challenges (id, email, purpose, code_hash, attempts, expires_at, verified, created_at)
            VALUES (?, ?, 'verify_email', ?, 0, ?, 0, ?)
          `)
          .run(`otp_${crypto.randomUUID()}`, cleanEmail, hashOtp(otpCode), Date.now() + 10 * 60 * 1000, now);
        await sendRealOtpEmail(cleanEmail, otpCode, 'verify_email');
        otpSent = true;
      } catch (e) {
        console.error('SMTP OTP send failed:', e);
      }
    }

    const token = createSessionForUser(userId);
    const userRow = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    res.status(201).json({
      token,
      user: mapUserRowToAccount(userRow),
      otpVerificationRequired: otpSent,
      smtpConfigured: isSmtpConfigured(),
    });
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const ip = req.ip || 'local';
    if (!checkRateLimit(`auth:${ip}`, 15, 60_000)) {
      res.status(429).json({ error: 'Too many login attempts. Please wait 60 seconds.' });
      return;
    }

    const { email, password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const row = sqlite.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail) as any;

    if (!row || !row.password_hash || !verifyPassword(String(password || ''), row.password_hash)) {
      res.status(401).json({ error: 'Invalid email address or password.' });
      return;
    }

    if (row.account_status === 'suspended') {
      res.status(403).json({ error: 'This account has been suspended.' });
      return;
    }

    // If 2FA is enabled AND SMTP is configured, issue genuine login OTP challenge
    if (row.two_factor_enabled && isSmtpConfigured()) {
      const otpCode = String(crypto.randomInt(100000, 999999));
      const challengeId = `otp_${crypto.randomUUID()}`;
      sqlite
        .prepare(`
          INSERT INTO otp_challenges (id, email, purpose, code_hash, attempts, expires_at, verified, created_at)
          VALUES (?, ?, 'login_2fa', ?, 0, ?, 0, ?)
        `)
        .run(challengeId, cleanEmail, hashOtp(otpCode), Date.now() + 10 * 60 * 1000, new Date().toISOString());

      await sendRealOtpEmail(cleanEmail, otpCode, 'login_2fa');
      res.json({
        requiresTwoFactor: true,
        challengeId,
        email: cleanEmail,
      });
      return;
    }

    const token = createSessionForUser(row.id);
    res.json({
      token,
      user: getUserBySessionToken(token),
      requiresTwoFactor: false,
    });
  });

  // Google Sign-In session bridge
  app.post('/api/auth/google', (req: Request, res: Response) => {
    const { firebaseUid, email, name, emailVerified } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!firebaseUid || !cleanEmail) {
      res.status(400).json({ error: 'Missing Google authentication profile fields.' });
      return;
    }

    let row = sqlite.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail) as any;
    const role = isBootstrappedAdminEmail(cleanEmail) ? 'admin' : 'customer';

    if (!row) {
      const userId = `usr_${crypto.randomUUID()}`;
      const renewalDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const now = new Date().toISOString();
      sqlite
        .prepare(`
          INSERT INTO users (
            id, firebase_uid, name, email, password_hash, role, account_status, email_verified,
            two_factor_enabled, auth_provider, plan_id, subscription_status, used_generations, renewal_date, created_at
          ) VALUES (?, ?, ?, ?, NULL, ?, 'active', ?, 0, 'google', 'free_trial', 'active', 0, ?, ?)
        `)
        .run(
          userId,
          String(firebaseUid),
          String(name || cleanEmail.split('@')[0]).slice(0, 100),
          cleanEmail,
          role,
          emailVerified ? 1 : 0,
          renewalDate,
          now
        );
      row = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    } else {
      sqlite
        .prepare('UPDATE users SET firebase_uid = ?, email_verified = CASE WHEN ? = 1 THEN 1 ELSE email_verified END, role = ? WHERE id = ?')
        .run(String(firebaseUid), emailVerified ? 1 : 0, row.role === 'admin' ? 'admin' : role, row.id);
      row = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(row.id);
    }

    if (row.account_status === 'suspended') {
      res.status(403).json({ error: 'This account has been suspended.' });
      return;
    }

    const token = createSessionForUser(row.id);
    res.json({
      token,
      user: getUserBySessionToken(token),
    });
  });

  // Genuine Email OTP request (Verify Email / Password Reset / Resend)
  app.post('/api/auth/send-otp', async (req: Request, res: Response) => {
    const ip = req.ip || 'local';
    if (!checkRateLimit(`otp:${ip}`, 5, 60_000)) {
      res.status(429).json({ error: 'Please wait before requesting another verification code.' });
      return;
    }

    if (!isSmtpConfigured()) {
      res.status(503).json({
        error:
          'Email OTP provider (SMTP) is not configured in environment variables. DEDSEC never generates fake OTPs—configure SMTP_HOST, SMTP_USER, and SMTP_PASS to enable email delivery.',
        smtpConfigured: false,
      });
      return;
    }

    const { email, purpose } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const validPurpose = ['verify_email', 'login_2fa', 'reset_password'].includes(purpose) ? purpose : 'verify_email';

    const userRow = sqlite.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail) as any;
    if (!userRow) {
      res.status(404).json({ error: 'No DEDSEC account found for that email address.' });
      return;
    }

    try {
      const otpCode = String(crypto.randomInt(100000, 999999));
      const challengeId = `otp_${crypto.randomUUID()}`;
      sqlite
        .prepare(`
          INSERT INTO otp_challenges (id, email, purpose, code_hash, attempts, expires_at, verified, created_at)
          VALUES (?, ?, ?, ?, 0, ?, 0, ?)
        `)
        .run(challengeId, cleanEmail, validPurpose, hashOtp(otpCode), Date.now() + 10 * 60 * 1000, new Date().toISOString());

      await sendRealOtpEmail(cleanEmail, otpCode, validPurpose);
      res.json({
        sent: true,
        challengeId,
        expiresInSeconds: 600,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to dispatch verification email.' });
    }
  });

  app.post('/api/auth/verify-otp', (req: Request, res: Response) => {
    const { email, code, purpose } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanCode = String(code || '').trim();

    if (!/^\d{6}$/.test(cleanCode)) {
      res.status(400).json({ error: 'Please enter a valid 6-digit verification code.' });
      return;
    }

    const challenge = sqlite
      .prepare(
        'SELECT * FROM otp_challenges WHERE email = ? AND purpose = ? AND verified = 0 ORDER BY created_at DESC LIMIT 1'
      )
      .get(cleanEmail, purpose || 'verify_email') as any;

    if (!challenge) {
      res.status(404).json({ error: 'No active OTP challenge found. Request a new code.' });
      return;
    }

    if (challenge.expires_at < Date.now()) {
      res.status(410).json({ error: 'Verification code has expired. Please resend a new code.' });
      return;
    }

    if (challenge.attempts >= 5) {
      res.status(429).json({ error: 'Maximum verification attempts exceeded. Request a new code.' });
      return;
    }

    if (challenge.code_hash !== hashOtp(cleanCode)) {
      sqlite.prepare('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?').run(challenge.id);
      res.status(401).json({ error: 'Incorrect verification code.' });
      return;
    }

    sqlite.prepare('UPDATE otp_challenges SET verified = 1 WHERE id = ?').run(challenge.id);
    const userRow = sqlite.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail) as any;

    if (purpose === 'verify_email' && userRow) {
      sqlite.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userRow.id);
      res.json({ verified: true, user: mapUserRowToAccount({ ...userRow, email_verified: 1 }) });
      return;
    }

    if (purpose === 'login_2fa' && userRow) {
      const token = createSessionForUser(userRow.id);
      res.json({ verified: true, token, user: getUserBySessionToken(token) });
      return;
    }

    res.json({ verified: true, challengeId: challenge.id });
  });

  app.post('/api/auth/reset-password', (req: Request, res: Response) => {
    const { email, code, newPassword } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanCode = String(code || '').trim();

    if (!newPassword || String(newPassword).length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters.' });
      return;
    }

    const challenge = sqlite
      .prepare(
        "SELECT * FROM otp_challenges WHERE email = ? AND purpose = 'reset_password' AND verified = 0 ORDER BY created_at DESC LIMIT 1"
      )
      .get(cleanEmail) as any;

    if (!challenge || challenge.expires_at < Date.now() || challenge.code_hash !== hashOtp(cleanCode)) {
      res.status(401).json({ error: 'Invalid or expired password reset verification code.' });
      return;
    }

    sqlite.prepare('UPDATE otp_challenges SET verified = 1 WHERE id = ?').run(challenge.id);
    sqlite
      .prepare('UPDATE users SET password_hash = ?, email_verified = 1 WHERE email = ?')
      .run(hashPassword(String(newPassword)), cleanEmail);

    res.json({ success: true });
  });

  app.get('/api/auth/me', requireAuth, (req: Request, res: Response) => {
    res.json({
      user: req.user,
      smtpConfigured: isSmtpConfigured(),
    });
  });

  app.post('/api/auth/logout', requireAuth, (req: Request, res: Response) => {
    if (req.sessionToken) {
      sqlite.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
    }
    res.json({ success: true });
  });

  app.put('/api/auth/profile', requireAuth, (req: Request, res: Response) => {
    const { name, twoFactorEnabled } = req.body || {};
    const cleanName = String(name || req.user!.name).trim().slice(0, 100);
    if (!cleanName) {
      res.status(400).json({ error: 'Display name cannot be empty.' });
      return;
    }
    if (twoFactorEnabled && !isSmtpConfigured()) {
      res.status(400).json({
        error: 'Email Two-Factor Authentication requires an active SMTP provider before enabling so you are not locked out.',
      });
      return;
    }

    sqlite
      .prepare('UPDATE users SET name = ?, two_factor_enabled = ? WHERE id = ?')
      .run(cleanName, twoFactorEnabled ? 1 : 0, req.user!.id);

    const updated = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id);
    res.json({ user: mapUserRowToAccount(updated) });
  });

  app.put('/api/auth/password', requireAuth, (req: Request, res: Response) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters.' });
      return;
    }
    const row = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
    if (row.password_hash && !verifyPassword(String(currentPassword || ''), row.password_hash)) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }
    sqlite.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(newPassword)), req.user!.id);
    res.json({ success: true });
  });

  // --- AI WORKFLOW ROUTES (VOICE, PROFILE EXTRACTION, GENERATE, REFINE) ---
  app.post('/api/ai/transcribe', requireAuth, async (req: Request, res: Response) => {
    const maxPerMin = Number(getSetting('rate_limit_per_minute', '12')) || 12;
    if (!checkRateLimit(`ai:${req.user!.id}`, maxPerMin, 60_000)) {
      res.status(429).json({ error: 'Rate limit reached. Please wait a moment before submitting another request.' });
      return;
    }

    const { audioBase64, mimeType } = req.body || {};
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      res.status(400).json({ error: 'Audio recording payload is missing.' });
      return;
    }

    const start = Date.now();
    try {
      const result = await transcribeVoiceAudio(audioBase64, mimeType || 'audio/webm');
      recordUsageLog({
        userId: req.user!.id,
        operation: 'transcribe_voice',
        provider: 'gemini',
        model: result.model,
        status: 'success',
        latencyMs: Date.now() - start,
        estimatedCostInr: result.estimatedCostInr,
      });
      res.json({ transcript: result.transcript, model: result.model });
    } catch (err: any) {
      recordUsageLog({
        userId: req.user!.id,
        operation: 'transcribe_voice',
        provider: 'gemini',
        model: getSetting('transcription_model', 'gemini-3.5-transcribe'),
        status: 'error',
        latencyMs: Date.now() - start,
        estimatedCostInr: 0,
        errorMessage: err?.message || 'Transcription failed',
      });
      res.status(500).json({ error: err?.message || 'Speech transcription failed.' });
    }
  });

  app.post('/api/ai/extract-profile', requireAuth, async (req: Request, res: Response) => {
    const maxPerMin = Number(getSetting('rate_limit_per_minute', '12')) || 12;
    if (!checkRateLimit(`ai:${req.user!.id}`, maxPerMin, 60_000)) {
      res.status(429).json({ error: 'Rate limit reached. Please wait a moment.' });
      return;
    }

    const { description } = req.body || {};
    const cleanDesc = String(description || '').trim();
    if (cleanDesc.length < 10) {
      res.status(400).json({ error: 'Please provide a more detailed facial description (at least 10 characters).' });
      return;
    }

    const start = Date.now();
    try {
      const result = await extractStructuredFacialProfile(cleanDesc);
      recordUsageLog({
        userId: req.user!.id,
        operation: 'extract_profile',
        provider: result.usedFallback ? 'local' : 'gemini',
        model: result.model,
        status: 'success',
        latencyMs: Date.now() - start,
        estimatedCostInr: result.estimatedCostInr,
      });
      res.json({ profile: result.profile, model: result.model });
    } catch (err: any) {
      recordUsageLog({
        userId: req.user!.id,
        operation: 'extract_profile',
        provider: 'gemini',
        model: getSetting('extraction_model', 'gemini-3.8-flash'),
        status: 'error',
        latencyMs: Date.now() - start,
        estimatedCostInr: 0,
        errorMessage: err?.message || 'Profile extraction failed',
      });
      res.status(500).json({ error: err?.message || 'Failed to extract facial profile.' });
    }
  });

  // Pre-generation cost & quota gate helper
  function authorizeGenerationOrThrow(user: UserAccount): void {
    if (user.subscriptionStatus !== 'active') {
      throw Object.assign(new Error('Your subscription is not active. Please renew or select an active plan.'), { status: 403 });
    }
    if (user.remainingGenerations <= 0) {
      throw Object.assign(
        new Error(
          `Monthly generation quota exhausted (${user.usedGenerations}/${user.generationAllowance} used). Upgrade your subscription plan to continue generating composites.`
        ),
        { status: 402 }
      );
    }
    const monthlyCap = Number(getSetting('monthly_spend_cap_inr', '2500')) || 2500;
    const currentSpend = getCurrentMonthAiSpendInr();
    const activeProvider = getSetting('active_image_provider', 'ai_horde_graphite');
    if ((activeProvider === 'gemini_image' || activeProvider === 'huggingface_sdxl') && currentSpend >= monthlyCap) {
      throw Object.assign(
        new Error('Monthly AI provider spending ceiling reached. Contact the DEDSEC administrator or switch to zero-cost open-source synthesis.'),
        { status: 503 }
      );
    }
  }

  app.post('/api/ai/generate', requireAuth, async (req: Request, res: Response) => {
    const maxPerMin = Number(getSetting('rate_limit_per_minute', '12')) || 12;
    if (!checkRateLimit(`gen:${req.user!.id}`, maxPerMin, 60_000)) {
      res.status(429).json({ error: 'Generation rate limit reached. Please wait briefly before generating again.' });
      return;
    }

    try {
      authorizeGenerationOrThrow(req.user!);
    } catch (gateErr: any) {
      res.status(gateErr.status || 403).json({ error: gateErr.message });
      return;
    }

    const { caseId, caseTitle, description, voiceTranscript, profile, styleRefId, notes } = req.body || {};
    const cleanDesc = String(description || '').trim();
    if (cleanDesc.length < 10) {
      res.status(400).json({ error: 'Please enter a facial description of at least 10 characters.' });
      return;
    }

    const styles = getStyleReferences(true);
    const chosenStyle = styles.find((s) => s.id === styleRefId) || styles[0];
    const start = Date.now();

    try {
      // Extract profile if user has not extracted yet, otherwise preserve user-edited attributes
      let workingProfile: FacialProfile = profile ? { ...DEFAULT_FACIAL_PROFILE, ...profile } : DEFAULT_FACIAL_PROFILE;
      const hasAnyKnown = Object.entries(workingProfile).some(
        ([k, v]) =>
          !['approximateAgeGroup', 'graphiteContrast', 'pencilDetailWeight'].includes(k) &&
          typeof v === 'string' &&
          v !== 'unknown'
      );
      if (!hasAnyKnown) {
        const extracted = await extractStructuredFacialProfile(cleanDesc);
        workingProfile = extracted.profile;
      }

      const genResult = await synthesizeGraphiteComposite({
        description: cleanDesc,
        profile: workingProfile,
        styleRef: chosenStyle,
      });

      // Deduct 1 credit ONLY after actual image synthesis succeeded
      sqlite.prepare('UPDATE users SET used_generations = used_generations + 1 WHERE id = ?').run(req.user!.id);

      recordUsageLog({
        userId: req.user!.id,
        operation: 'generate_composite',
        provider: genResult.provider,
        model: genResult.model,
        status: 'success',
        latencyMs: Date.now() - start,
        estimatedCostInr: genResult.estimatedCostInr,
      });

      // Save or update Case + Version
      const now = new Date().toISOString();
      let targetCaseId = caseId ? String(caseId) : '';
      const existingCase = targetCaseId ? getCaseByIdForUser(targetCaseId, req.user!.id) : null;

      if (!existingCase) {
        targetCaseId = `case_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const title = String(caseTitle || '').trim() || `Composite #${targetCaseId.slice(-5).toUpperCase()}`;
        sqlite
          .prepare(`
            INSERT INTO cases (
              id, user_id, title, original_description, voice_transcript, profile_json,
              active_image_url, style_ref_id, notes, is_saved, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'saved', ?, ?)
          `)
          .run(
            targetCaseId,
            req.user!.id,
            title.slice(0, 160),
            cleanDesc,
            voiceTranscript ? String(voiceTranscript) : null,
            JSON.stringify(workingProfile),
            genResult.imageUrl,
            chosenStyle.id,
            String(notes || ''),
            now,
            now
          );
      } else {
        sqlite
          .prepare(`
            UPDATE cases
            SET original_description = ?, voice_transcript = COALESCE(?, voice_transcript),
                profile_json = ?, active_image_url = ?, style_ref_id = ?, notes = COALESCE(?, notes), updated_at = ?
            WHERE id = ? AND user_id = ?
          `)
          .run(
            cleanDesc,
            voiceTranscript ? String(voiceTranscript) : null,
            JSON.stringify(workingProfile),
            genResult.imageUrl,
            chosenStyle.id,
            notes !== undefined ? String(notes) : null,
            now,
            targetCaseId,
            req.user!.id
          );
      }

      const nextVerNum =
        ((sqlite
          .prepare('SELECT COALESCE(MAX(version_number), 0) as m FROM case_versions WHERE case_id = ?')
          .get(targetCaseId) as { m: number }).m || 0) + 1;

      sqlite
        .prepare(`
          INSERT INTO case_versions (
            id, case_id, version_number, image_url, prompt_used, refinement_instruction,
            profile_snapshot_json, provider, model, seed, estimated_cost_inr, created_at
          ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          `ver_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`,
          targetCaseId,
          nextVerNum,
          genResult.imageUrl,
          genResult.promptUsed,
          JSON.stringify(workingProfile),
          genResult.provider,
          genResult.model,
          genResult.seed,
          genResult.estimatedCostInr,
          now
        );

      const updatedUser = getUserBySessionToken(req.sessionToken);
      const savedCase = getCaseByIdForUser(targetCaseId, req.user!.id);

      res.json({
        caseRecord: savedCase,
        user: updatedUser,
      });
    } catch (err: any) {
      recordUsageLog({
        userId: req.user!.id,
        operation: 'generate_composite',
        provider: getSetting('active_image_provider', 'ai_horde_graphite'),
        model: 'composite-engine',
        status: 'error',
        latencyMs: Date.now() - start,
        estimatedCostInr: 0,
        errorMessage: err?.message || 'Generation failed',
      });
      res.status(500).json({
        error: err?.message || 'Composite image generation failed. Your credits were not deducted.',
      });
    }
  });

  app.post('/api/ai/refine', requireAuth, async (req: Request, res: Response) => {
    const maxPerMin = Number(getSetting('rate_limit_per_minute', '12')) || 12;
    if (!checkRateLimit(`gen:${req.user!.id}`, maxPerMin, 60_000)) {
      res.status(429).json({ error: 'Refinement rate limit reached. Please wait briefly.' });
      return;
    }

    try {
      authorizeGenerationOrThrow(req.user!);
    } catch (gateErr: any) {
      res.status(gateErr.status || 403).json({ error: gateErr.message });
      return;
    }

    const { caseId, refinementInstruction } = req.body || {};
    const cleanInstruction = String(refinementInstruction || '').trim();
    if (!caseId || !cleanInstruction) {
      res.status(400).json({ error: 'Select an active composite case and enter a refinement instruction.' });
      return;
    }

    const existingCase = getCaseByIdForUser(String(caseId), req.user!.id);
    if (!existingCase || !existingCase.activeImageUrl) {
      res.status(404).json({ error: 'Existing composite case image not found to refine.' });
      return;
    }

    const styles = getStyleReferences(true);
    const chosenStyle = styles.find((s) => s.id === existingCase.styleRefId) || styles[0];
    const previousSeed = existingCase.versions[existingCase.versions.length - 1]?.seed;
    const start = Date.now();

    try {
      // 1. Update profile preserving unrelated traits
      let updatedProfile = existingCase.profile;
      try {
        const profUpdate = await updateProfileForRefinement({
          currentProfile: existingCase.profile,
          originalDescription: existingCase.originalDescription,
          refinementInstruction: cleanInstruction,
          existingImageUrl: existingCase.activeImageUrl,
        });
        updatedProfile = profUpdate.updatedProfile;
      } catch {
        updatedProfile = applyRefinementDeltaFallback(existingCase.profile, cleanInstruction);
      }

      // 2. Run image-to-image refinement on the existing composite image
      const genResult = await synthesizeGraphiteComposite({
        description: `${existingCase.originalDescription}. Modification: ${cleanInstruction}`,
        profile: updatedProfile,
        styleRef: chosenStyle,
        seed: previousSeed,
        existingImageUrl: existingCase.activeImageUrl,
        refinementInstruction: cleanInstruction,
      });

      // 3. Deduct 1 credit ONLY after refined image succeeded
      sqlite.prepare('UPDATE users SET used_generations = used_generations + 1 WHERE id = ?').run(req.user!.id);

      recordUsageLog({
        userId: req.user!.id,
        operation: 'refine_composite',
        provider: genResult.provider,
        model: genResult.model,
        status: 'success',
        latencyMs: Date.now() - start,
        estimatedCostInr: genResult.estimatedCostInr,
      });

      const now = new Date().toISOString();
      const nextVerNum =
        ((sqlite
          .prepare('SELECT COALESCE(MAX(version_number), 0) as m FROM case_versions WHERE case_id = ?')
          .get(existingCase.id) as { m: number }).m || 0) + 1;

      sqlite
        .prepare(`
          INSERT INTO case_versions (
            id, case_id, version_number, image_url, prompt_used, refinement_instruction,
            profile_snapshot_json, provider, model, seed, estimated_cost_inr, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          `ver_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`,
          existingCase.id,
          nextVerNum,
          genResult.imageUrl,
          genResult.promptUsed,
          cleanInstruction,
          JSON.stringify(updatedProfile),
          genResult.provider,
          genResult.model,
          genResult.seed,
          genResult.estimatedCostInr,
          now
        );

      sqlite
        .prepare('UPDATE cases SET profile_json = ?, active_image_url = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(updatedProfile), genResult.imageUrl, now, existingCase.id);

      res.json({
        caseRecord: getCaseByIdForUser(existingCase.id, req.user!.id),
        user: getUserBySessionToken(req.sessionToken),
      });
    } catch (err: any) {
      recordUsageLog({
        userId: req.user!.id,
        operation: 'refine_composite',
        provider: getSetting('active_image_provider', 'ai_horde_graphite'),
        model: 'composite-refiner',
        status: 'error',
        latencyMs: Date.now() - start,
        estimatedCostInr: 0,
        errorMessage: err?.message || 'Refinement failed',
      });
      res.status(500).json({
        error: err?.message || 'Composite refinement failed. Your previous image was preserved and no credit was deducted.',
      });
    }
  });

  // --- CASE MANAGEMENT ROUTES ---
  app.get('/api/cases', requireAuth, (req: Request, res: Response) => {
    res.json({ cases: listCasesForUser(req.user!.id) });
  });

  app.get('/api/cases/:id', requireAuth, (req: Request, res: Response) => {
    const record = getCaseByIdForUser(String(req.params.id), req.user!.id);
    if (!record) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }
    res.json({ caseRecord: record });
  });

  app.post('/api/cases', requireAuth, (req: Request, res: Response) => {
    const { title, originalDescription, voiceTranscript, profile, styleRefId, notes } = req.body || {};
    const now = new Date().toISOString();
    const caseId = `case_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const cleanTitle = String(title || '').trim() || `Case #${caseId.slice(-5).toUpperCase()}`;

    sqlite
      .prepare(`
        INSERT INTO cases (
          id, user_id, title, original_description, voice_transcript, profile_json,
          active_image_url, style_ref_id, notes, is_saved, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, 'draft', ?, ?)
      `)
      .run(
        caseId,
        req.user!.id,
        cleanTitle.slice(0, 160),
        String(originalDescription || ''),
        voiceTranscript ? String(voiceTranscript) : null,
        JSON.stringify({ ...DEFAULT_FACIAL_PROFILE, ...(profile || {}) }),
        String(styleRefId || 'forensic_fine_graphite'),
        String(notes || ''),
        now,
        now
      );

    res.status(201).json({ caseRecord: getCaseByIdForUser(caseId, req.user!.id) });
  });

  app.put('/api/cases/:id', requireAuth, (req: Request, res: Response) => {
    const existing = getCaseByIdForUser(String(req.params.id), req.user!.id);
    if (!existing) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }

    const { title, originalDescription, profile, notes, isSaved, status, styleRefId } = req.body || {};
    const now = new Date().toISOString();

    sqlite
      .prepare(`
        UPDATE cases
        SET title = ?, original_description = ?, profile_json = ?, notes = ?,
            is_saved = ?, status = ?, style_ref_id = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `)
      .run(
        String(title ?? existing.title).trim().slice(0, 160) || existing.title,
        String(originalDescription ?? existing.originalDescription),
        JSON.stringify(profile ? { ...existing.profile, ...profile } : existing.profile),
        String(notes ?? existing.notes),
        isSaved !== undefined ? (isSaved ? 1 : 0) : existing.isSaved ? 1 : 0,
        status && ['draft', 'saved', 'archived'].includes(status) ? status : existing.status,
        String(styleRefId || existing.styleRefId),
        now,
        existing.id,
        req.user!.id
      );

    res.json({ caseRecord: getCaseByIdForUser(existing.id, req.user!.id) });
  });

  app.post('/api/cases/:id/restore-version', requireAuth, (req: Request, res: Response) => {
    const existing = getCaseByIdForUser(String(req.params.id), req.user!.id);
    if (!existing) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }
    const { versionId } = req.body || {};
    const targetVersion = existing.versions.find((v) => v.id === versionId);
    if (!targetVersion) {
      res.status(404).json({ error: 'Composite version not found.' });
      return;
    }

    sqlite
      .prepare('UPDATE cases SET active_image_url = ?, profile_json = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(
        targetVersion.imageUrl,
        JSON.stringify(targetVersion.profileSnapshot),
        new Date().toISOString(),
        existing.id,
        req.user!.id
      );

    res.json({ caseRecord: getCaseByIdForUser(existing.id, req.user!.id) });
  });

  app.delete('/api/cases/:id', requireAuth, (req: Request, res: Response) => {
    const existing = getCaseByIdForUser(String(req.params.id), req.user!.id);
    if (!existing) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }
    sqlite.prepare('DELETE FROM cases WHERE id = ? AND user_id = ?').run(existing.id, req.user!.id);
    res.json({ success: true });
  });

  // --- SUBSCRIPTIONS & PAYMENT GATEWAY ROUTES ---
  app.get('/api/subscriptions/summary', requireAuth, (req: Request, res: Response) => {
    const plans = getAllPlans(false);
    const payments = sqlite
      .prepare(`
        SELECT p.*, sp.name as plan_name
        FROM payments p
        LEFT JOIN subscription_plans sp ON sp.id = p.plan_id
        WHERE p.user_id = ?
        ORDER BY p.created_at DESC
      `)
      .all(req.user!.id) as any[];

    const usageLogs = sqlite
      .prepare('SELECT * FROM usage_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(req.user!.id) as any[];

    const upiQr = getUpiQrConfig();
    const autoGateway = isLiveRazorpayConfigured()
      ? 'razorpay'
      : isLiveCashfreeConfigured()
      ? 'cashfree'
      : null;

    res.json({
      user: req.user,
      plans,
      payments: payments.map(mapPaymentRow),
      usageLogs: usageLogs.map((u) => ({
        id: u.id,
        userId: u.user_id,
        operation: u.operation,
        provider: u.provider,
        model: u.model,
        status: u.status,
        latencyMs: u.latency_ms,
        estimatedCostInr: u.estimated_cost_inr,
        errorMessage: u.error_message,
        createdAt: u.created_at,
      })),
      liveGatewayConfigured: Boolean(autoGateway) || upiQr.enabled,
      automaticVerificationSupported: Boolean(autoGateway),
      activeGateway: autoGateway || (upiQr.enabled ? 'upi_qr' : 'sandbox'),
      razorpayKeyId: isLiveRazorpayConfigured() ? process.env.RAZORPAY_KEY_ID : null,
      upiQr,
    });
  });

  // Create payment order (Google Pay UPI QR real checkout, Razorpay merchant if configured, or isolated Sandbox mode)
  app.post('/api/payments/create-order', requireAuth, async (req: Request, res: Response) => {
    const { planId, checkoutMode } = req.body || {};
    const plans = getAllPlans(false);
    const plan = plans.find((p) => p.id === planId);
    if (!plan) {
      res.status(404).json({ error: 'Selected subscription plan does not exist.' });
      return;
    }

    if (plan.priceInr === 0) {
      sqlite
        .prepare("UPDATE users SET plan_id = 'free_trial', subscription_status = 'active', custom_allowance = NULL WHERE id = ?")
        .run(req.user!.id);
      res.json({
        freePlanActivated: true,
        user: getUserBySessionToken(req.sessionToken),
      });
      return;
    }

    const now = new Date().toISOString();
    const internalId = `pay_${crypto.randomUUID()}`;

    // Isolated Development Sandbox Checkout (admin diagnostics only; strictly separated from customer checkout & live plans)
    if (checkoutMode === 'sandbox') {
      if (req.user!.role !== 'admin') {
        res.status(403).json({ error: 'Sandbox diagnostics are restricted to administrators and separated from customer checkout.' });
        return;
      }
      if (isLiveRazorpayConfigured() || isLiveCashfreeConfigured()) {
        res.status(403).json({ error: 'Sandbox test checkout is disabled while live merchant gateway keys are active.' });
        return;
      }

      const sandboxOrderId = `order_sbx_${crypto.randomBytes(8).toString('hex')}`;
      sqlite
        .prepare(`
          INSERT INTO payments (id, user_id, plan_id, gateway, order_id, payment_id, upi_utr, amount_inr, gateway_fee_inr, status, verified_server_side, created_at)
          VALUES (?, ?, ?, 'sandbox', ?, NULL, NULL, ?, 0, 'created', 0, ?)
        `)
        .run(internalId, req.user!.id, plan.id, sandboxOrderId, plan.priceInr, now);

      const sandboxSecret = process.env.SESSION_SECRET || 'dedsec_dev_sandbox_secret';
      const expectedSig = crypto
        .createHmac('sha256', sandboxSecret)
        .update(`${sandboxOrderId}|${req.user!.id}|${plan.id}`)
        .digest('hex');

      res.json({
        gateway: 'sandbox',
        orderId: sandboxOrderId,
        amountInr: plan.priceInr,
        currency: 'INR',
        sandboxChallengeSignature: expectedSig,
        plan,
        automaticVerificationSupported: false,
        notice:
          'Isolated Sandbox Test Mode: Simulates payment outcomes with HMAC verification without real money transfer or mixing with live UPI revenue.',
      });
      return;
    }

    // Live Razorpay Merchant Order Creation (if configured)
    if (isLiveRazorpayConfigured() && checkoutMode === 'razorpay') {
      const authBasic = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
      const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authBasic}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: plan.priceInr * 100,
          currency: 'INR',
          receipt: internalId,
          notes: {
            userId: req.user!.id,
            planId: plan.id,
          },
        }),
      });

      if (!rzpRes.ok) {
        const errBody = await rzpRes.text();
        res.status(502).json({ error: `Razorpay merchant order creation failed: ${errBody.slice(0, 160)}` });
        return;
      }

      const rzpOrder = (await rzpRes.json()) as { id: string; amount: number; currency: string };
      sqlite
        .prepare(`
          INSERT INTO payments (id, user_id, plan_id, gateway, order_id, payment_id, amount_inr, gateway_fee_inr, status, verified_server_side, created_at)
          VALUES (?, ?, ?, 'razorpay', ?, NULL, ?, 0, 'created', 0, ?)
        `)
        .run(internalId, req.user!.id, plan.id, rzpOrder.id, plan.priceInr, now);

      res.json({
        gateway: 'razorpay',
        orderId: rzpOrder.id,
        amountInr: plan.priceInr,
        currency: 'INR',
        razorpayKeyId: process.env.RAZORPAY_KEY_ID,
        plan,
        automaticVerificationSupported: true,
      });
      return;
    }

    // Configured Google Pay UPI QR Checkout (Real Payment -> Manual Admin Verification)
    const upiQr = getUpiQrConfig();
    if (!upiQr.enabled) {
      res.status(503).json({ error: 'UPI QR payment is currently disabled by the administrator.' });
      return;
    }

    // Prevent duplicate payment submissions if customer already has a pending verification for this plan
    const existingPending = sqlite
      .prepare(`
        SELECT * FROM payments
        WHERE user_id = ? AND plan_id = ? AND gateway = 'upi_qr' AND status = 'pending_verification'
        ORDER BY created_at DESC LIMIT 1
      `)
      .get(req.user!.id, plan.id) as any;

    if (existingPending) {
      res.status(409).json({
        error: `You already have a payment pending admin verification for ${plan.name} (Order ${existingPending.order_id}, UTR ${existingPending.upi_utr}). Your subscription will activate once verified.`,
      });
      return;
    }

    // Reuse an existing unsubmitted 'created' UPI order for the same user & plan & amount, or create a fresh order
    const existingOpen = sqlite
      .prepare(`
        SELECT * FROM payments
        WHERE user_id = ? AND plan_id = ? AND gateway = 'upi_qr' AND status = 'created' AND amount_inr = ?
        ORDER BY created_at DESC LIMIT 1
      `)
      .get(req.user!.id, plan.id, plan.priceInr) as any;

    const upiOrderId = existingOpen ? existingOpen.order_id : `ORD-UPI-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    if (!existingOpen) {
      sqlite
        .prepare(`
          INSERT INTO payments (id, user_id, plan_id, gateway, order_id, payment_id, upi_utr, amount_inr, gateway_fee_inr, status, verified_server_side, created_at)
          VALUES (?, ?, ?, 'upi_qr', ?, NULL, NULL, ?, 0, 'created', 0, ?)
        `)
        .run(internalId, req.user!.id, plan.id, upiOrderId, plan.priceInr, now);
    }

    const upiIntentUri = `upi://pay?pa=${encodeURIComponent(upiQr.vpa)}&pn=${encodeURIComponent(
      upiQr.payeeName
    )}&am=${encodeURIComponent(plan.priceInr.toFixed(2))}&cu=INR&tn=${encodeURIComponent(
      `DEDSEC ${plan.name} ${upiOrderId}`
    )}`;

    res.json({
      gateway: 'upi_qr',
      orderId: upiOrderId,
      amountInr: plan.priceInr,
      currency: 'INR',
      plan,
      upiQr,
      upiIntentUri,
      automaticVerificationSupported: false,
      notice:
        'Static Google Pay UPI QR codes do not support automatic bank webhooks. After paying in your UPI app, submit your 12-digit UPI transaction reference (UTR). Your plan activates once an administrator verifies receipt.',
    });
  });

  // Customer submits UPI transaction reference (UTR) after scanning & paying via Google Pay / UPI app
  // IMPORTANT: Never auto-activates the subscription; marks status = 'pending_verification' until Admin approves.
  app.post('/api/payments/upi-submit-reference', requireAuth, (req: Request, res: Response) => {
    const ip = req.ip || 'local';
    if (!checkRateLimit(`upi_ref:${req.user!.id}:${ip}`, 10, 60_000)) {
      res.status(429).json({ error: 'Too many submissions. Please wait a minute before trying again.' });
      return;
    }

    const { orderId, upiTransactionRef } = req.body || {};
    const cleanOrderId = String(orderId || '').trim();
    const cleanRef = String(upiTransactionRef || '').trim();

    if (!cleanOrderId) {
      res.status(400).json({ error: 'Missing payment order identifier.' });
      return;
    }
    if (!/^[A-Za-z0-9._-]{8,40}$/.test(cleanRef)) {
      res.status(400).json({
        error: 'Enter a valid UPI Transaction ID / 12-digit UTR (8–40 letters or numbers, no spaces).',
      });
      return;
    }

    const orderRow = sqlite
      .prepare("SELECT * FROM payments WHERE order_id = ? AND user_id = ? AND gateway = 'upi_qr'")
      .get(cleanOrderId, req.user!.id) as any;

    if (!orderRow) {
      res.status(404).json({ error: 'UPI payment order not found for your account.' });
      return;
    }
    if (orderRow.status === 'verified') {
      res.status(400).json({ error: 'This payment has already been verified and activated.' });
      return;
    }
    if (orderRow.status === 'rejected') {
      res.status(400).json({ error: 'This order was rejected during review. Please start a new UPI payment order.' });
      return;
    }

    // Prevent reusing a UTR / transaction reference already submitted on another non-rejected order
    const duplicateRef = sqlite
      .prepare(`
        SELECT id FROM payments
        WHERE (UPPER(upi_utr) = UPPER(?) OR UPPER(payment_id) = UPPER(?))
          AND id != ?
          AND status != 'rejected'
      `)
      .get(cleanRef, cleanRef, orderRow.id) as any;

    if (duplicateRef) {
      res.status(409).json({
        error: 'This UPI transaction reference has already been submitted on another order.',
      });
      return;
    }

    const now = new Date().toISOString();
    sqlite
      .prepare(`
        UPDATE payments
        SET payment_id = ?, upi_utr = ?, status = 'pending_verification', verified_server_side = 0, submitted_at = ?
        WHERE id = ? AND user_id = ?
      `)
      .run(cleanRef, cleanRef, now, orderRow.id, req.user!.id);

    const updatedRow = sqlite
      .prepare(`
        SELECT p.*, sp.name as plan_name
        FROM payments p
        LEFT JOIN subscription_plans sp ON sp.id = p.plan_id
        WHERE p.id = ?
      `)
      .get(orderRow.id) as any;

    res.json({
      pendingVerification: true,
      verified: false,
      subscriptionActivated: false,
      payment: mapPaymentRow(updatedRow),
      user: getUserBySessionToken(req.sessionToken),
      message:
        'Payment reference submitted. Status is Payment Pending until an administrator verifies your UPI transfer and approves activation.',
    });
  });

  // Server-side Razorpay signature verification
  app.post('/api/payments/verify-razorpay', requireAuth, (req: Request, res: Response) => {
    if (!isLiveRazorpayConfigured()) {
      res.status(400).json({ error: 'Razorpay live credentials are not configured.' });
      return;
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    const orderRow = sqlite
      .prepare("SELECT * FROM payments WHERE order_id = ? AND user_id = ? AND gateway = 'razorpay'")
      .get(String(razorpay_order_id || ''), req.user!.id) as any;

    if (!orderRow) {
      res.status(404).json({ error: 'Order reference not found.' });
      return;
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      sqlite.prepare("UPDATE payments SET status = 'failed' WHERE id = ?").run(orderRow.id);
      res.status(400).json({ error: 'Payment signature verification failed.' });
      return;
    }

    const estimatedFee = Number((orderRow.amount_inr * 0.0236).toFixed(2)); // ~2% + GST merchant gateway fee
    sqlite
      .prepare("UPDATE payments SET payment_id = ?, gateway_fee_inr = ?, status = 'verified', verified_server_side = 1 WHERE id = ?")
      .run(String(razorpay_payment_id), estimatedFee, orderRow.id);

    const renewalDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    sqlite
      .prepare("UPDATE users SET plan_id = ?, subscription_status = 'active', used_generations = 0, renewal_date = ? WHERE id = ?")
      .run(orderRow.plan_id, renewalDate, req.user!.id);

    res.json({
      verified: true,
      user: getUserBySessionToken(req.sessionToken),
    });
  });

  // Signed Razorpay Webhook endpoint
  app.post('/api/payments/webhook/razorpay', (req: any, res: Response) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      res.status(503).json({ error: 'Webhook secret not configured.' });
      return;
    }
    const signature = String(req.headers['x-razorpay-signature'] || '');
    const expected = crypto.createHmac('sha256', webhookSecret).update(req.rawBody || '').digest('hex');
    if (!signature || signature !== expected) {
      res.status(401).json({ error: 'Invalid webhook signature.' });
      return;
    }

    const event = req.body?.event;
    const entity = req.body?.payload?.payment?.entity;
    if (event === 'payment.captured' && entity?.order_id) {
      const orderRow = sqlite.prepare('SELECT * FROM payments WHERE order_id = ?').get(entity.order_id) as any;
      if (orderRow && orderRow.status !== 'verified') {
        const estimatedFee = Number((orderRow.amount_inr * 0.0236).toFixed(2));
        sqlite
          .prepare("UPDATE payments SET payment_id = ?, gateway_fee_inr = ?, status = 'verified', verified_server_side = 1 WHERE id = ?")
          .run(String(entity.id), estimatedFee, orderRow.id);
        const renewalDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        sqlite
          .prepare("UPDATE users SET plan_id = ?, subscription_status = 'active', used_generations = 0, renewal_date = ? WHERE id = ?")
          .run(orderRow.plan_id, renewalDate, orderRow.user_id);
      }
    } else if (event === 'payment.failed' && entity?.order_id) {
      sqlite.prepare("UPDATE payments SET status = 'failed' WHERE order_id = ?").run(entity.order_id);
    }

    res.json({ received: true });
  });

  // Isolated Admin Sandbox HMAC diagnostic settlement (records sandbox test status WITHOUT activating live subscriptions or revenue)
  app.post('/api/payments/sandbox-settle', requireAdmin, (req: Request, res: Response) => {
    if (isLiveRazorpayConfigured() || isLiveCashfreeConfigured()) {
      res.status(403).json({ error: 'Sandbox settlement is disabled when live merchant gateways are active.' });
      return;
    }

    const { orderId, outcome, signature } = req.body || {};
    const orderRow = sqlite
      .prepare("SELECT * FROM payments WHERE order_id = ? AND user_id = ? AND gateway = 'sandbox'")
      .get(String(orderId || ''), req.user!.id) as any;

    if (!orderRow) {
      res.status(404).json({ error: 'Sandbox order not found.' });
      return;
    }

    const sandboxSecret = process.env.SESSION_SECRET || 'dedsec_dev_sandbox_secret';
    const expectedSig = crypto
      .createHmac('sha256', sandboxSecret)
      .update(`${orderRow.order_id}|${req.user!.id}|${orderRow.plan_id}`)
      .digest('hex');

    if (signature !== expectedSig) {
      res.status(401).json({ error: 'Sandbox HMAC signature mismatch.' });
      return;
    }

    if (outcome === 'fail') {
      sqlite
        .prepare("UPDATE payments SET status = 'failed', verified_server_side = 1, admin_note = 'Isolated sandbox failure test' WHERE id = ?")
        .run(orderRow.id);
      res.status(402).json({
        verified: false,
        error: 'Simulated sandbox failure recorded in isolated test ledger.',
      });
      return;
    }

    const paymentId = `pay_sbx_${crypto.randomBytes(6).toString('hex')}`;
    sqlite
      .prepare(
        "UPDATE payments SET payment_id = ?, gateway_fee_inr = 0, status = 'verified', verified_server_side = 1, admin_note = 'Isolated sandbox diagnostic (does not activate live subscription)' WHERE id = ?"
      )
      .run(paymentId, orderRow.id);

    res.json({
      verified: true,
      paymentId,
      user: getUserBySessionToken(req.sessionToken),
    });
  });

  app.post('/api/subscriptions/cancel', requireAuth, (req: Request, res: Response) => {
    sqlite
      .prepare("UPDATE users SET plan_id = 'free_trial', subscription_status = 'active', custom_allowance = NULL WHERE id = ?")
      .run(req.user!.id);
    res.json({
      cancelled: true,
      user: getUserBySessionToken(req.sessionToken),
    });
  });

  // --- PROTECTED ADMIN DASHBOARD & COST PROTECTION ROUTES ---
  app.post('/api/admin/payments/:id/review', requireAdmin, (req: Request, res: Response) => {
    const paymentId = String(req.params.id || '').trim();
    const { decision, adminNote } = req.body || {};
    const cleanNote = String(adminNote || '').trim().slice(0, 280);

    if (decision !== 'approve' && decision !== 'reject') {
      res.status(400).json({ error: 'Decision must be either "approve" or "reject".' });
      return;
    }

    const orderRow = sqlite.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as any;
    if (!orderRow) {
      res.status(404).json({ error: 'Payment record not found.' });
      return;
    }

    if (orderRow.gateway === 'sandbox') {
      res.status(400).json({ error: 'Sandbox test orders are isolated from live customer payment approval.' });
      return;
    }

    if (orderRow.status === 'verified' && decision === 'approve') {
      res.status(400).json({ error: 'This payment has already been approved and activated.' });
      return;
    }

    const now = new Date().toISOString();

    if (decision === 'approve') {
      if (!orderRow.upi_utr && !orderRow.payment_id) {
        res.status(400).json({
          error: 'Cannot approve an order before the customer submits a UPI transaction reference.',
        });
        return;
      }

      const approveTx = sqlite.transaction(() => {
        sqlite
          .prepare(`
            UPDATE payments
            SET status = 'verified',
                verified_server_side = 1,
                reviewed_at = ?,
                reviewed_by = ?,
                admin_note = ?
            WHERE id = ?
          `)
          .run(
            now,
            req.user!.email,
            cleanNote || 'Approved after manual UPI transaction verification',
            orderRow.id
          );

        const renewalDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        sqlite
          .prepare(`
            UPDATE users
            SET plan_id = ?,
                subscription_status = 'active',
                used_generations = 0,
                custom_allowance = NULL,
                renewal_date = ?
            WHERE id = ?
          `)
          .run(orderRow.plan_id, renewalDate, orderRow.user_id);
      });

      approveTx();
    } else {
      sqlite
        .prepare(`
          UPDATE payments
          SET status = 'rejected',
              verified_server_side = 0,
              reviewed_at = ?,
              reviewed_by = ?,
              admin_note = ?
          WHERE id = ?
        `)
        .run(
          now,
          req.user!.email,
          cleanNote || 'Rejected: UPI transaction reference could not be verified',
          orderRow.id
        );
    }

    const updated = sqlite
      .prepare(`
        SELECT p.*, u.email as user_email, u.name as user_name, sp.name as plan_name
        FROM payments p
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN subscription_plans sp ON sp.id = p.plan_id
        WHERE p.id = ?
      `)
      .get(orderRow.id) as any;

    res.json({
      reviewed: true,
      decision,
      payment: mapPaymentRow(updated),
    });
  });

  app.get('/api/admin/overview', requireAdmin, (_req: Request, res: Response) => {
    const userRows = sqlite.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as any[];
    const users = userRows.map(mapUserRowToAccount);
    const plans = getAllPlans(true);
    const styles = getStyleReferences(true);

    const paymentRows = sqlite
      .prepare(`
        SELECT p.*, u.email as user_email, u.name as user_name, sp.name as plan_name
        FROM payments p
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN subscription_plans sp ON sp.id = p.plan_id
        ORDER BY
          CASE WHEN p.status = 'pending_verification' THEN 0 ELSE 1 END ASC,
          p.created_at DESC
        LIMIT 150
      `)
      .all() as any[];

    const usageRows = sqlite
      .prepare(`
        SELECT ul.*, u.email as user_email
        FROM usage_logs ul
        LEFT JOIN users u ON u.id = ul.user_id
        ORDER BY ul.created_at DESC
        LIMIT 120
      `)
      .all() as any[];

    // Strictly separate real verified customer revenue from sandbox test runs and unverified pending submissions
    const revStats = sqlite
      .prepare(`
        SELECT
          COUNT(*) as paid_count,
          COALESCE(SUM(amount_inr), 0) as gross_rev,
          COALESCE(SUM(gateway_fee_inr), 0) as total_fees
        FROM payments
        WHERE status = 'verified' AND gateway != 'sandbox'
      `)
      .get() as { paid_count: number; gross_rev: number; total_fees: number };

    const pendingStats = sqlite
      .prepare("SELECT COUNT(*) as pending_count FROM payments WHERE status = 'pending_verification'")
      .get() as { pending_count: number };

    const sandboxStats = sqlite
      .prepare("SELECT COUNT(*) as sbx_count FROM payments WHERE status = 'verified' AND gateway = 'sandbox'")
      .get() as { sbx_count: number };

    const aiStats = sqlite
      .prepare(`
        SELECT
          COALESCE(SUM(estimated_cost_inr), 0) as total_ai_cost,
          COUNT(CASE WHEN operation IN ('generate_composite', 'refine_composite') AND status = 'success' THEN 1 END) as img_count,
          COUNT(CASE WHEN status = 'error' THEN 1 END) as error_count
        FROM usage_logs
      `)
      .get() as { total_ai_cost: number; img_count: number; error_count: number };

    const grossRevenue = revStats.gross_rev;
    const totalPayments = revStats.paid_count;
    const gatewayFees = revStats.total_fees;
    const hostingCost = Number(getSetting('hosting_storage_estimate_inr', '0')) || 0;
    const aiCost = Number(aiStats.total_ai_cost || 0);
    const avgGenCost = aiStats.img_count > 0 ? Number((aiCost / aiStats.img_count).toFixed(2)) : 0;
    const operatingMargin = Number((grossRevenue - gatewayFees - aiCost - hostingCost).toFixed(2));

    const monthlyCap = Number(getSetting('monthly_spend_cap_inr', '2500')) || 2500;
    const alertThreshold = Number(getSetting('spend_alert_threshold_percent', '80')) || 80;
    const currentMonthSpend = getCurrentMonthAiSpendInr();
    const upiQr = getUpiQrConfig();
    const autoSupported = isLiveRazorpayConfigured() || isLiveCashfreeConfigured();

    const alerts: string[] = [];
    if (pendingStats.pending_count > 0) {
      alerts.push(
        `${pendingStats.pending_count} customer UPI QR payment${pendingStats.pending_count > 1 ? 's are' : ' is'} awaiting manual UTR verification in the Payments tab.`
      );
    }
    if (monthlyCap > 0 && (currentMonthSpend / monthlyCap) * 100 >= alertThreshold) {
      alerts.push(`Monthly AI spend (₹${currentMonthSpend.toFixed(2)}) has exceeded ${alertThreshold}% of the ₹${monthlyCap} cap.`);
    }
    if (aiStats.error_count >= 5) {
      alerts.push(`${aiStats.error_count} AI provider errors recorded in usage logs. Inspect provider connectivity.`);
    }

    res.json({
      financials: {
        grossRevenueInr: grossRevenue,
        totalSuccessfulPayments: totalPayments,
        pendingVerificationCount: pendingStats.pending_count,
        sandboxVerifiedCount: sandboxStats.sbx_count,
        paymentProcessingFeesInr: Number(gatewayFees.toFixed(2)),
        aiUsageCostInr: Number(aiCost.toFixed(2)),
        estimatedGenerationCostAvgInr: avgGenCost,
        hostingStorageEstimateInr: hostingCost,
        estimatedOperatingMarginInr: operatingMargin,
        monthlySpendCapInr: monthlyCap,
        spendAlertThresholdPercent: alertThreshold,
      },
      providerConfig: {
        activeImageProvider: getSetting('active_image_provider', 'ai_horde_graphite') as any,
        extractionModel: getSetting('extraction_model', 'gemini-3.8-flash'),
        transcriptionModel: getSetting('transcription_model', 'gemini-3.5-transcribe'),
        paidGeminiImageApproved: getSetting('paid_gemini_image_approved', 'false') === 'true',
        free300BudgetApproved: getSetting('free_300_budget_approved', 'false') === 'true',
        rateLimitPerMinute: Number(getSetting('rate_limit_per_minute', '12')) || 12,
        localSdUrl: getSetting('local_sd_url', ''),
        huggingfaceConfigured: Boolean(process.env.HUGGINGFACE_API_KEY),
        geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
        smtpConfigured: isSmtpConfigured(),
        livePaymentGatewayConfigured: autoSupported || upiQr.enabled,
        automaticPaymentVerificationSupported: autoSupported,
        activeGatewayName: isLiveRazorpayConfigured()
          ? 'Razorpay Merchant (Auto Webhook)'
          : isLiveCashfreeConfigured()
          ? 'Cashfree Merchant (Auto Webhook)'
          : 'Google Pay UPI QR (Manual Admin Verification)',
        upiQr,
      },
      users,
      plans,
      payments: paymentRows.map((p) => ({
        ...mapPaymentRow(p),
        userEmail: p.user_email || 'Unknown',
        userName: p.user_name || 'Customer',
      })),
      recentUsage: usageRows.map((u) => ({
        id: u.id,
        userId: u.user_id,
        userEmail: u.user_email || 'Unknown',
        operation: u.operation,
        provider: u.provider,
        model: u.model,
        status: u.status,
        latencyMs: u.latency_ms,
        estimatedCostInr: u.estimated_cost_inr,
        errorMessage: u.error_message,
        createdAt: u.created_at,
      })),
      styles,
      alerts,
    });
  });

  app.put('/api/admin/users/:id', requireAdmin, (req: Request, res: Response) => {
    const { accountStatus, planId, customAllowance, resetUsedGenerations } = req.body || {};
    const target = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(String(req.params.id)) as any;
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    sqlite
      .prepare(`
        UPDATE users
        SET account_status = ?, plan_id = ?, custom_allowance = ?,
            used_generations = CASE WHEN ? = 1 THEN 0 ELSE used_generations END
        WHERE id = ?
      `)
      .run(
        accountStatus === 'suspended' ? 'suspended' : 'active',
        String(planId || target.plan_id),
        customAllowance !== undefined && customAllowance !== '' && customAllowance !== null ? Number(customAllowance) : null,
        resetUsedGenerations ? 1 : 0,
        target.id
      );

    res.json({ user: mapUserRowToAccount(sqlite.prepare('SELECT * FROM users WHERE id = ?').get(target.id)) });
  });

  app.put('/api/admin/plans/:id', requireAdmin, (req: Request, res: Response) => {
    const { name, priceInr, generationAllowance, isActive } = req.body || {};
    const planId = String(req.params.id);
    const existing = sqlite.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(planId) as any;
    if (!existing) {
      res.status(404).json({ error: 'Subscription plan not found.' });
      return;
    }

    sqlite
      .prepare(`
        UPDATE subscription_plans
        SET name = ?, price_inr = ?, generation_allowance = ?, is_active = ?
        WHERE id = ?
      `)
      .run(
        String(name || existing.name).trim(),
        Math.max(0, Math.floor(Number(priceInr ?? existing.price_inr))),
        Math.max(0, Math.floor(Number(generationAllowance ?? existing.generation_allowance))),
        isActive !== undefined ? (isActive ? 1 : 0) : existing.is_active,
        planId
      );

    res.json({ plans: getAllPlans(true) });
  });

  app.put('/api/admin/cost-settings', requireAdmin, (req: Request, res: Response) => {
    const {
      activeImageProvider,
      paidGeminiImageApproved,
      free300BudgetApproved,
      monthlySpendCapInr,
      spendAlertThresholdPercent,
      rateLimitPerMinute,
      hostingStorageEstimateInr,
      localSdUrl,
    } = req.body || {};

    if (activeImageProvider && ['ai_horde_graphite', 'local_sd_webui', 'huggingface_sdxl', 'gemini_image'].includes(activeImageProvider)) {
      if (activeImageProvider === 'gemini_image' && !paidGeminiImageApproved) {
        res.status(400).json({
          error: 'You must explicitly enable Paid Gemini Image Approval before activating gemini_image.',
        });
        return;
      }
      setSetting('active_image_provider', activeImageProvider);
    }

    if (paidGeminiImageApproved !== undefined) {
      setSetting('paid_gemini_image_approved', paidGeminiImageApproved ? 'true' : 'false');
    }
    if (free300BudgetApproved !== undefined) {
      setSetting('free_300_budget_approved', free300BudgetApproved ? 'true' : 'false');
    }
    if (monthlySpendCapInr !== undefined) {
      setSetting('monthly_spend_cap_inr', String(Math.max(0, Number(monthlySpendCapInr))));
    }
    if (spendAlertThresholdPercent !== undefined) {
      setSetting('spend_alert_threshold_percent', String(Math.min(100, Math.max(10, Number(spendAlertThresholdPercent)))));
    }
    if (rateLimitPerMinute !== undefined) {
      setSetting('rate_limit_per_minute', String(Math.max(1, Math.min(120, Number(rateLimitPerMinute)))));
    }
    if (hostingStorageEstimateInr !== undefined) {
      setSetting('hosting_storage_estimate_inr', String(Math.max(0, Number(hostingStorageEstimateInr))));
    }
    if (localSdUrl !== undefined) {
      setSetting('local_sd_url', String(localSdUrl).trim());
    }

    res.json({ saved: true });
  });

  app.put('/api/admin/styles/:id', requireAdmin, (req: Request, res: Response) => {
    const { name, description, promptStyleDirective, negativeDirective, isActive } = req.body || {};
    const existing = sqlite.prepare('SELECT * FROM style_references WHERE id = ?').get(String(req.params.id)) as any;
    if (!existing) {
      res.status(404).json({ error: 'Style reference not found.' });
      return;
    }

    sqlite
      .prepare(`
        UPDATE style_references
        SET name = ?, description = ?, prompt_style_directive = ?, negative_directive = ?, is_active = ?
        WHERE id = ?
      `)
      .run(
        String(name ?? existing.name),
        String(description ?? existing.description),
        String(promptStyleDirective ?? existing.prompt_style_directive),
        String(negativeDirective ?? existing.negative_directive),
        isActive !== undefined ? (isActive ? 1 : 0) : existing.is_active,
        existing.id
      );

    res.json({ styles: getStyleReferences(true) });
  });

  // Vite middleware for development or static serving for production
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    (process.env.npm_lifecycle_event === 'start' && fs.existsSync(path.join(process.cwd(), 'dist', 'index.html')));

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DEDSEC AI Forensic Assistant server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
