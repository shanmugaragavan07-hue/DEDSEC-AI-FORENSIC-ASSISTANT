import React, { useState } from 'react';
import {
  Bookmark,
  Download,
  Edit3,
  FileText,
  FolderOpen,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { ForensicCase } from '../types.ts';
import { downloadCompositeImage, exportCasePdfReport } from '../lib/exportUtils.ts';
import { GlassButton, GlassModal, GlassPanel } from './LiquidGlassUI.tsx';

interface CasesGalleryViewProps {
  cases: ForensicCase[];
  initialFilter?: 'all' | 'recent' | 'saved';
  onOpenCase: (caseRecord: ForensicCase) => void;
  onNewComposite: () => void;
  onRenameCase: (caseId: string, newTitle: string) => Promise<void>;
  onToggleSaved: (caseRecord: ForensicCase) => Promise<void>;
  onDeleteCase: (caseId: string) => Promise<void>;
  notify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export const CasesGalleryView: React.FC<CasesGalleryViewProps> = ({
  cases,
  initialFilter = 'all',
  onOpenCase,
  onNewComposite,
  onRenameCase,
  onToggleSaved,
  onDeleteCase,
  notify,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'recent' | 'saved'>(initialFilter);
  const [renamingCase, setRenamingCase] = useState<ForensicCase | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [deletingCase, setDeletingCase] = useState<ForensicCase | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filteredCases = cases.filter((c) => {
    const matchesSearch =
      !searchQuery.trim() ||
      c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.originalDescription.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;
    if (filter === 'saved') return c.isSaved && Boolean(c.activeImageUrl);
    if (filter === 'recent') {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return new Date(c.updatedAt).getTime() >= sevenDaysAgo;
    }
    return true;
  });

  const handleExport = async (c: ForensicCase, format: 'png' | 'jpeg' | 'pdf') => {
    if (!c.activeImageUrl) {
      notify('error', 'No Composite Image', 'Open this case and generate a composite image first.');
      return;
    }
    try {
      if (format === 'pdf') {
        await exportCasePdfReport(c);
        notify('success', 'PDF Dossier Exported', `Saved ${c.title} report.`);
      } else {
        await downloadCompositeImage(c.activeImageUrl, c.title, format);
        notify('success', `${format.toUpperCase()} Downloaded`, `Exported ${c.title}.`);
      }
    } catch (err: any) {
      notify('error', 'Export Failed', err?.message);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[#F5F5F7]">Case Files &amp; Saved Composites</h2>
          <p className="text-xs text-[#989BA6] mt-1">
            Reopen saved facial composites, inspect version histories, or export formatted PDF case reports.
          </p>
        </div>
        <GlassButton variant="primary" onClick={onNewComposite}>
          <Plus className="w-4 h-4" />
          New Composite Case
        </GlassButton>
      </div>

      {/* Search & Interactive Filter Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-[#989BA6] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by case title or facial description..."
            className="w-full pl-10 pr-4 py-2 text-sm rounded-xl bg-[#101116] border border-white/[0.09] text-[#F5F5F7] placeholder:text-[#989BA6]/50 focus:outline-none focus:border-[#7AA7FF]"
          />
        </div>

        <div className="inline-flex items-center p-1 rounded-xl bg-[#101116] border border-white/[0.08] gap-1 self-start">
          {(['all', 'recent', 'saved'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                filter === tab
                  ? 'bg-[#181A22] text-[#F5F5F7]'
                  : 'text-[#989BA6] hover:text-[#F5F5F7]'
              }`}
            >
              {tab === 'all' && `All Cases (${cases.length})`}
              {tab === 'recent' && 'Recent (7d)'}
              {tab === 'saved' && 'Saved Sketches'}
            </button>
          ))}
        </div>
      </div>

      {/* Cases Grid or Empty State */}
      {filteredCases.length === 0 ? (
        <GlassPanel className="p-12 text-center space-y-4">
          <p className="text-base font-medium text-[#F5F5F7]">No composite cases match this view</p>
          <p className="text-xs text-[#989BA6] max-w-md mx-auto">
            Start a new composite description by text or voice to extract a structured profile and
            generate your first monochrome graphite sketch.
          </p>
          <GlassButton variant="primary" onClick={onNewComposite}>
            <Plus className="w-4 h-4" />
            Create First Composite
          </GlassButton>
        </GlassPanel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredCases.map((c) => (
            <div
              key={c.id}
              className="rounded-2xl bg-[#101116] border border-white/[0.08] hover:border-white/[0.16] transition-colors overflow-hidden flex flex-col"
            >
              <div
                onClick={() => onOpenCase(c)}
                className="aspect-square bg-[#181A22] flex items-center justify-center overflow-hidden cursor-pointer relative group"
              >
                {c.activeImageUrl ? (
                  <img
                    src={c.activeImageUrl}
                    alt={c.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain bg-white group-hover:scale-[1.02] transition-transform duration-200"
                  />
                ) : (
                  <div className="text-center p-6 space-y-2">
                    <FileText className="w-8 h-8 text-[#989BA6]/50 mx-auto" />
                    <p className="text-xs text-[#989BA6]">Draft Profile · No Composite Yet</p>
                  </div>
                )}
              </div>

              <div className="p-4 flex-1 flex flex-col justify-between space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3
                      onClick={() => onOpenCase(c)}
                      className="text-sm font-semibold text-[#F5F5F7] hover:text-[#7AA7FF] transition-colors cursor-pointer truncate"
                    >
                      {c.title}
                    </h3>
                    <button
                      type="button"
                      onClick={() => onToggleSaved(c)}
                      title={c.isSaved ? 'Remove from Saved Sketches' : 'Bookmark in Saved Sketches'}
                      className={`p-1 rounded-md cursor-pointer ${
                        c.isSaved ? 'text-[#7AA7FF]' : 'text-[#989BA6] hover:text-[#F5F5F7]'
                      }`}
                    >
                      <Bookmark className={`w-3.5 h-3.5 ${c.isSaved ? 'fill-current' : ''}`} />
                    </button>
                  </div>

                  {/* Clean Zero-Pill Unboxed Metadata */}
                  <div className="flex items-center gap-1.5 text-[11px] text-[#989BA6] font-mono tabular-nums">
                    <span>{c.versions.length} {c.versions.length === 1 ? 'version' : 'versions'}</span>
                    <span aria-hidden="true">·</span>
                    <span>{new Date(c.updatedAt).toLocaleDateString()}</span>
                  </div>

                  <p className="text-xs text-[#989BA6] line-clamp-2 leading-relaxed pt-1">
                    {c.originalDescription || 'No description saved.'}
                  </p>
                </div>

                <div className="pt-3 border-t border-white/[0.07] flex items-center justify-between gap-2">
                  <GlassButton variant="secondary" size="sm" onClick={() => onOpenCase(c)}>
                    <FolderOpen className="w-3.5 h-3.5" />
                    Open
                  </GlassButton>

                  <div className="flex items-center gap-1">
                    {c.activeImageUrl && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleExport(c, 'png')}
                          title="Download PNG"
                          className="px-2 py-1 text-[11px] rounded-md text-[#989BA6] hover:text-[#F5F5F7] hover:bg-white/[0.06] cursor-pointer"
                        >
                          PNG
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExport(c, 'pdf')}
                          title="Export PDF Case Report"
                          className="px-2 py-1 text-[11px] rounded-md text-[#989BA6] hover:text-[#F5F5F7] hover:bg-white/[0.06] cursor-pointer inline-flex items-center gap-1"
                        >
                          <Download className="w-3 h-3" />
                          PDF
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingCase(c);
                        setRenameInput(c.title);
                      }}
                      title="Rename case"
                      className="p-1.5 rounded-md text-[#989BA6] hover:text-[#F5F5F7] hover:bg-white/[0.06] cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingCase(c)}
                      title="Delete case"
                      className="p-1.5 rounded-md text-[#989BA6] hover:text-red-300 hover:bg-red-500/10 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rename Modal */}
      <GlassModal
        open={Boolean(renamingCase)}
        onClose={() => setRenamingCase(null)}
        title="Rename Case File"
        subtitle="Update the reference title for this composite case."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!renamingCase || !renameInput.trim()) return;
            setBusyId(renamingCase.id);
            try {
              await onRenameCase(renamingCase.id, renameInput.trim());
              setRenamingCase(null);
            } finally {
              setBusyId(null);
            }
          }}
          className="space-y-4"
        >
          <input
            type="text"
            required
            value={renameInput}
            onChange={(e) => setRenameInput(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-[#08090D] border border-white/[0.1] text-[#F5F5F7] focus:outline-none focus:border-[#7AA7FF]"
          />
          <div className="flex justify-end gap-2">
            <GlassButton type="button" variant="secondary" onClick={() => setRenamingCase(null)}>
              Cancel
            </GlassButton>
            <GlassButton type="submit" variant="primary" disabled={Boolean(busyId)}>
              Save Title
            </GlassButton>
          </div>
        </form>
      </GlassModal>

      {/* Delete Confirmation Modal */}
      <GlassModal
        open={Boolean(deletingCase)}
        onClose={() => setDeletingCase(null)}
        title="Delete Composite Case?"
        subtitle="This permanently removes the case, profile, notes, and version history."
      >
        <div className="space-y-4">
          <p className="text-xs text-[#989BA6]">
            Are you sure you want to permanently delete{' '}
            <span className="text-[#F5F5F7] font-semibold">{deletingCase?.title}</span>?
          </p>
          <div className="flex justify-end gap-2">
            <GlassButton type="button" variant="secondary" onClick={() => setDeletingCase(null)}>
              Cancel
            </GlassButton>
            <GlassButton
              type="button"
              variant="danger"
              disabled={Boolean(busyId)}
              onClick={async () => {
                if (!deletingCase) return;
                setBusyId(deletingCase.id);
                try {
                  await onDeleteCase(deletingCase.id);
                  setDeletingCase(null);
                } finally {
                  setBusyId(null);
                }
              }}
            >
              Delete Permanently
            </GlassButton>
          </div>
        </div>
      </GlassModal>
    </div>
  );
};
