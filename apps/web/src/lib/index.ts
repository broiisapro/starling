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
export {
  currentRoute,
  DEFAULT_ROUTE,
  initialSpeed,
  isPlaygroundName,
  PLAYGROUNDS,
  type PlaygroundName,
  parseRoute,
  type SkyRoute,
} from './route';
export {
  DEFAULT_DEMO_SPEED,
  DEMO_SPEEDS,
  type DemoSpeed,
  isDemoSpeed,
  otherSpeeds,
  parseDemoSpeed,
} from './speed';
export {
  HUB_BADGE,
  isTerminalStatus,
  NODE_STATUS_COLORS,
  type NodeStatusPalette,
  PERCH_BADGE,
  STATUS_COLORS,
  type StatusPalette,
  statusChip,
  statusLabel,
  statusPalette,
  statusSurface,
  TASK_STATUSES,
  TERMINAL_STATUSES,
  taskTone,
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
