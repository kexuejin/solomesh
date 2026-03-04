import type { DecisionItem } from '../stores/decision-items';
import type { TodoItem } from '../stores/todos';

export type WorkbenchDecisionLane = 'triage' | 'tracking';
export type WorkbenchTodoLane = 'queued' | 'inProgress' | 'done';

export interface WorkbenchColumns {
  triage: DecisionItem[];
  tracking: DecisionItem[];
  queued: TodoItem[];
  inProgress: TodoItem[];
  done: TodoItem[];
}

function toTime(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value);
  const ts = parsed.getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function compareDecisionItemByRecent(a: DecisionItem, b: DecisionItem): number {
  return toTime(b.created_at) - toTime(a.created_at);
}

function compareTodoByRecent(a: TodoItem, b: TodoItem): number {
  return toTime(b.last_seen_at) - toTime(a.last_seen_at);
}

export function getDecisionLane(item: DecisionItem): WorkbenchDecisionLane | null {
  if (item.status !== 'pending') return null;
  if (item.source_type === 'automation' || item.source_type === 'workflow' || item.source_type === 'plugin') {
    return 'tracking';
  }
  return 'triage';
}

export function getTodoLane(item: TodoItem): WorkbenchTodoLane | null {
  if (item.status === 'open') return 'queued';
  if (item.status === 'in_progress') return 'inProgress';
  if (item.status === 'done') return 'done';
  return null;
}

export function buildWorkbenchColumns(
  decisionItems: DecisionItem[],
  todos: TodoItem[],
): WorkbenchColumns {
  const triage: DecisionItem[] = [];
  const tracking: DecisionItem[] = [];
  const queued: TodoItem[] = [];
  const inProgress: TodoItem[] = [];
  const done: TodoItem[] = [];

  for (const item of decisionItems) {
    const lane = getDecisionLane(item);
    if (lane === 'triage') triage.push(item);
    if (lane === 'tracking') tracking.push(item);
  }

  for (const todo of todos) {
    const lane = getTodoLane(todo);
    if (lane === 'queued') queued.push(todo);
    if (lane === 'inProgress') inProgress.push(todo);
    if (lane === 'done') done.push(todo);
  }

  triage.sort(compareDecisionItemByRecent);
  tracking.sort(compareDecisionItemByRecent);
  queued.sort(compareTodoByRecent);
  inProgress.sort(compareTodoByRecent);
  done.sort(compareTodoByRecent);

  return {
    triage,
    tracking,
    queued,
    inProgress,
    done,
  };
}
