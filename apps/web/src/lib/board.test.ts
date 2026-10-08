import type { Task } from '@tm/shared';
import { describe, expect, it } from 'vitest';
import { dropDecision } from './board';

const task = (status: Task['status']): Task => ({
  id: '3f2c8a54-0b1e-4c63-9a52-7d1f0e6b9a10',
  title: 'T',
  description: null,
  status,
  assignee: null,
  createdAt: '2025-01-01T09:00:00.000Z',
  updatedAt: '2025-01-01T09:00:00.000Z',
});

describe('dropDecision', () => {
  it.each([
    ['to_do', 'pending'],
    ['pending', 'in_progress'],
    ['in_progress', 'done'],
  ] as const)('should move to the next status: %s -> %s', (from, to) => {
    expect(dropDecision(task(from), to)).toEqual({ kind: 'move' });
  });

  it.each(['to_do', 'pending', 'in_progress', 'done'] as const)(
    'should do nothing when dropped back on %s',
    (s) => {
      expect(dropDecision(task(s), s)).toEqual({ kind: 'stay' });
    },
  );

  it('should refuse a skip and name the only column it can go to', () => {
    expect(dropDecision(task('to_do'), 'done')).toEqual({
      kind: 'rejected',
      message: 'Tasks move one step at a time. This one can go to Pending.',
    });
  });

  it.each([
    ['pending', 'to_do'],
    ['in_progress', 'pending'],
    ['in_progress', 'to_do'],
  ] as const)('should refuse going back: %s -> %s', (from, to) => {
    expect(dropDecision(task(from), to)).toMatchObject({ kind: 'rejected' });
  });

  it('should explain that done tasks cannot move', () => {
    expect(dropDecision(task('done'), 'in_progress')).toEqual({
      kind: 'rejected',
      message: "Done tasks can't move.",
    });
  });
});
