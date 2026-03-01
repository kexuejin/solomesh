import { Github, ExternalLink, Heart, Code2, Lightbulb } from 'lucide-react';
import { useI18n } from '../../i18n';

export function AboutSection() {
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">{t('settings.about.infoBadge')}</div>
        <div className="text-sm font-medium text-foreground">SoloMesh</div>
        <p className="text-sm text-muted-foreground">{t('settings.about.subtitle')}</p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <a
            href="https://github.com/kexuejin/solomesh"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card px-3 py-1.5 text-brand-700 hover:text-brand-600"
          >
            <Github className="h-4 w-4 shrink-0 text-muted-foreground" />
            kexuejin/solomesh
            <ExternalLink className="h-3 w-3" />
          </a>
          <span className="inline-flex items-center gap-1 text-foreground">
            <Code2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            {t('settings.about.author')}
          </span>
        </div>
      </section>

      <section className="space-y-3 border-t border-border/70 pt-5">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          {t('settings.about.inspirationTitle')}
        </div>
        <div className="space-y-3 text-sm text-muted-foreground">
          <article className="border-l-2 border-border/70 pl-3">
            <a
              href="https://github.com/anthropics/claude-code/tree/main/packages/claude-agent-sdk"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-brand-700 hover:text-brand-600"
            >
              Claude Agent SDK / Claude Code
              <ExternalLink className="h-3 w-3" />
            </a>
            <p className="mt-1 leading-relaxed">
              {t('settings.about.inspiration.runtime')}
            </p>
          </article>
          <article className="border-l-2 border-border/70 pl-3">
            <a
              href="https://modelcontextprotocol.io/introduction"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-brand-700 hover:text-brand-600"
            >
              Model Context Protocol (MCP)
              <ExternalLink className="h-3 w-3" />
            </a>
            <p className="mt-1 leading-relaxed">
              {t('settings.about.inspiration.mcp')}
            </p>
          </article>
          <article className="border-l-2 border-border/70 pl-3">
            <a
              href="https://github.com/anthropics/claude-code/tree/main/packages/cowork"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-brand-700 hover:text-brand-600"
            >
              Multi-session Collaboration
              <ExternalLink className="h-3 w-3" />
            </a>
            <p className="mt-1 leading-relaxed">
              {t('settings.about.inspiration.collaboration')}
            </p>
          </article>
        </div>
      </section>

      <section className="space-y-3 border-t border-border/70 pt-5">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Heart className="h-4 w-4 text-rose-500" />
          {t('settings.about.philosophyTitle')}
        </div>
        <div className="rounded-xl border border-brand-200 bg-brand-50/70 p-3 text-sm text-foreground/85">
          {t('settings.about.philosophy')}
        </div>
      </section>
    </div>
  );
}
