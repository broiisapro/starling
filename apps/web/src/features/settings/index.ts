/**
 * Settings feature lane (Epic 118).
 *
 * C3 mounts `feature.Component` as an overlay (hotkey `,`) and passes `state` + `onClose` through
 * `FeatureProps`; everything else (schema, storage, apply, auth) is exported for the shell and for
 * Epic 204 to consume. The drawer never reads the Sky store, so the manifest cast stays honest.
 */
import type { ComponentType } from 'react';
import type { SkyState } from '../../data/reducer';
import { SettingsDrawer } from './SettingsDrawer';

/** Wave 3 feature-folder convention (the feature smoke test looks for this). */
export const FEATURE = 'settings' as const;

export interface FeatureProps {
  state: SkyState;
  onSelectTask?(key: string): void;
  onSelectRun?(runId: string): void;
  onClose?(): void;
}

export { applySettings, type ResolvedTheme, resolveTheme, SYSTEM_DARK_QUERY } from './apply';
export { AUTH_HEADER, authHeaders, hasToken, normalizeToken, TOKEN_MAX_LENGTH, tokenHint } from './auth';
export { SettingsDrawer, type SettingsDrawerProps } from './SettingsDrawer';
export type {
  Density,
  MotionSetting,
  SettingsPatch,
  StarlingSettings,
  ThemeSetting,
} from './schema';
export {
  DEFAULT_SETTINGS,
  DENSITY_OPTIONS,
  isDensity,
  isMotionSetting,
  isThemeSetting,
  MOTION_OPTIONS,
  mergeSettings,
  parseSettings,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSION,
  sameSettings,
  THEME_OPTIONS,
} from './schema';
export {
  clearSettings,
  readDemoSpeed,
  readSettings,
  type SettingsStorage,
  writeSettings,
} from './storage';
export {
  checkServerUrl,
  DEFAULT_HEALTH_TIMEOUT_MS,
  type HealthCheckOptions,
  type HealthCheckResult,
  healthUrl,
  normalizeServerUrl,
  type ServerUrlCheck,
  testServerHealth,
} from './url';
export { type SettingsUpdate, type UseSettingsOptions, useSettings } from './use-settings';

/**
 * One-line registration for checkpoint C3's registry. `icon` is a lucide-react name (the shell maps
 * it), `hotkey: ','` follows the Wave 3 key budget.
 */
export const feature = {
  id: FEATURE,
  title: 'Settings',
  description: 'Theme, motion, sound, demo speed, density and the hub connection.',
  kind: 'overlay',
  icon: 'Settings',
  hotkey: ',',
  Component: SettingsDrawer as ComponentType<FeatureProps>,
} as const;
