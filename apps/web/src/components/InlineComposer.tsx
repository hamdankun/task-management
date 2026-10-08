import type { CreateTaskInput } from '@tm/shared';
import { Loader2, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Result } from '@/hooks/useTaskBoard';
import { fieldErrorsOf } from '@/lib/errorCopy';

const TITLE_MAX = 120;
const COUNTER_FROM = 100;

/**
 * Trello-style composer at the top of the first column. Enter adds and keeps the composer open for
 * rapid entry; Escape or Cancel closes it. New tasks always start in "To do" (the status flow).
 */
export function InlineComposer({
  disabled,
  pending,
  onSubmit,
}: {
  disabled: boolean; // no actor selected
  pending: boolean;
  onSubmit: (input: CreateTaskInput) => Promise<Result<unknown>>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [withDescription, setWithDescription] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    setTitle('');
    setDescription('');
    setWithDescription(false);
    setErrors({});
    // Return focus to where the user came from once the opener is mounted again.
    queueMicrotask(() => openerRef.current?.focus());
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (pending) return;
    const result = await onSubmit({
      title,
      description: withDescription ? description : undefined,
    });
    if (result.ok) {
      setTitle('');
      setDescription('');
      setErrors({});
      titleRef.current?.focus();
    } else {
      setErrors(fieldErrorsOf(result.error));
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  }

  if (!open) {
    return (
      <Button
        ref={openerRef}
        variant="ghost"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="w-full justify-start text-muted-foreground hover:text-foreground"
      >
        <Plus aria-hidden="true" />
        Add a task
      </Button>
    );
  }

  const titleError = errors.title?.[0];
  const descriptionError = errors.description?.[0];

  return (
    <form
      onSubmit={submit}
      onKeyDown={onKeyDown}
      noValidate
      aria-label="New task"
      className="flex flex-col gap-2 rounded-md border bg-card p-2"
    >
      <Textarea
        ref={titleRef}
        aria-label="Task title"
        placeholder="What needs doing?"
        rows={2}
        value={title}
        readOnly={pending}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          // Enter adds (like Trello); Shift+Enter is not needed because titles are single-line.
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
        aria-invalid={titleError ? true : undefined}
        aria-describedby={titleError ? 'composer-title-error' : undefined}
        className="min-h-0 resize-none border-input bg-background font-serif text-[15px]"
      />
      <div className="flex justify-between gap-2 text-xs">
        <p id="composer-title-error" className="text-destructive">
          {titleError}
        </p>
        {title.length >= COUNTER_FROM && (
          <p className={title.length > TITLE_MAX ? 'text-destructive' : 'text-muted-foreground'}>
            {title.length}/{TITLE_MAX}
          </p>
        )}
      </div>

      {withDescription ? (
        <div className="flex flex-col gap-1">
          <Textarea
            aria-label="Task description"
            placeholder="Details (optional)"
            rows={3}
            value={description}
            readOnly={pending}
            onChange={(e) => setDescription(e.target.value)}
            aria-invalid={descriptionError ? true : undefined}
            aria-describedby={descriptionError ? 'composer-description-error' : undefined}
            className="border-input bg-background font-serif text-[15px]"
          />
          {descriptionError && (
            <p id="composer-description-error" className="text-xs text-destructive">
              {descriptionError}
            </p>
          )}
        </div>
      ) : (
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => setWithDescription(true)}
          className="h-auto self-start px-0 py-0 text-xs text-muted-foreground"
        >
          Add description
        </Button>
      )}

      <div className="flex items-center gap-2">
        {/* aria-disabled (not disabled) while saving: a disabled button would drop keyboard focus */}
        <Button
          type="submit"
          size="sm"
          aria-disabled={pending || undefined}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {pending ? 'Adding…' : 'Add task'}
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" onClick={close} aria-label="Cancel">
          <X aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}
