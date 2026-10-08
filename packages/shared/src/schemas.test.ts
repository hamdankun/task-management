import { describe, expect, it } from 'vitest';
import {
  ApiErrorBodySchema,
  ChangeStatusResponseSchema,
  ChangeStatusSchema,
  CreateTaskSchema,
  TaskSchema,
  UpdateTaskSchema,
} from './schemas';

describe('CreateTaskSchema', () => {
  it('should trim the title and default description to null', () => {
    expect(CreateTaskSchema.parse({ title: '  Prepare Invoice ' })).toEqual({
      title: 'Prepare Invoice',
      description: null,
    });
  });

  it('should store an empty or whitespace description as null', () => {
    expect(CreateTaskSchema.parse({ title: 'T', description: '   ' }).description).toBeNull();
    expect(CreateTaskSchema.parse({ title: 'T', description: null }).description).toBeNull();
  });

  it('should keep newlines and tabs inside a description', () => {
    expect(CreateTaskSchema.parse({ title: 'T', description: 'a\n\tb' }).description).toBe(
      'a\n\tb',
    );
  });

  it('should accept boundary lengths', () => {
    expect(CreateTaskSchema.safeParse({ title: 'x'.repeat(120) }).success).toBe(true);
    expect(CreateTaskSchema.safeParse({ title: 'T', description: 'x'.repeat(1000) }).success).toBe(
      true,
    );
  });

  it.each([
    ['missing title', {}],
    ['blank title', { title: '   ' }],
    ['non-string title', { title: 5 }],
    ['title over 120', { title: 'x'.repeat(121) }],
    ['description over 1000', { title: 'T', description: 'x'.repeat(1001) }],
    ['newline in title', { title: 'a\nb' }],
    ['tab in title', { title: 'a\tb' }],
    ['NUL in title', { title: 'a\u0000b' }],
    ['bidi override in title', { title: 'a‮b' }],
    ['bidi isolate in title', { title: 'a⁧b' }],
    ['LRM mark in title', { title: 'a‎b' }],
    ['carriage return in description', { title: 'T', description: 'a\rb' }],
    ['bidi override in description', { title: 'T', description: 'a‮b' }],
    ['unknown key', { title: 'T', status: 'done' }],
    ['id supplied by client', { title: 'T', id: 'x' }],
  ])('should reject %s', (_name, body) => {
    expect(CreateTaskSchema.safeParse(body).success).toBe(false);
  });

  it('should reject a __proto__ key from JSON', () => {
    const body = JSON.parse('{"title":"T","__proto__":{"admin":true}}');
    expect(CreateTaskSchema.safeParse(body).success).toBe(false);
  });

  it('should allow emoji sequences and accented text in a title', () => {
    expect(CreateTaskSchema.safeParse({ title: 'Café 👨‍👩‍👧 – Q1' }).success).toBe(true);
  });
});

describe('ChangeStatusSchema', () => {
  it('should accept a known status', () => {
    expect(ChangeStatusSchema.parse({ status: 'pending' })).toEqual({ status: 'pending' });
  });

  it.each([{ status: 'blocked' }, {}, { status: 'done', extra: 1 }])('should reject %j', (body) => {
    expect(ChangeStatusSchema.safeParse(body).success).toBe(false);
  });
});

describe('response schemas', () => {
  const task = {
    id: '3f2c8a54-0b1e-4c63-9a52-7d1f0e6b9a10',
    title: 'T',
    description: null,
    status: 'to_do',
    assignee: null,
    createdAt: '2025-01-01T09:00:00.000Z',
    updatedAt: '2025-01-01T09:00:00.000Z',
  };

  it('should parse a task and a no-op status change result', () => {
    expect(TaskSchema.safeParse(task).success).toBe(true);
    expect(
      ChangeStatusResponseSchema.safeParse({ task, changed: false, auditLog: null }).success,
    ).toBe(true);
  });

  it('should reject a task with a malformed timestamp', () => {
    expect(TaskSchema.safeParse({ ...task, createdAt: 'yesterday' }).success).toBe(false);
  });

  it('should parse an error body and reject unknown codes', () => {
    expect(
      ApiErrorBodySchema.safeParse({ error: { code: 'TASK_NOT_FOUND', message: 'x' } }).success,
    ).toBe(true);
    expect(ApiErrorBodySchema.safeParse({ error: { code: 'NOPE', message: 'x' } }).success).toBe(
      false,
    );
  });
});

describe('UpdateTaskSchema', () => {
  it('should accept any single field and leave the others absent', () => {
    expect(UpdateTaskSchema.parse({ title: '  New  ' })).toEqual({ title: 'New' });
    expect(UpdateTaskSchema.parse({ assignee: 'john.doe' })).toEqual({ assignee: 'john.doe' });
    expect(UpdateTaskSchema.parse({ description: ' text ' })).toEqual({ description: 'text' });
  });

  it('should treat an empty or null description as "clear" and null assignee as "unassign"', () => {
    expect(UpdateTaskSchema.parse({ description: '   ' })).toEqual({ description: null });
    expect(UpdateTaskSchema.parse({ description: null })).toEqual({ description: null });
    expect(UpdateTaskSchema.parse({ assignee: null })).toEqual({ assignee: null });
  });

  it('should not turn an omitted description into a clear', () => {
    expect('description' in UpdateTaskSchema.parse({ title: 'T' })).toBe(false);
  });

  it('should accept several fields at once', () => {
    expect(UpdateTaskSchema.parse({ title: 'T', description: 'D', assignee: null })).toEqual({
      title: 'T',
      description: 'D',
      assignee: null,
    });
  });

  it.each([
    ['empty object', {}],
    ['blank title', { title: '   ' }],
    ['title over 120', { title: 'x'.repeat(121) }],
    ['newline in title', { title: 'a\nb' }],
    ['bidi in title', { title: 'a‮b' }],
    ['description over 1000', { description: 'x'.repeat(1001) }],
    ['bidi in description', { description: 'a‮b' }],
    ['blank assignee', { assignee: '   ' }],
    ['over-long assignee', { assignee: 'x'.repeat(65) }],
    ['non-string assignee', { assignee: 7 }],
    ['status smuggled in', { title: 'T', status: 'done' }],
    ['id smuggled in', { title: 'T', id: 'x' }],
  ])('should reject %s', (_n, body) => {
    expect(UpdateTaskSchema.safeParse(body).success).toBe(false);
  });

  it('should reject a __proto__ key from JSON', () => {
    expect(
      UpdateTaskSchema.safeParse(JSON.parse('{"title":"T","__proto__":{"x":1}}')).success,
    ).toBe(false);
  });
});
