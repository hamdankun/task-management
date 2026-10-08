import type { Task } from '@tm/shared';
import { describe, expect, it } from 'vitest';
import { ACTORS, assertActor, assertAssignee } from './actors';
import { buildLog } from './audit-log';
import { AppError, InvalidTransitionError } from './errors';
import { assertTransition } from './transitions';

const task: Task = {
  id: '3f2c8a54-0b1e-4c63-9a52-7d1f0e6b9a10',
  title: 'Prepare Invoice',
  description: null,
  status: 'pending',
  assignee: null,
  createdAt: '2025-01-01T09:00:00.000Z',
  updatedAt: '2025-01-01T09:00:00.000Z',
};
const now = '2025-01-01T10:00:00.000Z';

describe('assertTransition', () => {
  it.each([
    ['to_do', 'pending'],
    ['pending', 'in_progress'],
    ['in_progress', 'done'],
  ] as const)('should allow the next step: %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each([
    ['to_do', 'in_progress'],
    ['to_do', 'done'],
    ['pending', 'done'],
  ] as const)('should reject a skip: %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
  });

  it.each([
    ['pending', 'to_do'],
    ['in_progress', 'pending'],
    ['in_progress', 'to_do'],
    ['done', 'in_progress'],
    ['done', 'pending'],
    ['done', 'to_do'],
  ] as const)('should reject moving backward: %s -> %s', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
  });

  it('should report the only allowed next status in the error details', () => {
    try {
      assertTransition('pending', 'done');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect(e).toMatchObject({
        code: 'INVALID_TRANSITION',
        httpStatus: 422,
        message: 'Cannot move from pending to done',
        details: { from: 'pending', to: 'done', allowed: 'in_progress' },
      });
    }
  });

  it('should report allowed: null from the terminal status', () => {
    expect(() => assertTransition('done', 'to_do')).toThrowError(
      expect.objectContaining({ details: { from: 'done', to: 'to_do', allowed: null } }),
    );
  });

  it('should reject a same-status request (the service treats it as a no-op before this)', () => {
    expect(() => assertTransition('pending', 'pending')).toThrow(InvalidTransitionError);
  });
});

describe('assertActor', () => {
  it.each(ACTORS)('should accept %s', (a) => {
    expect(() => assertActor(a)).not.toThrow();
  });

  it.each(['', 'John.Doe', ' john.doe', 'john.doe ', 'mallory', 'john.doe, jane.smith'])(
    'should reject %j without echoing it',
    (a) => {
      try {
        assertActor(a);
        expect.unreachable();
      } catch (e) {
        expect(e).toMatchObject({ code: 'INVALID_ACTOR', httpStatus: 400 });
        expect((e as Error).message).not.toContain(a || '\u0000');
      }
    },
  );
});

describe('buildLog', () => {
  it('should build a created entry with no from-status', () => {
    expect(
      buildLog({ action: 'created', task: { ...task, status: 'to_do' } }, 'john.doe', now),
    ).toEqual({
      taskId: task.id,
      taskTitle: 'Prepare Invoice',
      action: 'created',
      actor: 'john.doe',
      fromStatus: null,
      toStatus: 'to_do',
      createdAt: now,
      field: null,
      fromValue: null,
      toValue: null,
    });
  });

  it('should build a status_changed entry from the previous status to the target', () => {
    expect(
      buildLog({ action: 'status_changed', task, to: 'in_progress' }, 'jane.smith', now),
    ).toMatchObject({
      action: 'status_changed',
      actor: 'jane.smith',
      fromStatus: 'pending',
      toStatus: 'in_progress',
    });
  });

  it('should build a deleted entry recording the status at deletion', () => {
    expect(buildLog({ action: 'deleted', task }, 'john.doe', now)).toMatchObject({
      action: 'deleted',
      fromStatus: 'pending',
      toStatus: null,
    });
  });
});

describe('buildLog edited', () => {
  const after = { ...task, title: 'Prepare Invoice v2', assignee: 'jane.smith', updatedAt: now };

  it('should record the field with its previous and new value and no status', () => {
    expect(
      buildLog(
        {
          action: 'edited',
          task: after,
          field: 'title',
          from: 'Prepare Invoice',
          to: 'Prepare Invoice v2',
        },
        'john.doe',
        now,
      ),
    ).toEqual({
      taskId: task.id,
      taskTitle: 'Prepare Invoice v2', // snapshot of the title after the edit
      action: 'edited',
      actor: 'john.doe',
      fromStatus: null,
      toStatus: null,
      field: 'title',
      fromValue: 'Prepare Invoice',
      toValue: 'Prepare Invoice v2',
      createdAt: now,
    });
  });

  it('should allow null values for assignee and description', () => {
    expect(
      buildLog(
        { action: 'edited', task: after, field: 'assignee', from: null, to: 'jane.smith' },
        'john.doe',
        now,
      ),
    ).toMatchObject({
      field: 'assignee',
      fromValue: null,
      toValue: 'jane.smith',
    });
  });
});

describe('assertAssignee', () => {
  it.each(ACTORS)('should accept %s', (a) => {
    expect(() => assertAssignee(a)).not.toThrow();
  });

  it.each(['mallory-secret', '', 'John.Doe'])(
    'should reject %j with a field error and without echoing it',
    (a) => {
      try {
        assertAssignee(a);
        expect.unreachable();
      } catch (e) {
        expect(e).toMatchObject({
          code: 'VALIDATION_ERROR',
          details: { fieldErrors: { assignee: ['Choose a listed user'] } },
        });
        expect(JSON.stringify(e)).not.toContain('mallory');
      }
    },
  );
});
