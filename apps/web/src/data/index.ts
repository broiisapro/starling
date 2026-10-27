/** Data layer: the pure event reducer, zustand store, selectors, SSE client and demo player. */
export const FEATURE = 'data' as const;

export {
  probeHealth,
  type SkySink,
  type StartSkyDataOptions,
  type StartSkyDataResult,
  startSkyData,
} from './bootstrap';
export {
  DEMO_FIXTURE_PATH,
  DEMO_LOOP_PAUSE_MS,
  type DemoHandle,
  type DemoOptions,
  type DemoStatus,
  type DemoTimers,
  demoDurationMs,
  demoEvents,
  demoFixtureRaw,
  demoTimeline,
  parseJsonl,
  playDemo,
  scaledDelay,
} from './demo';
export type {
  AgentDrawerProps,
  DagViewProps,
  FlockPanelProps,
  JoinInfo,
  MergeQueueProps,
  MetricsPanelProps,
  SkyViewProps,
} from './handshake';
export {
  AGENT_LOG_CAP,
  applyEvent,
  applyEvents,
  type ConnectionState,
  createInitialState,
  EVENT_CAP,
  initialState,
  MERGE_CAP,
  METRICS_CAP,
  type MetricsSample,
  RECENT_CAP,
  type SkyState,
  VERDICT_CAP,
} from './reducer';
export {
  activeRunOf,
  dagProps,
  drawerProps,
  flockProps,
  metricsProps,
  queueProps,
  recentEvents,
  type SelectorActions,
  skyProps,
  sortedNodes,
  sortedRuns,
  storeActions,
} from './selectors';
export {
  ALL_EVENTS_URL,
  type BackoffOptions,
  type ConnectOptions,
  connectEvents,
  connectRunEvents,
  DEFAULT_BACKOFF,
  type EventSourceFactory,
  type EventSourceLike,
  nextBackoffDelay,
  parseSseEvent,
  runEventsUrl,
  type SseHandle,
  type SseStatus,
  type SseTimers,
  withSince,
} from './sse';
export { type SkyActions, type SkyStore, skyActions, useSky } from './store';
