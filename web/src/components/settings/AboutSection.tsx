import { Github, ExternalLink, Heart, Code2, Lightbulb } from 'lucide-react';

export function AboutSection() {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">项目信息</div>
        <div className="text-sm font-medium text-foreground">SoloMesh</div>
        <p className="text-sm text-muted-foreground">自托管多用户 AI Agent 工作空间</p>
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
            作者：kexuejin
          </span>
        </div>
      </section>

      <section className="space-y-3 border-t border-border/70 pt-5">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          灵感来源
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
              SoloMesh 延续“Runtime 优先”的理念：站在成熟运行时能力之上做产品抽象，减少重复造轮子，把重点放在协作、治理和交付链路上。
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
              工具能力通过协议化方式接入，而不是写死在单个实现里。SoloMesh 在 Runtime 上层提供可组合的 MCP 工具与执行编排能力，便于持续扩展。
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
              在多会话协作思路基础上，SoloMesh 引入 Workflow 模板、会话绑定和渠道路由，把“单次回答”组织为“可执行流程”。
            </p>
          </article>
        </div>
      </section>

      <section className="space-y-3 border-t border-border/70 pt-5">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Heart className="h-4 w-4 text-rose-500" />
          设计哲学
        </div>
        <div className="rounded-xl border border-brand-200 bg-brand-50/70 p-3 text-sm text-foreground/85">
          站在成熟运行时之上做产品抽象，用 Runtime、Workflow、渠道编排等能力组织企业级使用场景，而不是重复造 Agent 内核。
        </div>
      </section>
    </div>
  );
}
