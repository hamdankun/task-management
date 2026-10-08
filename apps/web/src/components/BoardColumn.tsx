import type { Status, Task } from '@tm/shared';
import { useDndContext, useDroppable } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import { TaskCard } from '@/components/TaskCard';
import { dropDecision } from '@/lib/board';
import { STATUS_LABEL } from '@/lib/status';
import { cn } from '@/lib/utils';

// Full class strings so Tailwind can see them; colours come from the tokens in index.css.
const DOT: Record<Status, string> = {
  to_do: 'bg-status-todo-fg',
  pending: 'bg-status-pending-fg',
  in_progress: 'bg-status-progress-fg',
  done: 'bg-status-done-fg',
};
const EMPTY: Record<Status, string> = {
  to_do: 'Nothing waiting.',
  pending: 'Nothing pending.',
  in_progress: 'Nothing in progress.',
  done: 'Nothing done yet.',
};

export function BoardColumn({
  status,
  tasks,
  locked,
  pending,
  composer,
  onOpen,
  onMove,
  onDelete,
}: {
  status: Status;
  tasks: Task[];
  locked: boolean;
  pending: ReadonlySet<string>;
  composer?: ReactNode;
  onOpen: (task: Task) => void;
  onMove: (task: Task, status: Status) => void;
  onDelete: (task: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const { active } = useDndContext();
  const dragged = (active?.data.current as { task?: Task } | undefined)?.task;
  const verdict = dragged ? dropDecision(dragged, status).kind : null;
  const headingId = `col-${status}`;

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      data-column={status}
      className={cn(
        'flex w-[85%] shrink-0 snap-start flex-col gap-2.5 rounded-xl bg-secondary p-2.5 transition-[opacity,outline-color] duration-150 sm:w-[18.5rem]',
        verdict === 'move' && 'outline-2 -outline-offset-2 outline-dashed outline-ring',
        verdict === 'move' && isOver && 'bg-accent',
        verdict === 'rejected' && 'opacity-60',
      )}
    >
      <header className="flex items-center gap-2 px-1">
        <span aria-hidden="true" className={cn('size-2.5 rounded-full', DOT[status])} />
        <h2 id={headingId} className="text-[15px] font-semibold">
          {STATUS_LABEL[status]}
        </h2>
        <span
          className="ml-auto text-xs font-medium text-muted-foreground tabular-nums"
          aria-label={`${tasks.length} tasks`}
        >
          {tasks.length}
        </span>
      </header>

      {tasks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              locked={locked}
              pending={pending.has(task.id)}
              onOpen={onOpen}
              onMove={onMove}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}

      {/* While dragging, the valid column (the next status) says where to drop, whether or not it has cards. */}
      {verdict === 'move' ? (
        <p className="rounded-md border border-dashed border-ring/60 px-3 py-4 text-center text-sm text-muted-foreground">
          Drop here
        </p>
      ) : (
        tasks.length === 0 && (
          <p className="px-1 py-2 text-sm text-muted-foreground">{EMPTY[status]}</p>
        )
      )}

      {/* Trello puts "Add a card" at the bottom: new cards land just above it. */}
      {composer}
    </section>
  );
}
