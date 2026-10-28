/**
 * Icon names → lucide components, with exactly one fallback.
 *
 * Manifests carry an icon *name* (a string, so the registry never has to know React). Importing
 * `* as icons` would pull the entire lucide set into the dashboard bundle for one 14 px glyph, so the
 * palette knows a chosen few and falls back to `Command` for everything else.
 */
import {
  BarChart3,
  Bird,
  Boxes,
  Clock,
  Coins,
  Command,
  Crosshair,
  Download,
  Gauge,
  GitCompare,
  Grid3x3,
  HeartPulse,
  Layers,
  ListOrdered,
  type LucideIcon,
  Network,
  Rocket,
  Search,
  Settings,
  Sparkles,
  Terminal,
  Trophy,
  Users,
} from 'lucide-react';

const ICONS: Readonly<Record<string, LucideIcon>> = {
  Activity: Gauge,
  BarChart3,
  Bird,
  Boxes,
  Clock,
  Coins,
  Command,
  Crosshair,
  Download,
  Gauge,
  GitCompare,
  Grid3x3,
  HeartPulse,
  Layers,
  ListOrdered,
  Network,
  Rocket,
  Search,
  Settings,
  Sparkles,
  Terminal,
  Trophy,
  Users,
  Dashboard: ListOrdered,
  Flock: Network,
  MergeQueue: ListOrdered,
  Metrics: Gauge,
  Sky: Bird,
};

export interface PaletteIconProps {
  /** A manifest's icon name. Unknown/absent names render `Command`. */
  name?: string;
  className?: string;
}

export function PaletteIcon({ name, className = 'h-3.5 w-3.5' }: PaletteIconProps) {
  const Icon = (name !== undefined ? ICONS[name] : undefined) ?? Command;
  return <Icon aria-hidden="true" className={className} />;
}
