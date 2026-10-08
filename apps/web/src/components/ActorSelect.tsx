import { ChevronDown, UserRound } from 'lucide-react';

// Native <select>: the most accessible control for a short list, and trivial to test.
// `appearance-none` + our own icons replace the browser's default arrow so it matches the design.
export function ActorSelect({
  actors,
  value,
  onChange,
}: {
  actors: string[];
  value: string | null;
  onChange: (actor: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1 sm:items-end">
      <div className="flex items-center gap-2.5">
        <label htmlFor="actor" className="text-sm font-medium text-chrome-muted">
          Acting as
        </label>
        <div className="relative">
          <UserRound
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-chrome-foreground"
          />
          <select
            id="actor"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
            aria-describedby="actor-help"
            className="h-9 w-48 cursor-pointer appearance-none rounded-md border border-chrome-border bg-chrome-control pr-9 pl-9 text-sm font-semibold text-chrome-foreground transition-colors hover:bg-chrome-control-hover sm:w-52"
          >
            <option value="" className="bg-card text-foreground">
              Choose who you are
            </option>
            {actors.map((a) => (
              <option key={a} value={a} className="bg-card text-foreground">
                {a}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-chrome-foreground"
          />
        </div>
      </div>
      <p id="actor-help" className="text-xs text-chrome-muted sm:text-right">
        Not authenticated. This name is recorded in the history.
      </p>
    </div>
  );
}
