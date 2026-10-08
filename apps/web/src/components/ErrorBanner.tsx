import { AlertCircle } from 'lucide-react';
import type { ApiError } from '@/api/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/errorCopy';

export function ErrorBanner({
  error,
  onDismiss,
  onRetry,
}: {
  error: ApiError;
  onDismiss?: () => void;
  onRetry?: () => void;
}) {
  return (
    <Alert variant="destructive" className="bg-danger-bg">
      <AlertCircle />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{errorMessage(error)}</span>
        <span className="flex gap-2">
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          )}
          {onDismiss && (
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </span>
      </AlertDescription>
    </Alert>
  );
}
