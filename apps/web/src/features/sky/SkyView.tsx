import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SkyViewProps } from './handshake';
import { statusColor } from './palette';
import { createSkyRenderer, type RenderOptions, type SkyRenderer } from './render';
import { describeSky } from './replay';
import { createSky, type SkyInput, type SkySimulation } from './sim';
import { createSkyAudio, readSoundEnabled, type SkyAudio, writeSoundEnabled } from './sound';

/**
 * The Sky: a live murmuration driven purely by `SkyViewProps` (ARCHITECTURE §8), so it works with
 * live SSE data, a replay or the recorded fixture without knowing which one it is looking at.
 *
 * - one `requestAnimationFrame` loop, paused while the tab is hidden or `paused` is true
 * - Canvas 2D only (L11); DPR + ResizeObserver aware
 * - click the nearest flock leader to select it, hover for a tooltip, arrow keys to cycle
 * - `reducedMotion` (or `prefers-reduced-motion`) switches to a calm, static status map
 * - optional WebAudio soundscape (off by default, remembered per viewer) with a toggle
 *
 * Epic 47: the loop's cues feed the sound engine; `paused` stops and resumes it without a time jump.
 */
export function SkyView(props: SkyViewProps) {
  const {
    run,
    nodes,
    recent,
    selectedTask,
    onSelectTask,
    reducedMotion,
    paused = false,
    onFps,
    createAudio,
  } = props;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<SkySimulation | null>(null);
  const rendererRef = useRef<SkyRenderer | null>(null);
  const optsRef = useRef<RenderOptions>({});
  const calmRef = useRef(false);
  const pausedRef = useRef(paused);
  const dirtyRef = useRef(true);
  const drawOnceRef = useRef<(() => void) | null>(null);
  const loopRef = useRef<((now: number) => void) | null>(null);
  const rafRef = useRef(0);
  const fpsRef = useRef(onFps);
  fpsRef.current = onFps;
  const audioRef = useRef<SkyAudio | null>(null);
  const makeAudioRef = useRef(createAudio);
  makeAudioRef.current = createAudio;
  const [soundOn, setSoundOn] = useState(() => readSoundEnabled());
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);
  const mediaReduced = usePrefersReducedMotion();
  const calm = reducedMotion === true || mediaReduced;

  const input = useMemo<SkyInput>(
    () => ({
      runId: run?.id,
      plan: run?.plan,
      tasks: run?.tasks,
      nodes,
      recent,
      status: run?.status,
    }),
    [run, nodes, recent],
  );
  const inputRef = useRef(input);
  inputRef.current = input;
  optsRef.current = { hoverKey: hover?.key, selectedKey: selectedTask };
  calmRef.current = calm;
  pausedRef.current = paused;
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

    const drawOnce = () => {
      const currentSim = simRef.current;
      const currentRenderer = rendererRef.current;
      if (!currentSim || !currentRenderer) return;
      currentRenderer.draw(currentSim, optsRef.current);
      dirtyRef.current = false;
    };
    drawOnceRef.current = drawOnce;

    let last = performance.now();
    let frames = 0;
    let fpsAt = last;
    let humAt = 0;
    const dev = import.meta.env.DEV;

    const loop = (now: number) => {
      if (pausedRef.current) {
        // Stop scheduling entirely: a paused Sky costs nothing (and `rafRef` marks it stopped).
        rafRef.current = 0;
        last = now;
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
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

      // Sound cues are drained every frame even when muted, so nothing piles up.
      const cues = currentSim.drainAudioCues();
      const audio = audioRef.current;
      if (audio?.enabled) {
        if (cues.landings > 0) audio.cue('landing', cues.landings);
        if (cues.migrations > 0) audio.cue('migration');
        if (cues.joins > 0) audio.cue('join');
      }
      if (now - humAt > 250) {
        audio?.setHum(currentSim.workingFraction());
        humAt = now;
      }

      frames += 1;
      if (now - fpsAt >= 1000) {
        const fps = Math.round((frames * 1000) / (now - fpsAt));
        wrap.dataset.fps = String(fps);
        fpsRef.current?.(fps);
        // Dev-only estimate; never logs in a production build.
        if (dev) console.debug(`[sky] ~${fps} fps · ${currentSim.flocks.length} flocks`);
        frames = 0;
        fpsAt = now;
      }
    };
    loopRef.current = loop;
    if (!pausedRef.current) rafRef.current = requestAnimationFrame(loop);
    else drawOnce();

    const handleResize = () => {
      const next = measure();
      renderer.resize(
        next.width,
        next.height,
        typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
      );
      sim.resize(next.width, next.height);
      dirtyRef.current = true;
      if (pausedRef.current) drawOnce();
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null;
    observer?.observe(wrap);
    window.addEventListener('resize', handleResize);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      loopRef.current = null;
      drawOnceRef.current = null;
      observer?.disconnect();
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      rendererRef.current = null;
      simRef.current = null;
    };
  }, []);

  // ── paused (Epic 40's optional prop): stop the loop, keep the last frame ───────────────────────
  useEffect(() => {
    pausedRef.current = paused;
    if (paused) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      drawOnceRef.current?.();
      return;
    }
    if (loopRef.current && rafRef.current === 0) {
      rafRef.current = requestAnimationFrame(loopRef.current);
    }
  }, [paused]);

  // ── props → sim ───────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.setInput(input);
    sim.setReducedMotion(calm);
    dirtyRef.current = true;
    if (pausedRef.current) drawOnceRef.current?.();
  }, [input, calm]);

  // Hover / selection change the overlay, which the calm (no-loop) renderer only redraws on demand.
  // A ref comparison during render is cheaper than an effect and keeps the loop free of extra deps.
  const overlayStamp = `${hover?.key ?? ''}|${selectedTask ?? ''}|${hover ? hover.x : 0}`;
  const overlayStampRef = useRef(overlayStamp);
  if (overlayStampRef.current !== overlayStamp) {
    overlayStampRef.current = overlayStamp;
    dirtyRef.current = true;
  }

  // ── sound ─────────────────────────────────────────────────────────────────────────────────────
  const toggleSound = useCallback(() => {
    const next = !soundOnRef.current;
    writeSoundEnabled(next);
    if (!next) {
      audioRef.current?.setEnabled(false);
      setSoundOn(false);
      return;
    }
    const audio = audioRef.current ?? makeAudioRef.current?.() ?? createSkyAudio();
    audioRef.current = audio;
    if (!audio.setEnabled(true)) {
      // WebAudio is unavailable (or blocked): keep the toggle honest and silent.
      setSoundOn(false);
      return;
    }
    audio.resume();
    setSoundOn(true);
  }, []);

  // A persisted "on" preference needs a gesture before the browser lets audio start.
  useEffect(() => {
    if (!soundOn) return;
    const audio = audioRef.current ?? makeAudioRef.current?.() ?? createSkyAudio();
    audioRef.current = audio;
    if (!audio.enabled && !audio.setEnabled(true)) return;
    const resume = () => audio.resume();
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    return () => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
  }, [soundOn]);

  useEffect(() => () => audioRef.current?.dispose(), []);

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
      <div className="sky-vignette" aria-hidden="true" />
      <button
        type="button"
        onClick={toggleSound}
        aria-pressed={soundOn}
        aria-label={soundOn ? 'Mute the sky' : 'Play sky sounds'}
        title={soundOn ? 'Soundscape on (chirps on landing, whoosh on migration)' : 'Soundscape off'}
        style={{ ...SOUND_BUTTON, opacity: soundOn ? 1 : 0.72 }}
      >
        <span aria-hidden="true" style={soundOn ? SOUND_DOT_ON : SOUND_DOT_OFF} />
        <span style={SOUND_LABEL}>{soundOn ? 'sound on' : 'sound off'}</span>
      </button>
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

const SOUND_BUTTON: CSSProperties = {
  position: 'absolute',
  top: 10,
  right: 10,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 9px',
  borderRadius: 999,
  border: '1px solid rgba(160, 196, 255, 0.28)',
  background: 'rgba(6, 12, 24, 0.78)',
  color: '#dbe7ff',
  font: '600 11px ui-monospace, SFMono-Regular, Menlo, monospace',
  cursor: 'pointer',
  zIndex: 2,
};

const SOUND_LABEL: CSSProperties = { letterSpacing: 0.3 };

const SOUND_DOT_ON: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: 999,
  background: '#7cf5d0',
  boxShadow: '0 0 8px rgba(124, 245, 208, 0.75)',
};

const SOUND_DOT_OFF: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: 999,
  border: '1px solid #8fa2b8',
  background: 'transparent',
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
