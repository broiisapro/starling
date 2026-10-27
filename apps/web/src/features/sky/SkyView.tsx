import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SkyViewProps } from './handshake';
import { statusColor } from './palette';
import { createSkyRenderer, type RenderOptions, type SkyRenderer } from './render';
import { describeSky } from './replay';
import { createSky, type SkyInput, type SkySimulation } from './sim';

/**
 * The Sky: a live murmuration driven purely by `SkyViewProps` (ARCHITECTURE §8), so it works with
 * live SSE data, a replay or the recorded fixture without knowing which one it is looking at.
 *
 * - one `requestAnimationFrame` loop, paused while the tab is hidden
 * - Canvas 2D only (L11); DPR + ResizeObserver aware
 * - click the nearest flock leader to select it, hover for a tooltip, arrow keys to cycle
 * - `reducedMotion` (or `prefers-reduced-motion`) switches to a calm, static status map
 */
export function SkyView(props: SkyViewProps) {
  const { run, nodes, recent, selectedTask, onSelectTask, reducedMotion } = props;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<SkySimulation | null>(null);
  const rendererRef = useRef<SkyRenderer | null>(null);
  const optsRef = useRef<RenderOptions>({});
  const calmRef = useRef(false);
  const dirtyRef = useRef(true);
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);
  const mediaReduced = usePrefersReducedMotion();
  const calm = reducedMotion === true || mediaReduced;

  const input = useMemo<SkyInput>(
    () => ({ runId: run?.id, plan: run?.plan, tasks: run?.tasks, nodes, recent }),
    [run, nodes, recent],
  );
  const inputRef = useRef(input);
  inputRef.current = input;
  optsRef.current = { hoverKey: hover?.key, selectedKey: selectedTask };
  calmRef.current = calm;
  const summary = useMemo(() => describeSky(run, nodes), [run, nodes]);

  // ── mount: renderer + sim + the single rAF loop ───────────────────────────────────────────────
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      return {
        width: Math.max(320, Math.round(rect.width) || wrap.clientWidth || 720),
        height: Math.max(220, Math.round(rect.height) || wrap.clientHeight || 420),
      };
    };

    const renderer = createSkyRenderer(canvas);
    rendererRef.current = renderer;
    const size = measure();
    const sim = createSky({ width: size.width, height: size.height, seed: 0x5eed });
    simRef.current = sim;
    renderer.resize(
      size.width,
      size.height,
      typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
    );
    if (inputRef.current) sim.setInput(inputRef.current);
    sim.setReducedMotion(calmRef.current);
    dirtyRef.current = true;

    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let fpsAt = last;
    const dev = import.meta.env.DEV;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (typeof document !== 'undefined' && document.hidden) return;
      const currentSim = simRef.current;
      const currentRenderer = rendererRef.current;
      if (!currentSim || !currentRenderer) return;
      if (calmRef.current && !dirtyRef.current) return;
      if (!calmRef.current) currentSim.step(dt);
      currentRenderer.draw(currentSim, optsRef.current);
      dirtyRef.current = false;

      frames += 1;
      if (dev && now - fpsAt >= 5000) {
        const fps = Math.round((frames * 1000) / (now - fpsAt));
        wrap.dataset.fps = String(fps);
        // Dev-only estimate; never runs in a production build.
        console.debug(`[sky] ~${fps} fps · ${currentSim.flocks.length} flocks`);
        frames = 0;
        fpsAt = now;
      }
    };
    raf = requestAnimationFrame(loop);

    const handleResize = () => {
      const next = measure();
      renderer.resize(
        next.width,
        next.height,
        typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
      );
      sim.resize(next.width, next.height);
      dirtyRef.current = true;
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null;
    observer?.observe(wrap);
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      rendererRef.current = null;
      simRef.current = null;
    };
  }, []);

  // ── props → sim ───────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.setInput(input);
    sim.setReducedMotion(calm);
    dirtyRef.current = true;
  }, [input, calm]);

  // Hover / selection change the overlay, which the calm (no-loop) renderer only redraws on demand.
  // A ref comparison during render is cheaper than an effect and keeps the loop free of extra deps.
  const overlayStamp = `${hover?.key ?? ''}|${selectedTask ?? ''}|${hover ? hover.x : 0}`;
  const overlayStampRef = useRef(overlayStamp);
  if (overlayStampRef.current !== overlayStamp) {
    overlayStampRef.current = overlayStamp;
    dirtyRef.current = true;
  }

  // ── interaction ───────────────────────────────────────────────────────────────────────────────
  const toSky = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const sim = simRef.current;
    const width = sim?.width ?? rect.width;
    const height = sim?.height ?? rect.height;
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    return {
      x: rect.width > 0 ? (localX / rect.width) * width : localX,
      y: rect.height > 0 ? (localY / rect.height) * height : localY,
      localX,
      localY,
    };
  }, []);

  const handleMove = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const sim = simRef.current;
      if (!sim) return;
      const point = toSky(event);
      const key = sim.hitTest(point.x, point.y, 54);
      setHover((previous) => {
        if (!key) return previous === null ? previous : null;
        if (
          previous &&
          previous.key === key &&
          Math.abs(previous.x - point.localX) < 6 &&
          Math.abs(previous.y - point.localY) < 6
        ) {
          return previous;
        }
        return { key, x: point.localX, y: point.localY };
      });
    },
    [toSky],
  );

  const handleLeave = useCallback(() => setHover(null), []);

  const handleClick = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const sim = simRef.current;
      if (!sim) return;
      const point = toSky(event);
      const key = sim.hitTest(point.x, point.y, 54);
      if (key) onSelectTask(key);
    },
    [onSelectTask, toSky],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLCanvasElement>) => {
      const sim = simRef.current;
      if (!sim || sim.flocks.length === 0) return;
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const keys = sim.flocks.map((flock) => flock.taskKey);
      const current = selectedTask ? keys.indexOf(selectedTask) : -1;
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      const next = keys[(current + delta + keys.length) % keys.length];
      if (next) onSelectTask(next);
    },
    [onSelectTask, selectedTask],
  );

  const hoveredTask = hover ? run?.tasks[hover.key] : undefined;
  const hoveredSpec = hover ? run?.plan?.tasks.find((task) => task.key === hover.key) : undefined;
  const hoveredNode = hoveredTask?.nodeId ? nodes.find((node) => node.id === hoveredTask.nodeId) : undefined;

  return (
    <div
      ref={wrapRef}
      data-testid="sky-view"
      role="application"
      aria-roledescription="task murmuration"
      aria-label={summary}
      style={WRAP_STYLE}
    >
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label="Task murmuration canvas. Use the left and right arrow keys to select a task."
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={{ ...CANVAS_STYLE, cursor: hover ? 'pointer' : 'default' }}
      />
      {hover && hoveredTask ? (
        <div style={{ ...TOOLTIP_STYLE, left: Math.min(hover.x + 14, 260), top: Math.max(8, hover.y - 54) }}>
          <div style={TOOLTIP_TITLE}>{hoveredSpec?.title ?? hover.key}</div>
          <div style={TOOLTIP_LINE}>
            <span style={{ color: statusColor(hoveredTask.status) }}>{hoveredTask.status}</span>
            {hoveredNode ? <span style={TOOLTIP_MUTED}>· {hoveredNode.name}</span> : null}
            <span style={TOOLTIP_MUTED}>
              · attempt {hoveredTask.attempts} · {hover.key}
            </span>
          </div>
        </div>
      ) : null}
      <div aria-live="polite" aria-atomic="true" style={SR_ONLY}>
        {summary}
      </div>
    </div>
  );
}

