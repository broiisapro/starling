/** The app shell: layout, top bar, region placeholders, theme + data bootstrap. */
export const FEATURE = 'app' as const;

export { AppShell } from './AppShell';
export { Layout, type LayoutProps } from './Layout';
export { type RegionName, RegionPlaceholder, type RegionPlaceholderProps } from './RegionPlaceholder';
export { TopBar, type TopBarProps } from './TopBar';
