import { useCallback, useEffect, useRef, useState } from "react";

import {
  describeApiError,
  getHubState,
  type HubState,
} from "../services/api";

export const POLL_INTERVAL_MS = 5_000;

export interface HubStateResult {
  state: HubState | null;
  error: string | null;
  isInitialLoading: boolean;
  isChecking: boolean;
  lastCheckedAt: Date | null;
  refresh: () => Promise<void>;
}

/**
 * Polls GET /api/state every five seconds.
 *
 * On failure the previous snapshot is dropped: showing a stale "Running" pill
 * after the Hub goes away would be dishonest. The page stays usable and the
 * last error is exposed for the offline notice.
 */
export function useHubState(): HubStateResult {
  const [state, setState] = useState<HubState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

  const mountedRef = useRef(true);
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    if (mountedRef.current) setIsChecking(true);

    try {
      const nextState = await getHubState(controller.signal);
      if (!mountedRef.current || controller.signal.aborted) return;
      setState(nextState);
      setError(null);
    } catch (caught) {
      if (!mountedRef.current || controller.signal.aborted) return;
      setState(null);
      setError(describeApiError(caught));
    } finally {
      if (mountedRef.current && requestRef.current === controller) {
        setIsChecking(false);
        setLastCheckedAt(new Date());
        requestRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();

    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [refresh]);

  return {
    state,
    error,
    isInitialLoading: isChecking && state === null && error === null,
    isChecking,
    lastCheckedAt,
    refresh,
  };
}
