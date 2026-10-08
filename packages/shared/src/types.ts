import type { z } from 'zod';
import type {
  ApiErrorBodySchema,
  AuditLogSchema,
  ChangeStatusResponseSchema,
  CreateTaskSchema,
  ERROR_CODES,
  TaskSchema,
  UpdateTaskResponseSchema,
  UpdateTaskSchema,
} from './schemas';

export type Task = z.infer<typeof TaskSchema>;
export type AuditLog = z.infer<typeof AuditLogSchema>;
export type AuditAction = AuditLog['action'];
export type CreateTaskInput = z.input<typeof CreateTaskSchema>;
export type CreateTask = z.output<typeof CreateTaskSchema>;
export type UpdateTask = z.output<typeof UpdateTaskSchema>;
export type UpdateTaskInput = z.input<typeof UpdateTaskSchema>;
export type UpdateTaskResponse = z.infer<typeof UpdateTaskResponseSchema>;
export type EditableField = NonNullable<AuditLog['field']>;
export type ChangeStatusResponse = z.infer<typeof ChangeStatusResponseSchema>;
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
export type ErrorCode = (typeof ERROR_CODES)[number];
