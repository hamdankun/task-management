import type { AuditLog } from '@tm/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/client';
import { errorMessage, fieldErrorsOf, toApiError } from './errorCopy';
import { formatAuditLog, formatTime } from './formatAuditLog';
import { STATUS_LABEL } from './status';

const base: AuditLog = {
  id: 1,
  taskId: '3f2c8a54-0b1e-4c63-9a52-7d1f0e6b9a10',
  taskTitle: 'Prepare Invoice',
  action: 'status_changed',
  actor: 'john.doe',
  fromStatus: 'pending',
  toStatus: 'in_progress',
  field: null,
  fromValue: null,
  toValue: null,
  createdAt: '2025-01-01T10:00:00.000Z',
};

describe('formatAuditLog', () => {
  it('should format a status change with display labels and local time', () => {
    expect(formatAuditLog(base)).toBe(
      'john.doe changed "Prepare Invoice" from "Pending" to "In progress" at 2025-01-01 10:00',
    );
  });
  it('should format created and deleted entries', () => {
    expect(
      formatAuditLog({ ...base, action: 'created', fromStatus: null, toStatus: 'to_do' }),
    ).toBe('john.doe created "Prepare Invoice" at 2025-01-01 10:00');
    expect(
      formatAuditLog({ ...base, action: 'deleted', actor: 'jane.smith', toStatus: null }),
    ).toBe('jane.smith deleted "Prepare Invoice" at 2025-01-01 10:00');
  });
  describe('edited entries', () => {
    const edit = (
      field: 'title' | 'description' | 'assignee',
      from: string | null,
      to: string | null,
    ): AuditLog => ({
      ...base,
      action: 'edited',
      fromStatus: null,
      toStatus: null,
      field,
      fromValue: from,
      toValue: to,
    });
    it.each([
      [edit('title', 'Old', 'New'), 'john.doe renamed "Old" to "New" at 2025-01-01 10:00'],
      [
        edit('description', null, 'Text'),
        'john.doe added a description to "Prepare Invoice" at 2025-01-01 10:00',
      ],
      [
        edit('description', 'Text', null),
        'john.doe removed the description from "Prepare Invoice" at 2025-01-01 10:00',
      ],
      [
        edit('description', 'A', 'B'),
        'john.doe changed the description of "Prepare Invoice" at 2025-01-01 10:00',
      ],
      [
        edit('assignee', null, 'jane.smith'),
        'john.doe assigned "Prepare Invoice" to jane.smith at 2025-01-01 10:00',
      ],
      [
        edit('assignee', 'jane.smith', null),
        'john.doe unassigned jane.smith from "Prepare Invoice" at 2025-01-01 10:00',
      ],
      [
        edit('assignee', 'jane.smith', 'budi.santoso'),
        'john.doe reassigned "Prepare Invoice" from jane.smith to budi.santoso at 2025-01-01 10:00',
      ],
    ])('should describe %#', (log, sentence) => {
      expect(formatAuditLog(log)).toBe(sentence);
    });
  });

  it('should zero-pad the time', () => {
    expect(formatTime('2025-03-04T05:06:00.000Z')).toBe('2025-03-04 05:06');
  });
});

describe('STATUS_LABEL', () => {
  it('should label every status in plain language', () => {
    expect(STATUS_LABEL).toEqual({
      to_do: 'To do',
      pending: 'Pending',
      in_progress: 'In progress',
      done: 'Done',
    });
  });
});

describe('errorMessage', () => {
  it.each([
    ['INVALID_ACTOR', 'Choose who you are, then try again.'],
    ['TASK_NOT_FOUND', 'That task no longer exists. The list was refreshed.'],
    ['INVALID_TRANSITION', 'This task was changed in another tab. The list was refreshed.'],
    ['NETWORK_ERROR', "Can't reach the task service. Check your connection and try again."],
    ['FORBIDDEN_HOST', "Can't reach the task service. Check the address and try again."],
    ['UNEXPECTED_RESPONSE', 'The task service sent an unexpected response. Try again.'],
  ] as const)('should explain %s', (code, text) => {
    expect(errorMessage(new ApiError(code, 'server text must not leak'))).toBe(text);
  });

  it('should never show raw server text and should include the reference for 500s', () => {
    const msg = errorMessage(
      new ApiError('INTERNAL_ERROR', 'SELECT * FROM secret', 500, { requestId: 'abc' }),
    );
    expect(msg).toBe('Something went wrong on our side. Try again. (Ref: abc)');
    expect(errorMessage(new ApiError('INTERNAL_ERROR', 'x', 500))).toBe(
      'Something went wrong on our side. Try again.',
    );
  });
});

describe('fieldErrorsOf / toApiError', () => {
  it('should read field errors from validation details', () => {
    const e = new ApiError('VALIDATION_ERROR', 'x', 400, {
      formErrors: [],
      fieldErrors: { title: ['Title is required'] },
    });
    expect(fieldErrorsOf(e)).toEqual({ title: ['Title is required'] });
  });
  it('should ignore malformed details', () => {
    expect(fieldErrorsOf(new ApiError('VALIDATION_ERROR', 'x', 400, 'nope'))).toEqual({});
    expect(
      fieldErrorsOf(
        new ApiError('VALIDATION_ERROR', 'x', 400, { fieldErrors: { title: 'str', ok: ['a'] } }),
      ),
    ).toEqual({ ok: ['a'] });
  });
  it('should wrap unknown thrown values', () => {
    expect(toApiError(new Error('x'))).toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
    const e = new ApiError('NETWORK_ERROR', 'x');
    expect(toApiError(e)).toBe(e);
  });
});
