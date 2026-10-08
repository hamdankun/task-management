import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import type { Result } from '@/hooks/useTaskBoard';
import { fieldErrorsOf } from '@/lib/errorCopy';

/**
 * Click the title to edit it in place. Enter or leaving the field saves, Escape cancels
 * (Trello behaviour). The `data-editing` marker stops Escape from also closing the dialog.
 */
export function InlineTitle({
  value,
  disabled,
  saving,
  onSave,
}: {
  value: string;
  disabled: boolean;
  saving: boolean;
  onSave: (title: string) => Promise<Result<unknown>>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const settled = useRef(false); // Enter/Escape already handled; the blur that follows must not save again

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  function start() {
    setDraft(value);
    setError(undefined);
    settled.current = false;
    setEditing(true);
  }

  async function commit() {
    if (settled.current || saving) return;
    settled.current = true;
    if (draft.trim() === value) return setEditing(false);
    const result = await onSave(draft);
    if (result.ok) setEditing(false);
    else {
      settled.current = false;
      setError(fieldErrorsOf(result.error).title?.[0] ?? 'Could not save the title. Try again.');
    }
  }

  if (!editing) {
    return (
      <h2 className="min-w-0">
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          aria-label={`Edit title: ${value}`}
          className="-mx-2 w-[calc(100%+1rem)] rounded-md px-2 py-1 text-left font-serif text-2xl leading-8 font-semibold break-words enabled:cursor-text enabled:hover:bg-accent"
        >
          {value}
        </button>
      </h2>
    );
  }

  return (
    <div data-editing className="flex flex-col gap-1">
      <Input
        ref={input}
        aria-label="Title"
        value={draft}
        readOnly={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            settled.current = true;
            setEditing(false);
          }
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'title-edit-error' : undefined}
        className="h-auto border-input bg-card py-1.5 font-serif text-2xl leading-8 font-semibold md:text-2xl"
      />
      {error && (
        <p id="title-edit-error" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
