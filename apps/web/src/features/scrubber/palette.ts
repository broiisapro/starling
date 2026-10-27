import {
  AlertTriangle,
  ArrowRightLeft,
  Flag,
  GitMerge,
  GitPullRequestClosed,
  Laptop,
  ListTree,
  type LucideIcon,
  Unplug,
} from 'lucide-react';
import type { MarkerKind } from './markers';

/** One icon per marker kind, shared by the track and the legend chips. */
export const MARKER_ICON: Record<MarkerKind, LucideIcon> = {
  merge: GitMerge,
  fail: AlertTriangle,
  conflict: GitPullRequestClosed,
  'node-join': Laptop,
  'node-leave': Unplug,
  migrate: ArrowRightLeft,
  plan: ListTree,
  finish: Flag,
};

/**
 * Marker colours, read from the same language as the status palette (`lib/status.ts`): emerald for
 * something that landed, red/rose for something that broke, sky for a roost joining, violet for a
 * migration. Tailwind class strings are written literally so the scanner emits them.
 */
export interface MarkerStyle {
  /** Short legend word. */
  name: string;
  /** Icon colour. */
  text: string;
  /** Filled dot on the track. */
  dot: string;
  /** Halo around the dot, and the legend chip's border. */
  ring: string;
}

export const MARKER_STYLE: Record<MarkerKind, MarkerStyle> = {
  merge: {
    name: 'merge',
    text: 'text-emerald-300',
    dot: 'bg-emerald-400',
    ring: 'border-emerald-400/50 bg-emerald-400/10',
  },
  fail: {
    name: 'failure',
    text: 'text-red-300',
    dot: 'bg-red-400',
    ring: 'border-red-400/50 bg-red-400/10',
  },
  conflict: {
    name: 'conflict',
    text: 'text-rose-300',
    dot: 'bg-rose-400',
    ring: 'border-rose-400/50 bg-rose-400/10',
  },
  'node-join': {
    name: 'perch joined',
    text: 'text-sky-300',
    dot: 'bg-sky-400',
    ring: 'border-sky-400/50 bg-sky-400/10',
  },
  'node-leave': {
    name: 'perch left',
    text: 'text-slate-300',
    dot: 'bg-slate-400',
    ring: 'border-slate-400/50 bg-slate-400/10',
  },
  migrate: {
    name: 'migration',
    text: 'text-violet-300',
    dot: 'bg-violet-400',
    ring: 'border-violet-400/50 bg-violet-400/10',
  },
  plan: {
    name: 'plan',
    text: 'text-teal-300',
    dot: 'bg-teal-400',
    ring: 'border-teal-400/50 bg-teal-400/10',
  },
  finish: {
    name: 'finish',
    text: 'text-amber-300',
    dot: 'bg-amber-400',
    ring: 'border-amber-400/50 bg-amber-400/10',
  },
};
