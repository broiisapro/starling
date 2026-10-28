import type { SkyState } from '../../data/reducer';
import type { CompareHistory, CompareLocation } from './url';

/**
 * The shared web feature contract (ARCHITECTURE L39). Every extra prop is optional so the manifest's
 * `Component: ComparePage as ComponentType<FeatureProps>` cast stays honest: the shell can render it
 * with `state` alone, and C3 can opt into the URL/fetch seams.
 */
export interface FeatureProps {
  state: SkyState;
  onSelectTask?(key: string): void;
  onSelectRun?(runId: string): void;
  onClose?(): void;
}

export interface ComparePageProps extends FeatureProps {
  /** Optional hub client. C3 passes one that adds the Epic 110 auth header. */
  fetchImpl?: typeof fetch;
  /** Initial `location.search`, for tests and for a shell with its own router. */
  search?: string;
  /** Test seam; defaults to `globalThis.history`. */
  historyTarget?: CompareHistory;
  /** Test seam; defaults to `globalThis.location`. */
  locationTarget?: CompareLocation;
  /** Fixed clock for snapshots and tests; live pages tick `useNow` instead. */
  now?: number;
}
