import type { AuditLog } from '@tm/shared';
import { ArrowRight, ArrowRightLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';
import { formatAuditLog, formatTime } from '@/lib/formatAuditLog';

const ICON = {
  created: Plus,
  status_changed: ArrowRightLeft,
  edited: Pencil,
  deleted: Trash2,
} as const;

const Quote = ({ value }: { value: string | null }) =>
  value === null ? (
    <em className="text-muted-foreground">nothing</em>
  ) : (
    <q className="break-words">{value}</q>
  );

/** What changed, shown beside the actor (the sentence itself is the accessible text). */
function EditSummary({ log }: { log: AuditLog }) {
  const { field, fromValue: from, toValue: to } = log;
  if (field === 'title') {
    return (
      <>
        <span>renamed the task</span>
        <span className="basis-full text-muted-foreground">
          <Quote value={from} /> <ArrowRight className="inline size-3.5" /> <Quote value={to} />
        </span>
      </>
    );
  }
  if (field === 'description') {
    const verb =
      from === null
        ? 'added a description'
        : to === null
          ? 'removed the description'
          : 'changed the description';
    return (
      <>
        <span>{verb}</span>
        <span className="basis-full space-y-0.5 text-sm text-muted-foreground">
          {from !== null && (
            <span className="line-clamp-2 block break-words whitespace-pre-line">
              Before: {from}
            </span>
          )}
          {to !== null && (
            <span className="line-clamp-2 block break-words whitespace-pre-line">After: {to}</span>
          )}
        </span>
      </>
    );
  }
  if (from === null)
    return (
      <span>
        assigned this to <strong className="font-semibold">{to}</strong>
      </span>
    );
  if (to === null)
    return (
      <span>
        unassigned <strong className="font-semibold">{from}</strong>
      </span>
    );
  return (
    <span>
      reassigned this from <strong className="font-semibold">{from}</strong> to{' '}
      <strong className="font-semibold">{to}</strong>
    </span>
  );
}

/**
 * Visually: actor, what happened, time. The full sentence (docs/04 §7) is the accessible text; the
 * structured layout is hidden from assistive tech to avoid reading it twice.
 */
export function AuditLogEntry({ log }: { log: AuditLog }) {
  const Icon = ICON[log.action];
  return (
    <li className="relative pb-5 pl-9 last:pb-0 before:absolute before:top-6 before:bottom-0 before:left-[11px] before:w-px before:bg-border last:before:hidden">
      <span className="sr-only">{formatAuditLog(log)}</span>
      <span
        aria-hidden="true"
        className="absolute top-0 left-0 flex size-6 items-center justify-center rounded-full border bg-card text-muted-foreground"
      >
        <Icon className="size-3" />
      </span>
      <div
        aria-hidden="true"
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
      >
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-serif text-[15px] leading-6">
          <strong className="font-semibold">{log.actor}</strong>
          {log.action === 'created' && <span>created the task</span>}
          {log.action === 'status_changed' && log.fromStatus && log.toStatus && (
            <>
              <span>moved it</span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <StatusBadge status={log.fromStatus} />
                <ArrowRight className="size-3.5 text-muted-foreground" />
                <StatusBadge status={log.toStatus} />
              </span>
            </>
          )}
          {log.action === 'edited' && <EditSummary log={log} />}
          {log.action === 'deleted' && (
            <>
              <span>deleted the task while</span>
              {log.fromStatus && <StatusBadge status={log.fromStatus} />}
            </>
          )}
        </p>
        <time
          dateTime={log.createdAt}
          title={log.createdAt}
          className="text-[13px] font-medium text-muted-foreground tabular-nums"
        >
          {formatTime(log.createdAt)}
        </time>
      </div>
    </li>
  );
}
