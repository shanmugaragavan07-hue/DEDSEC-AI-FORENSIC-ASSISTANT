import React, { useState } from 'react';
import {
  ChevronDown,
  Loader2,
  Mic,
  Sparkles,
  Sliders,
  Wand2,
  FileText,
  Palette,
  RotateCcw,
} from 'lucide-react';
import { DEFAULT_FACIAL_PROFILE, FacialProfile, StyleReference } from '../types.ts';
import { GlassButton } from './LiquidGlassUI.tsx';

interface FacialAttributeInspectorProps {
  description: string;
  onChangeDescription: (val: string) => void;
  profile: FacialProfile;
  onChangeProfile: (next: FacialProfile) => void;
  styles: StyleReference[];
  selectedStyleId: string;
  onChangeStyleId: (id: string) => void;
  hasActiveImage: boolean;
  isExtracting: boolean;
  isGenerating: boolean;
  isRefining: boolean;
  onOpenVoiceModal: () => void;
  onExtractProfile: () => void;
  onGenerateComposite: () => void;
  onRefineComposite: (instruction: string) => void;
}

type InspectorTab = 'description' | 'attributes' | 'refine' | 'style';

const ATTRIBUTE_GROUPS: {
  id: string;
  title: string;
  fields: { key: keyof FacialProfile; label: string; presets: string[] }[];
}[] = [
  {
    id: 'head',
    title: 'Head & Face',
    fields: [
      { key: 'subjectGenderPresentation', label: 'Adult Presentation', presets: ['unknown', 'adult man', 'adult woman', 'androgynous adult'] },
      { key: 'approximateAgeGroup', label: 'Age Bracket', presets: ['young adult (25-35)', 'adult', 'middle-aged adult (35-50)', 'older adult (50-65)'] },
      { key: 'faceShape', label: 'Face Shape', presets: ['unknown', 'oval', 'round', 'square', 'heart', 'oblong', 'diamond'] },
      { key: 'forehead', label: 'Forehead', presets: ['unknown', 'average', 'broad', 'high', 'narrow', 'lightly furrowed'] },
      { key: 'hairline', label: 'Hairline', presets: ['unknown', 'straight', 'rounded', 'receding temples', 'widow peak', 'high'] },
      { key: 'cheeks', label: 'Cheeks', presets: ['unknown', 'balanced', 'prominent cheekbones', 'full', 'lean hollow'] },
      { key: 'jawline', label: 'Jawline', presets: ['unknown', 'soft rounded', 'defined angular', 'square', 'tapered'] },
      { key: 'chin', label: 'Chin', presets: ['unknown', 'rounded', 'square', 'slightly pointed', 'subtle cleft'] },
    ],
  },
  {
    id: 'eyes',
    title: 'Eyes & Eyebrows',
    fields: [
      { key: 'eyeShape', label: 'Eye Shape', presets: ['unknown', 'almond', 'deep-set', 'hooded', 'round', 'upturned'] },
      { key: 'eyeSpacing', label: 'Eye Spacing', presets: ['unknown', 'average', 'wide-set', 'close-set'] },
      { key: 'eyeSize', label: 'Eye Size', presets: ['unknown', 'medium', 'large', 'narrow'] },
      { key: 'eyebrowShape', label: 'Eyebrow Shape', presets: ['unknown', 'straight', 'slightly arched', 'curved', 'angled'] },
      { key: 'eyebrowThickness', label: 'Eyebrow Thickness', presets: ['unknown', 'medium', 'thick', 'thin', 'dense'] },
    ],
  },
  {
    id: 'nose_mouth',
    title: 'Nose & Mouth',
    fields: [
      { key: 'noseShape', label: 'Nose Shape', presets: ['unknown', 'straight', 'rounded tip', 'aquiline', 'upturned'] },
      { key: 'noseWidth', label: 'Nose Width', presets: ['unknown', 'medium', 'broad', 'narrow'] },
      { key: 'noseBridge', label: 'Nose Bridge', presets: ['unknown', 'medium', 'high prominent', 'low'] },
      { key: 'lipShape', label: 'Lip Shape', presets: ['unknown', 'medium balanced', 'full', 'thin', 'defined cupid bow'] },
      { key: 'mouthWidth', label: 'Mouth Width', presets: ['unknown', 'medium', 'wide', 'narrow'] },
    ],
  },
  {
    id: 'hair',
    title: 'Hair & Facial Hair',
    fields: [
      { key: 'hairstyle', label: 'Hairstyle', presets: ['unknown', 'side-parted crop', 'textured short crop', 'slicked back', 'shoulder-length layered', 'buzz cut', 'bald'] },
      { key: 'hairLength', label: 'Hair Length', presets: ['unknown', 'short', 'cropped', 'medium', 'shoulder-length', 'long', 'bald'] },
      { key: 'hairTexture', label: 'Hair Texture', presets: ['unknown', 'straight', 'wavy', 'curly', 'coiled', 'fine'] },
      { key: 'facialHair', label: 'Facial Hair', presets: ['unknown', 'clean-shaven', 'moustache', 'trimmed beard', 'light stubble', 'goatee'] },
      { key: 'beardMoustacheDetails', label: 'Beard / Moustache Detail', presets: ['unknown', 'none', 'neatly trimmed moustache', 'short boxed beard', 'light jaw stubble'] },
    ],
  },
  {
    id: 'additional',
    title: 'Additional Features',
    fields: [
      { key: 'ears', label: 'Ears', presets: ['unknown', 'average close-set', 'prominent', 'attached lobes'] },
      { key: 'glasses', label: 'Eyeglasses', presets: ['unknown', 'none', 'thin rectangular wire-frame glasses', 'round wireframe spectacles', 'dark rimmed glasses'] },
      { key: 'facialMarks', label: 'Facial Marks', presets: ['unknown', 'none', 'subtle freckles', 'small mole on cheek', 'faint eyebrow scar'] },
      { key: 'accessories', label: 'Accessories', presets: ['unknown', 'none', 'small stud earrings'] },
    ],
  },
];

