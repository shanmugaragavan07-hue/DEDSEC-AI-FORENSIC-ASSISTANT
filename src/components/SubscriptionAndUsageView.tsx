import React, { useEffect, useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Info,
  QrCode,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  PaymentTransaction,
  SubscriptionPlan,
  UpiQrConfig,
  UsageLogRecord,
  UserAccount,
} from '../types.ts';
import { GlassButton, GlassModal, GlassPanel } from './LiquidGlassUI.tsx';

interface SubscriptionAndUsageViewProps {
  user: UserAccount;
  initialTab?: 'subscription' | 'usage';
  onUserUpdated: (user: UserAccount) => void;
  notify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

declare global {
  interface Window {
    Razorpay?: any;
  }
}

export const SubscriptionAndUsageView: React.FC<SubscriptionAndUsageViewProps> = ({
  user,
  initialTab = 'subscription',
  onUserUpdated,
  notify,
}) => {
  const [tab, setTab] = useState<'subscription' | 'usage'>(initialTab);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [usageLogs, setUsageLogs] = useState<UsageLogRecord[]>([]);
  const [activeGateway, setActiveGateway] = useState<'upi_qr' | 'razorpay' | 'cashfree' | 'sandbox'>('upi_qr');
  const [autoVerificationSupported, setAutoVerificationSupported] = useState(false);
  const [upiQrConfig, setUpiQrConfig] = useState<UpiQrConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [processingPlanId, setProcessingPlanId] = useState<string | null>(null);

  // Google Pay UPI QR Checkout Modal State
  const [upiCheckout, setUpiCheckout] = useState<{
    orderId: string;
    amountInr: number;
    plan: SubscriptionPlan;
    upiQr: UpiQrConfig;
    upiIntentUri?: string;
    notice: string;
    submittedPayment: PaymentTransaction | null;
  } | null>(null);
  const [utrInput, setUtrInput] = useState('');
  const [submittingUtr, setSubmittingUtr] = useState(false);
  const [utrError, setUtrError] = useState<string | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const loadSummary = async () => {
    setLoading(true);
    try {
      const res = await api.getSubscriptionSummary();
      setPlans(res.plans);
      setPayments(res.payments);
      setUsageLogs(res.usageLogs);
      setActiveGateway(res.activeGateway);
      setAutoVerificationSupported(res.automaticVerificationSupported);
      setUpiQrConfig(res.upiQr);
      onUserUpdated(res.user);
    } catch (err: any) {
      notify('error', 'Billing Load Error', err?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, []);

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify('info', `${label} Copied`, value);
    } catch {
      notify('info', label, value);
    }
  };

  const loadRazorpayScript = (): Promise<boolean> =>
    new Promise((resolve) => {
      if (window.Razorpay) {
        resolve(true);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });

  const handleSelectPlan = async (plan: SubscriptionPlan) => {
    setProcessingPlanId(plan.id);
    setUtrError(null);
    try {
      const mode = activeGateway === 'razorpay' ? 'razorpay' : 'live';
      const orderRes = await api.createPaymentOrder(plan.id, mode);

      if (orderRes.freePlanActivated && orderRes.user) {
        onUserUpdated(orderRes.user);
        notify('success', 'Plan Updated', 'Switched to Starter Trial plan.');
        await loadSummary();
        return;
      }

      if (orderRes.gateway === 'razorpay' && orderRes.orderId && orderRes.razorpayKeyId) {
        const sdkLoaded = await loadRazorpayScript();
        if (!sdkLoaded) {
          throw new Error('Could not load Razorpay merchant checkout SDK.');
        }

        const rzp = new window.Razorpay({
          key: orderRes.razorpayKeyId,
          amount: (orderRes.amountInr || plan.priceInr) * 100,
          currency: 'INR',
          name: 'DEDSEC Forensic Studio',
          description: `${plan.name} Subscription`,
          order_id: orderRes.orderId,
          prefill: {
            name: user.name,
            email: user.email,
          },
          theme: {
            color: '#7AA7FF',
          },
          handler: async (response: {
            razorpay_order_id: string;
            razorpay_payment_id: string;
            razorpay_signature: string;
          }) => {
            try {
              const verifyRes = await api.verifyRazorpayPayment(response);
              onUserUpdated(verifyRes.user);
              notify('success', 'Subscription Activated', `Verified ${plan.name} payment on server.`);
              await loadSummary();
            } catch (vErr: any) {
              notify('error', 'Verification Failed', vErr?.message);
            }
          },
        });
        rzp.open();
        return;
      }

      if (orderRes.gateway === 'upi_qr' && orderRes.orderId && orderRes.upiQr && orderRes.plan) {
        setUtrInput('');
        setUpiCheckout({
          orderId: orderRes.orderId,
          amountInr: orderRes.amountInr || plan.priceInr,
          plan: orderRes.plan,
          upiQr: orderRes.upiQr,
          upiIntentUri: orderRes.upiIntentUri,
          notice:
            orderRes.notice ||
            'Scan the configured Google Pay UPI QR code and pay the exact amount, then submit your 12-digit UPI transaction reference (UTR) for admin verification.',
          submittedPayment: null,
        });
      }
    } catch (err: any) {
      notify('error', 'Checkout Notice', err?.message);
    } finally {
      setProcessingPlanId(null);
    }
  };

  const handleReopenCreatedOrder = (payment: PaymentTransaction) => {
    const matchedPlan = plans.find((p) => p.id === payment.planId);
    if (!matchedPlan || !upiQrConfig) return;
    setUtrInput('');
    setUtrError(null);
    const upiIntentUri = `upi://pay?pa=${encodeURIComponent(upiQrConfig.vpa)}&pn=${encodeURIComponent(
      upiQrConfig.payeeName
    )}&am=${encodeURIComponent(payment.amountInr.toFixed(2))}&cu=INR&tn=${encodeURIComponent(
      `DEDSEC ${matchedPlan.name} ${payment.orderId}`
    )}`;
    setUpiCheckout({
      orderId: payment.orderId,
      amountInr: payment.amountInr,
      plan: matchedPlan,
      upiQr: upiQrConfig,
      upiIntentUri,
      notice:
        'Complete your transfer using the configured Google Pay UPI QR code and submit your UPI transaction reference below.',
      submittedPayment: null,
    });
  };

  const handleSubmitUpiReference = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!upiCheckout) return;

    const cleanRef = utrInput.trim();
    if (!/^[A-Za-z0-9._-]{8,40}$/.test(cleanRef)) {
      setUtrError('Enter a valid 12-digit UTR or UPI Transaction ID (8–40 letters/digits, no spaces).');
      return;
    }

    setSubmittingUtr(true);
    setUtrError(null);
    try {
      const res = await api.submitUpiReference({
        orderId: upiCheckout.orderId,
        upiTransactionRef: cleanRef,
      });
      setUpiCheckout({
        ...upiCheckout,
        submittedPayment: res.payment,
      });
      onUserUpdated(res.user);
      notify(
        'info',
        'Payment Pending Verification',
        'Your UPI reference was recorded. Your subscription will activate after administrator approval.'
      );
      await loadSummary();
    } catch (err: any) {
      setUtrError(err?.message || 'Could not submit UPI transaction reference.');
    } finally {
      setSubmittingUtr(false);
    }
  };

