import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  CreditCard,
  DollarSign,
  FlaskConical,
  Palette,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Users,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import {
  AdminOverviewData,
  PaymentTransaction,
  SubscriptionPlan,
  StyleReference,
} from '../types.ts';
import { GlassButton, GlassPanel } from './LiquidGlassUI.tsx';

interface AdminDashboardViewProps {
  notify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

type AdminSection = 'financials' | 'ai_cost' | 'users' | 'plans' | 'payments' | 'styles';

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({ notify }) => {
  const [data, setData] = useState<AdminOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<AdminSection>('financials');
  const [saving, setSaving] = useState(false);

  // Admin UPI Review states
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewingPaymentId, setReviewingPaymentId] = useState<string | null>(null);

  // Isolated Admin-Only Sandbox Diagnostic state
  const [sandboxRunning, setSandboxRunning] = useState(false);

  // Editable Cost & Provider form states
  const [activeImageProvider, setActiveImageProvider] = useState('ai_horde_graphite');
  const [paidGeminiApproved, setPaidGeminiApproved] = useState(false);
  const [free300Approved, setFree300Approved] = useState(false);
  const [monthlySpendCapInr, setMonthlySpendCapInr] = useState(2500);
  const [spendAlertPercent, setSpendAlertPercent] = useState(80);
  const [rateLimitPerMin, setRateLimitPerMin] = useState(12);
  const [hostingEstimateInr, setHostingEstimateInr] = useState(0);
  const [localSdUrl, setLocalSdUrl] = useState('');

