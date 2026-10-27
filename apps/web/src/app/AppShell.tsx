import { useEffect, useState } from 'react';
import { startSkyData } from '../data/bootstrap';
import { useSky } from '../data/store';
import { currentRoute, initialSpeed } from '../lib/route';
import type { DemoSpeed } from '../lib/speed';
import { applyTheme, readTheme, type Theme, toggleTheme } from '../lib/theme';
import { Layout } from './Layout';
import { PlaygroundHost } from './PlaygroundHost';

/**
 * Boots the shell: theme, route, data source and the store.
 *
 * Data source rules:
 * - `?demo=1` → always the recorded run;
 * - otherwise probe `/api/health`; a real server means live SSE, anything else means demo.
 *
 * Speed changes restart the data layer from a clean store so the replay is deterministic.
 * `?playground=<feature>` bypasses the shell entirely: those pages bring their own fixture.
 */
export function AppShell() {
  const state = useSky();
  const [route] = useState(currentRoute);
  const [speed, setSpeed] = useState<DemoSpeed>(() => initialSpeed(route));
  const [theme, setTheme] = useState<Theme>(() => {
    const initial = readTheme();
    applyTheme(initial);
    return initial;
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Dev-only handle for the browser demo check and for poking the store in DevTools. Stripped from
  // production builds by Vite's `import.meta.env.DEV` constant.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (globalThis as { __STARLING_SKY__?: typeof useSky }).__STARLING_SKY__ = useSky;
  }, []);

  const playground = route.playground;

  useEffect(() => {
    if (playground !== undefined) return;
    let cancelled = false;
    let stop: (() => void) | undefined;

    startSkyData({ demo: route.demo, speed })
      .then((result) => {
        if (cancelled) {
          result.stop();
          return;
        }
        stop = result.stop;
      })
      .catch(() => {
        if (!cancelled) useSky.getState().setConnection('offline');
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [route.demo, speed, playground]);

  // Deep link: ?run=<id> or #/runs/<id> selects a run once its events have arrived.
  useEffect(() => {
    if (route.runId === undefined || state.runs[route.runId] === undefined) return;
    if (state.activeRunId !== route.runId) useSky.getState().setActiveRun(route.runId);
  }, [route.runId, state.runs, state.activeRunId]);

  const changeSpeed = (next: DemoSpeed): void => {
    useSky.getState().reset();
    setSpeed(next);
  };

  if (playground !== undefined) return <PlaygroundHost name={playground} />;

  return (
    <Layout
      state={state}
      speed={speed}
      onSpeedChange={changeSpeed}
      theme={theme}
      onToggleTheme={() => setTheme(toggleTheme(theme))}
      onSelectRun={(runId) => useSky.getState().setActiveRun(runId)}
      onCloseDrawer={() => useSky.getState().selectTask()}
      onSelectTask={(key) => useSky.getState().selectTask(key)}
    />
  );
}
