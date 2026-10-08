import type { AuditLog } from '@tm/shared';
import { STATUS_LABEL } from './status';

const pad = (n: number) => String(n).padStart(2, '0');

/** Viewer-local `YYYY-MM-DD HH:mm`. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The middle of an edit sentence, e.g. `renamed "A" to "B"` (also used by the sentence tests). */
function describeEdit(log: AuditLog): string {
  const { field, fromValue: from, toValue: to, taskTitle } = log;
  if (field === 'title') return `renamed "${from ?? ''}" to "${to ?? ''}"`;
  if (field === 'description') {
    if (from === null) return `added a description to "${taskTitle}"`;
    if (to === null) return `removed the description from "${taskTitle}"`;
    return `changed the description of "${taskTitle}"`;
  }
  if (from === null) return `assigned "${taskTitle}" to ${to ?? ''}`;
  if (to === null) return `unassigned ${from} from "${taskTitle}"`;
  return `reassigned "${taskTitle}" from ${from} to ${to}`;
}

/** The full sentence for one entry (docs/04 §7): accessible name and the text tests assert on. */
export function formatAuditLog(log: AuditLog): string {
  const when = formatTime(log.createdAt);
  switch (log.action) {
    case 'created':
      return `${log.actor} created "${log.taskTitle}" at ${when}`;
    case 'deleted':
      return `${log.actor} deleted "${log.taskTitle}" at ${when}`;
    case 'edited':
      return `${log.actor} ${describeEdit(log)} at ${when}`;
    case 'status_changed': {
      const from = log.fromStatus ? STATUS_LABEL[log.fromStatus] : '';
      const to = log.toStatus ? STATUS_LABEL[log.toStatus] : '';
      return `${log.actor} changed "${log.taskTitle}" from "${from}" to "${to}" at ${when}`;
    }
  }
}
