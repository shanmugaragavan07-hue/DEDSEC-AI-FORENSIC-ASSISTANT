import React, { useEffect, useState } from 'react';
import {
  Activity,
  Bookmark,
  ChevronDown,
  Clock,
  CreditCard,
  Download,
  FileImage,
  FileText,
  FolderKanban,
  Globe,
  History,
  Layers,
  Loader2,
  LogOut,
  Maximize2,
  Menu,
  Mic,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Save,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  User,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { downloadCompositeImage, exportCasePdfReport } from '../lib/exportUtils.ts';
import {
  deleteCaseMetadataFromFirestore,
  syncCaseMetadataToFirestore,
} from '../lib/firebase.ts';
import {
  DEFAULT_FACIAL_PROFILE,
  FacialProfile,
  ForensicCase,
  StyleReference,
  UserAccount,
} from '../types.ts';
import { AdminDashboardView } from './AdminDashboardView.tsx';
import { CasesGalleryView } from './CasesGalleryView.tsx';
import { FacialAttributeInspector } from './FacialAttributeInspector.tsx';
import { BeforeAfterComparison, GlassButton, GlassModal } from './LiquidGlassUI.tsx';
import { SettingsAndAccountView } from './SettingsAndAccountView.tsx';
import { SubscriptionAndUsageView } from './SubscriptionAndUsageView.tsx';
import { VoiceRecorderModal } from './VoiceRecorderModal.tsx';

type NavDestination =
  | 'studio'
  | 'my_cases'
  | 'recent_cases'
  | 'saved_sketches'
  | 'subscription'
  | 'usage'
  | 'settings'
  | 'profile'
  | 'admin';

interface CreativeStudioWorkspaceProps {
  user: UserAccount;
  smtpConfigured: boolean;
  styles: StyleReference[];
  onUserUpdated: (user: UserAccount) => void;
  onLogout: () => void;
  onOpenMarketingSite: () => void;
  notify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export const CreativeStudioWorkspace: React.FC<CreativeStudioWorkspaceProps> = ({
  user,
  smtpConfigured,
  styles,
  onUserUpdated,
  onLogout,
  onOpenMarketingSite,
  notify,
}) => {
  const [activeNav, setActiveNav] = useState<NavDestination>('studio');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
  const [bottomTab, setBottomTab] = useState<'versions' | 'notes'>('versions');

  // Cases & Active Studio State
  const [cases, setCases] = useState<ForensicCase[]>([]);
  const [activeCase, setActiveCase] = useState<ForensicCase | null>(null);
  const [caseTitle, setCaseTitle] = useState('Untitled Composite');
  const [description, setDescription] = useState('');
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null);
  const [profile, setProfile] = useState<FacialProfile>({ ...DEFAULT_FACIAL_PROFILE });
  const [selectedStyleId, setSelectedStyleId] = useState<string>(
    styles[0]?.id || 'forensic_fine_graphite'
  );
  const [notes, setNotes] = useState('');

  // Canvas Interaction State
  const [zoom, setZoom] = useState(100);
  const [compareMode, setCompareMode] = useState(false);
  const [fullscreenPreview, setFullscreenPreview] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);

  // Async Processing & Retry Error State
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [lastError, setLastError] = useState<{
    message: string;
    retryFn?: () => void;
  } | null>(null);

  const loadCases = async () => {
    try {
      const res = await api.listCases();
      setCases(res.cases);
    } catch (err: any) {
      console.error('Failed to load cases:', err);
    }
  };

  useEffect(() => {
    loadCases();
  }, []);

  const handleStartNewComposite = () => {
    setActiveCase(null);
    setCaseTitle('New Composite Case');
    setDescription('');
    setVoiceTranscript(null);
    setProfile({ ...DEFAULT_FACIAL_PROFILE });
    setSelectedStyleId(styles[0]?.id || 'forensic_fine_graphite');
    setNotes('');
    setZoom(100);
    setCompareMode(false);
    setLastError(null);
    setActiveNav('studio');
    setMobileMenuOpen(false);
  };

  const handleOpenCaseInStudio = (c: ForensicCase) => {
    setActiveCase(c);
    setCaseTitle(c.title);
    setDescription(c.originalDescription);
    setVoiceTranscript(c.voiceTranscript);
    setProfile({ ...DEFAULT_FACIAL_PROFILE, ...c.profile });
    setSelectedStyleId(c.styleRefId || styles[0]?.id || 'forensic_fine_graphite');
    setNotes(c.notes || '');
    setZoom(100);
    setCompareMode(false);
    setLastError(null);
    setActiveNav('studio');
    setMobileMenuOpen(false);
  };

  const handleExtractProfile = async (overrideDesc?: string) => {
    const targetDesc = (overrideDesc ?? description).trim();
    if (targetDesc.length < 10) {
      notify('error', 'Description Too Short', 'Enter at least 10 characters describing facial features.');
      return;
    }
    setIsExtracting(true);
    setLastError(null);
    try {
      const res = await api.extractProfile(targetDesc);
      setProfile((prev) => ({
        ...res.profile,
        graphiteContrast: prev.graphiteContrast,
        pencilDetailWeight: prev.pencilDetailWeight,
      }));
      notify('success', 'Facial Profile Extracted', 'Review or edit the 23 structured facial traits.');
    } catch (err: any) {
      setLastError({
        message: err?.message || 'Facial profile extraction failed.',
        retryFn: () => handleExtractProfile(targetDesc),
      });
      notify('error', 'Extraction Failed', err?.message);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleGenerateComposite = async () => {
    if (description.trim().length < 10) {
      notify('error', 'Description Required', 'Provide a detailed facial description before generating.');
      return;
    }
    setIsGenerating(true);
    setLastError(null);
    try {
      const res = await api.generateComposite({
        caseId: activeCase?.id || null,
        caseTitle,
        description,
        voiceTranscript,
        profile,
        styleRefId: selectedStyleId,
        notes,
      });

      setActiveCase(res.caseRecord);
      setCaseTitle(res.caseRecord.title);
      setProfile(res.caseRecord.profile);
      onUserUpdated(res.user);
      setCompareMode(false);
      await loadCases();

      // Sync cloud metadata to Firestore when signed in via Google
      syncCaseMetadataToFirestore({
        caseId: res.caseRecord.id,
        title: res.caseRecord.title,
        description: res.caseRecord.originalDescription,
        imageUrl: res.caseRecord.activeImageUrl || '',
        status: res.caseRecord.status,
        versionCount: res.caseRecord.versions.length,
      }).catch(() => {});

      notify('success', 'Graphite Composite Generated', `Saved Version ${res.caseRecord.versions.length}.`);
    } catch (err: any) {
      setLastError({
        message: err?.message || 'Composite generation failed.',
        retryFn: handleGenerateComposite,
      });
      notify('error', 'Generation Failed', err?.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRefineComposite = async (instruction: string) => {
    if (!activeCase || !activeCase.activeImageUrl) return;
    setIsRefining(true);
    setLastError(null);
    try {
      const res = await api.refineComposite({
        caseId: activeCase.id,
        refinementInstruction: instruction,
      });
      setActiveCase(res.caseRecord);
      setProfile(res.caseRecord.profile);
      onUserUpdated(res.user);
      if (res.caseRecord.versions.length >= 2) {
        setCompareMode(true);
      }
      await loadCases();

      syncCaseMetadataToFirestore({
        caseId: res.caseRecord.id,
        title: res.caseRecord.title,
        description: res.caseRecord.originalDescription,
        imageUrl: res.caseRecord.activeImageUrl || '',
        status: res.caseRecord.status,
        versionCount: res.caseRecord.versions.length,
      }).catch(() => {});

      notify('success', 'Composite Refined', `Created Version ${res.caseRecord.versions.length}. Drag the slider to compare.`);
    } catch (err: any) {
      setLastError({
        message: err?.message || 'Composite refinement failed.',
        retryFn: () => handleRefineComposite(instruction),
      });
      notify('error', 'Refinement Failed', err?.message);
    } finally {
      setIsRefining(false);
    }
  };

  const handleSaveCaseMetadata = async () => {
    try {
      if (!activeCase) {
        const res = await api.createDraftCase({
          title: caseTitle,
          originalDescription: description,
          voiceTranscript,
          profile,
          styleRefId: selectedStyleId,
          notes,
        });
        setActiveCase(res.caseRecord);
        await loadCases();
        notify('success', 'Draft Case Saved', res.caseRecord.title);
      } else {
        const res = await api.updateCase(activeCase.id, {
          title: caseTitle,
          originalDescription: description,
          profile,
          notes,
          isSaved: true,
          styleRefId: selectedStyleId,
        });
        setActiveCase(res.caseRecord);
        await loadCases();
        syncCaseMetadataToFirestore({
          caseId: res.caseRecord.id,
          title: res.caseRecord.title,
          description: res.caseRecord.originalDescription,
          imageUrl: res.caseRecord.activeImageUrl || '',
          status: res.caseRecord.status,
          versionCount: res.caseRecord.versions.length,
        }).catch(() => {});
        notify('success', 'Case Saved', `Updated ${res.caseRecord.title}.`);
      }
    } catch (err: any) {
      notify('error', 'Save Failed', err?.message);
    }
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!activeCase) return;
    try {
      const res = await api.restoreCaseVersion(activeCase.id, versionId);
      setActiveCase(res.caseRecord);
      setProfile(res.caseRecord.profile);
      setCompareMode(false);
      await loadCases();
      notify('info', 'Version Restored', 'Active canvas restored to selected composite version.');
    } catch (err: any) {
      notify('error', 'Restore Failed', err?.message);
    }
  };

  const handleExportActive = async (format: 'png' | 'jpeg' | 'pdf') => {
    setExportMenuOpen(false);
    if (!activeCase?.activeImageUrl) {
      notify('error', 'Nothing to Export', 'Generate a composite image first.');
      return;
    }
    try {
      if (format === 'pdf') {
        await exportCasePdfReport({
          ...activeCase,
          title: caseTitle,
          notes,
          profile,
        });
        notify('success', 'PDF Case Dossier Exported', 'Downloaded complete report with composite & profile.');
      } else {
        await downloadCompositeImage(activeCase.activeImageUrl, caseTitle, format);
        notify('success', `${format.toUpperCase()} Downloaded`, `Saved ${caseTitle}.`);
      }
    } catch (err: any) {
      notify('error', 'Export Failed', err?.message);
    }
  };

  const statusText = isGenerating
    ? 'Synthesizing Graphite Composite...'
    : isRefining
    ? 'Refining Composite...'
    : isExtracting
    ? 'Extracting Facial Profile...'
    : activeCase?.activeImageUrl
    ? `Ready · v${activeCase.versions.length}`
    : 'Studio Ready';

  const versions = activeCase?.versions || [];
  const previousVersion = versions.length >= 2 ? versions[versions.length - 2] : null;
  const currentVersion = versions.length >= 1 ? versions[versions.length - 1] : null;

  const sidebarItems: {
    id: NavDestination;
    label: string;
    icon: React.FC<{ className?: string }>;
  }[] = [
    { id: 'my_cases', label: 'My Cases', icon: FolderKanban },
    { id: 'recent_cases', label: 'Recent Cases', icon: Clock },
    { id: 'saved_sketches', label: 'Saved Sketches', icon: Bookmark },
    { id: 'subscription', label: 'Subscription', icon: CreditCard },
    { id: 'usage', label: 'Usage', icon: Activity },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'profile', label: 'Profile', icon: User },
  ];

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full justify-between p-3.5 select-none">
      <div className="space-y-5">
        {/* DEDSEC Brand Mark */}
        <div className="px-2.5 pt-1 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setActiveNav('studio');
              setMobileMenuOpen(false);
            }}
            className="text-left cursor-pointer"
          >
            <span className="text-base font-bold tracking-tight text-[#F5F5F7] block">DEDSEC</span>
            <span className="text-[11px] text-[#989BA6] block">Forensic Studio</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-1.5 rounded-lg text-[#989BA6] hover:text-[#F5F5F7]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Primary New Composite Action */}
        <GlassButton
          variant="primary"
          className="w-full justify-start"
          onClick={handleStartNewComposite}
        >
          <Plus className="w-4 h-4" />
          New Composite
        </GlassButton>

        {/* Navigation Links */}
        <nav className="space-y-1">
          <button
            type="button"
            onClick={() => {
              setActiveNav('studio');
              setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
              activeNav === 'studio'
                ? 'bg-white/[0.08] text-[#F5F5F7]'
                : 'text-[#989BA6] hover:text-[#F5F5F7] hover:bg-white/[0.04]'
            }`}
          >
            <Sparkles className="w-4 h-4 text-[#7AA7FF]" />
            Composite Workspace
          </button>

          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveNav(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-white/[0.08] text-[#F5F5F7]'
                    : 'text-[#989BA6] hover:text-[#F5F5F7] hover:bg-white/[0.04]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </button>
            );
          })}

          {user.role === 'admin' && (
            <button
              type="button"
              onClick={() => {
                setActiveNav('admin');
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                activeNav === 'admin'
                  ? 'bg-[#7AA7FF]/15 text-[#7AA7FF]'
                  : 'text-[#989BA6] hover:text-[#F5F5F7] hover:bg-white/[0.04]'
              }`}
            >
              <Shield className="w-4 h-4 text-[#7AA7FF]" />
              Admin Console
            </button>
          )}
        </nav>
      </div>

      {/* Bottom Marketing Site Link & Quota Summary */}
      <div className="space-y-3 pt-4 border-t border-white/[0.07]">
        <div className="px-2.5 py-2 rounded-xl bg-[#101116] border border-white/[0.06] space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#989BA6]">Credits Left</span>
            <span className="font-mono tabular-nums text-[#F5F5F7] font-semibold">
              {user.remainingGenerations} / {user.generationAllowance}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
            <div
              className="h-full bg-[#7AA7FF]"
              style={{
                width: `${
                  user.generationAllowance > 0
                    ? Math.min(100, (user.remainingGenerations / user.generationAllowance) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenMarketingSite}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-[#989BA6] hover:text-[#F5F5F7] hover:bg-white/[0.04] transition-colors cursor-pointer"
        >
          <Globe className="w-3.5 h-3.5" />
          Product Website
        </button>
      </div>
    </div>
  );

  return (
    <div className="h-screen w-full overflow-hidden bg-[#08090D] text-[#F5F5F7] flex">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:block w-[236px] shrink-0 bg-[#0C0D12] border-r border-white/[0.08] h-full">
        {renderSidebarContent()}
      </aside>

      {/* Mobile / Tablet Slide-over Sidebar */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
          />
          <aside className="relative z-10 w-[250px] bg-[#0C0D12] border-r border-white/[0.1] h-full">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Right Main Area (Top Bar + Active View) */}
      <div className="flex-1 min-w-0 flex flex-col h-full">
        {/* Top Bar */}
        <header className="h-14 shrink-0 bg-[#0C0D12]/90 backdrop-blur-xl border-b border-white/[0.08] px-4 lg:px-6 flex items-center justify-between gap-4 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-1.5 rounded-lg text-[#989BA6] hover:text-[#F5F5F7] hover:bg-white/[0.06] cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>

            <span className="hidden sm:inline text-xs font-medium text-[#989BA6] whitespace-nowrap">
              {activeNav === 'studio' ? 'Creative Studio' : 'Workspace'}
            </span>
            <span aria-hidden="true" className="hidden sm:inline text-[#989BA6]">/</span>

            {activeNav === 'studio' ? (
              <input
                type="text"
                value={caseTitle}
                onChange={(e) => setCaseTitle(e.target.value)}
                aria-label="Current case name"
                className="bg-transparent text-sm font-semibold text-[#F5F5F7] focus:outline-none focus:bg-[#181A22] px-2 py-1 rounded-lg min-w-0 max-w-[200px] sm:max-w-[280px] truncate"
              />
            ) : (
              <span className="text-sm font-semibold text-[#F5F5F7] truncate capitalize">
                {activeNav.replace(/_/g, ' ')}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Generation Status */}
            <div className="hidden md:flex items-center gap-1.5 text-xs text-[#989BA6] mr-2">
              {(isGenerating || isRefining || isExtracting) && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#7AA7FF]" />
              )}
              <span className="whitespace-nowrap">{statusText}</span>
            </div>

            {/* Usage Indicator */}
            <button
              type="button"
              onClick={() => setActiveNav('subscription')}
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs font-mono tabular-nums text-[#F5F5F7] hover:bg-white/[0.08] cursor-pointer whitespace-nowrap"
              title="Remaining monthly generations"
            >
              <span>{user.remainingGenerations} left</span>
            </button>

            {activeNav === 'studio' && (
              <>
                <GlassButton variant="secondary" size="sm" onClick={handleSaveCaseMetadata}>
                  <Save className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Save Case</span>
                </GlassButton>

                {/* Export Dropdown */}
                <div className="relative">
                  <GlassButton
                    variant="secondary"
                    size="sm"
                    disabled={!activeCase?.activeImageUrl}
                    onClick={() => setExportMenuOpen((v) => !v)}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Export</span>
                    <ChevronDown className="w-3 h-3" />
                  </GlassButton>

                  {exportMenuOpen && (
                    <div
                      onMouseLeave={() => setExportMenuOpen(false)}
                      className="absolute right-0 mt-2 w-48 liquid-glass-elevated rounded-xl p-1.5 shadow-2xl z-40 space-y-0.5"
                    >
                      <button
                        type="button"
                        onClick={() => handleExportActive('png')}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#F5F5F7] hover:bg-white/[0.08] rounded-lg cursor-pointer"
                      >
                        <FileImage className="w-3.5 h-3.5 text-[#7AA7FF]" />
                        Export PNG (Lossless)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportActive('jpeg')}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#F5F5F7] hover:bg-white/[0.08] rounded-lg cursor-pointer"
                      >
                        <FileImage className="w-3.5 h-3.5 text-[#68D6A3]" />
                        Export JPEG (Paper)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportActive('pdf')}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#F5F5F7] hover:bg-white/[0.08] rounded-lg cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5 text-[#A78BFA]" />
                        PDF Case Report
                      </button>
                    </div>
                  )}
                </div>

                {/* Toggle Right Inspector on Desktop/Tablet */}
                <button
                  type="button"
                  onClick={() => setInspectorVisible((v) => !v)}
                  title={inspectorVisible ? 'Collapse Inspector' : 'Expand Inspector'}
                  className="hidden lg:inline-flex p-2 rounded-lg text-[#989BA6] hover:text-[#F5F5F7] hover:bg-white/[0.06] cursor-pointer"
                >
                  {inspectorVisible ? (
                    <PanelRightClose className="w-4 h-4" />
                  ) : (
                    <PanelRightOpen className="w-4 h-4" />
                  )}
                </button>
              </>
            )}

            {/* Account Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setAccountMenuOpen((v) => !v)}
                className="w-8 h-8 rounded-full bg-[#181A22] border border-white/[0.12] flex items-center justify-center text-xs font-semibold text-[#F5F5F7] hover:border-[#7AA7FF] transition-colors cursor-pointer"
                title={user.email}
              >
                {user.name.slice(0, 1).toUpperCase()}
              </button>

              {accountMenuOpen && (
                <div
                  onMouseLeave={() => setAccountMenuOpen(false)}
                  className="absolute right-0 mt-2 w-56 liquid-glass-elevated rounded-xl p-2 shadow-2xl z-40 space-y-1"
                >
                  <div className="px-2.5 py-1.5 border-b border-white/[0.08]">
                    <p className="text-xs font-semibold text-[#F5F5F7] truncate">{user.name}</p>
                    <p className="text-[11px] text-[#989BA6] truncate">{user.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      setActiveNav('profile');
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-[#F5F5F7] hover:bg-white/[0.07] rounded-lg cursor-pointer"
                  >
                    <User className="w-3.5 h-3.5" />
                    Account &amp; Security
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      setActiveNav('subscription');
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-[#F5F5F7] hover:bg-white/[0.07] rounded-lg cursor-pointer"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    Subscription ({user.planId})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      onLogout();
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/10 rounded-lg cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Sub-Views Routing */}
        {(activeNav === 'my_cases' ||
          activeNav === 'recent_cases' ||
          activeNav === 'saved_sketches') && (
          <CasesGalleryView
            cases={cases}
            initialFilter={
              activeNav === 'recent_cases'
                ? 'recent'
                : activeNav === 'saved_sketches'
                ? 'saved'
                : 'all'
            }
            onOpenCase={handleOpenCaseInStudio}
            onNewComposite={handleStartNewComposite}
            onRenameCase={async (caseId, newTitle) => {
              const res = await api.updateCase(caseId, { title: newTitle });
              if (activeCase?.id === caseId) {
                setActiveCase(res.caseRecord);
                setCaseTitle(newTitle);
              }
              await loadCases();
              notify('success', 'Case Renamed', newTitle);
            }}
            onToggleSaved={async (c) => {
              const res = await api.updateCase(c.id, { isSaved: !c.isSaved });
              if (activeCase?.id === c.id) setActiveCase(res.caseRecord);
              await loadCases();
            }}
            onDeleteCase={async (caseId) => {
              await api.deleteCase(caseId);
              deleteCaseMetadataFromFirestore(caseId).catch(() => {});
              if (activeCase?.id === caseId) handleStartNewComposite();
              await loadCases();
              notify('info', 'Case Deleted', 'Removed composite case file.');
            }}
            notify={notify}
          />
        )}

        {(activeNav === 'subscription' || activeNav === 'usage') && (
          <SubscriptionAndUsageView
            user={user}
            initialTab={activeNav === 'usage' ? 'usage' : 'subscription'}
            onUserUpdated={onUserUpdated}
            notify={notify}
          />
        )}

        {(activeNav === 'settings' || activeNav === 'profile') && (
          <SettingsAndAccountView
            user={user}
            smtpConfigured={smtpConfigured}
            onUserUpdated={onUserUpdated}
            onNavigateSubscription={() => setActiveNav('subscription')}
            onLogout={onLogout}
            notify={notify}
          />
        )}

        {activeNav === 'admin' && user.role === 'admin' && (
          <AdminDashboardView notify={notify} />
        )}

        {/* MAIN CREATIVE STUDIO VIEW */}
        {activeNav === 'studio' && (
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
            {/* Center Column: Canvas + Bottom Version/Notes Panel */}
            <div className="flex-1 min-w-0 flex flex-col min-h-[500px] lg:min-h-0">
              {/* Central Graphite Composite Canvas */}
              <div className="flex-1 relative studio-canvas-grid flex flex-col items-center justify-center p-4 sm:p-8 overflow-hidden">
                {/* Error Recovery Banner (Preserves previous image!) */}
                {lastError && (
                  <div className="absolute top-4 left-4 right-4 max-w-xl mx-auto z-20 liquid-glass-elevated rounded-xl px-4 py-3 border border-red-400/30 flex items-center justify-between gap-3">
                    <span className="text-xs text-red-200">{lastError.message}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      {lastError.retryFn && (
                        <GlassButton
                          variant="secondary"
                          size="sm"
                          onClick={lastError.retryFn}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Retry
                        </GlassButton>
                      )}
                      <button
                        type="button"
                        onClick={() => setLastError(null)}
                        className="text-[#989BA6] hover:text-[#F5F5F7] cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Active Composite Paper Frame OR Empty Studio Prompt */}
                {activeCase?.activeImageUrl ? (
                  <div className="relative w-full h-full flex items-center justify-center overflow-auto">
                    <div
                      className="relative rounded-xl shadow-2xl bg-white border border-white/15 transition-transform duration-150 flex items-center justify-center overflow-hidden"
                      style={{
                        width: 'min(74vh, 100%)',
                        aspectRatio: '1 / 1',
                        transform: `scale(${zoom / 100})`,
                      }}
                    >
                      {compareMode && previousVersion && currentVersion ? (
                        <BeforeAfterComparison
                          beforeUrl={previousVersion.imageUrl}
                          afterUrl={currentVersion.imageUrl}
                          beforeLabel={`v${previousVersion.versionNumber}`}
                          afterLabel={`v${currentVersion.versionNumber} (Refined)`}
                        />
                      ) : (
                        <img
                          src={activeCase.activeImageUrl}
                          alt={caseTitle}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-contain select-none"
                        />
                      )}

                      {(isGenerating || isRefining) && (
                        <div className="absolute inset-0 bg-[#08090D]/75 backdrop-blur-sm flex flex-col items-center justify-center gap-3 text-center p-6">
                          <Loader2 className="w-7 h-7 animate-spin text-[#7AA7FF]" />
                          <p className="text-sm font-medium text-[#F5F5F7]">
                            {isRefining
                              ? 'Applying graphite refinement to active composite...'
                              : 'Rendering monochrome graphite composite...'}
                          </p>
                          <p className="text-xs text-[#989BA6]">
                            Preserving natural facial proportions and pencil shading
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Floating Liquid Glass Canvas Toolbar */}
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 liquid-glass-elevated rounded-xl px-2.5 py-1.5 flex items-center gap-1 shadow-xl">
                      <button
                        type="button"
                        onClick={() => setZoom((z) => Math.max(50, z - 15))}
                        title="Zoom out"
                        className="p-1.5 rounded-lg text-[#989BA6] hover:text-[#F5F5F7] hover:bg-white/[0.07] cursor-pointer"
                      >
                        <ZoomOut className="w-4 h-4" />
                      </button>
                      <span className="px-2 text-xs font-mono tabular-nums text-[#F5F5F7]">
                        {zoom}%
                      </span>
                      <button
                        type="button"
                        onClick={() => setZoom((z) => Math.min(200, z + 15))}
                        title="Zoom in"
                        className="p-1.5 rounded-lg text-[#989BA6] hover:text-[#F5F5F7] hover:bg-white/[0.07] cursor-pointer"
                      >
                        <ZoomIn className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setZoom(100)}
                        title="Fit to screen"
                        className="px-2 py-1 text-xs text-[#989BA6] hover:text-[#F5F5F7] hover:bg-white/[0.07] rounded-lg cursor-pointer whitespace-nowrap"
                      >
                        Fit
                      </button>

                      {versions.length >= 2 && (
                        <>
                          <div className="w-px h-4 bg-white/10 mx-1" />
                          <button
                            type="button"
                            onClick={() => setCompareMode((v) => !v)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                              compareMode
                                ? 'bg-[#7AA7FF] text-[#08090D]'
                                : 'text-[#989BA6] hover:text-[#F5F5F7] hover:bg-white/[0.07]'
                            }`}
                          >
                            <Layers className="w-3.5 h-3.5" />
                            Compare
                          </button>
                        </>
                      )}

                      <div className="w-px h-4 bg-white/10 mx-1" />
                      <button
                        type="button"
                        onClick={() => setFullscreenPreview(true)}
                        title="Full-screen preview"
                        className="p-1.5 rounded-lg text-[#989BA6] hover:text-[#F5F5F7] hover:bg-white/[0.07] cursor-pointer"
                      >
                        <Maximize2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Clean Spacious Empty Canvas State */
                  <div className="max-w-lg w-full text-center space-y-5 p-8 rounded-2xl liquid-glass">
                    {isGenerating ? (
                      <div className="py-10 space-y-4">
                        <Loader2 className="w-8 h-8 animate-spin text-[#7AA7FF] mx-auto" />
                        <div className="space-y-1">
                          <h3 className="text-base font-semibold text-[#F5F5F7]">
                            Synthesizing Graphite Composite
                          </h3>
                          <p className="text-xs text-[#989BA6]">
                            Extracting structured facial profile and rendering monochrome 2B/4B pencil shading...
                          </p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="w-12 h-12 rounded-2xl bg-[#181A22] border border-white/[0.1] flex items-center justify-center mx-auto">
                          <SlidersHorizontal className="w-5 h-5 text-[#7AA7FF]" />
                        </div>
                        <div className="space-y-1.5">
                          <h2 className="text-lg font-semibold text-[#F5F5F7]">
                            Graphite Composite Studio Canvas
                          </h2>
                          <p className="text-xs text-[#989BA6] leading-relaxed">
                            Describe a fictional adult face using natural text in the Inspector or
                            dictate traits by voice to extract an editable 23-attribute facial profile
                            and render your monochrome composite.
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                          <GlassButton
                            variant="secondary"
                            size="md"
                            onClick={() => setVoiceModalOpen(true)}
                          >
                            <Mic className="w-4 h-4 text-[#A78BFA]" />
                            Dictate by Voice
                          </GlassButton>
                          <GlassButton
                            variant="primary"
                            size="md"
                            onClick={() => {
                              setInspectorVisible(true);
                              if (!description) {
                                setDescription(
                                  'A fictional adult woman in her early thirties with a heart-shaped face, shoulder-length wavy dark hair, arched medium eyebrows, expressive almond eyes, a straight narrow nose, and balanced lips.'
                                );
                              }
                            }}
                          >
                            <Sparkles className="w-4 h-4" />
                            Load Example Description
                          </GlassButton>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Bottom Panel: Version History & Case Notes */}
              <div className="shrink-0 bg-[#0C0D12] border-t border-white/[0.08]">
                <div className="px-4 py-2 flex items-center justify-between border-b border-white/[0.06]">
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => {
                        setBottomTab('versions');
                        setBottomPanelOpen(true);
                      }}
                      className={`inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer ${
                        bottomTab === 'versions' && bottomPanelOpen
                          ? 'text-[#F5F5F7]'
                          : 'text-[#989BA6] hover:text-[#F5F5F7]'
                      }`}
                    >
                      <History className="w-3.5 h-3.5" />
                      Version History ({versions.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBottomTab('notes');
                        setBottomPanelOpen(true);
                      }}
                      className={`inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer ${
                        bottomTab === 'notes' && bottomPanelOpen
                          ? 'text-[#F5F5F7]'
                          : 'text-[#989BA6] hover:text-[#F5F5F7]'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Case Notes
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setBottomPanelOpen((v) => !v)}
                    className="text-xs text-[#989BA6] hover:text-[#F5F5F7] cursor-pointer"
                  >
                    {bottomPanelOpen ? 'Minimize' : 'Expand'}
                  </button>
                </div>

                {bottomPanelOpen && (
                  <div className="p-3.5 h-36 overflow-x-auto overflow-y-auto">
                    {bottomTab === 'versions' ? (
                      versions.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-xs text-[#989BA6]">
                          Generated composites and refinements will appear here in chronological order.
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 h-full">
                          {versions.map((ver) => {
                            const isActiveVer = activeCase?.activeImageUrl === ver.imageUrl;
                            return (
                              <div
                                key={ver.id}
                                className={`h-full shrink-0 w-60 rounded-xl p-2 border flex items-center gap-3 transition-colors ${
                                  isActiveVer
                                    ? 'bg-[#181A22] border-[#7AA7FF]'
                                    : 'bg-[#101116] border-white/[0.07]'
                                }`}
                              >
                                <img
                                  src={ver.imageUrl}
                                  alt={`Version ${ver.versionNumber}`}
                                  referrerPolicy="no-referrer"
                                  className="w-20 h-20 rounded-lg object-contain bg-white shrink-0"
                                />
                                <div className="min-w-0 flex-1 flex flex-col justify-between h-full py-0.5">
                                  <div>
                                    <p className="text-xs font-semibold font-mono tabular-nums text-[#F5F5F7]">
                                      Version {ver.versionNumber}
                                    </p>
                                    <p className="text-[11px] text-[#989BA6] truncate mt-0.5">
                                      {ver.refinementInstruction || 'Initial composite'}
                                    </p>
                                  </div>
                                  {!isActiveVer ? (
                                    <button
                                      type="button"
                                      onClick={() => handleRestoreVersion(ver.id)}
                                      className="text-[11px] text-[#7AA7FF] hover:underline text-left cursor-pointer"
                                    >
                                      Restore version
                                    </button>
                                  ) : (
                                    <span className="text-[11px] text-[#68D6A3]">Active on canvas</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )
                    ) : (
                      <div className="h-full flex gap-3 items-start">
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Record case context, descriptive clarifications, or version observations..."
                          className="flex-1 h-full p-2.5 text-xs rounded-xl bg-[#08090D] border border-white/[0.09] text-[#F5F5F7] placeholder:text-[#989BA6]/45 focus:outline-none focus:border-[#7AA7FF] resize-none"
                        />
                        <GlassButton variant="secondary" size="sm" onClick={handleSaveCaseMetadata}>
                          Save Notes
                        </GlassButton>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right Inspector Panel */}
            {inspectorVisible && (
              <FacialAttributeInspector
                description={description}
                onChangeDescription={setDescription}
                profile={profile}
                onChangeProfile={setProfile}
                styles={styles}
                selectedStyleId={selectedStyleId}
                onChangeStyleId={setSelectedStyleId}
                hasActiveImage={Boolean(activeCase?.activeImageUrl)}
                isExtracting={isExtracting}
                isGenerating={isGenerating}
                isRefining={isRefining}
                onOpenVoiceModal={() => setVoiceModalOpen(true)}
                onExtractProfile={() => handleExtractProfile()}
                onGenerateComposite={handleGenerateComposite}
                onRefineComposite={handleRefineComposite}
              />
            )}
          </div>
        )}
      </div>

      {/* Voice Input Modal */}
      <VoiceRecorderModal
        open={voiceModalOpen}
        onClose={() => setVoiceModalOpen(false)}
        onApproveTranscript={async (approvedText) => {
          setVoiceTranscript(approvedText);
          setDescription(approvedText);
          await handleExtractProfile(approvedText);
        }}
        notify={notify}
      />

      {/* Full-Screen Preview Lightbox */}
      <GlassModal
        open={fullscreenPreview && Boolean(activeCase?.activeImageUrl)}
        onClose={() => setFullscreenPreview(false)}
        title={caseTitle}
        subtitle="Full-Resolution Monochrome Graphite Preview"
        maxWidthClass="max-w-4xl"
      >
        {activeCase?.activeImageUrl && (
          <div className="space-y-4">
            <div className="max-h-[75vh] aspect-square mx-auto bg-white rounded-xl overflow-hidden flex items-center justify-center">
              <img
                src={activeCase.activeImageUrl}
                alt={caseTitle}
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#989BA6]">
                Illustrative fictional composite · Not for biometric identification
              </span>
              <GlassButton
                variant="secondary"
                size="sm"
                onClick={() => setFullscreenPreview(false)}
              >
                <Minimize2 className="w-3.5 h-3.5" />
                Exit Full Screen
              </GlassButton>
            </div>
          </div>
        )}
      </GlassModal>
    </div>
  );
};
