import type { AuditLog } from '@tm/shared';
import { useCallback, useEffect, useState } from 'react';
import { isAbort, type Api, type ApiError } from '@/api/client';
import { AuditLogEntry } from '@/components/AuditLogEntry';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Skeleton } from '@/components/ui/skeleton';
import { toApiError } from '@/lib/errorCopy';

/** Fetches when mounted (i.e. when expanded) and again whenever `version` (task.updatedAt) changes. */
export function AuditLogPanel({
  api,
  taskId,
  version,
}: {
  api: Api;
  taskId: string;
  version: string;
}) {
  const [logs, setLogs] = useState<AuditLog[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    api
      .listAuditLogs(taskId, controller.signal)
      .then((list) => {
        setLogs(list);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) setError(toApiError(e));
      });
    return () => controller.abort();
  }, [api, taskId, version, attempt]);

  if (error) return <ErrorBanner error={error} onRetry={retry} />;
  if (!logs) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading history">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
      </div>
    );
  }
  if (logs.length === 0)
    return <p className="text-sm text-muted-foreground">No history recorded.</p>;
  return (
    <ol className="flex flex-col" aria-label="History, oldest first">
      {logs.map((log) => (
        <AuditLogEntry key={log.id} log={log} />
      ))}
    </ol>
  );
}
