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
    title: 'The sky hit turbulence',
    description:
      'The murmuration panel crashed. The rest of the dashboard keeps flying — reload to bring it back.',
    icon: <Bird />,
  },
  dag: {
    title: 'The flight plan lost a wing',
    description: 'The task DAG crashed. Use the Sky view; every other panel is unaffected.',
    icon: <Waypoints />,
  },
  drawer: {
    title: 'No bird to show',
    description: 'Pick a task in the sky, the DAG, the queue or the flock to open its transcript.',
    icon: <PanelRight />,
  },
  queue: {
    title: 'The merge queue hit turbulence',
    description:
      'The queue board crashed. Merges continue on the engine side — reload to bring the board back.',
    icon: <ListOrdered />,
  },
  metrics: {
    title: 'The cost meter hit turbulence',
    description:
      'The metrics panel crashed. Spend is still recorded by the store; reload to bring the meter back.',
    icon: <Gauge />,
  },
  flock: {
    title: 'The flock went out of sight',
    description: 'The flock panel crashed. Nodes keep heartbeating; reload to bring the roosts back.',
    icon: <Network />,
  },
};

export interface RegionPlaceholderProps {
  name: RegionName;
  compact?: boolean;
  /** The error message from the boundary, appended for whoever has to fix it. */
  detail?: string;
}

/**
 * The fallback every region renders when its panel throws (wrapped in a `components/ErrorBoundary`
 * in `Layout.tsx`). Before C1 it was the "not wired yet" placeholder; now it only appears when a
 * panel crashes, so one bad panel can never blank the dashboard on stage.
 */
export function RegionPlaceholder({ name, compact, detail }: RegionPlaceholderProps) {
  const copy = REGIONS[name];
  return (
    <div data-region-placeholder={name} role="status" className="h-full">
      <EmptyState
        compact={compact}
        icon={copy.icon}
        title={copy.title}
        description={detail === undefined ? copy.description : `${copy.description} (${detail})`}
      />
    </div>
  );
}
