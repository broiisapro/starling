import { Bird, Gauge, ListOrdered, Network, PanelRight, Waypoints } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '../components';

export type RegionName = 'sky' | 'dag' | 'drawer' | 'queue' | 'metrics' | 'flock';

interface RegionCopy {
  title: string;
  description: string;
  icon: ReactNode;
}

const REGIONS: Record<RegionName, RegionCopy> = {
  sky: {
    title: 'The sky is being feathered 🐦',
    description: 'The murmuration canvas lands here at C1 — one bird per task, roosts for every machine.',
    icon: <Bird />,
  },
  dag: {
    title: 'The flight plan',
    description: 'The lane-safe task DAG lands here at C1, with dependency edges and status colours.',
    icon: <Waypoints />,
  },
  drawer: {
    title: 'Pick a bird',
    description: 'Agent transcript, verdict history and diff for the selected task.',
    icon: <PanelRight />,
  },
  queue: {
    title: 'Merge queue',
    description: 'Branches waiting to land on the integration branch, and the resolver hand-offs.',
    icon: <ListOrdered />,
  },
  metrics: {
    title: 'Cost & speed',
    description: 'API spend, local-model savings and elapsed time — the open-weight story in numbers.',
    icon: <Gauge />,
  },
  flock: {
    title: 'The flock',
    description: 'Hub plus perches: capacity, latency and which machine each bird is on.',
    icon: <Network />,
  },
};

export interface RegionPlaceholderProps {
  name: RegionName;
  compact?: boolean;
}

/**
 * Wave 1 placeholder. Every region renders one of these until C1 swaps in the real feature panel
 * (see the `WIRED AT C1` comment at each call site in `Layout.tsx`).
 */
export function RegionPlaceholder({ name, compact }: RegionPlaceholderProps) {
  const copy = REGIONS[name];
  return (
    <div data-region-placeholder={name} className="h-full">
      <EmptyState compact={compact} icon={copy.icon} title={copy.title} description={copy.description} />
    </div>
  );
}
