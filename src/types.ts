export interface FacialProfile {
  // Group 1: Head & Face
  faceShape: string;
  forehead: string;
  hairline: string;
  cheeks: string;
  jawline: string;
  chin: string;

  // Group 2: Eyes & Eyebrows
  eyeShape: string;
  eyeSpacing: string;
  eyeSize: string;
  eyebrowShape: string;
  eyebrowThickness: string;

  // Group 3: Nose & Mouth
  noseShape: string;
  noseWidth: string;
  noseBridge: string;
  lipShape: string;
  mouthWidth: string;

  // Group 4: Hair
  hairstyle: string;
  hairLength: string;
  hairTexture: string;
  facialHair: string;
  beardMoustacheDetails: string;

  // Group 5: Additional Features
  ears: string;
  glasses: string;
  facialMarks: string;
  accessories: string;

  // Studio Calibration Controls
  subjectGenderPresentation: string;
  approximateAgeGroup: string;
  graphiteContrast: number; // 30 - 90
  pencilDetailWeight: number; // 30 - 90
}

export const DEFAULT_FACIAL_PROFILE: FacialProfile = {
  faceShape: 'unknown',
  forehead: 'unknown',
  hairline: 'unknown',
  cheeks: 'unknown',
  jawline: 'unknown',
  chin: 'unknown',
  eyeShape: 'unknown',
  eyeSpacing: 'unknown',
  eyeSize: 'unknown',
  eyebrowShape: 'unknown',
  eyebrowThickness: 'unknown',
  noseShape: 'unknown',
  noseWidth: 'unknown',
  noseBridge: 'unknown',
  lipShape: 'unknown',
  mouthWidth: 'unknown',
  hairstyle: 'unknown',
  hairLength: 'unknown',
  hairTexture: 'unknown',
  facialHair: 'unknown',
  beardMoustacheDetails: 'unknown',
  ears: 'unknown',
  glasses: 'unknown',
  facialMarks: 'unknown',
  accessories: 'unknown',
  subjectGenderPresentation: 'unknown',
  approximateAgeGroup: 'adult',
  graphiteContrast: 65,
  pencilDetailWeight: 72,
};

export interface StyleReference {
  id: string;
  name: string;
  description: string;
  previewUrl: string;
  promptStyleDirective: string;
  negativeDirective: string;
  paperTone: 'crisp_white' | 'warm_archival';
  isActive: boolean;
}

export interface CompositeVersion {
  id: string;
  caseId: string;
  versionNumber: number;
  imageUrl: string;
  promptUsed: string;
  refinementInstruction: string | null;
  profileSnapshot: FacialProfile;
  provider: string;
  model: string;
  seed: string;
  estimatedCostInr: number;
  createdAt: string;
}

export interface ForensicCase {
  id: string;
  userId: string;
  title: string;
  originalDescription: string;
  voiceTranscript: string | null;
  profile: FacialProfile;
  activeImageUrl: string | null;
  styleRefId: string;
  notes: string;
  isSaved: boolean;
  status: 'draft' | 'saved' | 'archived';
  versions: CompositeVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  tagline: string;
  priceInr: number;
  billingInterval: 'month' | 'year';
  generationAllowance: number;
  features: string[];
  restrictions: string[];
  isActive: boolean;
}

export interface UserAccount {
  id: string;
  firebaseUid: string | null;
  name: string;
  email: string;
  role: 'customer' | 'admin';
  accountStatus: 'active' | 'suspended';
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  authProvider: 'email' | 'google';
  planId: string;
  subscriptionStatus: 'active' | 'cancelled' | 'past_due';
  generationAllowance: number;
  usedGenerations: number;
  remainingGenerations: number;
  renewalDate: string;
  createdAt: string;
}

export interface UpiQrConfig {
  enabled: boolean;
  imageUrl: string;
  vpa: string;
  payeeName: string;
  automaticVerificationSupported: boolean;
}

export interface PaymentTransaction {
  id: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  planId: string;
  planName?: string;
  gateway: 'upi_qr' | 'razorpay' | 'cashfree' | 'sandbox';
  orderId: string;
  paymentId: string | null;
  upiUtr: string | null;
  amountInr: number;
  gatewayFeeInr: number;
  status: 'created' | 'pending_verification' | 'verified' | 'rejected' | 'failed' | 'refunded';
  verifiedServerSide: boolean;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  adminNote: string | null;
  createdAt: string;
}

export interface UsageLogRecord {
  id: string;
  userId: string;
  userEmail?: string;
  operation: 'extract_profile' | 'transcribe_voice' | 'generate_composite' | 'refine_composite';
  provider: string;
  model: string;
  status: 'success' | 'error';
  latencyMs: number;
  estimatedCostInr: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface AdminOverviewData {
  financials: {
    grossRevenueInr: number;
    totalSuccessfulPayments: number;
    pendingVerificationCount: number;
    sandboxVerifiedCount: number;
    paymentProcessingFeesInr: number;
    aiUsageCostInr: number;
    estimatedGenerationCostAvgInr: number;
    hostingStorageEstimateInr: number;
    estimatedOperatingMarginInr: number;
    monthlySpendCapInr: number;
    spendAlertThresholdPercent: number;
  };
  providerConfig: {
    activeImageProvider: 'ai_horde_graphite' | 'local_sd_webui' | 'huggingface_sdxl' | 'gemini_image';
    extractionModel: string;
    transcriptionModel: string;
    paidGeminiImageApproved: boolean;
    free300BudgetApproved: boolean;
    rateLimitPerMinute: number;
    localSdUrl: string;
    huggingfaceConfigured: boolean;
    geminiKeyConfigured: boolean;
    smtpConfigured: boolean;
    livePaymentGatewayConfigured: boolean;
    automaticPaymentVerificationSupported: boolean;
    activeGatewayName: string;
    upiQr: UpiQrConfig;
  };
  users: UserAccount[];
  plans: SubscriptionPlan[];
  payments: PaymentTransaction[];
  recentUsage: UsageLogRecord[];
  styles: StyleReference[];
  alerts: string[];
}