// ── reduced motion ──────────────────────────────────────────────────────────────────────────────
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function usePrefersReducedMotion(): boolean {
  const [prefers, setPrefers] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setPrefers(query.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return prefers;
}

// ── styles ──────────────────────────────────────────────────────────────────────────────────────
const WRAP_STYLE: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: 240,
  overflow: 'hidden',
  background: '#070d1c',
};

const CANVAS_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'block',
  width: '100%',
  height: '100%',
  outline: 'none',
};

const TOOLTIP_STYLE: CSSProperties = {
  position: 'absolute',
  pointerEvents: 'none',
  maxWidth: 280,
  padding: '6px 9px',
  borderRadius: 6,
  border: '1px solid rgba(160, 196, 255, 0.22)',
  background: 'rgba(6, 11, 24, 0.92)',
  color: '#dbe7ff',
  font: '11px ui-monospace, SFMono-Regular, Menlo, monospace',
  lineHeight: 1.45,
  boxShadow: '0 6px 20px rgba(0, 0, 0, 0.35)',
};

const TOOLTIP_TITLE: CSSProperties = { fontWeight: 600, marginBottom: 2 };
const TOOLTIP_LINE: CSSProperties = { display: 'flex', gap: 4, flexWrap: 'wrap' };
const TOOLTIP_MUTED: CSSProperties = { color: '#8fa2b8' };

const SR_ONLY: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};