const QUICK_REFINEMENTS = [
  'Add thin rectangular wire-frame glasses',
  'Add a neatly trimmed moustache',
  'Make the jawline slightly stronger and more angular',
  'Change hairstyle to short wavy side-parted hair',
  'Make eyebrows thicker and slightly arched',
  'Remove facial hair for a clean-shaven jaw',
];

export const FacialAttributeInspector: React.FC<FacialAttributeInspectorProps> = ({
  description,
  onChangeDescription,
  profile,
  onChangeProfile,
  styles,
  selectedStyleId,
  onChangeStyleId,
  hasActiveImage,
  isExtracting,
  isGenerating,
  isRefining,
  onOpenVoiceModal,
  onExtractProfile,
  onGenerateComposite,
  onRefineComposite,
}) => {
  const [activeTab, setActiveTab] = useState<InspectorTab>('description');
  const [expandedGroup, setExpandedGroup] = useState<string>('head');
  const [refinementText, setRefinementText] = useState('');

  const busy = isExtracting || isGenerating || isRefining;

  const updateField = (key: keyof FacialProfile, value: string | number) => {
    onChangeProfile({
      ...profile,
      [key]: value,
    });
  };

  const definedTraitCount = Object.entries(profile).filter(
    ([k, v]) =>
      !['approximateAgeGroup', 'graphiteContrast', 'pencilDetailWeight'].includes(k) &&
      typeof v === 'string' &&
      v.trim().toLowerCase() !== 'unknown'
  ).length;

  const glassesEnabled =
    profile.glasses !== 'unknown' && profile.glasses !== 'none' && profile.glasses.trim() !== '';

  return (
    <aside className="w-full lg:w-[360px] xl:w-[390px] shrink-0 bg-[#0C0D12] border-t lg:border-t-0 lg:border-l border-white/[0.08] flex flex-col h-full">
      {/* Segmented Inspector Tabs */}
      <div className="p-3 border-b border-white/[0.08]">
        <div className="grid grid-cols-4 p-1 rounded-xl bg-[#08090D] border border-white/[0.07] gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('description')}
            className={`py-1.5 px-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'description'
                ? 'bg-[#181A22] text-[#F5F5F7]'
                : 'text-[#989BA6] hover:text-[#F5F5F7]'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Input
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('attributes')}
            className={`py-1.5 px-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'attributes'
                ? 'bg-[#181A22] text-[#F5F5F7]'
                : 'text-[#989BA6] hover:text-[#F5F5F7]'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            Profile ({definedTraitCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('refine')}
            className={`py-1.5 px-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'refine'
                ? 'bg-[#181A22] text-[#F5F5F7]'
                : 'text-[#989BA6] hover:text-[#F5F5F7]'
            }`}
          >
            <Wand2 className="w-3.5 h-3.5" />
            Refine
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('style')}
            className={`py-1.5 px-2 rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'style'
                ? 'bg-[#181A22] text-[#F5F5F7]'
                : 'text-[#989BA6] hover:text-[#F5F5F7]'
            }`}
          >
            <Palette className="w-3.5 h-3.5" />
            Style
          </button>
        </div>
      </div>

      {/* Scrollable Inspector Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'description' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-[#F5F5F7]">
                Facial Description
              </label>
              <span className="text-[11px] font-mono tabular-nums text-[#989BA6]">
                {description.length} chars
              </span>
            </div>

            <textarea
              rows={6}
              value={description}
              onChange={(e) => onChangeDescription(e.target.value)}
              placeholder="Describe a fictional adult's facial characteristics—for example: 'A fictional adult man with an oval face, short side-parted dark hair, slightly arched thick eyebrows, deep-set almond eyes, a broad nose, medium lips, and a neatly trimmed moustache.'"
              className="w-full p-3.5 text-sm rounded-xl bg-[#08090D] border border-white/[0.1] text-[#F5F5F7] placeholder:text-[#989BA6]/45 focus:outline-none focus:border-[#7AA7FF] resize-y leading-relaxed"
            />

            <div className="flex items-center justify-between gap-2">
              <GlassButton
                type="button"
                variant="secondary"
                size="sm"
                onClick={onOpenVoiceModal}
                disabled={busy}
              >
                <Mic className="w-3.5 h-3.5 text-[#A78BFA]" />
                Voice Input
              </GlassButton>

              <div className="flex items-center gap-1.5">
                <GlassButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onChangeDescription(
                      'A fictional adult man in his mid-thirties with an oval face, short black side-parted hair, thick slightly arched eyebrows, deep-set almond eyes, a straight medium-broad nose, balanced lips, and a neatly trimmed moustache.'
                    )
                  }
                  disabled={busy}
                >
                  Sample
                </GlassButton>
                <GlassButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChangeDescription('')}
                  disabled={!description || busy}
                >
                  Clear
                </GlassButton>
              </div>
            </div>

            <div className="pt-2 border-t border-white/[0.08] space-y-2.5">
              <GlassButton
                type="button"
                variant="secondary"
                className="w-full"
                disabled={description.trim().length < 10 || busy}
                onClick={async () => {
                  await onExtractProfile();
                  setActiveTab('attributes');
                }}
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Extracting Facial Profile...
                  </>
                ) : (
                  <>
                    <Sliders className="w-4 h-4 text-[#7AA7FF]" />
                    Extract &amp; Review Profile
                  </>
                )}
              </GlassButton>

              <GlassButton
                type="button"
                variant="primary"
                className="w-full"
                disabled={description.trim().length < 10 || busy}
                onClick={onGenerateComposite}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Synthesizing Graphite Composite...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate Composite
                  </>
                )}
              </GlassButton>
            </div>

            <p className="text-[11px] text-[#989BA6] leading-relaxed">
              Unspecified attributes remain marked as unknown rather than invented. Review the
              Profile tab anytime to inspect or override individual facial traits.
            </p>
          </div>
        )}

        {activeTab === 'attributes' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-[#F5F5F7]">Structured Facial Profile</p>
              <button
                type="button"
                onClick={() => onChangeProfile({ ...DEFAULT_FACIAL_PROFILE })}
                className="inline-flex items-center gap-1 text-[11px] text-[#989BA6] hover:text-[#F5F5F7] cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                Reset traits
              </button>
            </div>

            {/* Quick Eyeglasses Toggle */}
            <div className="p-3 rounded-xl bg-[#101116] border border-white/[0.07] flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-[#F5F5F7]">Eyeglasses Toggle</p>
                <p className="text-[11px] text-[#989BA6]">Include optical frames in composite</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={glassesEnabled}
                onClick={() =>
                  updateField(
                    'glasses',
                    glassesEnabled ? 'none' : 'thin rectangular wire-frame glasses'
                  )
                }
                className={`w-10 h-5.5 rounded-full transition-colors p-0.5 cursor-pointer ${
                  glassesEnabled ? 'bg-[#7AA7FF]' : 'bg-white/15'
                }`}
              >
                <div
                  className={`w-4.5 h-4.5 rounded-full bg-[#08090D] transition-transform ${
                    glassesEnabled ? 'translate-x-4.5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Expandable Attribute Groups */}
            <div className="space-y-2">
              {ATTRIBUTE_GROUPS.map((group) => {
                const isOpen = expandedGroup === group.id;
                return (
                  <div
                    key={group.id}
                    className="rounded-xl bg-[#101116] border border-white/[0.07] overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedGroup(isOpen ? '' : group.id)}
                      className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-semibold text-[#F5F5F7] hover:bg-white/[0.03] cursor-pointer"
                    >
                      <span>{group.title}</span>
                      <ChevronDown
                        className={`w-4 h-4 text-[#989BA6] transition-transform duration-150 ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {isOpen && (
                      <div className="px-3.5 pb-3.5 pt-1 space-y-3 border-t border-white/[0.06]">
                        {group.fields.map((f) => {
                          const currentVal = String(profile[f.key] ?? 'unknown');
                          const isCustom = !f.presets.includes(currentVal);
                          return (
                            <div key={String(f.key)} className="space-y-1">
                              <div className="flex items-center justify-between">
                                <label className="text-[11px] text-[#989BA6]">{f.label}</label>
                                <select
                                  value={isCustom ? '__custom__' : currentVal}
                                  onChange={(e) => {
                                    if (e.target.value !== '__custom__') {
                                      updateField(f.key, e.target.value);
                                    }
                                  }}
                                  className="text-[11px] bg-[#181A22] border border-white/[0.09] rounded-md px-2 py-0.5 text-[#F5F5F7] focus:outline-none focus:border-[#7AA7FF]"
                                >
                                  {f.presets.map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                  {isCustom && <option value="__custom__">Custom value</option>}
                                </select>
                              </div>
                              <input
                                type="text"
                                value={currentVal}
                                onChange={(e) => updateField(f.key, e.target.value)}
                                className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-[#08090D] border border-white/[0.08] text-[#F5F5F7] focus:outline-none focus:border-[#7AA7FF]"
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <GlassButton
              type="button"
              variant="primary"
              className="w-full mt-2"
              disabled={description.trim().length < 10 || busy}
              onClick={onGenerateComposite}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Synthesizing Composite...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate from Edited Profile
                </>
              )}
            </GlassButton>
          </div>
        )}

        {activeTab === 'refine' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-[#F5F5F7]">Refine Existing Composite</p>
              <p className="text-xs text-[#989BA6] leading-relaxed">
                Modify specific facial attributes on the active composite while preserving unrelated
                features and saving a new version in history.
              </p>
            </div>

            {!hasActiveImage && (
              <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs text-[#E8BB75]">
                Generate an initial composite first to unlock image-to-image refinement.
              </div>
            )}

            <textarea
              rows={4}
              value={refinementText}
              onChange={(e) => setRefinementText(e.target.value)}
              disabled={!hasActiveImage || busy}
              placeholder="e.g., Add thin rectangular eyeglasses, narrow the jawline slightly, or add a trimmed beard."
              className="w-full p-3 text-sm rounded-xl bg-[#08090D] border border-white/[0.1] text-[#F5F5F7] placeholder:text-[#989BA6]/45 focus:outline-none focus:border-[#7AA7FF] disabled:opacity-50 resize-none"
            />

            <div className="space-y-1.5">
              <p className="text-[11px] text-[#989BA6]">Quick Refinement Presets</p>
              <div className="flex flex-col gap-1.5">
                {QUICK_REFINEMENTS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={!hasActiveImage || busy}
                    onClick={() => setRefinementText(preset)}
                    className="text-left px-3 py-1.5 rounded-lg bg-[#101116] border border-white/[0.07] text-xs text-[#989BA6] hover:text-[#F5F5F7] hover:border-white/[0.16] transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <GlassButton
              type="button"
              variant="primary"
              className="w-full"
              disabled={!hasActiveImage || !refinementText.trim() || busy}
              onClick={() => {
                onRefineComposite(refinementText.trim());
                setRefinementText('');
              }}
            >
              {isRefining ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Applying Refinement...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  Refine Composite
                </>
              )}
            </GlassButton>
          </div>
        )}

        {activeTab === 'style' && (
          <div className="space-y-5">
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-[#F5F5F7]">Approved Graphite Style References</p>
              <p className="text-[11px] text-[#989BA6] leading-relaxed">
                Style references guide pencil texture, paper grain, and monochrome tonal balance—never
                copying the reference face identity.
              </p>

              <div className="space-y-2.5">
                {styles.map((style) => {
                  const selected = style.id === selectedStyleId;
                  return (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => onChangeStyleId(style.id)}
                      className={`w-full text-left p-3 rounded-xl border transition-colors flex items-start gap-3 cursor-pointer ${
                        selected
                          ? 'bg-[#181A22] border-[#7AA7FF]'
                          : 'bg-[#101116] border-white/[0.08] hover:border-white/[0.16]'
                      }`}
                    >
                      <div className="w-14 h-14 rounded-lg overflow-hidden bg-white shrink-0 border border-white/10">
                        <img
                          src={style.previewUrl}
                          alt={style.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-[#F5F5F7] truncate">{style.name}</p>
                        <p className="text-[11px] text-[#989BA6] line-clamp-2 mt-0.5 leading-relaxed">
                          {style.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-4 border-t border-white/[0.08] space-y-4">
              <p className="text-xs font-semibold text-[#F5F5F7]">Graphite Tonal Calibration</p>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-[#989BA6]">Graphite Shading Contrast</span>
                  <span className="font-mono tabular-nums text-[#F5F5F7]">
                    {profile.graphiteContrast}%
                  </span>
                </div>
                <input
                  type="range"
                  min={30}
                  max={90}
                  value={profile.graphiteContrast}
                  onChange={(e) => updateField('graphiteContrast', Number(e.target.value))}
                  className="w-full accent-[#7AA7FF] cursor-pointer"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-[#989BA6]">Pencil Stroke Detail Weight</span>
                  <span className="font-mono tabular-nums text-[#F5F5F7]">
                    {profile.pencilDetailWeight}%
                  </span>
                </div>
                <input
                  type="range"
                  min={30}
                  max={90}
                  value={profile.pencilDetailWeight}
                  onChange={(e) => updateField('pencilDetailWeight', Number(e.target.value))}
                  className="w-full accent-[#7AA7FF] cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
