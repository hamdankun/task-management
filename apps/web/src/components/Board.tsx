import {
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  STATUSES,
  type CreateTaskInput,
  type Status,
  type Task,
  type UpdateTaskInput,
} from '@tm/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Api, ApiError } from '@/api/client';
import { BoardColumn } from '@/components/BoardColumn';
import { ErrorBanner } from '@/components/ErrorBanner';
import { InlineComposer } from '@/components/InlineComposer';
import { TaskCardPreview } from '@/components/TaskCard';
import { TaskDialog } from '@/components/TaskDialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { Phase, Result } from '@/hooks/useTaskBoard';
import { dropDecision } from '@/lib/board';

/**
 * The column under the pointer wins (as in Trello). Overlap of the dragged preview is only a
 * fallback (e.g. a touch drag ending in a gutter), because the preview extends to one side of the
 * pointer and would otherwise favour the neighbouring column.
 */
const collisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : rectIntersection(args);
};

export function Board({
  api,
  actors,
  tasks,
  phase,
  loadError,
  locked,
  pending,
  onRetry,
  onCreate,
  onUpdate,
  onMove,
  onDelete,
}: {
  api: Api;
  actors: string[];
  tasks: Task[];
  phase: Phase;
  loadError: ApiError | null;
  locked: boolean;
  pending: ReadonlySet<string>;
  onRetry: () => void;
  onCreate: (input: CreateTaskInput) => Promise<Result<unknown>>;
  onUpdate: (task: Task, patch: UpdateTaskInput) => Promise<Result<unknown>>;
  onMove: (task: Task, status: Status) => void;
  onDelete: (task: Task) => void;
}) {
  // Mouse: a small drag distance keeps plain clicks on the card's buttons working.
  // Touch: press-and-hold, so a swipe still scrolls the board.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const [dragging, setDragging] = useState<Task | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    const task = (active.data.current as { task?: Task } | undefined)?.task;
    if (!task || !over) return;
    const target = STATUSES.find((s) => s === over.id);
    if (!target) return;
    const decision = dropDecision(task, target);
    if (decision.kind === 'move') onMove(task, target);
    else if (decision.kind === 'rejected') toast(decision.message);
  }

  if (phase === 'loading') {
    return (
      <div className="flex gap-3 overflow-hidden" aria-busy="true" aria-label="Loading tasks">
        {STATUSES.map((s) => (
          <Skeleton key={s} className="h-48 w-[18.5rem] shrink-0 bg-chrome-control" />
        ))}
      </div>
    );
  }
  if (phase === 'error' && loadError) return <ErrorBanner error={loadError} onRetry={onRetry} />;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={({ active }) =>
        setDragging((active.data.current as { task?: Task } | undefined)?.task ?? null)
      }
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div
        role="region"
        aria-label="Task board"
        className="-mx-4 flex snap-x items-start gap-3 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6"
      >
        {STATUSES.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            // Oldest first, so a task added with the composer appears right above it (as in Trello).
            tasks={tasks
              .filter((t) => t.status === status)
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))}
            locked={locked}
            pending={pending}
            onOpen={(task) => setOpenId(task.id)}
            onMove={onMove}
            onDelete={onDelete}
            composer={
              status === 'to_do' ? (
                <InlineComposer
                  disabled={locked}
                  pending={pending.has('new')}
                  onSubmit={onCreate}
                />
              ) : undefined
            }
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging ? <TaskCardPreview task={dragging} /> : null}
      </DragOverlay>
      <TaskDialog
        api={api}
        task={tasks.find((t) => t.id === openId) ?? null}
        actors={actors}
        locked={locked}
        pending={openId !== null && pending.has(openId)}
        onClose={() => setOpenId(null)}
        onUpdate={onUpdate}
        onMove={onMove}
      />
    </DndContext>
  );
}
