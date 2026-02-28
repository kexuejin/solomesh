import { Lock } from 'lucide-react';
import type { Skill } from '../../stores/skills';

interface SkillCardProps {
  skill: Skill;
  selected: boolean;
  onSelect: () => void;
}

const SOURCE_LABELS: Record<Skill['source'], string> = {
  user: '用户级',
  project: '项目级',
};

export function SkillCard({ skill, selected, onSelect }: SkillCardProps) {
  return (
    <button
      onClick={onSelect}
      className={`surface-card-soft w-full rounded-xl border p-4 text-left transition-all ${
        selected
          ? 'border-primary/70 bg-brand-50/75 shadow-[0_12px_26px_rgba(15,107,255,0.16)]'
          : 'border-border/70 bg-card/90 hover:border-brand-200/85 hover:bg-muted/35 hover:shadow-[0_10px_22px_rgba(15,23,42,0.09)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-foreground truncate">{skill.name}</h3>
            <span
              className={`rounded-lg border px-2 py-0.5 text-xs font-medium ${
                skill.source === 'user'
                  ? 'border-brand-200/75 bg-brand-50/80 text-primary'
                  : 'border-border/70 bg-muted/60 text-muted-foreground'
              }`}
            >
              {SOURCE_LABELS[skill.source]}
            </span>
            {skill.syncedFromHost && (
              <span className="rounded-lg border border-amber-200/80 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                已同步
              </span>
            )}
            {skill.userInvocable && (
              <span className="rounded-lg border border-blue-200/80 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                可调用
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2">{skill.description}</p>
        </div>

        <div className="flex items-center gap-2" title="技能启用状态为只读">
          <Lock size={16} className="text-muted-foreground/80" />
          <div
            className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
              skill.enabled
                ? 'border-brand-200/80 bg-brand-100'
                : 'border-border/80 bg-muted/70'
            } opacity-60`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-card shadow-sm transition-transform ${
                skill.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </div>
        </div>
      </div>
    </button>
  );
}
