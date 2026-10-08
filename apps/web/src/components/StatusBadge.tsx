import type { Status } from '@tm/shared';
import { Badge } from '@/components/ui/badge';
import { STATUS_LABEL } from '@/lib/status';
import { cn } from '@/lib/utils';

// Full class strings so Tailwind can see them; colours come from the tokens in index.css.
export const TONE: Record<Status, string> = {
  to_do: 'bg-status-todo-bg text-status-todo-fg',
  pending: 'bg-status-pending-bg text-status-pending-fg',
  in_progress: 'bg-status-progress-bg text-status-progress-fg',
  done: 'bg-status-done-bg text-status-done-fg',
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <Badge
      data-status={status}
      variant="secondary"
      className={cn(
        'rounded-full border-transparent px-2.5 py-0.5 text-xs font-semibold',
        TONE[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}
