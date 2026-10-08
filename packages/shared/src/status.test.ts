import { describe, expect, it } from 'vitest';
import { nextStatus, STATUSES } from './status';

describe('nextStatus', () => {
  it('should walk to_do -> pending -> in_progress -> done', () => {
    expect(nextStatus('to_do')).toBe('pending');
    expect(nextStatus('pending')).toBe('in_progress');
    expect(nextStatus('in_progress')).toBe('done');
  });

  it('should return null for the terminal status', () => {
    expect(nextStatus('done')).toBeNull();
  });

  it('should define exactly four statuses in flow order', () => {
    expect(STATUSES).toEqual(['to_do', 'pending', 'in_progress', 'done']);
  });
});
