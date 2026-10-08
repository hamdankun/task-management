import { useMemo } from 'react';
import { toast } from 'sonner';
import { createApi, type Api } from '@/api/client';
import { ActorSelect } from '@/components/ActorSelect';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Board } from '@/components/Board';
import { Toaster } from '@/components/ui/sonner';
import { useActor } from '@/hooks/useActor';
import { useTaskBoard } from '@/hooks/useTaskBoard';
import { STATUS_LABEL } from '@/lib/status';

/** `api` is injectable so tests can run the whole UI against a fake backend. */
export function App({ api: injected }: { api?: Api }) {
  const api = useMemo(() => injected ?? createApi(), [injected]);
  const { actors, actor, setActor, error: actorsError } = useActor(api);
  const board = useTaskBoard(api, actor);
  const locked = actor === null;
  const banner =
    board.actionError ?? (board.phase === 'error' ? null : board.loadError) ?? actorsError;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-chrome text-chrome-foreground backdrop-blur-sm">
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-bold tracking-tight">Task log</h1>
            <span
              aria-hidden="true"
              className="hidden h-4 w-px self-center bg-chrome-border sm:block"
            />
            <p className="hidden text-sm text-chrome-muted sm:block">Who changed what, and when.</p>
          </div>
          <ActorSelect actors={actors} value={actor} onChange={setActor} />
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
        {banner && (
          <ErrorBanner
            error={banner}
            onDismiss={board.actionError ? board.dismissActionError : undefined}
            onRetry={board.actionError ? undefined : board.reload}
          />
        )}

        {locked && (
          <p className="text-sm font-medium text-chrome-foreground">
            Choose who you are to add or change tasks.
          </p>
        )}

        <Board
          api={api}
          actors={actors}
          tasks={board.tasks}
          phase={board.phase}
          loadError={board.loadError}
          locked={locked}
          pending={board.pending}
          onRetry={board.reload}
          onCreate={async (input) => {
            const result = await board.createTask(input);
            if (result.ok) toast.success('Task added');
            return result;
          }}
          onUpdate={(task, patch) => board.update(task, patch)}
          onMove={async (task, status) => {
            const result = await board.move(task, status);
            if (!result.ok) return;
            const label = STATUS_LABEL[result.value.task.status];
            if (result.value.changed) toast.success(`Moved to ${label}`);
            else toast(`Already ${label}. Nothing changed.`);
          }}
          onDelete={async (task) => {
            const result = await board.remove(task);
            if (result.ok) toast.success('Task deleted');
          }}
        />
      </main>
      <Toaster position="bottom-center" />
    </div>
  );
}
