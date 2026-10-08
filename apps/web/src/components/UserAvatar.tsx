import { cn } from '@/lib/utils';

/** "john.doe" -> "JD"; a single word -> its first letter. Purely decorative: the name is always text. */
export const initials = (username: string): string =>
  username
    .split(/[._\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

export function UserAvatar({ username, className }: { username: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] leading-none font-semibold text-primary-foreground',
        className,
      )}
    >
      {initials(username)}
    </span>
  );
}
