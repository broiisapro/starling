/** Shared component ownership: panels, badges, dots, tabs and other small primitives. */
export const FEATURE = 'components' as const;

export { Badge, type BadgeProps, type BadgeTone } from './Badge';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { Kbd, type KbdProps } from './Kbd';
export { Panel, type PanelProps } from './Panel';
export { Stat, type StatProps, type StatTone } from './Stat';
export { StatusDot, type StatusDotProps } from './StatusDot';
export { type TabItem, Tabs, type TabsProps } from './Tabs';
export { Tooltip, type TooltipProps } from './Tooltip';
