import { useEffect, useState } from 'react';
import { useTasksStore } from '../stores/tasks';
import { useChatStore } from '../stores/chat';
import { TaskCard } from '../components/tasks/TaskCard';
import { CreateTaskForm } from '../components/tasks/CreateTaskForm';
import { Plus, RefreshCw, Clock, X } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { SkeletonCardList } from '@/components/common/Skeletons';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';

export function TasksPage() {
  const { tasks, loading, error, loadTasks, createTask, updateTaskStatus, deleteTask } = useTasksStore();
  const { groups, loadGroups } = useChatStore();
  const [showCreateForm, setShowCreateForm] = useState(false);

  useEffect(() => {
    loadTasks();
    loadGroups();
  }, [loadTasks, loadGroups]);

  const handleCreateTask = async (data: {
    groupFolder: string;
    chatJid: string;
    prompt: string;
    scheduleType: 'cron' | 'interval' | 'once';
    scheduleValue: string;
    contextMode: 'group' | 'isolated';
  }) => {
    await createTask(
      data.groupFolder,
      data.chatJid,
      data.prompt,
      data.scheduleType,
      data.scheduleValue,
      data.contextMode
    );
    setShowCreateForm(false);
  };

  const handlePause = async (id: string) => {
    if (confirm('确定要暂停此任务吗？')) {
      await updateTaskStatus(id, 'paused');
    }
  };

  const handleResume = async (id: string) => {
    if (confirm('确定要恢复此任务吗？')) {
      await updateTaskStatus(id, 'active');
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('确定要删除此任务吗？此操作不可撤销。')) {
      await deleteTask(id);
    }
  };

  const groupsList = Object.entries(groups).map(([jid, group]) => ({
    jid,
    name: group.name,
    folder: group.folder,
  }));

  const activeTasks = tasks.filter((t) => t.status === 'active');
  const pausedTasks = tasks.filter((t) => t.status === 'paused');
  const otherTasks = tasks.filter((t) => t.status !== 'active' && t.status !== 'paused');

  return (
    <div className="min-h-full app-canvas p-4 lg:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="rounded-xl border border-border/80 bg-card px-5 py-4">
          <PageHeader
            title="定时任务管理"
            subtitle={`共 ${tasks.length} 个任务 · ${activeTasks.length} 运行中 · ${pausedTasks.length} 已暂停`}
            className="mb-4"
            actions={
              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <Button variant="outline" onClick={loadTasks} disabled={loading}>
                  <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                  刷新
                </Button>
                <Button onClick={() => setShowCreateForm(true)}>
                  <Plus size={18} />
                  创建任务
                </Button>
              </div>
            }
          />
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">总任务</div>
              <div className="text-base font-semibold text-foreground">{tasks.length}</div>
            </div>
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2">
              <div className="text-[11px] text-green-700">运行中</div>
              <div className="text-base font-semibold text-green-700">{activeTasks.length}</div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <div className="text-[11px] text-amber-700">已暂停</div>
              <div className="text-base font-semibold text-amber-700">{pausedTasks.length}</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">其他状态</div>
              <div className="text-base font-semibold text-foreground">{otherTasks.length}</div>
            </div>
          </div>
        </div>

        {error && (
          <div className="surface-card-soft flex items-center justify-between rounded-xl border border-red-200 bg-red-50/85 p-3">
            <span className="text-sm text-red-700">{error}</span>
            <button
              onClick={() => useTasksStore.setState({ error: null })}
              className="p-1 text-red-400 hover:text-red-600 rounded transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {loading && tasks.length === 0 ? (
          <SkeletonCardList count={4} />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="还没有创建任何定时任务"
            action={
              <Button onClick={() => setShowCreateForm(true)}>
                <Plus size={18} />
                创建第一个任务
              </Button>
            }
          />
        ) : (
          <div className="space-y-6">
            {activeTasks.length > 0 && (
              <section className="space-y-3">
                <h2 className="px-1 text-sm font-semibold text-foreground/85">运行中</h2>
                <div className="space-y-3">
                  {activeTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onPause={handlePause}
                      onResume={handleResume}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </section>
            )}

            {pausedTasks.length > 0 && (
              <section className="space-y-3">
                <h2 className="px-1 text-sm font-semibold text-foreground/85">已暂停</h2>
                <div className="space-y-3">
                  {pausedTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onPause={handlePause}
                      onResume={handleResume}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </section>
            )}

            {otherTasks.length > 0 && (
              <section className="space-y-3">
                <h2 className="px-1 text-sm font-semibold text-foreground/85">其他</h2>
                <div className="space-y-3">
                  {otherTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onPause={handlePause}
                      onResume={handleResume}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {showCreateForm && (
        <CreateTaskForm
          groups={groupsList}
          onSubmit={handleCreateTask}
          onClose={() => setShowCreateForm(false)}
        />
      )}
    </div>
  );
}
