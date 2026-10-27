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
// Work cues (Epic 47): spark pool, captions and the notice copy.
export {
  BEAT_DECAY,
  createSparkPool,
  liveSparks,
  MAX_SPARKS,
  NOTICE_LIFE,
  type NoticeKind,
  noticeAlpha,
  noticeText,
  RIPPLE_LIFE,
  type RoostNotice,
  resetSparks,
  SPARK_LIFE,
  type SparkPool,
  spawnSparks,
  stepSparks,
} from './cues';
export type { SkyViewProps } from './handshake';
// Roost geometry (Epic 47 added the label metrics + sessions gauge fields).
export {
  GAUGE_BASELINE,
  LABEL_BASELINE,
  layoutRoosts,
  makeWire,
  ROOST_LIFT,
  type Roost,
  roostLabelFont,
  roostPerchOffset,
  roostPerchRow,
  type Wire,
  wireSlotX,
} from './layout';
// Dev page / demo backup.
export { DEFAULT_FIXTURE_URL, Playground, type PlaygroundProps } from './Playground';
export { SKY_COLORS, STATUS_SHEEN, statusColor, TASK_STATUSES } from './palette';
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
  STRESS_TASKS,
  statusCounts,
  withStressTasks,
} from './replay';
// The panel shell (E23) wires store → props; the Sky never reads a global store.
export { SkyView } from './SkyView';
// Simulation.
export {
  ACTIVITY_WINDOW_MS,
  type AudioCues,
  BIRDS_PER_FLOCK,
  createSky,
  type Flock,
  hashSeed,
  LANDING_SHIMMER,
  MAX_BIRDS,
  MAX_TASKS,
  mulberry32,
  type SkyInput,
  type SkySimOptions,
  SkySimulation,
  SPARKS_PER_EDIT,
  SWEEP_DURATION,
  TRAIL_CAP,
} from './sim';
// Optional soundscape (Epic 47): synthesised, off by default, remembered per viewer.
export {
  type AudioCue,
  createSkyAudio,
  readSoundEnabled,
  type SkyAudio,
  type SkyAudioOptions,
  SOUND_STORAGE_KEY,
  type StorageLike,
  safeStorage,
  silentAudio,
  writeSoundEnabled,
} from './sound';
