import React, { useState } from 'react';
import { ArrowLeft, Globe, KeyRound, Lock, Mail, ShieldCheck, User } from 'lucide-react';
import { api, setStoredToken } from '../lib/api.ts';
import { signInWithGooglePopup } from '../lib/firebase.ts';
import { UserAccount } from '../types.ts';
import { GlassButton, GlassModal, GlassPanel } from './LiquidGlassUI.tsx';

interface AuthScreenProps {
  smtpConfigured: boolean;
  onAuthenticated: (user: UserAccount) => void;
  onOpenMarketingSite: () => void;
  notify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

type AuthMode = 'login' | 'register' | 'otp_verify' | 'reset_password';

export const AuthScreen: React.FC<AuthScreenProps> = ({
  smtpConfigured,
  onAuthenticated,
  onOpenMarketingSite,
  notify,
}) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [loading, setLoading] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  // Form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // OTP & Reset states
  const [otpPurpose, setOtpPurpose] = useState<'verify_email' | 'login_2fa' | 'reset_password'>('verify_email');
  const [otpCode, setOtpCode] = useState('');
  const [newResetPassword, setNewResetPassword] = useState('');
  const [pendingUserAfterVerify, setPendingUserAfterVerify] = useState<UserAccount | null>(null);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.login({ email, password });
      if (res.requiresTwoFactor) {
        setOtpPurpose('login_2fa');
        setOtpCode('');
        setMode('otp_verify');
        notify('info', 'Two-Step Verification Required', `Enter the 6-digit code sent to ${email}.`);
      } else if (res.token && res.user) {
        setStoredToken(res.token);
        onAuthenticated(res.user);
      }
    } catch (err: any) {
      notify('error', 'Sign-in failed', err?.message || 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.register({
        name,
        email,
        password,
        confirmPassword,
        acceptedTerms,
      });
      setStoredToken(res.token);
      if (res.otpVerificationRequired) {
        setPendingUserAfterVerify(res.user);
        setOtpPurpose('verify_email');
        setOtpCode('');
        setMode('otp_verify');
        notify('info', 'Verify Your Email', `A 6-digit verification code has been dispatched to ${email}.`);
      } else {
        notify(
          'success',
          'Account Created',
          res.smtpConfigured
            ? 'Welcome to DEDSEC Studio.'
            : 'Assigned Starter Plan. Note: SMTP email delivery is not configured on this server, so email OTP was skipped transparently.'
        );
        onAuthenticated(res.user);
      }
    } catch (err: any) {
      notify('error', 'Registration failed', err?.message || 'Could not create account.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      const fbUser = await signInWithGooglePopup();
      if (!fbUser.email) {
        throw new Error('Google account did not supply an email address.');
      }
      const res = await api.googleAuthBridge({
        firebaseUid: fbUser.uid,
        email: fbUser.email,
        name: fbUser.displayName || fbUser.email.split('@')[0],
        emailVerified: fbUser.emailVerified,
      });
      setStoredToken(res.token);
      notify('success', 'Signed in with Google', `Welcome, ${res.user.name}.`);
      onAuthenticated(res.user);
    } catch (err: any) {
      const msg = err?.message || 'Google sign-in could not complete.';
      if (!msg.includes('auth/popup-closed-by-user')) {
        notify('error', 'Google Authentication Error', msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.verifyOtp({
        email,
        code: otpCode,
        purpose: otpPurpose,
      });
      if (res.token) {
        setStoredToken(res.token);
      }
      if (res.user) {
        notify('success', 'Verification Complete', 'Your identity has been verified.');
        onAuthenticated(res.user);
      } else if (pendingUserAfterVerify) {
        onAuthenticated({ ...pendingUserAfterVerify, emailVerified: true });
      }
    } catch (err: any) {
      notify('error', 'OTP Verification Failed', err?.message || 'Invalid verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestPasswordResetOtp = async () => {
    if (!email.trim()) {
      notify('error', 'Email Required', 'Enter your account email address first.');
      return;
    }
    setLoading(true);
    try {
      await api.sendOtp({ email, purpose: 'reset_password' });
      notify('info', 'Reset Code Dispatched', `Check ${email} for your 6-digit reset code.`);
    } catch (err: any) {
      notify('error', 'Cannot Send Reset Email', err?.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCompletePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.resetPassword({
        email,
        code: otpCode,
        newPassword: newResetPassword,
      });
      notify('success', 'Password Updated', 'You can now sign in with your new password.');
      setPassword('');
      setMode('login');
    } catch (err: any) {
      notify('error', 'Password Reset Failed', err?.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setLoading(true);
    try {
      await api.sendOtp({ email, purpose: otpPurpose });
      notify('info', 'Verification Code Resent', `Sent a fresh code to ${email}.`);
    } catch (err: any) {
      notify('error', 'Resend Failed', err?.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#08090D] text-[#F5F5F7] flex flex-col justify-between px-4 py-6 sm:px-8">
      {/* Top Minimal Header */}
      <div className="max-w-6xl w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-base font-bold tracking-tight text-[#F5F5F7]">DEDSEC</span>
          <span aria-hidden="true" className="text-[#989BA6]">·</span>
          <span className="text-xs text-[#989BA6]">Forensic Composite Studio</span>
        </div>
        <button
          onClick={onOpenMarketingSite}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#989BA6] hover:text-[#F5F5F7] transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Globe className="w-3.5 h-3.5 text-[#7AA7FF]" />
          Explore Product Website
        </button>
      </div>

      {/* Main Centered Liquid Glass Auth Container */}
      <div className="max-w-md w-full mx-auto my-8">
        <GlassPanel elevated className="p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="space-y-1.5 text-center">
            <h1 className="text-xl font-semibold tracking-tight text-[#F5F5F7]">
              {mode === 'login' && 'Sign in to DEDSEC Studio'}
              {mode === 'register' && 'Create your Studio Account'}
              {mode === 'otp_verify' && 'Two-Step Email Verification'}
              {mode === 'reset_password' && 'Recover Account Password'}
            </h1>
            <p className="text-xs text-[#989BA6]">
              {mode === 'login' && 'Access your saved facial composites, voice tools, and case files.'}
              {mode === 'register' && 'Includes configurable Starter Plan quota upon registration.'}
              {mode === 'otp_verify' && `Enter the 6-digit code dispatched to ${email}.`}
              {mode === 'reset_password' && 'Verify your email with an OTP to set a new password.'}
            </p>
          </div>

          {/* Mode Switcher Tabs for Login / Register */}
          {(mode === 'login' || mode === 'register') && (
            <div className="grid grid-cols-2 p-1 rounded-xl bg-[#08090D]/80 border border-white/[0.08]">
              <button
                type="button"
                onClick={() => setMode('login')}
                className={`py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                  mode === 'login' ? 'bg-[#181A22] text-[#F5F5F7] shadow-sm' : 'text-[#989BA6] hover:text-[#F5F5F7]'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setMode('register')}
                className={`py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                  mode === 'register' ? 'bg-[#181A22] text-[#F5F5F7] shadow-sm' : 'text-[#989BA6] hover:text-[#F5F5F7]'
                }`}
              >
                Register
              </button>
            </div>
          )}

          {mode === 'login' && (
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[#989BA6]">Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#989BA6] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@studio.com"
                    className="w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl bg-[#08090D]/80 border border-white/[0.1] text-[#F5F5F7] placeholder:text-[#989BA6]/50 focus:outline-none focus:border-[#7AA7FF]"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-[#989BA6]">Password</label>
                  <button
                    type="button"
                    onClick={() => setMode('reset_password')}
                    className="text-xs text-[#7AA7FF] hover:underline cursor-pointer"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#989BA6] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-3.5 py-2.5 text-sm rounded-xl bg-[#08090D]/80 border border-white/[0.1] text-[#F5F5F7] placeholder:text-[#989BA6]/50 focus:outline-none focus:border-[#7AA7FF]"
                  />
                </div>
              </div>

              <GlassButton type="submit" variant="primary" className="w-full" disabled={loading}>
                {loading ? 'Authenticating...' : 'Sign In'}
              </GlassButton>

              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-white/[0.08]" />
                <span className="shrink-0 px-3 text-[11px] text-[#989BA6]">or continue with</span>
                <div className="flex-grow border-t border-white/[0.08]" />
              </div>

              <GlassButton
                type="button"
                variant="secondary"
                className="w-full"
                onClick={handleGoogleSignIn}
                disabled={loading}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#EA4335"
                    d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3 14.7 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.8H12z"
                  />
                </svg>
                Continue with Google
              </GlassButton>
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-[#989BA6]">Full Name</label>
                <div className="relative">
                  <User className="w-4 h-4 text-[#989BA6] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Investigator or Artist Name"
                    className="w-full pl-10 pr-3.5 py-2 text-sm rounded-xl bg-[#08090D]/80 border border-white/[0.1] text-[#F5F5F7] placeholder:text-[#989BA6]/50 focus:outline-none focus:border-[#7AA7FF]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-[#989BA6]">Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#989BA6] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@studio.com"
                    className="w-full pl-10 pr-3.5 py-2 text-sm rounded-xl bg-[#08090D]/80 border border-white/[0.1] text-[#F5F5F7] placeholder:text-[#989BA6]/50 focus:outline-none focus:border-[#7AA7FF]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-[#989BA6]">Password</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 8 chars"
                    className="w-full px-3.5 py-2 text-sm rounded-xl bg-[#08090D]/80 border border-white/[0.1] text-[#F5F5F7] placeholder:text-[#989BA6]/50 focus:outline-none focus:border-[#7AA7FF]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-[#989BA6]">Confirm Password</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat password"
                    className="w-full px-3.5 py-2 text-sm rounded-xl bg-[#08090D]/80 border border-white/[0.1] text-[#F5F5F7] placeholder:text-[#989BA6]/50 focus:outline-none focus:border-[#7AA7FF]"
                  />
                </div>
              </div>

              <label className="flex items-start gap-2.5 pt-1 text-xs text-[#989BA6] cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-0.5 rounded border-white/20 bg-[#08090D] text-[#7AA7FF] focus:ring-[#7AA7FF]"
                />
                <span>
                  I accept the{' '}
                  <button
                    type="button"
                    onClick={() => setShowTermsModal(true)}
                    className="text-[#7AA7FF] hover:underline cursor-pointer"
                  >
                    Terms of Use, Privacy Policy, and Illustrative Composite Guidelines
                  </button>
                  .
                </span>
              </label>

              {!smtpConfigured && (
                <p className="text-[11px] text-[#989BA6] bg-white/[0.03] border border-white/[0.07] rounded-lg p-2.5 leading-relaxed">
                  Note: SMTP email server is not configured in environment variables yet. Your account will open directly on the Starter Plan without pretending an OTP email was sent, or you can use verified Google Sign-In below.
                </p>
              )}

              <GlassButton type="submit" variant="primary" className="w-full" disabled={loading}>
                {loading ? 'Creating Account...' : 'Create Studio Account'}
              </GlassButton>

              <GlassButton
                type="button"
                variant="secondary"
                className="w-full"
                onClick={handleGoogleSignIn}
                disabled={loading}
              >
                Sign Up with Google
              </GlassButton>
            </form>
          )}

          {mode === 'otp_verify' && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[#989BA6]">6-Digit Verification Code</label>
                <div className="relative">
                  <ShieldCheck className="w-4 h-4 text-[#7AA7FF] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    required
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full pl-10 pr-3.5 py-2.5 text-base font-mono tracking-[0.3em] rounded-xl bg-[#08090D]/80 border border-white/[0.1] text-[#F5F5F7] focus:outline-none focus:border-[#7AA7FF]"
                  />
                </div>
              </div>

              <GlassButton type="submit" variant="primary" className="w-full" disabled={loading}>
                {loading ? 'Verifying...' : 'Verify Code'}
              </GlassButton>

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={loading}
                  className="text-[#7AA7FF] hover:underline cursor-pointer"
                >
                  Resend verification code
                </button>
                {pendingUserAfterVerify ? (
                  <button
                    type="button"
                    onClick={() => onAuthenticated(pendingUserAfterVerify)}
                    className="text-[#989BA6] hover:text-[#F5F5F7] cursor-pointer"
                  >
                    Verify later
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setMode('login')}
                    className="text-[#989BA6] hover:text-[#F5F5F7] cursor-pointer"
                  >
                    Back to Sign In
                  </button>
                )}
              </div>
            </form>
          )}

          {mode === 'reset_password' && (
            <div className="space-y-4">
              {!smtpConfigured ? (
                <div className="p-4 rounded-xl bg-white/[0.04] border border-white/[0.09] space-y-2">
                  <p className="text-xs font-medium text-[#E8BB75]">SMTP Provider Not Configured</p>
                  <p className="text-xs text-[#989BA6] leading-relaxed">
                    Password reset OTP delivery requires SMTP_HOST, SMTP_USER, and SMTP_PASS to be configured on the server. DEDSEC never displays simulated reset codes. Use Google Sign-In or contact your administrator.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleCompletePasswordReset} className="space-y-3.5">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[#989BA6]">Account Email</label>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@studio.com"
                        className="flex-1 px-3.5 py-2 text-sm rounded-xl bg-[#08090D]/80 border border-white/[0.1] text-[#F5F5F7] focus:outline-none focus:border-[#7AA7FF]"
                      />
                      <GlassButton
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={handleRequestPasswordResetOtp}
                        disabled={loading}
                      >
                        Send OTP
                      </GlassButton>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[#989BA6]">6-Digit Email OTP</label>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      className="w-full px-3.5 py-2 text-sm font-mono tracking-widest rounded-xl bg-[#08090D]/80 border border-white/[0.1] text-[#F5F5F7] focus:outline-none focus:border-[#7AA7FF]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[#989BA6]">New Password</label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-[#989BA6] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="password"
                        required
                        minLength={8}
                        value={newResetPassword}
                        onChange={(e) => setNewResetPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        className="w-full pl-10 pr-3.5 py-2 text-sm rounded-xl bg-[#08090D]/80 border border-white/[0.1] text-[#F5F5F7] focus:outline-none focus:border-[#7AA7FF]"
                      />
                    </div>
                  </div>

                  <GlassButton type="submit" variant="primary" className="w-full" disabled={loading}>
                    {loading ? 'Updating Password...' : 'Reset Password'}
                  </GlassButton>
                </form>
              )}

              <button
                type="button"
                onClick={() => setMode('login')}
                className="inline-flex items-center gap-1.5 text-xs text-[#989BA6] hover:text-[#F5F5F7] cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Return to Sign In
              </button>
            </div>
          )}
        </GlassPanel>
      </div>

      {/* Responsible Positioning Footer */}
      <p className="text-center text-[11px] text-[#989BA6] max-w-xl mx-auto">
        DEDSEC creates illustrative fictional facial composites. It is not a facial-recognition or
        biometric identification tool.
      </p>

      {/* Terms & Privacy Policy Modal */}
      <GlassModal
        open={showTermsModal}
        onClose={() => setShowTermsModal(false)}
        title="Terms of Use & Privacy Policy"
        subtitle="DEDSEC AI Forensic Assistant — Responsible Use & Data Retention"
      >
        <div className="space-y-3 text-xs text-[#989BA6] leading-relaxed max-h-80 overflow-y-auto pr-1">
          <p className="text-[#F5F5F7] font-medium">1. Illustrative Fictional Scope</p>
          <p>
            DEDSEC generates illustrative black-and-white graphite composites of fictional adult
            characters based on user-supplied descriptions. Generated images are artistic
            approximations and must never be presented as biometric evidence or used for automated
            person identification.
          </p>
          <p className="text-[#F5F5F7] font-medium">2. Privacy &amp; Data Retention</p>
          <p>
            Account credentials are stored using salted scrypt password hashes. Saved composite
            cases, descriptions, and version histories remain private to your authenticated account
            until you delete them. Voice recordings are processed transiently for speech-to-text
            transcription and are not permanently stored as raw audio files.
          </p>
          <p className="text-[#F5F5F7] font-medium">3. Customer-Funded Quotas &amp; Billing</p>
          <p>
            Each subscription tier grants a fixed monthly composite allowance enforced on the
            backend. Failed generation requests do not deduct from your allowance. Payments are
            verified server-side through authorised merchant gateways.
          </p>
        </div>
        <div className="pt-4 mt-4 border-t border-white/[0.08] flex justify-end gap-2">
          <GlassButton
            variant="primary"
            size="sm"
            onClick={() => {
              setAcceptedTerms(true);
              setShowTermsModal(false);
            }}
          >
            Accept &amp; Continue
          </GlassButton>
        </div>
      </GlassModal>
    </div>
  );
};
