/** Shared utilities: formatting, status palette, theme, routing, class names. */
export const FEATURE = 'lib' as const;

export { cn } from './cn';
export {
  formatClock,
  formatDuration,
  formatRelative,
  formatTokens,
  formatUsd,
  percent,
  totalTokens,
} from './format';
export { currentRoute, DEFAULT_ROUTE, initialSpeed, parseRoute, type SkyRoute } from './route';
export {
  DEFAULT_DEMO_SPEED,
  DEMO_SPEEDS,
  type DemoSpeed,
  isDemoSpeed,
  otherSpeeds,
  parseDemoSpeed,
} from './speed';
export {
  isTerminalStatus,
  STATUS_COLORS,
  type StatusPalette,
  statusLabel,
  statusPalette,
  TASK_STATUSES,
  TERMINAL_STATUSES,
} from './status';
export {
  applyTheme,
  isTheme,
  nextTheme,
  readTheme,
  THEME_STORAGE_KEY,
  type Theme,
  type ThemeStorage,
  toggleTheme,
  writeTheme,
} from './theme';
