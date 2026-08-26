import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(body?.message ?? body?.error ?? `Request failed (${res.status})`, res.status, body?.error);
  }
  return body as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
};

export interface Loadable<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Fetches on mount and whenever `path` changes.
 *
 * Keeps the previous data visible while a refetch is in flight: a filter
 * change should not blank the table it is filtering, which reads as a bug even
 * when the request succeeds a moment later.
 */
export function useApi<T>(path: string, deps: unknown[] = []): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    api.get<T>(path)
      .then((d) => { if (alive.current) { setData(d); setError(null); } })
      .catch((e: Error) => { if (alive.current) setError(e.message); })
      .finally(() => { if (alive.current) setLoading(false); });
    return () => { alive.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

export type StreamEvent =
  | { type: 'log'; runId: number | null; line: string; stream: 'out' | 'err' }
  | { type: 'status'; runId: number | null; kind: string | null; running: boolean; exitCode?: number | null };

/**
 * Subscribes to the pipeline event stream for the lifetime of the app.
 *
 * EventSource reconnects on its own, so a server restart heals without a page
 * reload. Lines are capped because a long discovery run emits thousands and
 * the browser should not be asked to keep them all in the DOM.
 */
export function useRunStream(onStatusChange?: () => void) {
  const [lines, setLines] = useState<{ line: string; stream: 'out' | 'err'; id: number }[]>([]);
  const [status, setStatus] = useState<{ running: boolean; kind: string | null; runId: number | null }>({
    running: false, kind: null, runId: null,
  });
  const counter = useRef(0);
  const onChange = useRef(onStatusChange);
  onChange.current = onStatusChange;

  useEffect(() => {
    const source = new EventSource('/api/stream');

    source.onmessage = (evt) => {
      const data = JSON.parse(evt.data) as StreamEvent;
      if (data.type === 'log') {
        setLines((prev) => {
          const next = [...prev, { line: data.line, stream: data.stream, id: counter.current++ }];
          return next.length > 300 ? next.slice(-300) : next;
        });
      } else {
        setStatus({ running: data.running, kind: data.kind, runId: data.runId });
        // A run that just ended has written rows every screen wants.
        if (!data.running) onChange.current?.();
      }
    };

    return () => source.close();
  }, []);

  const clear = useCallback(() => setLines([]), []);
  return { lines, status, clear };
}
