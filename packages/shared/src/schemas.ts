import { z } from 'zod';
import { STATUSES } from './status';

export const StatusSchema = z.enum(STATUSES);

// Control and bidi characters could make an audit line read differently from what happened
// (docs/06 S-07). Title rejects all of them; description keeps \t and \n.
/* eslint-disable no-control-regex -- matching control characters is the point */
const TITLE_FORBIDDEN = /[\u0000-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/u;
const DESCRIPTION_FORBIDDEN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/u;
/* eslint-enable no-control-regex */

const title = z
  .string('Title is required')
  .trim()
  .min(1, 'Title is required')
  .max(120, 'Title must be 120 characters or fewer')
  .refine((v) => !TITLE_FORBIDDEN.test(v), 'Title contains unsupported characters');

const descriptionText = z
  .string()
  .trim()
  .max(1000, 'Description must be 1000 characters or fewer')
  .refine((v) => !DESCRIPTION_FORBIDDEN.test(v), 'Description contains unsupported characters');

const emptyToNull = (v: string | null | undefined) => (v ? v : null);
const description = descriptionText.nullish().transform(emptyToNull);

// Assignee is validated against the server-owned actor list by the service; here only its shape.
const assignee = z
  .string('Choose a user')
  .trim()
  .min(1, 'Choose a user')
  .max(64, 'Choose a user')
  .nullable();

// ---- requests (strict: unknown keys => 400, blocks mass assignment) ----
export const CreateTaskSchema = z.strictObject({ title, description });
export const ChangeStatusSchema = z.strictObject({ status: StatusSchema });

/**
 * Partial update. A key that is absent means "leave unchanged"; `description: ''` or `null`
 * clears it; `assignee: null` unassigns. At least one key is required.
 */
export const UpdateTaskSchema = z
  .strictObject({
    title: title.optional(),
    description: descriptionText.nullable().transform(emptyToNull).optional(),
    assignee: assignee.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to change' });

// ---- entities / responses (lenient on read) ----
const timestamp = z.iso.datetime();

export const TaskSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: StatusSchema,
  assignee: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const AUDIT_ACTIONS = ['created', 'status_changed', 'edited', 'deleted'] as const;
export const EDITABLE_FIELDS = ['title', 'description', 'assignee'] as const;

export const AuditLogSchema = z.object({
  id: z.number().int().positive(),
  taskId: z.uuid(),
  taskTitle: z.string(),
  action: z.enum(AUDIT_ACTIONS),
  actor: z.string(),
  fromStatus: StatusSchema.nullable(),
  toStatus: StatusSchema.nullable(),
  // Only for action 'edited': which field changed and its previous / new value.
  field: z.enum(EDITABLE_FIELDS).nullable(),
  fromValue: z.string().nullable(),
  toValue: z.string().nullable(),
  createdAt: timestamp,
});

export const ActorsResponseSchema = z.object({ actors: z.array(z.string()) });
export const TasksResponseSchema = z.object({ tasks: z.array(TaskSchema) });
export const TaskResponseSchema = z.object({ task: TaskSchema });
export const ChangeStatusResponseSchema = z.object({
  task: TaskSchema,
  changed: z.boolean(),
  auditLog: AuditLogSchema.nullable(),
});
export const UpdateTaskResponseSchema = z.object({
  task: TaskSchema,
  changed: z.boolean(),
  auditLogs: z.array(AuditLogSchema),
});
export const AuditLogsResponseSchema = z.object({ auditLogs: z.array(AuditLogSchema) });

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'INVALID_ACTOR',
  'FORBIDDEN_HOST',
  'TASK_NOT_FOUND',
  'ROUTE_NOT_FOUND',
  'INVALID_TRANSITION',
  'INTERNAL_ERROR',
] as const;

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
