import { useState } from 'react';
import { ChevronDown, ChevronUp, Pause, Play, Trash2 } from 'lucide-react';
import { ScheduledTask } from '../../stores/tasks';
import { TaskDetail } from './TaskDetail';

interface TaskCardProps {
  task: ScheduledTask;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
}

export function TaskCard({ task, onPause, onResume, onDelete }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);

  const formatScheduleValue = () => {
    if (task.schedule_type === 'interval') {
      const ms = Number.parseInt(task.schedule_value, 10);
      if (!Number.isFinite(ms) || ms <= 0) return task.schedule_value;
      const minute = 60 * 1000;
      const hour = 60 * minute;
      const day = 24 * hour;
      if (ms % day === 0) return `每 ${ms / day} 天`;
      if (ms % hour === 0) return `每 ${ms / hour} 小时`;
      if (ms % minute === 0) return `每 ${ms / minute} 分钟`;
      if (ms % 1000 === 0) return `每 ${ms / 1000} 秒`;
      return `每 ${ms}ms`;
    }

    if (task.schedule_type === 'once') {
      const parsed = new Date(task.schedule_value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
      }
    }

    return task.schedule_value;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-600';
      case 'paused':
        return 'bg-amber-100 text-amber-600';
      case 'completed':
        return 'bg-muted text-muted-foreground';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active':
        return '运行中';
      case 'paused':
        return '已暂停';
      case 'completed':
        return '已完成';
      default:
        return status;
    }
  };

  const handleTogglePause = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (task.status === 'active') {
      onPause(task.id);
    } else {
      onResume(task.id);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(task.id);
  };

  return (
    <div className="bg-card rounded-xl border border-border hover:border-brand-300 hover:shadow-[0_10px_22px_rgba(15,23,42,0.09)] transition-all duration-200">
      {/* Card Header - Clickable */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 text-left cursor-pointer"
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0 mr-4">
            {/* Prompt (truncated 2 lines) */}
            <p className="text-foreground font-medium line-clamp-2 mb-2">
              {task.prompt}
            </p>

            {/* Schedule Info */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm mb-2">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">调度:</span>
                <span className="text-foreground font-medium">
                  {task.schedule_type === 'cron' && 'Cron'}
                  {task.schedule_type === 'interval' && '间隔'}
                  {task.schedule_type === 'once' && '单次'}
                </span>
                <code className="text-xs bg-muted px-2 py-0.5 rounded">
                  {formatScheduleValue()}
                </code>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">群组:</span>
                <span className="text-foreground font-medium">
                  {task.group_folder}
                </span>
              </div>
            </div>

            {/* Status Badge */}
            <div>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(
                  task.status
                )}`}
              >
                {getStatusLabel(task.status)}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Pause/Resume */}
            {(task.status === 'active' || task.status === 'paused') && (
              <button
                onClick={handleTogglePause}
                className="p-2 text-muted-foreground hover:text-primary hover:bg-brand-50 rounded-lg transition-colors cursor-pointer"
                title={task.status === 'active' ? '暂停' : '恢复'}
                aria-label={task.status === 'active' ? '暂停任务' : '恢复任务'}
              >
                {task.status === 'active' ? (
                  <Pause className="w-5 h-5" />
                ) : (
                  <Play className="w-5 h-5" />
                )}
              </button>
            )}

            {/* Delete */}
            <button
              onClick={handleDelete}
              className="p-2 text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
              title="删除"
              aria-label="删除任务"
            >
              <Trash2 className="w-5 h-5" />
            </button>

            {/* Expand Icon */}
            <div className="ml-2">
              {expanded ? (
                <ChevronUp className="w-5 h-5 text-muted-foreground/80" />
              ) : (
                <ChevronDown className="w-5 h-5 text-muted-foreground/80" />
              )}
            </div>
          </div>
        </div>
      </button>

      {/* Expanded Detail */}
      {expanded && (
        <div className="border-t border-border">
          <TaskDetail task={task} />
        </div>
      )}
    </div>
  );
}
