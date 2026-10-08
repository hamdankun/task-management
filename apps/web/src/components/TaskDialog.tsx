import type { Status, Task, UpdateTaskInput } from '@tm/shared';
import { toast } from 'sonner';
import type { Api } from '@/api/client';
import { AssigneeField } from '@/components/AssigneeField';
import { AuditLogPanel } from '@/components/AuditLogPanel';
import { DescriptionEditor } from '@/components/DescriptionEditor';
import { InlineTitle } from '@/components/InlineTitle';
import { StatusSelect } from '@/components/StatusSelect';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { Result } from '@/hooks/useTaskBoard';
import { formatTime } from '@/lib/formatAuditLog';

/**
 * The Trello-style card popup: editable title, assignee, editable description on the left; the
 * read-only activity ledger on the right (stacked on small screens).
 */
export function TaskDialog({
  api,
  task,
  actors,
  locked,
  pending,
  onClose,
  onUpdate,
  onMove,
}: {
  api: Api;
  task: Task | null;
  actors: string[];
  locked: boolean; // no actor selected
  pending: boolean;
  onClose: () => void;
  onUpdate: (task: Task, patch: UpdateTaskInput) => Promise<Result<unknown>>;
  onMove: (task: Task, status: Status) => void;
}) {
  const save = async (t: Task, patch: UpdateTaskInput) => {
    const result = await onUpdate(t, patch);
    if (result.ok) toast.success('Saved');
    return result;
  };

  return (
    <Dialog open={task !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[90vh] gap-0 overflow-hidden bg-card p-0 sm:max-w-4xl"
        // While a field is being edited Escape cancels that edit, not the whole dialog.
        onEscapeKeyDown={(e) => {
          if ((e.target as HTMLElement | null)?.closest('[data-editing]')) e.preventDefault();
        }}
      >
        {task && (
          <>
            <DialogTitle className="sr-only">Task details</DialogTitle>
            <DialogDescription className="sr-only">
              Edit this task and read its history.
            </DialogDescription>
            <div className="grid max-h-[90vh] overflow-y-auto md:grid-cols-[minmax(0,1fr)_20rem] md:overflow-hidden">
              <div className="flex flex-col gap-6 p-6 md:max-h-[90vh] md:overflow-y-auto">
                <div className="pr-8">
                  <StatusSelect
                    value={task.status}
                    disabled={locked}
                    onChange={(status) => !pending && onMove(task, status)}
                  />
                </div>

                <InlineTitle
                  value={task.title}
                  disabled={locked}
                  saving={pending}
                  onSave={(title) => save(task, { title })}
                />

                <AssigneeField
                  value={task.assignee}
                  actors={actors}
                  disabled={locked || pending}
                  onChange={(assignee) => void save(task, { assignee })}
                />

                <DescriptionEditor
                  value={task.description}
                  disabled={locked}
                  saving={pending}
                  onSave={(description) => save(task, { description })}
                />

                <p className="text-xs text-muted-foreground tabular-nums">
                  Created {formatTime(task.createdAt)}
                  {task.updatedAt !== task.createdAt && (
                    <> · Updated {formatTime(task.updatedAt)}</>
                  )}
                </p>
                {locked && (
                  <p className="text-sm text-muted-foreground">
                    Choose who you are to edit this task.
                  </p>
                )}
              </div>

              <aside
                aria-labelledby="activity-heading"
                className="border-t bg-muted/50 p-6 md:max-h-[90vh] md:overflow-y-auto md:border-t-0 md:border-l"
              >
                <h3 id="activity-heading" className="mb-4 text-base font-semibold">
                  Activity
                </h3>
                <AuditLogPanel api={api} taskId={task.id} version={task.updatedAt} />
              </aside>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
