import React, { useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  FileText,
  FolderKanban,
  Layers,
  Mic,
  Sliders,
  Sparkles,
  Check,
} from 'lucide-react';
import { SubscriptionPlan, UserAccount } from '../types.ts';
import { GlassButton, GlassPanel } from './LiquidGlassUI.tsx';

interface MarketingSiteProps {
  plans: SubscriptionPlan[];
  currentUser: UserAccount | null;
  onGetStarted: () => void;
  onOpenStudio: () => void;
}

const FAQ_ITEMS = [
  {
    q: 'What kind of images does DEDSEC generate?',
    a: 'DEDSEC creates monochrome, hand-drawn style graphite facial composites of fictional adult characters from text or spoken descriptions. Every composite is calibrated for neutral front-facing framing, realistic facial proportions, and paper-like pencil shading.',
  },
  {
    q: 'Is DEDSEC a facial recognition or biometric matching system?',
    a: 'No. DEDSEC is strictly an illustrative composite creation studio. It does not perform facial recognition, database identity matching, or automated suspect identification, and generated illustrations should never be treated as photographic proof of any real individual.',
  },
  {
    q: 'How does voice input connect to profile extraction?',
    a: 'When you record spoken facial traits, DEDSEC transcribes your speech into editable text first. Once you review and approve the transcript, it enters the exact same 23-attribute facial profile extraction and composite generation pipeline as typed descriptions.',
  },
  {
    q: 'How does customer-funded billing and quota enforcement work?',
    a: 'Subscription plans provide a transparent monthly generation allowance enforced on the server. Failed synthesis attempts never deduct from your remaining credits, and no external paid upgrades occur automatically.',
  },
  {
    q: 'What export formats are included for saved cases?',
    a: 'Every composite can be exported as a high-resolution PNG, a white-paper JPEG, or a formatted PDF Case Dossier containing the composite image, original description, structured facial profile, refinement log, and illustrative-use notice.',
  },
];

