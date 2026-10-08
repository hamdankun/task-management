import { nextStatus, type Status, type Task } from '@tm/shared';
import { useDraggable } from '@dnd-kit/core';
import { AlignLeft, ArrowRight, Loader2 } from 'lucide-react';
import { ConfirmDelete } from '@/components/ConfirmDelete';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/ui/button';
import { STATUS_LABEL } from '@/lib/status';
import { cn } from '@/lib/utils';

const titleClass = 'font-serif text-base leading-6 font-semibold break-words';

/** Small indicators (has a description, who it is assigned to), like a Trello card. */
function Indicators({ task }: { task: Task }) {
  if (!task.description && !task.assignee) return null;
  return (
    <div className="mt-2 flex min-h-6 items-center gap-2 text-muted-foreground">
      {task.description && (
        <span title="Has a description">
          <AlignLeft aria-hidden="true" className="size-4" />
          <span className="sr-only">Has a description</span>
        </span>
      )}
      {task.assignee && (
        <span className="ml-auto" title={`Assigned to ${task.assignee}`}>
          <UserAvatar username={task.assignee} />
          <span className="sr-only">Assigned to {task.assignee}</span>
        </span>
      )}
    </div>
  );
}

export function TaskCardPreview({ task }: { task: Task }) {
  return (
    <div className="w-[17.5rem] rotate-2 cursor-grabbing rounded-lg border bg-card p-3 shadow-xl ring-1 ring-ring/30">
      <h3 className={titleClass}>{task.title}</h3>
      <Indicators task={task} />
    </div>
  );
}

/**
 * A clean card: title and small indicators. Click opens the popup; drag (pointer or touch) moves it
 * one step either way. Quick actions are icon buttons that appear at the top right on hover or
 * keyboard focus (and always on touch screens); they stay in the accessibility tree at all times.
 * The popup's Status dropdown is the other non-drag way to move a card, including backward.
 * No dnd attributes/roles are applied to the card itself.
 */
export function TaskCard({
  task,
  locked,
  pending,
  onOpen,
  onMove,
  onDelete,
}: {
  task: Task;
  locked: boolean;
  pending: boolean;
  onOpen: (task: Task) => void;
  onMove: (task: Task, status: Status) => void;
  onDelete: (task: Task) => void;
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: locked || pending,
  });
  const next = nextStatus(task.status);

  return (
    <li
      ref={setNodeRef}
      {...listeners}
      data-status={task.status}
      aria-busy={pending || undefined}
      // Anywhere on the card opens it, except on the card's own buttons.
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button')) onOpen(task);
      }}
      className={cn(
        'group relative cursor-pointer rounded-lg border bg-card p-3 shadow-sm transition-[opacity,box-shadow] hover:border-ring/50 hover:shadow-md',
        !locked && !pending && 'cursor-grab',
        pending && 'opacity-70',
        isDragging && 'opacity-30',
      )}
    >
      <h3 className={titleClass}>
        <button
          type="button"
          onClick={() => onOpen(task)}
          aria-haspopup="dialog"
          className="block w-full cursor-[inherit] rounded-sm text-left"
        >
          {task.title}
        </button>
      </h3>
      <Indicators task={task} />

      <div
        className={cn(
          'absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-md bg-card/95 shadow-sm ring-1 ring-border transition-opacity',
          'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
          pending && 'opacity-100',
          isDragging && 'opacity-0!', // the card being dragged shows no quick actions
        )}
      >
        {next && (
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={locked}
            aria-disabled={pending || undefined} // keeps keyboard focus, unlike `disabled`
            onClick={() => !pending && onMove(task, next)}
            aria-label={`Move to ${STATUS_LABEL[next]}: ${task.title}`}
            title={`Move to ${STATUS_LABEL[next]}`}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <ArrowRight aria-hidden="true" />
            )}
          </Button>
        )}
        <ConfirmDelete
          compact
          title={task.title}
          disabled={locked || pending}
          onConfirm={() => onDelete(task)}
        />
      </div>
    </li>
  );
}
