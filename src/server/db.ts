import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DEFAULT_FACIAL_PROFILE } from '../types.ts';
import type {
  FacialProfile,
  ForensicCase,
  CompositeVersion,
  SubscriptionPlan,
  StyleReference,
  UserAccount,
  PaymentTransaction,
  UsageLogRecord,
} from '../types.ts';

export const DATA_DIR = path.resolve(process.cwd(), 'data');
export const COMPOSITES_DIR = path.join(DATA_DIR, 'composites');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(COMPOSITES_DIR)) {
  fs.mkdirSync(COMPOSITES_DIR, { recursive: true });
}

export const sqlite = new Database(path.join(DATA_DIR, 'dedsec.sqlite'));
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Initialize tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subscription_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tagline TEXT NOT NULL,
    price_inr INTEGER NOT NULL,
    billing_interval TEXT NOT NULL DEFAULT 'month',
    generation_allowance INTEGER NOT NULL,
    features_json TEXT NOT NULL,
    restrictions_json TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS style_references (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    preview_url TEXT NOT NULL,
    prompt_style_directive TEXT NOT NULL,
    negative_directive TEXT NOT NULL,
    paper_tone TEXT NOT NULL DEFAULT 'crisp_white',
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    firebase_uid TEXT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'customer',
    account_status TEXT NOT NULL DEFAULT 'active',
    email_verified INTEGER NOT NULL DEFAULT 0,
    two_factor_enabled INTEGER NOT NULL DEFAULT 0,
    auth_provider TEXT NOT NULL DEFAULT 'email',
    plan_id TEXT NOT NULL DEFAULT 'free_trial',
    subscription_status TEXT NOT NULL DEFAULT 'active',
    used_generations INTEGER NOT NULL DEFAULT 0,
    custom_allowance INTEGER,
    renewal_date TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS otp_challenges (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    purpose TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    original_description TEXT NOT NULL,
    voice_transcript TEXT,
    profile_json TEXT NOT NULL,
    active_image_url TEXT,
    style_ref_id TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    is_saved INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'saved',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS case_versions (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    prompt_used TEXT NOT NULL,
    refinement_instruction TEXT,
    profile_snapshot_json TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    seed TEXT NOT NULL,
    estimated_cost_inr REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    gateway TEXT NOT NULL,
    order_id TEXT NOT NULL UNIQUE,
    payment_id TEXT,
    upi_utr TEXT,
    amount_inr INTEGER NOT NULL,
    gateway_fee_inr REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    verified_server_side INTEGER NOT NULL DEFAULT 0,
    submitted_at TEXT,
    reviewed_at TEXT,
    reviewed_by TEXT,
    admin_note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS usage_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    latency_ms INTEGER NOT NULL,
    estimated_cost_inr REAL NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL
  );
`);

// Non-destructive column migration for existing SQLite databases
const paymentColumns = (sqlite.prepare('PRAGMA table_info(payments)').all() as { name: string }[]).map((c) => c.name);
for (const [colName, colDef] of [
  ['upi_utr', 'TEXT'],
  ['submitted_at', 'TEXT'],
  ['reviewed_at', 'TEXT'],
  ['reviewed_by', 'TEXT'],
  ['admin_note', 'TEXT'],
] as const) {
  if (!paymentColumns.includes(colName)) {
    sqlite.exec(`ALTER TABLE payments ADD COLUMN ${colName} ${colDef}`);
  }
}

export function getSetting(key: string, defaultValue: string): string {
  const row = sqlite.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) {
    sqlite.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)').run(key, defaultValue);
    return defaultValue;
  }
  return row.value;
}

export function setSetting(key: string, value: string): void {
  sqlite
    .prepare('INSERT INTO system_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

// Seed default system settings (strict cost protection: never enable paid services automatically)
getSetting('active_image_provider', 'ai_horde_graphite');
getSetting('extraction_model', 'gemini-3.8-flash');
getSetting('transcription_model', 'gemini-3.5-transcribe');
getSetting('paid_gemini_image_approved', 'false');
getSetting('free_300_budget_approved', 'false');
getSetting('monthly_spend_cap_inr', '2500');
getSetting('spend_alert_threshold_percent', '80');
getSetting('rate_limit_per_minute', '12');
getSetting('hosting_storage_estimate_inr', '0');
getSetting('local_sd_url', process.env.LOCAL_SD_URL || '');
// Configured Google Pay UPI QR code settings (never removed)
getSetting('upi_qr_enabled', 'true');
getSetting('upi_qr_image_url', '/assets/aistudio/1000109412_84c02ce5.jpg');
getSetting('upi_vpa', 'shanmugaragavan15@okicici');
getSetting('upi_payee_name', 'shanmuga ragavan');

// Seed subscription plans if empty
const planCount = (sqlite.prepare('SELECT COUNT(*) as c FROM subscription_plans').get() as { c: number }).c;
if (planCount === 0) {
  const insertPlan = sqlite.prepare(`
    INSERT INTO subscription_plans (id, name, tagline, price_inr, billing_interval, generation_allowance, features_json, restrictions_json, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  insertPlan.run(
    'free_trial',
    'Starter Trial',
    'For initial composite evaluation using zero-upfront open-source synthesis',
    0,
    'month',
    15,
    JSON.stringify([
      '15 graphite composite generations per month (300/mo available when local/free capacity is approved)',
      'AI facial profile extraction from text & voice input',
      'Interactive 23-attribute forensic profile inspector',
      'PNG & JPEG composite downloads',
      'Up to 10 saved workspace cases',
    ]),
    JSON.stringify([
      'Standard open-source synthesis queue',
      'PDF forensic report includes illustrative watermark header',
    ])
  );

  insertPlan.run(
    'plus',
    'DEDSEC Plus',
    'For independent illustrators, writers, and investigative researchers',
    499,
    'month',
    300,
    JSON.stringify([
      '300 graphite composite & refinement generations per month',
      'Image-to-image composite refinement with before/after slider',
      'Full PNG, JPEG, and formatted PDF Case Report exports',
      'Voice-to-profile transcription workflow',
      'Unlimited saved cases & version history restore',
    ]),
    JSON.stringify([
      'Single-seat workspace licence',
    ])
  );

  insertPlan.run(
    'studio_pro',
    'DEDSEC Studio Pro',
    'For high-volume creative studios and academic forensic training labs',
    1499,
    'month',
    1200,
    JSON.stringify([
      '1,200 graphite composite & refinement generations per month',
      'All approved graphite & archival paper style references',
      'Unlimited multi-version history & side-by-side comparison',
      'Priority provider routing & higher rate-limit ceiling',
      'Comprehensive PDF case dossiers with refinement audit trail',
    ]),
    JSON.stringify([
      'Subject to illustrative fictional-composite terms of use',
    ])
  );
}

// Seed approved Style Reference Library from the product owner's uploaded assets
const styleCount = (sqlite.prepare('SELECT COUNT(*) as c FROM style_references').get() as { c: number }).c;
if (styleCount === 0) {
  const insertStyle = sqlite.prepare(`
    INSERT INTO style_references (id, name, description, preview_url, prompt_style_directive, negative_directive, paper_tone, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);

  insertStyle.run(
    'forensic_fine_graphite',
    'Precision Forensic Graphite (2B/4B)',
    'High-detail monochrome forensic pencil composite with crisp hair strand rendering, natural skin stippling, symmetrical front-facing framing, and clean white studio paper.',
    '/assets/aistudio/DEDSEC_SKETCH_AUTO_1774605753783_aab1244a.png',
    'masterpiece forensic composite sketch, realistic hand-drawn black and white 2B and 4B graphite pencil portrait on clean pure white drawing paper, symmetrical front-facing passport-style head and neck view, intricate fine pencil hatching, realistic skin pores and tonal shading, crisp individual hair strands, realistic eyes, neutral expression, high contrast monochrome pencil drawing',
    'color, polychrome, cartoon, anime, manga, 3d render, cgi, unreal engine, oil painting, watercolor, airbrushed plastic skin, asymmetrical distortion, side profile, dramatic shadows, dark background, text, signature, watermark',
    'crisp_white'
  );

  insertStyle.run(
    'observational_paper_sketch',
    'Traditional Hand-Drawn Sketch Paper',
    'Soft tonal graphite shading with authentic paper tooth, organic pencil blending, and classical observational sketch proportions.',
    '/assets/aistudio/sketch_sample_a0a9f0af.jpg',
    'authentic traditional hand-drawn HB and 2B graphite pencil sketch portrait on lightly textured off-white sketchpad paper, front-facing adult portrait, soft blended pencil shading, natural pencil strokes visible in hair and eyebrows, realistic human facial proportions, monochrome鉛筆画, neutral expression',
    'color, vibrant, digital art, anime, cartoon, 3d model, glossy plastic, oil paint, heavy ink, comic book, deformed eyes, extra limbs, text, signature, watermark',
    'warm_archival'
  );
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  const derivedBuffer = crypto.scryptSync(password, salt, 64);
  const keyBuffer = Buffer.from(key, 'hex');
  if (derivedBuffer.length !== keyBuffer.length) return false;
  return crypto.timingSafeEqual(derivedBuffer, keyBuffer);
}

export function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export function isBootstrappedAdminEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const configured = (process.env.ADMIN_EMAILS || 'shanmugaragavan07@gmail.com')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!configured.includes('shanmugaragavan07@gmail.com')) {
    configured.push('shanmugaragavan07@gmail.com');
  }
  return configured.includes(normalized);
}

export function getAllPlans(includeInactive = false): SubscriptionPlan[] {
  const rows = sqlite
    .prepare(
      includeInactive
        ? 'SELECT * FROM subscription_plans ORDER BY price_inr ASC'
        : 'SELECT * FROM subscription_plans WHERE is_active = 1 ORDER BY price_inr ASC'
    )
    .all() as any[];

  const free300Approved = getSetting('free_300_budget_approved', 'false') === 'true';

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    tagline: r.tagline,
    priceInr: r.price_inr,
    billingInterval: r.billing_interval,
    generationAllowance: r.id === 'free_trial' && free300Approved ? Math.max(300, r.generation_allowance) : r.generation_allowance,
    features: JSON.parse(r.features_json || '[]'),
    restrictions: JSON.parse(r.restrictions_json || '[]'),
    isActive: Boolean(r.is_active),
  }));
}

export function getStyleReferences(includeInactive = false): StyleReference[] {
  const rows = sqlite
    .prepare(
      includeInactive
        ? 'SELECT * FROM style_references ORDER BY name ASC'
        : 'SELECT * FROM style_references WHERE is_active = 1 ORDER BY name ASC'
    )
    .all() as any[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    previewUrl: r.preview_url,
    promptStyleDirective: r.prompt_style_directive,
    negativeDirective: r.negative_directive,
    paperTone: r.paper_tone,
    isActive: Boolean(r.is_active),
  }));
}

export function mapUserRowToAccount(row: any): UserAccount {
  const plans = getAllPlans(true);
  const plan = plans.find((p) => p.id === row.plan_id) || plans[0];
  const allowance = row.custom_allowance !== null && row.custom_allowance !== undefined ? row.custom_allowance : plan.generationAllowance;
  const used = row.used_generations || 0;

  return {
    id: row.id,
    firebaseUid: row.firebase_uid || null,
    name: row.name,
    email: row.email,
    role: row.role === 'admin' || isBootstrappedAdminEmail(row.email) ? 'admin' : 'customer',
    accountStatus: row.account_status,
    emailVerified: Boolean(row.email_verified),
    twoFactorEnabled: Boolean(row.two_factor_enabled),
    authProvider: row.auth_provider,
    planId: row.plan_id,
    subscriptionStatus: row.subscription_status,
    generationAllowance: allowance,
    usedGenerations: used,
    remainingGenerations: Math.max(0, allowance - used),
    renewalDate: row.renewal_date,
    createdAt: row.created_at,
  };
}

export function createSessionForUser(userId: string): string {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 14; // 14 days
  sqlite
    .prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, expiresAt, new Date().toISOString());
  return token;
}

export function getUserBySessionToken(token: string | undefined): UserAccount | null {
  if (!token) return null;
  const session = sqlite
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?')
    .get(token) as { user_id: string; expires_at: number } | undefined;
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    sqlite.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  const userRow = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as any;
  if (!userRow) return null;

  // Auto-renew monthly cycle if renewal_date has passed
  if (new Date(userRow.renewal_date).getTime() < Date.now() && userRow.subscription_status === 'active') {
    const nextRenewal = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    sqlite.prepare('UPDATE users SET used_generations = 0, renewal_date = ? WHERE id = ?').run(nextRenewal, userRow.id);
    userRow.used_generations = 0;
    userRow.renewal_date = nextRenewal;
  }

  // Promote bootstrapped admin automatically if needed
  if (isBootstrappedAdminEmail(userRow.email) && userRow.role !== 'admin') {
    sqlite.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(userRow.id);
    userRow.role = 'admin';
  }

  return mapUserRowToAccount(userRow);
}

export function getCaseByIdForUser(caseId: string, userId: string, isAdmin = false): ForensicCase | null {
  const row = isAdmin
    ? (sqlite.prepare('SELECT * FROM cases WHERE id = ?').get(caseId) as any)
    : (sqlite.prepare('SELECT * FROM cases WHERE id = ? AND user_id = ?').get(caseId, userId) as any);
  if (!row) return null;

  const versionRows = sqlite
    .prepare('SELECT * FROM case_versions WHERE case_id = ? ORDER BY version_number ASC')
    .all(row.id) as any[];

  const versions: CompositeVersion[] = versionRows.map((v) => ({
    id: v.id,
    caseId: v.case_id,
    versionNumber: v.version_number,
    imageUrl: v.image_url,
    promptUsed: v.prompt_used,
    refinementInstruction: v.refinement_instruction,
    profileSnapshot: { ...DEFAULT_FACIAL_PROFILE, ...JSON.parse(v.profile_snapshot_json || '{}') },
    provider: v.provider,
    model: v.model,
    seed: v.seed,
    estimatedCostInr: v.estimated_cost_inr,
    createdAt: v.created_at,
  }));

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    originalDescription: row.original_description,
    voiceTranscript: row.voice_transcript,
    profile: { ...DEFAULT_FACIAL_PROFILE, ...JSON.parse(row.profile_json || '{}') },
    activeImageUrl: row.active_image_url,
    styleRefId: row.style_ref_id,
    notes: row.notes || '',
    isSaved: Boolean(row.is_saved),
    status: row.status,
    versions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listCasesForUser(userId: string): ForensicCase[] {
  const rows = sqlite
    .prepare('SELECT id FROM cases WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId) as { id: string }[];
  return rows.map((r) => getCaseByIdForUser(r.id, userId)!).filter(Boolean);
}

export function recordUsageLog(params: {
  userId: string;
  operation: UsageLogRecord['operation'];
  provider: string;
  model: string;
  status: 'success' | 'error';
  latencyMs: number;
  estimatedCostInr: number;
  errorMessage?: string | null;
}): void {
  sqlite
    .prepare(`
      INSERT INTO usage_logs (id, user_id, operation, provider, model, status, latency_ms, estimated_cost_inr, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      `ulog_${crypto.randomUUID()}`,
      params.userId,
      params.operation,
      params.provider,
      params.model,
      params.status,
      params.latencyMs,
      params.estimatedCostInr,
      params.errorMessage || null,
      new Date().toISOString()
    );
}

export function getCurrentMonthAiSpendInr(): number {
  const monthPrefix = new Date().toISOString().slice(0, 7); // YYYY-MM
  const row = sqlite
    .prepare("SELECT COALESCE(SUM(estimated_cost_inr), 0) as total FROM usage_logs WHERE status = 'success' AND created_at LIKE ?")
    .get(`${monthPrefix}%`) as { total: number };
  return Number(row?.total || 0);
}
