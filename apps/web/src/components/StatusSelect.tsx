import { nextStatus, STATUSES, type Status } from '@tm/shared';
import { ChevronDown } from 'lucide-react';
import { TONE } from '@/components/StatusBadge';
import { Label } from '@/components/ui/label';
import { STATUS_LABEL } from '@/lib/status';
import { cn } from '@/lib/utils';

/**
 * The task's status as a dropdown (Trello's list chip). All four statuses are listed so the whole
 * flow is visible, but only the NEXT one can be chosen (the brief: status follows the order); the
 * others are disabled because the server refuses skips and moving back. Once a task is done there
 * is nothing to choose, so the control is disabled. Native <select>: accessible, easy to test.
 */
export function StatusSelect({
  value,
  disabled,
  onChange,
}: {
  value: Status;
  disabled: boolean;
  onChange: (status: Status) => void;
}) {
  const next = nextStatus(value);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="status" className="text-sm text-muted-foreground">
        Status
      </Label>
      <div className="relative w-fit">
        <select
          id="status"
          data-status={value}
          value={value}
          disabled={disabled || next === null}
          title={next === null ? 'Done is the last status' : undefined}
          onChange={(e) => onChange(e.target.value as Status)}
          className={cn(
            'h-9 cursor-pointer appearance-none rounded-full border border-transparent pr-9 pl-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60',
            TONE[value],
          )}
        >
          {STATUSES.map((s) => (
            <option
              key={s}
              value={s}
              disabled={s !== value && s !== next}
              className="bg-card text-foreground"
            >
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
        />
      </div>
    </div>
  );
}
