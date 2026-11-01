import {
  AdminOverviewData,
  FacialProfile,
  ForensicCase,
  PaymentTransaction,
  StyleReference,
  SubscriptionPlan,
  UpiQrConfig,
  UsageLogRecord,
  UserAccount,
} from '../types.ts';

const TOKEN_STORAGE_KEY = 'dedsec_session_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data as T;
}

export const api = {
  getPublicConfig: () =>
    requestJson<{
      plans: SubscriptionPlan[];
      styles: StyleReference[];
      capabilities: {
        smtpConfigured: boolean;
        livePaymentGatewayConfigured: boolean;
        automaticPaymentVerificationSupported: boolean;
        activeGateway: string;
        razorpayKeyId: string | null;
        upiQr: UpiQrConfig;
      };
    }>('/api/public/config'),

  register: (payload: {
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
    acceptedTerms: boolean;
  }) =>
    requestJson<{
      token: string;
      user: UserAccount;
      otpVerificationRequired: boolean;
      smtpConfigured: boolean;
    }>('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }),

  login: (payload: { email: string; password: string }) =>
    requestJson<{
      token?: string;
      user?: UserAccount;
      requiresTwoFactor: boolean;
      challengeId?: string;
      email?: string;
    }>('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }),

  googleAuthBridge: (payload: {
    firebaseUid: string;
    email: string;
    name: string;
    emailVerified: boolean;
  }) =>
    requestJson<{ token: string; user: UserAccount }>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  sendOtp: (payload: { email: string; purpose: 'verify_email' | 'login_2fa' | 'reset_password' }) =>
    requestJson<{ sent: boolean; challengeId: string; expiresInSeconds: number }>('/api/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  verifyOtp: (payload: { email: string; code: string; purpose: 'verify_email' | 'login_2fa' | 'reset_password' }) =>
    requestJson<{ verified: boolean; token?: string; user?: UserAccount }>('/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  resetPassword: (payload: { email: string; code: string; newPassword: string }) =>
    requestJson<{ success: boolean }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getMe: () => requestJson<{ user: UserAccount; smtpConfigured: boolean }>('/api/auth/me'),

  logout: () => requestJson<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),

  updateProfile: (payload: { name: string; twoFactorEnabled: boolean }) =>
    requestJson<{ user: UserAccount }>('/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  updatePassword: (payload: { currentPassword?: string; newPassword: string }) =>
    requestJson<{ success: boolean }>('/api/auth/password', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  transcribeVoice: (payload: { audioBase64: string; mimeType: string }) =>
    requestJson<{ transcript: string; model: string }>('/api/ai/transcribe', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  extractProfile: (description: string) =>
    requestJson<{ profile: FacialProfile; model: string }>('/api/ai/extract-profile', {
      method: 'POST',
      body: JSON.stringify({ description }),
    }),

  generateComposite: (payload: {
    caseId?: string | null;
    caseTitle?: string;
    description: string;
    voiceTranscript?: string | null;
    profile: FacialProfile;
    styleRefId: string;
    notes?: string;
  }) =>
    requestJson<{ caseRecord: ForensicCase; user: UserAccount }>('/api/ai/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  refineComposite: (payload: { caseId: string; refinementInstruction: string }) =>
    requestJson<{ caseRecord: ForensicCase; user: UserAccount }>('/api/ai/refine', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listCases: () => requestJson<{ cases: ForensicCase[] }>('/api/cases'),

  createDraftCase: (payload: {
    title?: string;
    originalDescription?: string;
    voiceTranscript?: string | null;
    profile?: Partial<FacialProfile>;
    styleRefId?: string;
    notes?: string;
  }) =>
    requestJson<{ caseRecord: ForensicCase }>('/api/cases', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateCase: (
    caseId: string,
    payload: {
      title?: string;
      originalDescription?: string;
      profile?: FacialProfile;
      notes?: string;
      isSaved?: boolean;
      status?: 'draft' | 'saved' | 'archived';
      styleRefId?: string;
    }
  ) =>
    requestJson<{ caseRecord: ForensicCase }>(`/api/cases/${caseId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  restoreCaseVersion: (caseId: string, versionId: string) =>
    requestJson<{ caseRecord: ForensicCase }>(`/api/cases/${caseId}/restore-version`, {
      method: 'POST',
      body: JSON.stringify({ versionId }),
    }),

  deleteCase: (caseId: string) =>
    requestJson<{ success: boolean }>(`/api/cases/${caseId}`, { method: 'DELETE' }),

  getSubscriptionSummary: () =>
    requestJson<{
      user: UserAccount;
      plans: SubscriptionPlan[];
      payments: PaymentTransaction[];
      usageLogs: UsageLogRecord[];
      liveGatewayConfigured: boolean;
      automaticVerificationSupported: boolean;
      activeGateway: 'upi_qr' | 'razorpay' | 'cashfree' | 'sandbox';
      razorpayKeyId: string | null;
      upiQr: UpiQrConfig;
    }>('/api/subscriptions/summary'),

  createPaymentOrder: (planId: string, checkoutMode: 'live' | 'sandbox' | 'razorpay' = 'live') =>
    requestJson<{
      freePlanActivated?: boolean;
      user?: UserAccount;
      gateway?: 'upi_qr' | 'razorpay' | 'sandbox';
      orderId?: string;
      amountInr?: number;
      currency?: string;
      razorpayKeyId?: string;
      sandboxChallengeSignature?: string;
      upiQr?: UpiQrConfig;
      upiIntentUri?: string;
      automaticVerificationSupported?: boolean;
      plan?: SubscriptionPlan;
      notice?: string;
    }>('/api/payments/create-order', {
      method: 'POST',
      body: JSON.stringify({ planId, checkoutMode }),
    }),

  submitUpiReference: (payload: { orderId: string; upiTransactionRef: string }) =>
    requestJson<{
      pendingVerification: boolean;
      verified: boolean;
      subscriptionActivated: boolean;
      payment: PaymentTransaction;
      user: UserAccount;
      message: string;
    }>('/api/payments/upi-submit-reference', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  verifyRazorpayPayment: (payload: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) =>
    requestJson<{ verified: boolean; user: UserAccount }>('/api/payments/verify-razorpay', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  settleSandboxOrder: (payload: { orderId: string; outcome: 'success' | 'fail'; signature: string }) =>
    requestJson<{ verified: boolean; paymentId?: string; user?: UserAccount }>('/api/payments/sandbox-settle', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  cancelSubscription: () =>
    requestJson<{ cancelled: boolean; user: UserAccount }>('/api/subscriptions/cancel', {
      method: 'POST',
    }),

  getAdminOverview: () => requestJson<AdminOverviewData>('/api/admin/overview'),

  adminReviewPayment: (
    paymentId: string,
    payload: { decision: 'approve' | 'reject'; adminNote?: string }
  ) =>
    requestJson<{ reviewed: boolean; decision: 'approve' | 'reject'; payment: PaymentTransaction }>(
      `/api/admin/payments/${paymentId}/review`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  adminUpdateUser: (
    userId: string,
    payload: {
      accountStatus: 'active' | 'suspended';
      planId: string;
      customAllowance?: number | null;
      resetUsedGenerations?: boolean;
    }
  ) =>
    requestJson<{ user: UserAccount }>(`/api/admin/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  adminUpdatePlan: (
    planId: string,
    payload: { name: string; priceInr: number; generationAllowance: number; isActive: boolean }
  ) =>
    requestJson<{ plans: SubscriptionPlan[] }>(`/api/admin/plans/${planId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  adminUpdateCostSettings: (payload: {
    activeImageProvider: string;
    paidGeminiImageApproved: boolean;
    free300BudgetApproved: boolean;
    monthlySpendCapInr: number;
    spendAlertThresholdPercent: number;
    rateLimitPerMinute: number;
    hostingStorageEstimateInr: number;
    localSdUrl: string;
  }) =>
    requestJson<{ saved: boolean }>('/api/admin/cost-settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  adminUpdateStyle: (
    styleId: string,
    payload: {
      name: string;
      description: string;
      promptStyleDirective: string;
      negativeDirective: string;
      isActive: boolean;
    }
  ) =>
    requestJson<{ styles: StyleReference[] }>(`/api/admin/styles/${styleId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
};
