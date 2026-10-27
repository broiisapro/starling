import { lazy, Suspense } from 'react';
import { EmptyState } from '../components';
import { demoEvents } from '../data/demo';
import type { PlaygroundName } from '../lib/route';

/**
 * `?playground=<feature>` — each feature's own `Playground.tsx`, full screen.
 *
 * These are dev pages that double as a demo backup: if a panel misbehaves on stage, the same panel
 * can be shown on its own from the recorded run. They are lazy-loaded so the dashboard bundle does
 * not carry six playgrounds (and six copies of the fixture) for a URL nobody on stage types.
 */
const SkyPlayground = lazy(() =>
  import('../features/sky/Playground').then((module) => ({ default: module.Playground })),
);
const DagPlayground = lazy(() => import('../features/dag/Playground'));
const AgentsPlayground = lazy(() => import('../features/agents/Playground'));
const QueuePlayground = lazy(() =>
  import('../features/queue/Playground').then((module) => ({ default: module.Playground })),
);
const MetricsPlayground = lazy(() =>
  import('../features/metrics/Playground').then((module) => ({ default: module.Playground })),
);
const FlockPlayground = lazy(() =>
  import('../features/flock/Playground').then((module) => ({ default: module.Playground })),
);

const TITLES: Record<PlaygroundName, string> = {
  sky: 'The sky',
  dag: 'Flight plan',
  agents: 'Agent drawer',
  queue: 'Merge queue',
  metrics: 'Cost & speed',
  flock: 'The flock',
};

function renderPlayground(name: PlaygroundName) {
  switch (name) {
    case 'sky':
      // The Sky's playground can take the fixture directly, so it works from a production build too.
      return <SkyPlayground events={demoEvents()} autoPlay />;
    case 'dag':
      return <DagPlayground />;
    case 'agents':
      return <AgentsPlayground />;
    case 'queue':
      return <QueuePlayground />;
    case 'metrics':
      return <MetricsPlayground />;
    case 'flock':
      return <FlockPlayground events={demoEvents()} autoplay />;
  }
}

export interface PlaygroundHostProps {
  name: PlaygroundName;
}

export function PlaygroundHost({ name }: PlaygroundHostProps) {
  return (
    <div className="h-screen min-h-0 w-full overflow-y-auto" data-playground={name}>
      <Suspense
        fallback={
          <div className="grid h-full place-items-center">
            <EmptyState compact title={`Loading the ${TITLES[name].toLowerCase()} playground…`} />
          </div>
        }
      >
        {renderPlayground(name)}
      </Suspense>
    </div>
  );
}
