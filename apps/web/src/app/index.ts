/** The app shell: layout, top bar, keyboard help, playground routes, theme + data bootstrap. */
export const FEATURE = 'app' as const;

export { AppShell } from './AppShell';
export { KeyboardHelp, type KeyboardHelpProps, SHORTCUTS } from './KeyboardHelp';
export { Layout, type LayoutProps } from './Layout';
export { PlaygroundHost, type PlaygroundHostProps } from './PlaygroundHost';
export { type RegionName, RegionPlaceholder, type RegionPlaceholderProps } from './RegionPlaceholder';
export { type CentreView, TopBar, type TopBarProps } from './TopBar';
