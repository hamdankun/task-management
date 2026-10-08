import { ChevronDown, UserRound } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { UserAvatar } from '@/components/UserAvatar';

/** Single assignee chosen from the predefined users (native select: accessible and easy to test). */
export function AssigneeField({
  value,
  actors,
  disabled,
  onChange,
}: {
  value: string | null;
  actors: string[];
  disabled: boolean;
  onChange: (assignee: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="assignee" className="text-sm text-muted-foreground">
        Assignee
      </Label>
      <div className="flex items-center gap-3">
        {value ? (
          <UserAvatar username={value} className="size-8 text-xs" />
        ) : (
          <span
            aria-hidden="true"
            className="inline-flex size-8 items-center justify-center rounded-full border border-dashed text-muted-foreground"
          >
            <UserRound className="size-4" />
          </span>
        )}
        <div className="relative">
          <select
            id="assignee"
            value={value ?? ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value || null)}
            className="h-9 w-52 cursor-pointer appearance-none rounded-md border border-input bg-card pr-9 pl-3 text-sm font-medium enabled:hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">Unassigned</option>
            {actors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
        </div>
      </div>
    </div>
  );
}
