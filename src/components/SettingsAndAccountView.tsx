import React, { useState } from 'react';
import { KeyRound, LogOut, Mail, ShieldCheck, User } from 'lucide-react';
import { api } from '../lib/api.ts';
import { UserAccount } from '../types.ts';
import { GlassButton, GlassPanel } from './LiquidGlassUI.tsx';

interface SettingsAndAccountViewProps {
  user: UserAccount;
  smtpConfigured: boolean;
  onUserUpdated: (user: UserAccount) => void;
  onNavigateSubscription: () => void;
  onLogout: () => void;
  notify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export const SettingsAndAccountView: React.FC<SettingsAndAccountViewProps> = ({
  user,
  smtpConfigured,
  onUserUpdated,
  onNavigateSubscription,
  onLogout,
  notify,
}) => {
  const [name, setName] = useState(user.name);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(user.twoFactorEnabled);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [verifyOtpCode, setVerifyOtpCode] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await api.updateProfile({ name, twoFactorEnabled });
      onUserUpdated(res.user);
      notify('success', 'Profile Saved', 'Account settings updated.');
    } catch (err: any) {
      setTwoFactorEnabled(user.twoFactorEnabled);
      notify('error', 'Update Failed', err?.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPassword(true);
    try {
      await api.updatePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      notify('success', 'Password Updated', 'Your account password has been changed.');
    } catch (err: any) {
      notify('error', 'Password Change Failed', err?.message);
    } finally {
      setSavingPassword(false);
    }
  };

  const handleRequestEmailVerify = async () => {
    try {
      await api.sendOtp({ email: user.email, purpose: 'verify_email' });
      setOtpRequested(true);
      notify('info', 'Verification Email Dispatched', `Check ${user.email} for your 6-digit code.`);
    } catch (err: any) {
      notify('error', 'Email Verification Unavailable', err?.message);
    }
  };

  const handleConfirmEmailVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.verifyOtp({
        email: user.email,
        code: verifyOtpCode,
        purpose: 'verify_email',
      });
      if (res.user) onUserUpdated(res.user);
      setOtpRequested(false);
      setVerifyOtpCode('');
      notify('success', 'Email Verified', 'Your email address is now verified.');
    } catch (err: any) {
      notify('error', 'OTP Verification Failed', err?.message);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[#F5F5F7]">Account &amp; Security Settings</h2>
          <p className="text-xs text-[#989BA6] mt-1">
            Manage your profile identity, authentication security, and privacy preferences.
          </p>
        </div>
        <GlassButton variant="danger" size="sm" onClick={onLogout}>
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </GlassButton>
      </div>

      {/* Profile & Two-Step Verification */}
      <GlassPanel className="p-6 space-y-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#F5F5F7]">
          <User className="w-4 h-4 text-[#7AA7FF]" />
          <span>Profile Information &amp; Security</span>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs text-[#989BA6]">Display Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-xl bg-[#08090D] border border-white/[0.1] text-[#F5F5F7] focus:outline-none focus:border-[#7AA7FF]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs text-[#989BA6]">Account Email</label>
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  disabled
                  value={user.email}
                  className="w-full px-3.5 py-2 text-sm rounded-xl bg-[#101116] border border-white/[0.07] text-[#989BA6]"
                />
              </div>
              <p className="text-[11px] text-[#989BA6]">
                Auth method: {user.authProvider} ·{' '}
                {user.emailVerified ? (
                  <span className="text-[#68D6A3]">Email verified</span>
                ) : (
                  <span className="text-[#E8BB75]">Unverified email</span>
                )}
              </p>
            </div>
          </div>

          {!user.emailVerified && (
            <div className="p-3.5 rounded-xl bg-[#101116] border border-white/[0.08] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-[#989BA6]">
                  {smtpConfigured
                    ? 'Verify your email address via 6-digit OTP.'
                    : 'SMTP provider is not configured on the server; email OTP verification will activate once SMTP variables are set.'}
                </span>
                {smtpConfigured && !otpRequested && (
                  <GlassButton type="button" variant="secondary" size="sm" onClick={handleRequestEmailVerify}>
                    <Mail className="w-3.5 h-3.5" />
                    Send Verification OTP
                  </GlassButton>
                )}
              </div>

              {otpRequested && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    maxLength={6}
                    value={verifyOtpCode}
                    onChange={(e) => setVerifyOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6-digit OTP"
                    className="px-3 py-1.5 text-xs font-mono rounded-lg bg-[#08090D] border border-white/[0.1] text-[#F5F5F7]"
                  />
                  <GlassButton type="button" variant="primary" size="sm" onClick={handleConfirmEmailVerify}>
                    Confirm Code
                  </GlassButton>
                </div>
              )}
            </div>
          )}

          {/* 2FA Toggle */}
          <div className="pt-2 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-[#F5F5F7]">Two-Step Login Verification (Email OTP)</p>
              <p className="text-[11px] text-[#989BA6]">
                Requires a genuine 6-digit email OTP on every password sign-in (requires configured SMTP server).
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={twoFactorEnabled}
              onClick={() => setTwoFactorEnabled(!twoFactorEnabled)}
              className={`w-11 h-6 rounded-full p-0.5 transition-colors cursor-pointer ${
                twoFactorEnabled ? 'bg-[#7AA7FF]' : 'bg-white/15'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-[#08090D] transition-transform ${
                  twoFactorEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="flex justify-end pt-2">
            <GlassButton type="submit" variant="primary" size="sm" disabled={savingProfile}>
              {savingProfile ? 'Saving...' : 'Save Profile Changes'}
            </GlassButton>
          </div>
        </form>
      </GlassPanel>

      {/* Password Update */}
      <GlassPanel className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#F5F5F7]">
          <KeyRound className="w-4 h-4 text-[#A78BFA]" />
          <span>Password Management</span>
        </div>

        <form onSubmit={handleSavePassword} className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
          <div className="space-y-1.5">
            <label className="block text-xs text-[#989BA6]">
              Current Password {user.authProvider === 'google' && '(leave blank if setting first password)'}
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3.5 py-2 text-sm rounded-xl bg-[#08090D] border border-white/[0.1] text-[#F5F5F7] focus:outline-none focus:border-[#7AA7FF]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs text-[#989BA6]">New Password (min 8 chars)</label>
            <div className="flex gap-2">
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New strong password"
                className="flex-1 px-3.5 py-2 text-sm rounded-xl bg-[#08090D] border border-white/[0.1] text-[#F5F5F7] focus:outline-none focus:border-[#7AA7FF]"
              />
              <GlassButton type="submit" variant="secondary" size="sm" disabled={savingPassword}>
                Update
              </GlassButton>
            </div>
          </div>
        </form>
      </GlassPanel>

      {/* Subscription Quick Summary & Privacy Retention */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <GlassPanel className="p-5 space-y-3">
          <p className="text-sm font-semibold text-[#F5F5F7]">Subscription &amp; Allowance</p>
          <p className="text-xs text-[#989BA6] font-mono tabular-nums">
            Plan: {user.planId} · {user.remainingGenerations} / {user.generationAllowance} credits remaining
          </p>
          <GlassButton variant="secondary" size="sm" onClick={onNavigateSubscription}>
            Manage Subscription &amp; Usage
          </GlassButton>
        </GlassPanel>

        <GlassPanel className="p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#F5F5F7]">
            <ShieldCheck className="w-4 h-4 text-[#68D6A3]" />
            <span>Privacy &amp; Responsible Positioning</span>
          </div>
          <p className="text-xs text-[#989BA6] leading-relaxed">
            DEDSEC stores only your saved case files, descriptions, and composite versions. Voice
            audio is transcribed transiently and never retained as permanent audio files. All outputs
            are illustrative fictional facial sketches.
          </p>
        </GlassPanel>
      </div>
    </div>
  );
};
