/**
 * Measurement wrappers. The engine writes through the `Store` port, so a thin instrumented store
 * records append/save latency without touching `@starling/store`.
 *
 * `SqliteStore.appendEvent` is intentionally buffered (one transaction per 64 events or per
 * microtask), so "append latency" is the cost the engine actually sees. The real WAL commit cost is
 * captured separately: the sampler calls `flush()` every 50 ms and records how long that takes.
 */
import type { Run, StarlingEvent, Store } from '../../packages/core/src/index.ts';

export interface StoreSamples {
  append: number[];
  save: number[];
  flush: number[];
  readEvents: number[];
  appendEvents: number;
  savedRuns: number;
  readCalls: number;
}

export interface InstrumentedStore {
  store: Store;
  samples: StoreSamples;
  close(): void;
}

interface FlushableStore extends Store {
  flush?: () => void;
}

function mb(bytes: number): number {
  return Math.round((bytes / 1024 ** 2) * 10) / 10;
}

/**
 * Wrap a store, timing every port call. A 50 ms timer flushes the buffer (when the inner store
 * supports it) and records the transaction cost, so disk latency is measured under load rather than
 * once at the end on a quiet store.
 */
export function instrumentStore(inner: FlushableStore): InstrumentedStore {
  const samples: StoreSamples = {
    append: [],
    save: [],
    flush: [],
    readEvents: [],
    appendEvents: 0,
    savedRuns: 0,
    readCalls: 0,
  };

  const store: Store = {
    saveRun(run: Run) {
      const started = performance.now();
      try {
        inner.saveRun(run);
      } finally {
        samples.save.push(performance.now() - started);
        samples.savedRuns += 1;
      }
    },
    getRun(runId: string) {
      return inner.getRun(runId);
    },
    listRuns() {
      return inner.listRuns();
    },
    appendEvent(event: StarlingEvent) {
      const started = performance.now();
      try {
        inner.appendEvent(event);
      } finally {
        samples.append.push(performance.now() - started);
        samples.appendEvents += 1;
      }
    },
    events(runId: string, sinceTs?: number) {
      const started = performance.now();
      try {
        return inner.events(runId, sinceTs);
      } finally {
        samples.readEvents.push(performance.now() - started);
        samples.readCalls += 1;
      }
    },
    exportJsonl(runId: string, path: string) {
      inner.exportJsonl(runId, path);
    },
  };

  const timer = setInterval(() => {
    if (inner.flush === undefined) return;
    const started = performance.now();
    try {
      inner.flush();
    } finally {
      samples.flush.push(performance.now() - started);
    }
  }, 50);
  timer.unref?.();

  return {
    store,
    samples,
    close() {
      clearInterval(timer);
    },
  };
}

export interface MemorySnapshot {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
}

export interface MemoryReport extends MemorySnapshot {
  peakRssMb: number;
  peakHeapUsedMb: number;
}

export interface MemorySampler {
  snapshot(): MemorySnapshot;
  stop(): MemoryReport;
}

export function memorySnapshot(): MemorySnapshot {
  const usage = process.memoryUsage();
  return {
    rssMb: mb(usage.rss),
    heapUsedMb: mb(usage.heapUsed),
    heapTotalMb: mb(usage.heapTotal),
    externalMb: mb(usage.external),
  };
}

/** Poll `process.memoryUsage()` so we can report a peak, not just the end state. */
export function startMemorySampler(intervalMs = 50): MemorySampler {
  const start = memorySnapshot();
  let peakRssMb = start.rssMb;
  let peakHeapUsedMb = start.heapUsedMb;
  const timer = setInterval(() => {
    const snapshot = memorySnapshot();
    peakRssMb = Math.max(peakRssMb, snapshot.rssMb);
    peakHeapUsedMb = Math.max(peakHeapUsedMb, snapshot.heapUsedMb);
  }, intervalMs);
  timer.unref?.();

  return {
    snapshot: memorySnapshot,
    stop() {
      clearInterval(timer);
      const end = memorySnapshot();
      peakRssMb = Math.max(peakRssMb, end.rssMb);
      peakHeapUsedMb = Math.max(peakHeapUsedMb, end.heapUsedMb);
      return { ...end, peakRssMb, peakHeapUsedMb };
    },
  };
}
