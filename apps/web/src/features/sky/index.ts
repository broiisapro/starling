/**
 * The Sky (Epic 24) — a Canvas 2D murmuration dashboard panel.
 *
 * `SkyView` is the lane's public entry point (props mirrored from ARCHITECTURE §8 in
 * `handshake.ts`). Everything else here is exported for tests, the Playground and future panels:
 * the pure simulation, the behaviour table, the palette fallback and the fixture reducer.
 */
export const FEATURE = 'sky' as const;

// State → behaviour, and the colours the shell shares.
export {
  type Behaviour,
  type BehaviourKind,
  behaviourFor,
  behaviourTable,
  STATIC_KINDS,
} from './behaviour';
export type { SkyViewProps } from './handshake';

// Dev page / demo backup.
export { DEFAULT_FIXTURE_URL, Playground, type PlaygroundProps } from './Playground';
export {
  FALLBACK_STATUS_COLORS,
  SKY_COLORS,
  STATUS_SHEEN,
  statusColor,
  TASK_STATUSES,
} from './palette';
// Rendering (used by the Playground and screenshots; the shell only needs SkyView).
export { createSkyRenderer, type RenderOptions, type SkyRenderer } from './render';
// Fixture / replay helpers.
export {
  buildFrame,
  describeSky,
  indexAtTs,
  nextBeat,
  parseEventJsonl,
  RECENT_WINDOW_MS,
  type SkyFrame,
  statusCounts,
} from './replay';
// The panel shell (E23) wires store → props; the Sky never reads a global store.
export { SkyView } from './SkyView';
// Simulation.
export {
  ACTIVITY_WINDOW_MS,
  BIRDS_PER_FLOCK,
  createSky,
  type Flock,
  hashSeed,
  MAX_BIRDS,
  MAX_TASKS,
  mulberry32,
  type SkyInput,
  type SkySimOptions,
  SkySimulation,
  TRAIL_CAP,
} from './sim';
