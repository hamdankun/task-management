import { useCallback, useEffect, useState } from 'react';
import { isAbort, type Api, type ApiError } from '@/api/client';
import { toApiError } from '@/lib/errorCopy';

const KEY = 'tm.actor';

// localStorage can throw (private mode, blocked site data) and is user-editable: untrusted.
const read = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const write = (value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value);
  } catch {
    /* preference only; the app works without persistence */
  }
};

/** Loads the actor list from the API and restores the saved choice only if it is still valid. */
export function useActor(api: Api) {
  const [actors, setActors] = useState<string[]>([]);
  const [actor, setActorState] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .actors(controller.signal)
      .then((list) => {
        const stored = read();
        const valid = stored !== null && list.includes(stored) ? stored : null;
        if (stored !== null && valid === null) write(null);
        setActors(list);
        setActorState(valid);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!isAbort(e)) setError(toApiError(e));
      });
    return () => controller.abort();
  }, [api]);

  const setActor = useCallback((next: string | null) => {
    write(next);
    setActorState(next);
  }, []);

  return { actors, actor, setActor, error };
}
