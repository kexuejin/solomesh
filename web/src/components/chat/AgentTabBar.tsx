import { Plus, X } from 'lucide-react';
import type { AgentInfo } from '../../types';

interface AgentTabBarProps {
  agents: AgentInfo[];
  activeTab: string | null; // null = main conversation
  onSelectTab: (agentId: string | null) => void;
  onDeleteAgent: (agentId: string) => void;
  onCreateConversation?: () => void;
  sdkTaskIds?: Set<string>; // SDK Task IDs (managed by SDK, no manual delete)
}

const TASK_STATUS_ICON: Record<string, string> = {
  running: '\u{1F504}', // 🔄
  completed: '\u{2705}', // ✅
  error: '\u{274C}', // ❌
};

const tabClass = (active: boolean) =>
  `flex-shrink-0 px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
    active
      ? 'bg-brand-100 text-brand-700 shadow-sm'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

export function AgentTabBar({ agents, activeTab, onSelectTab, onDeleteAgent, onCreateConversation, sdkTaskIds }: AgentTabBarProps) {
  const conversations = agents.filter(a => a.kind === 'conversation');
  const tasks = agents.filter(a => a.kind === 'task');

  // Show bar if there are agents OR if creation is available
  if (conversations.length === 0 && tasks.length === 0 && !onCreateConversation) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border/70 bg-muted/70 px-3 py-1.5 scrollbar-none">
      {/* Main conversation tab */}
      <button onClick={() => onSelectTab(null)} className={tabClass(activeTab === null)}>
        主对话
      </button>

      {/* Conversation tabs — same visual level as main */}
      {conversations.map((agent) => (
        <div
          key={agent.id}
          className={`${tabClass(activeTab === agent.id)} flex items-center gap-1.5 group`}
          onClick={() => onSelectTab(agent.id)}
        >
          {agent.status === 'running' && (
            <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-brand-500" />
          )}
          <span className="truncate max-w-[120px]">{agent.name}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteAgent(agent.id); }}
            className="cursor-pointer rounded p-0.5 opacity-0 transition-all group-hover:opacity-100 hover:bg-muted"
            title="关闭对话"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}

      {/* Create conversation button */}
      {onCreateConversation && (
        <button
          onClick={onCreateConversation}
          className="flex-shrink-0 flex items-center gap-0.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
          title="新建对话"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Task agent tabs — subordinate style, separated */}
      {tasks.length > 0 && (
        <>
          <div className="mx-1 h-4 w-px flex-shrink-0 bg-border" />
          {tasks.map((agent) => (
            <div
              key={agent.id}
              className={`flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer group ${
                activeTab === agent.id
                  ? 'bg-muted text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              onClick={() => onSelectTab(agent.id)}
            >
              <span>{TASK_STATUS_ICON[agent.status] || ''}</span>
              <span className="truncate max-w-[100px]">{agent.name}</span>
              {/* SDK Task 由 SDK 管理生命周期，不允许手动删除 */}
              {!sdkTaskIds?.has(agent.id) && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteAgent(agent.id); }}
                  className="cursor-pointer rounded p-0.5 opacity-0 transition-all group-hover:opacity-100 hover:bg-muted"
                  title="删除 Agent"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