  const loadOverview = async () => {
    setLoading(true);
    try {
      const res = await api.getAdminOverview();
      setData(res);
      setActiveImageProvider(res.providerConfig.activeImageProvider);
      setPaidGeminiApproved(res.providerConfig.paidGeminiImageApproved);
      setFree300Approved(res.providerConfig.free300BudgetApproved);
      setMonthlySpendCapInr(res.financials.monthlySpendCapInr);
      setSpendAlertPercent(res.financials.spendAlertThresholdPercent);
      setRateLimitPerMin(res.providerConfig.rateLimitPerMinute);
      setHostingEstimateInr(res.financials.hostingStorageEstimateInr);
      setLocalSdUrl(res.providerConfig.localSdUrl);
    } catch (err: any) {
      notify('error', 'Admin Console Load Error', err?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const handleSaveCostSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.adminUpdateCostSettings({
        activeImageProvider,
        paidGeminiImageApproved: paidGeminiApproved,
        free300BudgetApproved: free300Approved,
        monthlySpendCapInr,
        spendAlertThresholdPercent: spendAlertPercent,
        rateLimitPerMinute: rateLimitPerMin,
        hostingStorageEstimateInr: hostingEstimateInr,
        localSdUrl,
      });
      notify('success', 'Cost & Provider Policy Saved', 'Updated server-side generation and spending safeguards.');
      await loadOverview();
    } catch (err: any) {
      notify('error', 'Save Failed', err?.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSavePlan = async (plan: SubscriptionPlan) => {
    try {
      await api.adminUpdatePlan(plan.id, {
        name: plan.name,
        priceInr: plan.priceInr,
        generationAllowance: plan.generationAllowance,
        isActive: plan.isActive,
      });
      notify('success', 'Plan Updated', `Saved pricing & quota for ${plan.name}.`);
      await loadOverview();
    } catch (err: any) {
      notify('error', 'Plan Update Error', err?.message);
    }
  };

  const handleSaveStyle = async (style: StyleReference) => {
    try {
      await api.adminUpdateStyle(style.id, {
        name: style.name,
        description: style.description,
        promptStyleDirective: style.promptStyleDirective,
        negativeDirective: style.negativeDirective,
        isActive: style.isActive,
      });
      notify('success', 'Style Reference Saved', `Updated ${style.name}.`);
      await loadOverview();
    } catch (err: any) {
      notify('error', 'Style Save Error', err?.message);
    }
  };

  const handleReviewPayment = async (payment: PaymentTransaction, decision: 'approve' | 'reject') => {
    setReviewingPaymentId(payment.id);
    try {
      const note = (reviewNotes[payment.id] || '').trim();
      await api.adminReviewPayment(payment.id, {
        decision,
        adminNote: note || undefined,
      });
      notify(
        decision === 'approve' ? 'success' : 'info',
        decision === 'approve' ? 'Payment Verified & Plan Activated' : 'Payment Rejected',
        decision === 'approve'
          ? `Approved UTR ${payment.upiUtr} and activated ${payment.planName || payment.planId} for ${payment.userEmail}.`
          : `Rejected UTR ${payment.upiUtr} for ${payment.userEmail}; subscription was not activated.`
      );
      setReviewNotes((prev) => {
        const next = { ...prev };
        delete next[payment.id];
        return next;
      });
      await loadOverview();
    } catch (err: any) {
      notify('error', 'Payment Review Failed', err?.message);
    } finally {
      setReviewingPaymentId(null);
    }
  };

  const handleRunIsolatedSandboxDiagnostic = async (outcome: 'success' | 'fail') => {
    if (!data) return;
    const paidPlan = data.plans.find((p) => p.priceInr > 0) || data.plans[0];
    if (!paidPlan) return;

    setSandboxRunning(true);
    try {
      const orderRes = await api.createPaymentOrder(paidPlan.id, 'sandbox');
      if (!orderRes.orderId || !orderRes.sandboxChallengeSignature) {
        throw new Error('Could not initialize sandbox diagnostic order.');
      }
      await api.settleSandboxOrder({
        orderId: orderRes.orderId,
        outcome,
        signature: orderRes.sandboxChallengeSignature,
      });
      notify(
        'info',
        'Sandbox Diagnostic Complete',
        'Recorded isolated HMAC test entry without affecting live revenue or customer subscriptions.'
      );
      await loadOverview();
    } catch (err: any) {
      notify('info', 'Sandbox Failure Recorded', err?.message);
      await loadOverview();
    } finally {
      setSandboxRunning(false);
    }
  };

  const copyUtr = async (utr: string) => {
    try {
      await navigator.clipboard.writeText(utr);
      notify('info', 'UTR Copied', utr);
    } catch {
      notify('info', 'UTR Reference', utr);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex-1 p-8 text-sm text-[#989BA6]">
        Loading protected administrator console...
      </div>
    );
  }

  if (!data) return null;

  const pendingUpiPayments = data.payments.filter(
    (p) => p.status === 'pending_verification' && p.gateway !== 'sandbox'
  );
  const liveLedgerPayments = data.payments.filter((p) => p.gateway !== 'sandbox');
  const sandboxLedgerPayments = data.payments.filter((p) => p.gateway === 'sandbox');

  const paymentsTabLabel =
    data.financials.pendingVerificationCount > 0
      ? `Payments (${data.financials.pendingVerificationCount} Pending)`
      : 'Payments';

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[#F5F5F7]">
            Protected Administrator &amp; Cost-Control Console
          </h2>
          <p className="text-xs text-[#989BA6] mt-1">
            Verify Google Pay UPI QR transfers, monitor customer-funded margins, enforce spend caps, and manage users.
          </p>
        </div>
        <GlassButton variant="secondary" size="sm" onClick={loadOverview}>
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh Telemetry
        </GlassButton>
      </div>

      {/* System Warnings / Alerts */}
      {data.alerts.length > 0 && (
        <div className="space-y-2">
          {data.alerts.map((alertMsg, idx) => (
            <div
              key={idx}
              className="p-3.5 rounded-xl bg-white/[0.04] border border-[#E8BB75]/30 flex items-center justify-between gap-3 text-xs text-[#E8BB75]"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{alertMsg}</span>
              </div>
              {alertMsg.includes('UPI QR') && section !== 'payments' && (
                <GlassButton variant="secondary" size="sm" onClick={() => setSection('payments')}>
                  Review Queue
                </GlassButton>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-[#101116] border border-white/[0.08] w-fit">
        {(
          [
            ['financials', 'Financials', DollarSign],
            ['payments', paymentsTabLabel, CreditCard],
            ['ai_cost', 'AI & Cost Protection', Cpu],
            ['users', `Users (${data.users.length})`, Users],
            ['plans', 'Subscription Plans', ShieldAlert],
            ['styles', 'Style Library', Palette],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              section === id
                ? 'bg-[#181A22] text-[#F5F5F7]'
                : 'text-[#989BA6] hover:text-[#F5F5F7]'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* 1. Financial Dashboard */}
      {section === 'financials' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <GlassPanel className="p-5 space-y-1">
              <p className="text-xs text-[#989BA6]">Verified Customer Revenue</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-[#F5F5F7]">
                ₹{data.financials.grossRevenueInr.toLocaleString('en-IN')}
              </p>
              <p className="text-[11px] text-[#68D6A3] font-mono tabular-nums">
                {data.financials.totalSuccessfulPayments} approved live payments ·{' '}
                <span className="text-[#E8BB75]">{data.financials.pendingVerificationCount} pending</span>
              </p>
            </GlassPanel>

            <GlassPanel className="p-5 space-y-1">
              <p className="text-xs text-[#989BA6]">Estimated AI Usage Cost</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-[#F5F5F7]">
                ₹{data.financials.aiUsageCostInr.toFixed(2)}
              </p>
              <p className="text-[11px] text-[#989BA6] font-mono tabular-nums">
                Avg ₹{data.financials.estimatedGenerationCostAvgInr.toFixed(2)} / composite
              </p>
            </GlassPanel>

            <GlassPanel className="p-5 space-y-1">
              <p className="text-xs text-[#989BA6]">Gateway &amp; Hosting Expenses</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-[#F5F5F7]">
                ₹{(data.financials.paymentProcessingFeesInr + data.financials.hostingStorageEstimateInr).toFixed(2)}
              </p>
              <p className="text-[11px] text-[#989BA6] font-mono tabular-nums">
                Fees ₹{data.financials.paymentProcessingFeesInr.toFixed(2)} · Infra ₹{data.financials.hostingStorageEstimateInr.toFixed(2)}
              </p>
            </GlassPanel>

            <GlassPanel className="p-5 space-y-1">
              <p className="text-xs text-[#989BA6]">Estimated Operating Margin</p>
              <p
                className={`text-2xl font-bold font-mono tabular-nums ${
                  data.financials.estimatedOperatingMarginInr >= 0 ? 'text-[#68D6A3]' : 'text-red-300'
                }`}
              >
                ₹{data.financials.estimatedOperatingMarginInr.toLocaleString('en-IN')}
              </p>
              <p className="text-[11px] text-[#989BA6]">
                Sandbox tests excluded from live revenue
              </p>
            </GlassPanel>
          </div>

          {/* Connectivity Summary */}
          <GlassPanel className="p-5">
            <h3 className="text-sm font-semibold text-[#F5F5F7] mb-3">Infrastructure &amp; Payment Setup Status</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div>
                <span className="text-[#989BA6] block">Active Image Engine</span>
                <span className="font-mono text-[#F5F5F7]">{data.providerConfig.activeImageProvider}</span>
              </div>
              <div>
                <span className="text-[#989BA6] block">Gemini Extraction / Voice Key</span>
                <span className={data.providerConfig.geminiKeyConfigured ? 'text-[#68D6A3]' : 'text-[#E8BB75]'}>
                  {data.providerConfig.geminiKeyConfigured ? 'Connected' : 'Not set'}
                </span>
              </div>
              <div>
                <span className="text-[#989BA6] block">Payment Collection Method</span>
                <span className="text-[#68D6A3]">{data.providerConfig.activeGatewayName}</span>
              </div>
              <div>
                <span className="text-[#989BA6] block">Automatic Payment Verification</span>
                <span
                  className={
                    data.providerConfig.automaticPaymentVerificationSupported
                      ? 'text-[#68D6A3]'
                      : 'text-[#E8BB75]'
                  }
                >
                  {data.providerConfig.automaticPaymentVerificationSupported
                    ? 'Supported (Signed Merchant Webhook)'
                    : 'Not Supported (Manual Admin Review Required)'}
                </span>
              </div>
            </div>
          </GlassPanel>
        </div>
      )}

      {/* 2. AI Provider & Cost Protection */}
      {section === 'ai_cost' && (
        <div className="space-y-6">
          <GlassPanel className="p-6">
            <form onSubmit={handleSaveCostSettings} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[#F5F5F7]">
                    Active Composite Image Provider
                  </label>
                  <select
                    value={activeImageProvider}
                    onChange={(e) => setActiveImageProvider(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm rounded-xl bg-[#08090D] border border-white/[0.1] text-[#F5F5F7] focus:outline-none focus:border-[#7AA7FF]"
                  >
                    <option value="ai_horde_graphite">
                      Open-Source Community Diffusion + Graphite Processor (₹0 Upfront)
                    </option>
                    <option value="local_sd_webui">
                      Local Self-Hosted Stable Diffusion WebUI / Forge (₹0 API Cost)
                    </option>
                    <option value="huggingface_sdxl">
                      Hugging Face Inference Router (Requires HUGGINGFACE_API_KEY)
                    </option>
                    <option value="gemini_image">
                      Paid Gemini 3.1 Flash Lite Image (Requires Explicit Owner Approval)
                    </option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[#F5F5F7]">
                    Local Stable Diffusion WebUI Endpoint (Optional)
                  </label>
                  <input
                    type="text"
                    value={localSdUrl}
                    onChange={(e) => setLocalSdUrl(e.target.value)}
                    placeholder="http://127.0.0.1:7860"
                    className="w-full px-3.5 py-2 text-sm rounded-xl bg-[#08090D] border border-white/[0.1] text-[#F5F5F7] focus:outline-none focus:border-[#7AA7FF]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-[#F5F5F7]">
                    Monthly AI Provider Spending Ceiling (₹ INR)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={monthlySpendCapInr}
                    onChange={(e) => setMonthlySpendCapInr(Number(e.target.value))}
                    className="w-full px-3.5 py-2 text-sm font-mono rounded-xl bg-[#08090D] border border-white/[0.1] text-[#F5F5F7]"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs text-[#989BA6]">Alert at (%)</label>
                    <input
                      type="number"
                      min={10}
                      max={100}
                      value={spendAlertPercent}
                      onChange={(e) => setSpendAlertPercent(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm font-mono rounded-xl bg-[#08090D] border border-white/[0.1] text-[#F5F5F7]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs text-[#989BA6]">Rate / min</label>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={rateLimitPerMin}
                      onChange={(e) => setRateLimitPerMin(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm font-mono rounded-xl bg-[#08090D] border border-white/[0.1] text-[#F5F5F7]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs text-[#989BA6]">Infra Est (₹)</label>
                    <input
                      type="number"
                      min={0}
                      value={hostingEstimateInr}
                      onChange={(e) => setHostingEstimateInr(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm font-mono rounded-xl bg-[#08090D] border border-white/[0.1] text-[#F5F5F7]"
                    />
                  </div>
                </div>
              </div>

              {/* Explicit Owner Financial Safeguards */}
              <div className="pt-4 border-t border-white/[0.08] space-y-3">
                <label className="flex items-start gap-3 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={free300Approved}
                    onChange={(e) => setFree300Approved(e.target.checked)}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-[#F5F5F7] font-medium block">
                      Approve 300 Generations / Month Free Plan Target
                    </span>
                    <span className="text-[#989BA6]">
                      Enable only when backed by zero-cost open-source capacity, local GPU hardware,
                      or an approved business budget—preventing unbudgeted free-tier subsidy.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={paidGeminiApproved}
                    onChange={(e) => setPaidGeminiApproved(e.target.checked)}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-[#F5F5F7] font-medium block">
                      Explicitly Approve Paid Gemini Image API Usage
                    </span>
                    <span className="text-[#989BA6]">
                      Locked off by default so DEDSEC never incurs paid image API charges without
                      explicit owner authorization.
                    </span>
                  </div>
                </label>
              </div>

              <div className="flex justify-end">
                <GlassButton type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Saving Policy...' : 'Save Cost & Provider Settings'}
                </GlassButton>
              </div>
            </form>
          </GlassPanel>

          {/* Recent Provider Usage & Error Audit */}
          <div className="rounded-2xl bg-[#101116] border border-white/[0.08] overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] text-[#989BA6]">
                  <th className="py-3 px-4">Time</th>
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Operation</th>
                  <th className="py-3 px-4">Provider / Model</th>
                  <th className="py-3 px-4 text-right">Est. Cost</th>
                  <th className="py-3 px-4">Status / Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {data.recentUsage.slice(0, 30).map((u) => (
                  <tr key={u.id}>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-[#989BA6]">
                      {new Date(u.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 px-4 text-[#F5F5F7]">{u.userEmail}</td>
                    <td className="py-2.5 px-4 text-[#989BA6]">{u.operation}</td>
                    <td className="py-2.5 px-4 font-mono text-[#989BA6]">
                      {u.provider} / {u.model}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[#F5F5F7]">
                      ₹{u.estimatedCostInr.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-4">
                      <span className={u.status === 'success' ? 'text-[#68D6A3]' : 'text-red-300'}>
                        {u.status}
                        {u.errorMessage ? ` — ${u.errorMessage.slice(0, 60)}` : ''}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. User Management */}
      {section === 'users' && (
        <div className="rounded-2xl bg-[#101116] border border-white/[0.08] overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] text-[#989BA6]">
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Plan</th>
                <th className="py-3 px-4 text-right">Used / Quota</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td className="py-3 px-4">
                    <p className="font-medium text-[#F5F5F7]">{u.name}</p>
                    <p className="text-[#989BA6]">{u.email}</p>
                  </td>
                  <td className="py-3 px-4 text-[#989BA6]">{u.role}</td>
                  <td className="py-3 px-4">
                    <select
                      value={u.planId}
                      onChange={async (e) => {
                        await api.adminUpdateUser(u.id, {
                          accountStatus: u.accountStatus,
                          planId: e.target.value,
                        });
                        notify('success', 'User Plan Updated', u.email);
                        loadOverview();
                      }}
                      className="bg-[#181A22] border border-white/[0.1] rounded-lg px-2 py-1 text-xs text-[#F5F5F7]"
                    >
                      {data.plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-[#F5F5F7]">
                    {u.usedGenerations} / {u.generationAllowance}
                  </td>
                  <td className="py-3 px-4">
                    <span className={u.accountStatus === 'active' ? 'text-[#68D6A3]' : 'text-red-300'}>
                      {u.accountStatus}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right space-x-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await api.adminUpdateUser(u.id, {
                          accountStatus: u.accountStatus,
                          planId: u.planId,
                          resetUsedGenerations: true,
                        });
                        notify('info', 'Quota Reset', `Reset used credits for ${u.email}.`);
                        loadOverview();
                      }}
                      className="text-[#7AA7FF] hover:underline cursor-pointer"
                    >
                      Reset Usage
                    </button>
                    {u.role !== 'admin' && (
                      <button
                        type="button"
                        onClick={async () => {
                          await api.adminUpdateUser(u.id, {
                            accountStatus: u.accountStatus === 'active' ? 'suspended' : 'active',
                            planId: u.planId,
                          });
                          loadOverview();
                        }}
                        className="text-[#E8BB75] hover:underline cursor-pointer"
                      >
                        {u.accountStatus === 'active' ? 'Suspend' : 'Activate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 4. Subscription Plan Editor */}
      {section === 'plans' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {data.plans.map((plan, idx) => (
            <GlassPanel key={plan.id} className="p-5 space-y-3.5">
              <div className="space-y-1">
                <label className="text-[11px] text-[#989BA6]">Plan Name</label>
                <input
                  type="text"
                  value={plan.name}
                  onChange={(e) => {
                    const copy = [...data.plans];
                    copy[idx] = { ...plan, name: e.target.value };
                    setData({ ...data, plans: copy });
                  }}
                  className="w-full px-3 py-1.5 text-sm rounded-lg bg-[#08090D] border border-white/[0.1] text-[#F5F5F7]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] text-[#989BA6]">Monthly Price (₹)</label>
                  <input
                    type="number"
                    min={0}
                    value={plan.priceInr}
                    onChange={(e) => {
                      const copy = [...data.plans];
                      copy[idx] = { ...plan, priceInr: Number(e.target.value) };
                      setData({ ...data, plans: copy });
                    }}
                    className="w-full px-3 py-1.5 text-sm font-mono rounded-lg bg-[#08090D] border border-white/[0.1] text-[#F5F5F7]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-[#989BA6]">Monthly Quota</label>
                  <input
                    type="number"
                    min={0}
                    value={plan.generationAllowance}
                    onChange={(e) => {
                      const copy = [...data.plans];
                      copy[idx] = { ...plan, generationAllowance: Number(e.target.value) };
                      setData({ ...data, plans: copy });
                    }}
                    className="w-full px-3 py-1.5 text-sm font-mono rounded-lg bg-[#08090D] border border-white/[0.1] text-[#F5F5F7]"
                  />
                </div>
              </div>

              <GlassButton variant="primary" size="sm" className="w-full" onClick={() => handleSavePlan(plan)}>
                Save Plan Configuration
              </GlassButton>
            </GlassPanel>
          ))}
        </div>
      )}

      {/* 5. UPI QR Verification Queue, Live Payment Ledger & Isolated Sandbox Diagnostics */}
      {section === 'payments' && (
        <div className="space-y-6">
          {/* Configured Google Pay QR Summary & Automatic Verification Explanation */}
          <GlassPanel className="p-5">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
              <div className="flex items-center gap-4">
                <img
                  src={data.providerConfig.upiQr.imageUrl}
                  alt="Configured Google Pay UPI QR"
                  className="w-20 h-20 rounded-xl object-contain bg-white p-1 border border-white/15 shrink-0"
                />
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-2 text-[#F5F5F7] font-semibold text-sm">
                    <QrCode className="w-4 h-4 text-[#7AA7FF]" />
                    <span>Configured Google Pay UPI QR</span>
                  </div>
                  <p className="text-[#989BA6]">
                    Payee: <span className="text-[#F5F5F7]">{data.providerConfig.upiQr.payeeName}</span> · UPI ID:{' '}
                    <span className="font-mono text-[#F5F5F7]">{data.providerConfig.upiQr.vpa}</span>
                  </p>
                  <p className="text-[#989BA6] max-w-2xl leading-relaxed">
                    Automatic verification:{' '}
                    <span className="text-[#E8BB75]">
                      {data.providerConfig.automaticPaymentVerificationSupported
                        ? 'Active via signed merchant gateway webhooks.'
                        : 'Not supported by static VPA QR codes (no bank webhook push). Check your Google Pay / ICICI bank statement for the customer’s exact amount and 12-digit UTR before approving.'}
                    </span>
                  </p>
                </div>
              </div>

              <div className="text-xs font-mono tabular-nums text-[#989BA6] shrink-0">
                <div>Pending Review: {pendingUpiPayments.length}</div>
                <div>Approved Live: {data.financials.totalSuccessfulPayments}</div>
              </div>
            </div>
          </GlassPanel>

          {/* Pending UPI Payment Verification Queue */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#F5F5F7] flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#E8BB75]" />
                <span>Pending UPI Transaction Reviews ({pendingUpiPayments.length})</span>
              </h3>
            </div>

            {pendingUpiPayments.length === 0 ? (
              <div className="p-6 rounded-2xl bg-[#101116] border border-white/[0.08] text-xs text-[#989BA6] text-center">
                No customer UPI transaction references are currently awaiting verification.
              </div>
            ) : (
              <div className="space-y-3">
                {pendingUpiPayments.map((p) => {
                  const isBusy = reviewingPaymentId === p.id;
                  return (
                    <div
                      key={p.id}
                      className="p-5 rounded-2xl bg-[#101116] border border-[#E8BB75]/40 space-y-4"
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div className="space-y-1 text-xs">
                          <div className="text-sm font-semibold text-[#F5F5F7]">
                            {p.userName || 'Customer'}{' '}
                            <span className="font-normal text-[#989BA6]">({p.userEmail})</span>
                          </div>
                          <div className="text-[#989BA6]">
                            Plan: <span className="text-[#F5F5F7] font-medium">{p.planName || p.planId}</span> ·
                            Payable:{' '}
                            <span className="font-mono tabular-nums text-[#7AA7FF] font-semibold">
                              ₹{p.amountInr.toLocaleString('en-IN')}
                            </span>{' '}
                            · Order <span className="font-mono">{p.orderId}</span>
                          </div>
                          <div className="text-[#989BA6] font-mono tabular-nums">
                            Submitted {p.submittedAt ? new Date(p.submittedAt).toLocaleString() : new Date(p.createdAt).toLocaleString()}
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5 bg-[#08090D] border border-white/[0.1] rounded-xl px-3.5 py-2.5 self-start lg:self-auto">
                          <div className="text-xs">
                            <span className="text-[#989BA6] block text-[10px]">Submitted UPI UTR / Ref</span>
                            <span className="font-mono text-sm font-semibold text-[#F5F5F7]">
                              {p.upiUtr || p.paymentId || '—'}
                            </span>
                          </div>
                          {p.upiUtr && (
                            <button
                              type="button"
                              onClick={() => copyUtr(p.upiUtr!)}
                              className="p-1.5 rounded-lg hover:bg-white/[0.08] text-[#7AA7FF] cursor-pointer"
                              title="Copy UTR"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-3 border-t border-white/[0.07]">
                        <input
                          type="text"
                          value={reviewNotes[p.id] || ''}
                          onChange={(e) =>
                            setReviewNotes((prev) => ({
                              ...prev,
                              [p.id]: e.target.value,
                            }))
                          }
                          placeholder="Optional review note (e.g. Verified ₹499 in GPay statement / UTR mismatch)"
                          className="flex-1 px-3 py-2 text-xs rounded-xl bg-[#08090D] border border-white/[0.1] text-[#F5F5F7] placeholder:text-[#989BA6]/50 focus:outline-none focus:border-[#7AA7FF]"
                        />

                        <div className="flex items-center gap-2 justify-end">
                          <GlassButton
                            type="button"
                            variant="danger"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => handleReviewPayment(p, 'reject')}
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Reject
                          </GlassButton>
                          <GlassButton
                            type="button"
                            variant="primary"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => handleReviewPayment(p, 'approve')}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {isBusy ? 'Updating...' : 'Approve & Activate Plan'}
                          </GlassButton>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Live Customer Payment Audit Ledger */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[#F5F5F7]">Live Customer Payment Audit Ledger</h3>
            <div className="rounded-2xl bg-[#101116] border border-white/[0.08] overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-white/[0.08] text-[#989BA6]">
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Plan</th>
                    <th className="py-3 px-4">Order &amp; UTR</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                    <th className="py-3 px-4">Verification &amp; Reviewer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {liveLedgerPayments.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 px-4 text-center text-[#989BA6]">
                        No live customer payment records yet.
                      </td>
                    </tr>
                  ) : (
                    liveLedgerPayments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-3 px-4 font-mono tabular-nums text-[#989BA6]">
                          {new Date(p.createdAt).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-[#F5F5F7]">{p.userEmail}</td>
                        <td className="py-3 px-4 text-[#989BA6]">{p.planName || p.planId}</td>
                        <td className="py-3 px-4 font-mono text-[#989BA6]">
                          <div>{p.orderId}</div>
                          {p.upiUtr && <div className="text-[#F5F5F7] text-[11px]">UTR: {p.upiUtr}</div>}
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
                            {p.gateway === 'upi_qr' ? 'upi_qr' : p.gateway} · {p.status}
                          </div>
                          {(p.reviewedBy || p.adminNote) && (
                            <div className="text-[11px] text-[#989BA6] mt-0.5">
                              {p.reviewedBy ? `By ${p.reviewedBy}` : ''}
                              {p.reviewedBy && p.adminNote ? ' · ' : ''}
                              {p.adminNote || ''}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Strictly Separated Admin Sandbox Diagnostic Ledger */}
          <div className="p-5 rounded-2xl bg-[#101116] border border-white/[0.08] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-[#F5F5F7] flex items-center gap-1.5">
                  <FlaskConical className="w-3.5 h-3.5 text-[#989BA6]" />
                  <span>Isolated Sandbox Diagnostics (Separated from Real Payments)</span>
                </h4>
                <p className="text-[11px] text-[#989BA6]">
                  Admin-only HMAC verification test harness. Sandbox records never appear in customer checkout, never
                  activate customer subscriptions, and are excluded from live revenue totals.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <GlassButton
                  variant="ghost"
                  size="sm"
                  disabled={sandboxRunning}
                  onClick={() => handleRunIsolatedSandboxDiagnostic('fail')}
                >
                  Test Failure Path
                </GlassButton>
                <GlassButton
                  variant="secondary"
                  size="sm"
                  disabled={sandboxRunning}
                  onClick={() => handleRunIsolatedSandboxDiagnostic('success')}
                >
                  Test HMAC Pass
                </GlassButton>
              </div>
            </div>

            {sandboxLedgerPayments.length > 0 && (
              <div className="border-t border-white/[0.07] pt-3 overflow-x-auto">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="text-[#989BA6]">
                      <th className="py-1.5 pr-4">Time</th>
                      <th className="py-1.5 pr-4">Sandbox Order</th>
                      <th className="py-1.5 pr-4">Test Amount</th>
                      <th className="py-1.5">Diagnostic Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {sandboxLedgerPayments.slice(0, 5).map((p) => (
                      <tr key={p.id}>
                        <td className="py-1.5 pr-4 font-mono tabular-nums text-[#989BA6]">
                          {new Date(p.createdAt).toLocaleString()}
                        </td>
                        <td className="py-1.5 pr-4 font-mono text-[#989BA6]">{p.orderId}</td>
                        <td className="py-1.5 pr-4 font-mono tabular-nums text-[#989BA6]">
                          ₹{p.amountInr.toLocaleString('en-IN')} (test)
                        </td>
                        <td className="py-1.5 text-[#989BA6]">
                          sandbox · {p.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. Style Reference Library Configuration */}
      {section === 'styles' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {data.styles.map((style, idx) => (
            <GlassPanel key={style.id} className="p-5 space-y-3">
              <div className="flex items-center gap-3">
                <img
                  src={style.previewUrl}
                  alt={style.name}
                  referrerPolicy="no-referrer"
                  className="w-16 h-16 rounded-lg object-cover bg-white border border-white/10"
                />
                <div className="flex-1">
                  <input
                    type="text"
                    value={style.name}
                    onChange={(e) => {
                      const copy = [...data.styles];
                      copy[idx] = { ...style, name: e.target.value };
                      setData({ ...data, styles: copy });
                    }}
                    className="w-full px-2.5 py-1 text-sm font-semibold rounded-lg bg-[#08090D] border border-white/[0.1] text-[#F5F5F7]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-[#989BA6]">Positive Graphite Style Directive</label>
                <textarea
                  rows={3}
                  value={style.promptStyleDirective}
                  onChange={(e) => {
                    const copy = [...data.styles];
                    copy[idx] = { ...style, promptStyleDirective: e.target.value };
                    setData({ ...data, styles: copy });
                  }}
                  className="w-full p-2.5 text-xs rounded-lg bg-[#08090D] border border-white/[0.1] text-[#F5F5F7]"
                />
              </div>

              <GlassButton variant="secondary" size="sm" onClick={() => handleSaveStyle(style)}>
                Save Style Directive
              </GlassButton>
            </GlassPanel>
          ))}
        </div>
      )}
    </div>
  );
};
