import { useState, useEffect } from 'react';
import { File, Folder, Loader2, Lock, Trash2 } from 'lucide-react';
import { useSkillsStore, type SkillDetail as SkillDetailType } from '../../stores/skills';
import { MarkdownRenderer } from '../chat/MarkdownRenderer';
import { useI18n } from '../../i18n';

interface SkillDetailProps {
  skillId: string | null;
  onDeleted?: () => void;
}

export function SkillDetail({ skillId, onDeleted }: SkillDetailProps) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<SkillDetailType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const getSkillDetail = useSkillsStore((state) => state.getSkillDetail);
  const deleteSkill = useSkillsStore((state) => state.deleteSkill);

  useEffect(() => {
    if (!skillId) {
      setDetail(null);
      setError(null);
      return;
    }

    const loadDetail = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getSkillDetail(skillId);
        setDetail(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('skills.detail.loadFailed'));
        setDetail(null);
      } finally {
        setLoading(false);
      }
    };

    loadDetail();
  }, [skillId, getSkillDetail, t]);

  if (!skillId) {
    return (
      <div className="surface-card-soft flex items-center justify-center rounded-xl border border-border/70 bg-muted/20 p-12">
        <p className="text-muted-foreground/80 text-center">{t('skills.detail.selectHint')}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="surface-card-soft flex items-center justify-center rounded-xl border border-border/70 bg-muted/20 p-12">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="surface-card-soft flex items-center justify-center rounded-xl border border-red-200 bg-red-50/70 p-12">
        <p className="text-red-600 text-center">{error || t('skills.detail.loadFailed')}</p>
      </div>
    );
  }

  return (
    <div className="surface-card overflow-hidden rounded-xl">
      <div className="border-b border-border/70 bg-[linear-gradient(140deg,rgba(15,107,255,0.10),rgba(20,184,166,0.08))] p-5 md:p-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-xl font-bold text-foreground">{detail.name}</h2>
              <span
                className={`rounded-lg border px-2 py-0.5 text-xs font-medium ${
                  detail.source === 'user'
                    ? 'border-brand-200/75 bg-brand-50/80 text-primary'
                    : 'border-border/70 bg-muted/60 text-muted-foreground'
                }`}
              >
                {detail.source === 'user' ? t('skills.common.sourceUser') : t('skills.common.sourceProject')}
              </span>
              {detail.syncedFromHost && (
                <span className="rounded-lg border border-amber-200/80 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                  {t('skills.common.synced')}
                </span>
              )}
              {detail.userInvocable && (
                <span className="rounded-lg border border-blue-200/80 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                  {t('skills.common.invocable')}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{detail.description}</p>
          </div>

          {detail.source === 'project' ? (
            <div className="flex items-center gap-2">
              <Lock size={16} className="text-muted-foreground/80" />
              <div
                className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
                  detail.enabled
                    ? 'border-brand-200/80 bg-brand-100'
                    : 'border-border/80 bg-muted/70'
                } opacity-60`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-card shadow-sm transition-transform ${
                    detail.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </div>
            </div>
          ) : (
            <button
              disabled={deleting}
              onClick={async () => {
                if (!confirm(t('skills.detail.confirmDelete', { name: detail.name }))) return;
                setDeleting(true);
                try {
                  await deleteSkill(detail.id);
                  onDeleted?.();
                } catch {
                  // error is handled by the store
                } finally {
                  setDeleting(false);
                }
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-red-200/80 px-3 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 size={16} />
              {deleting ? t('skills.detail.deleting') : t('skills.detail.delete')}
            </button>
          )}
        </div>

        {/* Metadata */}
        <div className="space-y-2 text-sm">
          {detail.allowedTools && detail.allowedTools.length > 0 && (
            <div>
              <span className="text-muted-foreground">{t('skills.detail.allowedTools')}:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {detail.allowedTools.map((tool: string) => (
                  <span
                    key={tool}
                    className="rounded-lg border border-border/70 bg-muted/60 px-2 py-0.5 text-xs text-foreground/85"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}
          {detail.argumentHint && (
            <div>
              <span className="text-muted-foreground">{t('skills.detail.argumentHint')}:</span>
              <span className="text-foreground/80 ml-2">{detail.argumentHint}</span>
            </div>
          )}
        </div>
      </div>

      {/* SKILL.md content */}
      <div className="border-b border-border/70 p-5 md:p-6">
        <h3 className="text-sm font-semibold text-foreground/80 mb-3">{t('skills.detail.skillDoc')}</h3>
        <div className="max-w-none">
          <MarkdownRenderer content={detail.content} variant="docs" />
        </div>
      </div>

      {/* File list */}
      {detail.files && detail.files.length > 0 && (
        <div className="border-b border-border/70 p-5 md:p-6">
          <h3 className="text-sm font-semibold text-foreground/80 mb-3">{t('skills.detail.fileList')}</h3>
          <div className="space-y-1.5">
            {detail.files.map((file) => (
              <div
                key={file.name}
                className="flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-2 text-sm text-muted-foreground"
              >
                {file.type === 'directory' ? (
                  <Folder size={16} className="text-muted-foreground/80" />
                ) : (
                  <File size={16} className="text-muted-foreground/80" />
                )}
                <span>{file.name}</span>
                {file.type === 'file' && (
                  <span className="text-xs text-muted-foreground/80">({file.size} B)</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer note */}
      <div className="bg-muted/25 p-5 md:p-6">
        <p className="text-sm text-muted-foreground/90">
          {detail.source === 'user'
            ? detail.syncedFromHost
              ? t('skills.detail.footerSynced')
              : t('skills.detail.footerUser')
            : t('skills.detail.footerProject')}
        </p>
      </div>
    </div>
  );
}