  const pendingPayments = payments.filter((p) => p.status === 'pending_verification' && p.gateway === 'upi_qr');
  const unsubmittedOrders = payments.filter((p) => p.status === 'created' && p.gateway === 'upi_qr');
  const recentRejectedPayments = payments.filter((p) => p.status === 'rejected' && p.gateway === 'upi_qr').slice(0, 2);

  const usagePercent =
    user.generationAllowance > 0
      ? Math.min(100, Math.round((user.usedGenerations / user.generationAllowance) * 100))
      : 100;

  const formatPaymentStatus = (p: PaymentTransaction) => {
    if (p.status === 'verified') return 'Verified · Subscription Activated';
    if (p.status === 'pending_verification') return 'Payment Pending · Awaiting Admin Review';
    if (p.status === 'rejected') return 'Rejected · Not Verified';
    if (p.status === 'created') return 'Awaiting UPI Reference Submission';
    if (p.status === 'failed') return 'Failed';
    return p.status;
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-8">
      {/* Header & View Switch */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[#F5F5F7]">Subscription &amp; Usage Quota</h2>
          <p className="text-xs text-[#989BA6] mt-1">
            Google Pay UPI QR billing with verified transaction approval before subscription activation.
          </p>
        </div>

        <div className="inline-flex items-center p-1 rounded-xl bg-[#101116] border border-white/[0.08] gap-1 self-start">
          <button
            type="button"
            onClick={() => setTab('subscription')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
              tab === 'subscription' ? 'bg-[#181A22] text-[#F5F5F7]' : 'text-[#989BA6] hover:text-[#F5F5F7]'
            }`}
          >
            Plans &amp; Billing
          </button>
          <button
            type="button"
            onClick={() => setTab('usage')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
              tab === 'usage' ? 'bg-[#181A22] text-[#F5F5F7]' : 'text-[#989BA6] hover:text-[#F5F5F7]'
            }`}
          >
            Usage &amp; Payment History
          </button>
        </div>
      </div>

      {/* Current Allowance Summary Strip */}
      <GlassPanel className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
          <div className="space-y-1">
            <p className="text-xs text-[#989BA6]">Active Plan</p>
            <p className="text-lg font-semibold text-[#F5F5F7]">
              {plans.find((p) => p.id === user.planId)?.name || user.planId}
            </p>
            <p className="text-xs text-[#68D6A3]">Status · {user.subscriptionStatus}</p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-[#989BA6]">Used Generations</p>
            <p className="text-lg font-semibold font-mono tabular-nums text-[#F5F5F7]">
              {user.usedGenerations} / {user.generationAllowance}
            </p>
            <p className="text-xs text-[#989BA6]">Failed calls never deduct credits</p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-[#989BA6]">Remaining Credits</p>
            <p className="text-lg font-semibold font-mono tabular-nums text-[#7AA7FF]">
              {user.remainingGenerations}
            </p>
            <p className="text-xs text-[#989BA6]">
              Renews {new Date(user.renewalDate).toLocaleDateString()}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs font-mono tabular-nums text-[#989BA6]">
              <span>Monthly Quota</span>
              <span>{usagePercent}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-white/[0.08] overflow-hidden">
              <div
                className={`h-full transition-all ${
                  usagePercent >= 90 ? 'bg-[#E8BB75]' : 'bg-[#7AA7FF]'
                }`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
            {user.planId !== 'free_trial' && (
              <button
                type="button"
                onClick={async () => {
                  const res = await api.cancelSubscription();
                  onUserUpdated(res.user);
                  notify('info', 'Subscription Cancelled', 'Reverted account to Starter Trial.');
                  loadSummary();
                }}
                className="text-[11px] text-[#989BA6] hover:text-red-300 underline cursor-pointer"
              >
                Cancel paid plan
              </button>
            )}
          </div>
        </div>
      </GlassPanel>

      {/* Prominent Payment Pending Verification Banner */}
      {pendingPayments.length > 0 && (
        <div className="p-5 rounded-2xl bg-[#101116] border border-[#E8BB75]/40 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 text-[#E8BB75] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-[#F5F5F7]">
                  Payment Pending Administrator Verification
                </h3>
                <p className="text-xs text-[#989BA6] leading-relaxed">
                  Your UPI transaction reference has been recorded. Subscriptions do not activate automatically on UTR
                  submission—an administrator verifies receipt in Google Pay before unlocking plan credits.
                </p>
              </div>
            </div>
            <GlassButton variant="ghost" size="sm" onClick={loadSummary}>
              <RefreshCw className="w-3.5 h-3.5" />
              Check Status
            </GlassButton>
          </div>

          <div className="divide-y divide-white/[0.06] border-t border-white/[0.08] pt-2">
            {pendingPayments.map((p) => (
              <div
                key={p.id}
                className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="text-[#F5F5F7]">
                  <span className="font-medium">{p.planName || p.planId}</span>
                  <span className="text-[#989BA6]"> · </span>
                  <span className="font-mono tabular-nums text-[#F5F5F7]">
                    ₹{p.amountInr.toLocaleString('en-IN')}
                  </span>
                  <span className="text-[#989BA6]"> · Order </span>
                  <span className="font-mono text-[#989BA6]">{p.orderId}</span>
                </div>
                <div className="text-[#E8BB75] font-mono tabular-nums">
                  UTR {p.upiUtr} · Pending Review
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Rejected Payment Feedback */}
      {recentRejectedPayments.length > 0 && pendingPayments.length === 0 && (
        <div className="p-4 rounded-xl bg-[#101116] border border-red-400/30 flex items-start gap-3">
          <XCircle className="w-4 h-4 text-red-300 shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <p className="text-[#F5F5F7] font-medium">Recent UPI Verification Rejected</p>
            {recentRejectedPayments.map((p) => (
              <p key={p.id} className="text-[#989BA6]">
                {p.planName || p.planId} · ₹{p.amountInr.toLocaleString('en-IN')} · UTR{' '}
                <span className="font-mono text-[#F5F5F7]">{p.upiUtr || 'N/A'}</span>
                {p.adminNote ? ` — ${p.adminNote}` : ''}
              </p>
            ))}
          </div>
        </div>
      )}

      {tab === 'subscription' ? (
        <div className="space-y-6">
          {/* Explicit Verification Mode Explanation */}
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-start gap-3">
            <Info className="w-4 h-4 text-[#7AA7FF] shrink-0 mt-0.5" />
            <div className="text-xs text-[#989BA6] leading-relaxed">
              <span className="text-[#F5F5F7] font-medium">Google Pay UPI QR Verification Policy: </span>
              {autoVerificationSupported ? (
                <>
                  Live merchant gateway webhooks are active—verified payments unlock plan allowances automatically after
                  cryptographic signature validation.
                </>
              ) : (
                <>
                  Automatic payment verification is <span className="text-[#F5F5F7]">not supported</span> by the
                  current static Google Pay UPI QR setup (<span className="font-mono text-[#F5F5F7]">{upiQrConfig?.vpa || 'shanmugaragavan15@okicici'}</span>),
                  because direct peer-to-peer VPA QR transfers do not send bank webhooks to the server. After scanning
                  and paying the exact plan amount, submit your 12-digit UPI transaction reference (UTR); your
                  subscription activates only after administrator verification and approval.
                </>
              )}
            </div>
          </div>

          {/* Resume Unsubmitted UPI Order if present */}
          {unsubmittedOrders.length > 0 && (
            <div className="p-4 rounded-xl bg-[#101116] border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-[#989BA6]">
                <span className="text-[#F5F5F7] font-medium">Open UPI Payment Order: </span>
                {unsubmittedOrders[0].planName || unsubmittedOrders[0].planId} · ₹
                {unsubmittedOrders[0].amountInr.toLocaleString('en-IN')} ·{' '}
                <span className="font-mono">{unsubmittedOrders[0].orderId}</span> (awaiting UTR submission)
              </div>
              <GlassButton
                variant="secondary"
                size="sm"
                onClick={() => handleReopenCreatedOrder(unsubmittedOrders[0])}
              >
                <QrCode className="w-3.5 h-3.5" />
                View QR &amp; Submit UTR
              </GlassButton>
            </div>
          )}

          {/* Plan Selection Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
            {plans.map((plan) => {
              const isCurrent = user.planId === plan.id;
              const pendingForPlan = pendingPayments.find((p) => p.planId === plan.id);

              return (
                <div
                  key={plan.id}
                  className={`rounded-2xl p-6 flex flex-col justify-between border ${
                    isCurrent
                      ? 'bg-[#181A22] border-[#7AA7FF]'
                      : pendingForPlan
                      ? 'bg-[#101116] border-[#E8BB75]/45'
                      : 'bg-[#101116] border-white/[0.08]'
                  }`}
                >
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-base font-semibold text-[#F5F5F7]">{plan.name}</h3>
                        <p className="text-xs text-[#989BA6] mt-1">{plan.tagline}</p>
                      </div>
                      {isCurrent ? (
                        <span className="text-xs font-medium text-[#68D6A3]">Active</span>
                      ) : pendingForPlan ? (
                        <span className="text-xs font-medium text-[#E8BB75]">Pending Review</span>
                      ) : null}
                    </div>

                    <div className="pt-2 pb-4 border-b border-white/[0.08] flex items-baseline gap-1.5">
                      <span className="text-3xl font-bold font-mono tabular-nums text-[#F5F5F7]">
                        {plan.priceInr === 0 ? '₹0' : `₹${plan.priceInr.toLocaleString('en-IN')}`}
                      </span>
                      <span className="text-xs text-[#989BA6]">/ {plan.billingInterval}</span>
                    </div>

                    <p className="text-xs font-mono tabular-nums text-[#7AA7FF]">
                      {plan.generationAllowance.toLocaleString('en-IN')} generations / month
                    </p>

                    <ul className="space-y-2.5 pt-1">
                      {plan.features.map((f, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-xs text-[#F5F5F7]/90">
                          <Check className="w-3.5 h-3.5 text-[#68D6A3] shrink-0 mt-0.5" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-6 mt-6 border-t border-white/[0.07]">
                    {pendingForPlan ? (
                      <div className="space-y-2">
                        <GlassButton variant="secondary" className="w-full" disabled>
                          <Clock className="w-4 h-4 text-[#E8BB75]" />
                          Payment Pending Verification
                        </GlassButton>
                        <p className="text-[11px] text-center font-mono text-[#989BA6]">
                          UTR {pendingForPlan.upiUtr} under review
                        </p>
                      </div>
                    ) : (
                      <GlassButton
                        variant={isCurrent ? 'secondary' : 'primary'}
                        className="w-full"
                        disabled={isCurrent || processingPlanId === plan.id || loading}
                        onClick={() => handleSelectPlan(plan)}
                      >
                        {plan.priceInr > 0 && activeGateway === 'upi_qr' ? (
                          <QrCode className="w-4 h-4" />
                        ) : (
                          <CreditCard className="w-4 h-4" />
                        )}
                        {isCurrent
                          ? 'Current Active Plan'
                          : processingPlanId === plan.id
                          ? 'Preparing Order...'
                          : plan.priceInr === 0
                          ? 'Switch to Starter'
                          : activeGateway === 'upi_qr'
                          ? `Pay ₹${plan.priceInr.toLocaleString('en-IN')} via GPay QR`
                          : `Subscribe · ₹${plan.priceInr.toLocaleString('en-IN')}`}
                      </GlassButton>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Payment Transactions Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#F5F5F7]">Payment Verification History</h3>
              <GlassButton variant="ghost" size="sm" onClick={loadSummary}>
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </GlassButton>
            </div>

            <div className="rounded-2xl bg-[#101116] border border-white/[0.08] overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-white/[0.08] text-[#989BA6]">
                    <th className="py-3 px-4 font-medium">Date</th>
                    <th className="py-3 px-4 font-medium">Plan</th>
                    <th className="py-3 px-4 font-medium">Order &amp; UPI Reference</th>
                    <th className="py-3 px-4 font-medium">Method</th>
                    <th className="py-3 px-4 font-medium text-right">Amount</th>
                    <th className="py-3 px-4 font-medium">Verification Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {payments.filter((p) => p.gateway !== 'sandbox').length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 px-4 text-center text-[#989BA6]">
                        No subscription payment transactions recorded yet.
                      </td>
                    </tr>
                  ) : (
                    payments
                      .filter((p) => p.gateway !== 'sandbox')
                      .map((p) => (
                        <tr key={p.id} className="hover:bg-white/[0.02]">
                          <td className="py-3 px-4 font-mono tabular-nums text-[#989BA6]">
                            {new Date(p.createdAt).toLocaleString()}
                          </td>
                          <td className="py-3 px-4 text-[#F5F5F7] font-medium">
                            {p.planName || p.planId}
                          </td>
                          <td className="py-3 px-4 font-mono text-[#989BA6]">
                            <div>{p.orderId}</div>
                            {p.upiUtr ? (
                              <div className="text-[#F5F5F7] text-[11px] mt-0.5">UTR: {p.upiUtr}</div>
                            ) : p.status === 'created' && p.gateway === 'upi_qr' ? (
                              <button
                                type="button"
                                onClick={() => handleReopenCreatedOrder(p)}
                                className="text-[#7AA7FF] hover:underline text-[11px] mt-0.5 cursor-pointer"
                              >
                                Submit UPI reference →
                              </button>
                            ) : null}
                          </td>
                          <td className="py-3 px-4 text-[#989BA6]">
                            {p.gateway === 'upi_qr' ? 'Google Pay UPI QR' : p.gateway}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-[#F5F5F7]">
                            ₹{p.amountInr.toLocaleString('en-IN')}
                          </td>
                          <td className="py-3 px-4">
                            <div
                              className={
                                p.status === 'verified'
                                  ? 'text-[#68D6A3]'
                                  : p.status === 'rejected' || p.status === 'failed'
                                  ? 'text-red-300'
                                  : 'text-[#E8BB75]'
                              }
                            >
                              {formatPaymentStatus(p)}
                            </div>
                            {p.adminNote && (
                              <div className="text-[11px] text-[#989BA6] mt-0.5">{p.adminNote}</div>
                            )}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Customer AI Usage Ledger */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[#F5F5F7]">Recent AI Operations</h3>
            <div className="rounded-2xl bg-[#101116] border border-white/[0.08] overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-white/[0.08] text-[#989BA6]">
                    <th className="py-3 px-4 font-medium">Timestamp</th>
                    <th className="py-3 px-4 font-medium">Operation</th>
                    <th className="py-3 px-4 font-medium">Provider / Model</th>
                    <th className="py-3 px-4 font-medium text-right">Duration</th>
                    <th className="py-3 px-4 font-medium">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {usageLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 px-4 text-center text-[#989BA6]">
                        No composite operations logged yet.
                      </td>
                    </tr>
                  ) : (
                    usageLogs.map((u) => (
                      <tr key={u.id} className="hover:bg-white/[0.02]">
                        <td className="py-3 px-4 font-mono tabular-nums text-[#989BA6]">
                          {new Date(u.createdAt).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-[#F5F5F7]">{u.operation.replace(/_/g, ' ')}</td>
                        <td className="py-3 px-4 font-mono text-[#989BA6]">
                          {u.provider} / {u.model}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-[#989BA6]">
                          {(u.latencyMs / 1000).toFixed(1)}s
                        </td>
                        <td className="py-3 px-4">
                          <span className={u.status === 'success' ? 'text-[#68D6A3]' : 'text-[#E8BB75]'}>
                            {u.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Real Configured Google Pay UPI QR Checkout Modal */}
      <GlassModal
        open={Boolean(upiCheckout)}
        onClose={() => {
          if (!submittingUtr) setUpiCheckout(null);
        }}
        title={
          upiCheckout?.submittedPayment
            ? 'Payment Pending Administrator Verification'
            : 'Pay via Configured Google Pay UPI QR'
        }
        subtitle={
          upiCheckout?.submittedPayment
            ? 'Your transaction reference is queued for manual verification before plan activation.'
            : 'Scan with Google Pay, PhonePe, Paytm, or any BHIM UPI app and pay the exact amount shown.'
        }
        maxWidthClass="max-w-xl"
      >
        {upiCheckout && (
          <div className="space-y-5">
            {upiCheckout.submittedPayment ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-[#08090D] border border-[#E8BB75]/40 space-y-2.5 text-xs">
                  <div className="flex items-center gap-2 text-[#E8BB75] font-medium">
                    <Clock className="w-4 h-4" />
                    <span>Status · Payment Pending Verification</span>
                  </div>
                  <p className="text-[#989BA6] leading-relaxed">
                    Your subscription has <span className="text-[#F5F5F7]">not</span> been activated yet. Because
                    static Google Pay UPI QR codes do not support automatic bank webhooks, an administrator will verify
                    your transfer in Google Pay and approve your plan upgrade.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-[#08090D] border border-white/[0.08] space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[#989BA6]">Selected Plan</span>
                    <span className="text-[#F5F5F7] font-semibold">{upiCheckout.plan.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#989BA6]">Payable Amount</span>
                    <span className="font-mono tabular-nums text-[#F5F5F7] font-semibold">
                      ₹{upiCheckout.amountInr.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#989BA6]">Order ID</span>
                    <span className="font-mono text-[#989BA6]">{upiCheckout.orderId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#989BA6]">Submitted UPI Reference (UTR)</span>
                    <span className="font-mono text-[#7AA7FF] font-semibold">
                      {upiCheckout.submittedPayment.upiUtr}
                    </span>
                  </div>
                </div>

                <div className="flex justify-end">
                  <GlassButton variant="primary" onClick={() => setUpiCheckout(null)}>
                    Done
                  </GlassButton>
                </div>
              </div>
            ) : (
              <>
                {/* Step 1 & 2: Exact Payable Amount + Configured Google Pay QR */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                  <div className="bg-white rounded-2xl p-3 border border-white/20 flex flex-col items-center">
                    <img
                      src={upiCheckout.upiQr.imageUrl}
                      alt={`Google Pay UPI QR for ${upiCheckout.upiQr.payeeName}`}
                      className="w-full max-w-[230px] h-auto rounded-lg object-contain"
                    />
                  </div>

                  <div className="space-y-3 text-xs">
                    <div className="p-3.5 rounded-xl bg-[#08090D] border border-white/[0.08] space-y-2">
                      <div>
                        <span className="text-[#989BA6] block">Selected Plan</span>
                        <span className="text-sm font-semibold text-[#F5F5F7]">
                          {upiCheckout.plan.name}
                        </span>
                      </div>

                      <div className="pt-2 border-t border-white/[0.07]">
                        <span className="text-[#989BA6] block">Exact Amount to Pay</span>
                        <span className="text-2xl font-bold font-mono tabular-nums text-[#7AA7FF]">
                          ₹{upiCheckout.amountInr.toLocaleString('en-IN')}.00
                        </span>
                      </div>

                      <div className="pt-2 border-t border-white/[0.07] space-y-1">
                        <span className="text-[#989BA6] block">Payee</span>
                        <span className="text-[#F5F5F7] font-medium block">
                          {upiCheckout.upiQr.payeeName}
                        </span>
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <span className="font-mono text-[11px] text-[#989BA6] break-all">
                            {upiCheckout.upiQr.vpa}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyText(upiCheckout.upiQr.vpa, 'UPI ID')}
                            className="inline-flex items-center gap-1 text-[11px] text-[#7AA7FF] hover:underline shrink-0 cursor-pointer"
                          >
                            <Copy className="w-3 h-3" />
                            Copy
                          </button>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-white/[0.07] flex items-center justify-between">
                        <span className="text-[#989BA6]">Order Ref</span>
                        <span className="font-mono text-[11px] text-[#F5F5F7]">{upiCheckout.orderId}</span>
                      </div>
                    </div>

                    {upiCheckout.upiIntentUri && (
                      <a
                        href={upiCheckout.upiIntentUri}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.1] text-xs font-medium text-[#F5F5F7] transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-[#7AA7FF]" />
                        Open in Mobile UPI App (₹{upiCheckout.amountInr})
                      </a>
                    )}
                  </div>
                </div>

                {/* Step 3 & 4: Submit UPI Transaction Reference */}
                <form
                  onSubmit={handleSubmitUpiReference}
                  className="p-4 rounded-xl bg-[#08090D] border border-white/[0.08] space-y-3"
                >
                  <div className="space-y-1">
                    <label htmlFor="upi-utr-input" className="block text-xs font-medium text-[#F5F5F7]">
                      Submit UPI Transaction Reference / 12-Digit UTR After Paying
                    </label>
                    <p className="text-[11px] text-[#989BA6]">
                      Locate the 12-digit UPI transaction ID / UTR in your Google Pay or bank receipt and enter it
                      below. Submitting a reference sets your order to <span className="text-[#F5F5F7]">Payment Pending</span> until verified.
                    </p>
                  </div>

                  <input
                    id="upi-utr-input"
                    type="text"
                    required
                    minLength={8}
                    maxLength={40}
                    value={utrInput}
                    onChange={(e) => setUtrInput(e.target.value)}
                    placeholder="e.g. 430518920411"
                    className="w-full px-3.5 py-2.5 text-sm font-mono rounded-xl bg-[#101116] border border-white/[0.12] text-[#F5F5F7] placeholder:text-[#989BA6]/45 focus:outline-none focus:border-[#7AA7FF]"
                  />

                  {utrError && <p className="text-xs text-red-300">{utrError}</p>}

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
                    <span className="text-[11px] text-[#989BA6]">
                      Manual verification · No instant auto-activation
                    </span>
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <GlassButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setUpiCheckout(null)}
                        disabled={submittingUtr}
                      >
                        Close
                      </GlassButton>
                      <GlassButton type="submit" variant="primary" size="sm" disabled={submittingUtr}>
                        <ShieldCheck className="w-4 h-4" />
                        {submittingUtr ? 'Submitting...' : 'Submit UPI Reference'}
                      </GlassButton>
                    </div>
                  </div>
                </form>
              </>
            )}
          </div>
        )}
      </GlassModal>
    </div>
  );
};
