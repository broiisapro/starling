import { useEffect, useState } from 'react';
import { fetchServerReport, mergeServerReport } from './live';
import type { FlightReport } from './types';

export interface ServerReportOptions {
  /** Only a live hub has the route; demo/replay never calls it. */
  enabled: boolean;
  /** C3 injects a fetch that carries the auth header (Epic 110); tests inject a fake. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * One fetch per run, never on the first paint's critical path. The raw payload is kept and merged
 * over the *current* local report on every render, so a server-provided summary sticks while locally
 * derived counters keep updating from the event stream.
 */
export function useServerReport(
  report: FlightReport | undefined,
  options: ServerReportOptions,
): FlightReport | undefined {
  const [remote, setRemote] = useState<{ runId: string; data: unknown } | undefined>();
  const { enabled, fetchImpl, timeoutMs } = options;
  const runId = report?.runId;

  useEffect(() => {
    if (!enabled || runId === undefined) return;
    const controller = new AbortController();
    let mounted = true;
    void fetchServerReport(runId, fetchImpl, {
      signal: controller.signal,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }).then((data) => {
      if (mounted && data !== undefined) setRemote({ runId, data });
    });
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [enabled, runId, fetchImpl, timeoutMs]);

  if (report === undefined) return undefined;
  if (remote === undefined || remote.runId !== report.runId) return report;
  return mergeServerReport(report, remote.data);
}
