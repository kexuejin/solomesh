import { Hono } from 'hono';

import type { Variables } from '../web-context.js';
import { authMiddleware } from '../middleware/auth.js';
import { TodoIngestSchema, TodoQuerySchema } from '../schemas.js';
import {
  getTodoById,
  listTodoSourceEvents,
  listTodos,
} from '../db.js';
import { ingestTodo } from '../todo-core.js';
import type { AuthUser } from '../types.js';

const todosRoutes = new Hono<{ Variables: Variables }>();

todosRoutes.post('/ingest', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = TodoIngestSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const authUser = c.get('user') as AuthUser;
  const result = ingestTodo(validation.data, authUser.id);
  return c.json(result);
});

todosRoutes.post('/', authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const authUser = c.get('user') as AuthUser;

  const payload = {
    ...body,
    source_type: body.source_type ?? 'manual',
    source_id: body.source_id ?? `user:${authUser.id}`,
    trigger_mode: body.trigger_mode ?? 'manual',
  };

  const validation = TodoIngestSchema.safeParse(payload);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const result = ingestTodo(validation.data, authUser.id);
  return c.json(result);
});

todosRoutes.get('/', authMiddleware, (c) => {
  const validation = TodoQuerySchema.safeParse(c.req.query());
  if (!validation.success) {
    return c.json(
      { error: 'Invalid query', details: validation.error.format() },
      400,
    );
  }

  const todos = listTodos(validation.data);
  const last = todos[todos.length - 1];
  return c.json({
    todos,
    nextCursor: last ? `${last.last_seen_at}|${last.id}` : null,
  });
});

todosRoutes.get('/:id/events', authMiddleware, (c) => {
  const todoId = c.req.param('id');
  const todo = getTodoById(todoId);
  if (!todo) return c.json({ error: 'Todo not found' }, 404);

  const events = listTodoSourceEvents(todoId);
  return c.json({ events });
});

export default todosRoutes;
