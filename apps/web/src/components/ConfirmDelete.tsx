import { Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

// An in-page dialog instead of window.confirm: it cannot block automation and is fully testable.
export function ConfirmDelete({
  title,
  disabled,
  compact = false,
  onConfirm,
}: {
  title: string;
  disabled: boolean;
  /** Icon-only trigger (used on board cards); the accessible name is the same. */
  compact?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? 'icon-sm' : 'sm'}
          disabled={disabled}
          aria-label={`Delete ${title}`}
          title="Delete"
          className="text-destructive hover:text-destructive"
        >
          <Trash2 aria-hidden="true" />
          {!compact && <span className="max-sm:sr-only">Delete</span>}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">Delete “{title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The task leaves the board. Its history is kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete task
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