export const MarketingSite: React.FC<MarketingSiteProps> = ({
  plans,
  currentUser,
  onGetStarted,
  onOpenStudio,
}) => {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div className="min-h-screen bg-[#08090D] text-[#F5F5F7]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-[#08090D]/80 backdrop-blur-xl border-b border-white/[0.08]">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-6 py-4">
          <a
            href="#top"
            className="text-base font-bold tracking-tight text-[#F5F5F7] whitespace-nowrap shrink-0"
          >
            DEDSEC
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#989BA6]">
            <a
              href="#introduction"
              className="hover:text-[#F5F5F7] transition-colors whitespace-nowrap shrink-0"
            >
              Overview
            </a>
            <a
              href="#workflow"
              className="hover:text-[#F5F5F7] transition-colors whitespace-nowrap shrink-0"
            >
              Workflow
            </a>
            <a
              href="#capabilities"
              className="hover:text-[#F5F5F7] transition-colors whitespace-nowrap shrink-0"
            >
              Capabilities
            </a>
            <a
              href="#plans"
              className="hover:text-[#F5F5F7] transition-colors whitespace-nowrap shrink-0"
            >
              Plans
            </a>
            <a
              href="#faq"
              className="hover:text-[#F5F5F7] transition-colors whitespace-nowrap shrink-0"
            >
              FAQ
            </a>
          </nav>

          <div className="shrink-0">
            <GlassButton
              variant="primary"
              size="sm"
              onClick={currentUser ? onOpenStudio : onGetStarted}
            >
              {currentUser ? 'Return to Studio' : 'Sign In to Studio'}
            </GlassButton>
          </div>
        </div>
      </header>

      {/* 1. Hero Section */}
      <section id="top" className="max-w-7xl mx-auto px-6 pt-16 pb-20 lg:pt-24 lg:pb-28">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-6 space-y-6">
            <p className="text-xs text-[#989BA6]">
              Illustrative Facial Composite Studio · Voice &amp; Text Synthesis
            </p>
            <h1
              className="font-bold tracking-tight text-[#F5F5F7] leading-[1.08]"
              style={{ fontSize: 'clamp(2.25rem, 4vw, 3.65rem)', textWrap: 'balance' }}
            >
              Every Detail Matters. Every Feature Has a Story.
            </h1>
            <p className="text-base sm:text-lg text-[#989BA6] leading-relaxed max-w-xl">
              Transform detailed facial descriptions into carefully crafted illustrative facial
              composites using AI-powered text and voice workflows.
            </p>
            <div className="flex flex-wrap items-center gap-3.5 pt-2">
              <GlassButton variant="primary" size="lg" onClick={currentUser ? onOpenStudio : onGetStarted}>
                Get Started
                <ArrowRight className="w-4 h-4" />
              </GlassButton>
              <a
                href="#workflow"
                className="inline-flex items-center justify-center px-5 py-2.5 text-sm font-medium rounded-xl bg-white/[0.05] border border-white/[0.1] text-[#F5F5F7] hover:bg-white/[0.09] transition-colors whitespace-nowrap shrink-0"
              >
                Explore DEDSEC
              </a>
            </div>
            <p className="text-xs text-[#989BA6] pt-2">
              Monochrome 2B/4B Graphite Output · 23 Editable Traits · PNG, JPEG &amp; PDF Case Dossiers
            </p>
          </div>

          {/* macOS Liquid Glass Studio Showcase */}
          <div className="lg:col-span-6">
            <GlassPanel elevated className="p-4 sm:p-5 shadow-2xl">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/[0.08]">
                <div className="flex items-center gap-2 text-xs text-[#989BA6]">
                  <span className="font-medium text-[#F5F5F7]">DEDSEC Studio</span>
                  <span aria-hidden="true">·</span>
                  <span>Case #DS-204</span>
                </div>
                <span className="text-xs font-mono tabular-nums text-[#989BA6]">1024 × 1024 px</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-stretch">
                <div className="sm:col-span-7 rounded-xl overflow-hidden bg-white aspect-square flex items-center justify-center border border-white/10">
                  <img
                    src="/assets/aistudio/DEDSEC_SKETCH_AUTO_1774605753783_aab1244a.png"
                    alt="Precision monochrome graphite facial composite sample"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="sm:col-span-5 flex flex-col justify-between bg-[#101116] rounded-xl p-4 border border-white/[0.07]">
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-[#F5F5F7]">Extracted Facial Profile</p>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between gap-2 pb-1.5 border-b border-white/[0.06]">
                        <span className="text-[#989BA6]">Face Shape</span>
                        <span className="text-[#F5F5F7] font-medium">Oval</span>
                      </div>
                      <div className="flex justify-between gap-2 pb-1.5 border-b border-white/[0.06]">
                        <span className="text-[#989BA6]">Hairstyle</span>
                        <span className="text-[#F5F5F7] font-medium">Side-parted crop</span>
                      </div>
                      <div className="flex justify-between gap-2 pb-1.5 border-b border-white/[0.06]">
                        <span className="text-[#989BA6]">Eyebrows</span>
                        <span className="text-[#F5F5F7] font-medium">Thick, arched</span>
                      </div>
                      <div className="flex justify-between gap-2 pb-1.5 border-b border-white/[0.06]">
                        <span className="text-[#989BA6]">Nose</span>
                        <span className="text-[#F5F5F7] font-medium">Broad bridge</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-[#989BA6]">Facial Hair</span>
                        <span className="text-[#F5F5F7] font-medium">Trimmed moustache</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] text-[#989BA6] pt-4 leading-relaxed">
                    Every extracted attribute remains editable prior to composite synthesis and iterative refinement.
                  </p>
                </div>
              </div>
            </GlassPanel>
          </div>
        </div>
      </section>

      {/* 2. Product Introduction */}
      <section id="introduction" className="border-t border-white/[0.07] bg-[#101116]/60 py-20">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-5 space-y-4">
            <p className="text-xs text-[#7AA7FF] font-medium">01. Product Introduction</p>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#F5F5F7]" style={{ textWrap: 'balance' }}>
              A calm, desktop-grade creative environment built around the composite canvas.
            </h2>
            <p className="text-sm sm:text-base text-[#989BA6] leading-relaxed">
              Traditional composite illustration demands hours of manual drafting before a single
              proportion can be reviewed. DEDSEC pairs structured natural-language understanding
              with monochrome graphite synthesis inside a focused Apple-inspired dark workspace—keeping
              every case, version, and attribute organised in one place.
            </p>
          </div>
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="p-6 rounded-2xl bg-[#181A22]/70 border border-white/[0.08] space-y-3">
              <h3 className="text-base font-semibold text-[#F5F5F7]">Authentic Graphite Fidelity</h3>
              <p className="text-sm text-[#989BA6] leading-relaxed">
                Calibrated specifically for monochrome pencil texture, natural anatomical proportions,
                and clean studio paper—avoiding glossy 3D renders, painted styles, or cartoon artifacts.
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-[#181A22]/70 border border-white/[0.08] space-y-3">
              <h3 className="text-base font-semibold text-[#F5F5F7]">Zero Invented Assumptions</h3>
              <p className="text-sm text-[#989BA6] leading-relaxed">
                Attributes not stated in your description are marked explicitly as unknown so you can
                review, verify, or supply missing details before generating.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. How DEDSEC Works + 4. Text + 5. Voice + 6. Extraction */}
      <section id="workflow" className="max-w-7xl mx-auto px-6 py-20 space-y-14">
        <div className="max-w-2xl space-y-3">
          <p className="text-xs text-[#7AA7FF] font-medium">02. How DEDSEC Works</p>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#F5F5F7]" style={{ textWrap: 'balance' }}>
            From spoken or written observation to finished case dossier in four transparent stages.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 4. Text Description Workflow */}
          <GlassPanel className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-[#989BA6]">Stage 01 · Text Description Workflow</span>
              <FileText className="w-4 h-4 text-[#7AA7FF]" />
            </div>
            <h3 className="text-lg font-semibold text-[#F5F5F7]">Natural-Language Description</h3>
            <p className="text-sm text-[#989BA6] leading-relaxed">
              Describe fictional adult facial traits in plain prose—such as face shape, hairline,
              eyebrow arch, nose bridge, and facial hair—without learning technical prompt syntax.
              Your exact wording is preserved alongside every saved version.
            </p>
          </GlassPanel>

          {/* 5. Voice Input Workflow */}
          <GlassPanel className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-[#989BA6]">Stage 02 · Voice Input Workflow</span>
              <Mic className="w-4 h-4 text-[#A78BFA]" />
            </div>
            <h3 className="text-lg font-semibold text-[#F5F5F7]">Dictate, Review, and Approve</h3>
            <p className="text-sm text-[#989BA6] leading-relaxed">
              Record descriptions directly through your microphone. DEDSEC transcribes the recording,
              displays the full editable text for your verification, and routes the approved transcript
              into the identical extraction pipeline as typed input.
            </p>
          </GlassPanel>

          {/* 6. Facial Profile Extraction */}
          <GlassPanel className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-[#989BA6]">Stage 03 · Facial Profile Extraction</span>
              <Sliders className="w-4 h-4 text-[#68D6A3]" />
            </div>
            <h3 className="text-lg font-semibold text-[#F5F5F7]">23-Attribute Editable Inspector</h3>
            <p className="text-sm text-[#989BA6] leading-relaxed">
              DEDSEC organises extracted features across Head &amp; Face, Eyes &amp; Eyebrows, Nose &amp;
              Mouth, Hair, and Additional Features. Unmentioned traits remain marked unknown until you
              choose to specify or refine them.
            </p>
          </GlassPanel>

          {/* 7. AI Composite Generation */}
          <GlassPanel className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-[#989BA6]">Stage 04 · AI Composite Generation</span>
              <Sparkles className="w-4 h-4 text-[#E8BB75]" />
            </div>
            <h3 className="text-lg font-semibold text-[#F5F5F7]">Monochrome Graphite Synthesis</h3>
            <p className="text-sm text-[#989BA6] leading-relaxed">
              Combines your original narrative, structured facial profile, and chosen graphite reference
              preset to render a crisp monochrome pencil composite on neutral archival or pure white paper.
            </p>
          </GlassPanel>
        </div>
      </section>

      {/* 8. Image Refinement & 9. Case Management */}
      <section id="capabilities" className="border-t border-white/[0.07] bg-[#101116]/60 py-20">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-5 rounded-2xl overflow-hidden bg-white p-3 border border-white/10">
            <img
              src="/assets/aistudio/sketch_sample_a0a9f0af.jpg"
              alt="Traditional hand-drawn graphite sketch style reference"
              referrerPolicy="no-referrer"
              className="w-full h-80 object-contain rounded-lg"
            />
          </div>
          <div className="lg:col-span-7 space-y-8">
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 text-xs text-[#7AA7FF] font-medium">
                <Layers className="w-4 h-4" />
                <span>03. Iterative Image Refinement</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-semibold text-[#F5F5F7]">
                Modify specific traits without losing previous work.
              </h3>
              <p className="text-sm sm:text-base text-[#989BA6] leading-relaxed">
                Instruct DEDSEC to add wire-rimmed glasses, adjust jawline angularity, or refine
                eyebrow thickness on an existing composite. Every refinement creates a numbered version
                with an interactive Before/After comparison slider and one-click version restore.
              </p>
            </div>

            <div className="pt-6 border-t border-white/[0.08] space-y-2.5">
              <div className="flex items-center gap-2 text-xs text-[#68D6A3] font-medium">
                <FolderKanban className="w-4 h-4" />
                <span>04. Structured Case Management &amp; Export</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-semibold text-[#F5F5F7]">
                Organise cases, track notes, and export complete PDF dossiers.
              </h3>
              <p className="text-sm sm:text-base text-[#989BA6] leading-relaxed">
                Search, rename, and reopen saved cases with full version histories intact. Export
                standalone PNG or JPEG artwork, or generate a formatted PDF Case Report containing
                all descriptions, structured traits, and illustrative disclaimers.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 10. Subscription Plans */}
      <section id="plans" className="max-w-7xl mx-auto px-6 py-20 space-y-12">
        <div className="max-w-2xl space-y-3">
          <p className="text-xs text-[#7AA7FF] font-medium">05. Customer-Funded Subscription Plans</p>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#F5F5F7]" style={{ textWrap: 'balance' }}>
            Transparent monthly allowances with strict backend quota protection.
          </h2>
          <p className="text-sm text-[#989BA6]">
            Plans fund AI synthesis, storage, and operating infrastructure directly—with zero hidden
            fees or automatic overage charges.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
          {plans.map((plan) => {
            const isHighlighted = plan.id === 'plus';
            return (
              <div
                key={plan.id}
                className={`rounded-2xl p-6 flex flex-col justify-between border ${
                  isHighlighted
                    ? 'bg-[#181A22] border-[#7AA7FF]/45'
                    : 'bg-[#101116] border-white/[0.08]'
                }`}
              >
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-[#F5F5F7]">{plan.name}</h3>
                    <p className="text-xs text-[#989BA6] mt-1">{plan.tagline}</p>
                  </div>
                  <div className="pt-2 pb-4 border-b border-white/[0.08] flex items-baseline gap-1.5">
                    <span className="text-3xl font-bold font-mono tabular-nums text-[#F5F5F7]">
                      {plan.priceInr === 0 ? '₹0' : `₹${plan.priceInr.toLocaleString('en-IN')}`}
                    </span>
                    <span className="text-xs text-[#989BA6]">/ {plan.billingInterval}</span>
                  </div>
                  <p className="text-xs font-mono tabular-nums text-[#7AA7FF]">
                    {plan.generationAllowance.toLocaleString('en-IN')} composite generations / month
                  </p>
                  <ul className="space-y-2.5 pt-2">
                    {plan.features.map((feat, idx) => (
                      <li key={idx} className="flex items-start gap-2.5 text-xs text-[#F5F5F7]/90">
                        <Check className="w-3.5 h-3.5 text-[#68D6A3] shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-6 mt-6 border-t border-white/[0.06]">
                  <GlassButton
                    variant={isHighlighted ? 'primary' : 'secondary'}
                    className="w-full"
                    onClick={currentUser ? onOpenStudio : onGetStarted}
                  >
                    {plan.priceInr === 0 ? 'Start with Starter Plan' : `Choose ${plan.name}`}
                  </GlassButton>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 11. Frequently Asked Questions */}
      <section id="faq" className="border-t border-white/[0.07] bg-[#101116]/60 py-20">
        <div className="max-w-3xl mx-auto px-6 space-y-8">
          <div className="space-y-2">
            <p className="text-xs text-[#7AA7FF] font-medium">06. Frequently Asked Questions</p>
            <h2 className="text-2xl font-semibold text-[#F5F5F7]">
              Product positioning, privacy, and workflow details.
            </h2>
          </div>

          <div className="divide-y divide-white/[0.08] border-y border-white/[0.08]">
            {FAQ_ITEMS.map((item, idx) => {
              const expanded = openFaq === idx;
              return (
                <div key={idx} className="py-4">
                  <button
                    onClick={() => setOpenFaq(expanded ? null : idx)}
                    className="w-full flex items-center justify-between gap-4 text-left text-sm font-medium text-[#F5F5F7] hover:text-[#7AA7FF] transition-colors cursor-pointer"
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-[#989BA6] shrink-0 transition-transform duration-150 ${
                        expanded ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {expanded && (
                    <p className="text-sm text-[#989BA6] leading-relaxed mt-3 pr-6">{item.a}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 12. Footer & Contact Information */}
      <footer className="border-t border-white/[0.08] bg-[#08090D] py-12">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          <div className="space-y-2 max-w-md">
            <p className="text-sm font-bold tracking-tight text-[#F5F5F7]">DEDSEC AI FORENSIC ASSISTANT</p>
            <p className="text-xs text-[#989BA6] leading-relaxed">
              Illustrative fictional facial-composite studio. Not a biometric identification or
              facial-recognition platform. AI-generated composites are artistic illustrations and may
              not accurately depict any real person.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-xs text-[#989BA6]">
            <a href="#introduction" className="hover:text-[#F5F5F7] transition-colors">
              Overview
            </a>
            <a href="#workflow" className="hover:text-[#F5F5F7] transition-colors">
              Workflow
            </a>
            <a href="#plans" className="hover:text-[#F5F5F7] transition-colors">
              Pricing
            </a>
            <span>Contact: support@dedsec.studio</span>
            <button
              onClick={currentUser ? onOpenStudio : onGetStarted}
              className="text-[#7AA7FF] hover:underline cursor-pointer"
            >
              {currentUser ? 'Open Workspace' : 'Sign In'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
