/**
 * Development/demo entry for the Sky, served by Vite at
 * `/src/features/sky/preview.html?t=0|mid|end|<seconds>`.
 *
 * The fixture is imported with `?raw`, so this page needs no server and no API: exactly the backup
 * to open if the live dashboard or the network dies mid-demo. The Playground's own fetch path is
 * still the default inside the dashboard shell.
 */
import { createRoot } from 'react-dom/client';
import fixtureRaw from '../../../../../fixtures/runs/sky-todo-launch-day.jsonl?raw';
import { Playground } from './Playground';
import { indexAtTs, parseEventJsonl } from './replay';

const events = parseEventJsonl(fixtureRaw);
const params = new URLSearchParams(window.location.search);
const at = params.get('t');
let index = 0;

if (at === 'mid') {
  index = Math.floor(events.length * 0.55);
} else if (at === 'end') {
  index = Math.max(0, events.length - 1);
} else if (at) {
  const seconds = Number(at);
  if (Number.isFinite(seconds)) index = indexAtTs(events, (events[0]?.ts ?? 0) + seconds * 1000);
}

const mount = document.getElementById('root');
if (mount) {
  createRoot(mount).render(<Playground events={events} initialIndex={index} />);
}
