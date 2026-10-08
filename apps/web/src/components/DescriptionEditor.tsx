import { AlignLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Result } from '@/hooks/useTaskBoard';
import { fieldErrorsOf } from '@/lib/errorCopy';

/** Description with an explicit Save / Discard changes, like the Trello card (docs/07 §14). */
export function DescriptionEditor({
  value,
  disabled,
  saving,
  onSave,
}: {
  value: string | null;
  disabled: boolean;
  saving: boolean;
  onSave: (description: string) => Promise<Result<unknown>>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [error, setError] = useState<string | undefined>();
  const field = useRef<HTMLTextAreaElement>(null);
  const dirty = draft.trim() !== (value ?? '');

  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  function start() {
    setDraft(value ?? '');
    setError(undefined);
    setEditing(true);
  }

  async function save() {
    if (saving) return;
    if (!dirty) return setEditing(false);
    const result = await onSave(draft);
    if (result.ok) setEditing(false);
    else
      setError(
        fieldErrorsOf(result.error).description?.[0] ??
          'Could not save the description. Try again.',
      );
  }

  return (
    <section aria-labelledby="description-heading" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <AlignLeft aria-hidden="true" className="size-4 text-muted-foreground" />
        <h3 id="description-heading" className="text-base font-semibold">
          Description
        </h3>
        {editing && dirty && (
          <span className="ml-auto rounded bg-status-pending-bg px-2 py-0.5 text-xs font-semibold text-status-pending-fg">
            Unsaved changes
          </span>
        )}
      </div>

      {editing ? (
        <div data-editing className="flex flex-col gap-3">
          <Textarea
            ref={field}
            aria-label="Description"
            rows={7}
            value={draft}
            readOnly={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setEditing(false);
              }
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'description-edit-error' : undefined}
            placeholder="Add a more detailed description…"
            className="border-input bg-card font-serif text-[15px] leading-6"
          />
          {error && (
            <p id="description-edit-error" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void save()}
              aria-disabled={saving || undefined}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Discard changes
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          aria-label={value ? 'Edit description' : 'Add a description'}
          className="min-h-16 w-full rounded-md p-3 text-left font-serif text-[15px] leading-6 break-words whitespace-pre-line enabled:cursor-text enabled:hover:bg-accent disabled:opacity-60 data-[empty=true]:bg-muted data-[empty=true]:text-muted-foreground"
          data-empty={!value}
        >
          {value ?? 'Add a more detailed description…'}
        </button>
      )}
    </section>
  );
}
