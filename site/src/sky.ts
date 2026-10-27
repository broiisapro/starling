/**
 * The hero murmuration, rendered on a Canvas 2D.
 *
 * This file is the only DOM-aware part of the sky: it sizes the canvas, caches the static dusk
 * backdrop (gradient, stars, the wire the flock lands on), runs the animation loop only while the
 * hero is on screen and the tab is visible, and paints a single still frame when the visitor asks
 * for reduced motion.
 */
import { createFlock, defaultCount, type Flock, type Point, stepFlock } from './boids.ts';

const BIRD_COLORS = ['#9df3e5', '#63d2ff', '#b18cff', '#ffd9a0', '#9be36d'] as const;
const STAR_COLORS = ['#eaf4ff', '#cfe4ff', '#b9c6ff', '#ffe6c2'] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

interface Scene {
  width: number;
  height: number;
  dpr: number;
  flock: Flock;
  background: HTMLCanvasElement;
}

/** Paint the gradient, stars and roost wires once per size change. */
function paintBackground(width: number, height: number, dpr: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const ctx = canvas.getContext('2d');
  if (ctx === null) return canvas;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#04060f');
  sky.addColorStop(0.24, '#060a18');
  sky.addColorStop(0.52, '#0a1028');
  sky.addColorStop(0.74, '#151638');
  sky.addColorStop(0.9, '#2a1a46');
  sky.addColorStop(1, '#3a243f');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const violet = ctx.createRadialGradient(
    width * 0.82,
    -height * 0.08,
    0,
    width * 0.82,
    -height * 0.08,
    Math.max(width, height) * 0.72,
  );
  violet.addColorStop(0, 'rgba(124, 92, 255, 0.26)');
  violet.addColorStop(0.55, 'rgba(70, 50, 160, 0.08)');
  violet.addColorStop(1, 'rgba(4, 6, 15, 0)');
  ctx.fillStyle = violet;
  ctx.fillRect(0, 0, width, height);

  const horizon = ctx.createRadialGradient(
    width * 0.62,
    height * 1.02,
    0,
    width * 0.62,
    height * 1.02,
    Math.max(width, height) * 0.62,
  );
  horizon.addColorStop(0, 'rgba(242, 166, 90, 0.3)');
  horizon.addColorStop(0.4, 'rgba(185, 106, 90, 0.12)');
  horizon.addColorStop(1, 'rgba(4, 6, 15, 0)');
  ctx.fillStyle = horizon;
  ctx.fillRect(0, 0, width, height);

  // Stars: denser up high, gone by the horizon.
  const random = randomFrom(0x51a7);
  const stars = Math.round(clamp((width * height) / 9000, 44, 150));
  for (let i = 0; i < stars; i += 1) {
    const x = random() * width;
    const y = random() * height * 0.66;
    const radius = 0.4 + random() * 0.9;
    const alpha = 0.12 + random() * 0.55 * (1 - y / (height * 0.8));
    ctx.fillStyle = STAR_COLORS[i % STAR_COLORS.length] ?? '#eaf4ff';
    ctx.globalAlpha = Math.max(0.05, alpha);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Two wires near the horizon: merged birds land here in the dashboard. Kept very quiet.
  if (height > 430) {
    ctx.strokeStyle = 'rgba(190, 206, 232, 0.18)';
    ctx.lineWidth = 1;
    for (const [offset, curve] of [
      [66, 14],
      [38, 8],
    ] as const) {
      const y = height - offset;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(width * 0.52, y - curve, width, y + curve * 0.4);
      ctx.stroke();
    }

    // A dozen perched silhouettes on the lower wire.
    const perches = Math.round(clamp(width / 150, 5, 12));
    ctx.strokeStyle = 'rgba(207, 228, 255, 0.42)';
    ctx.lineWidth = 1.1;
    const perchRandom = randomFrom(0x9c3b);
    for (let i = 0; i < perches; i += 1) {
      const x = width * (0.12 + perchRandom() * 0.82);
      const y = height - 38 - Math.round(perchRandom() * 3);
      ctx.beginPath();
      ctx.moveTo(x - 3.4, y);
      ctx.quadraticCurveTo(x - 1.4, y - 3.4, x, y - 0.8);
      ctx.quadraticCurveTo(x + 1.4, y - 3.4, x + 3.4, y);
      ctx.stroke();
    }
  }

  return canvas;
}

function focusFor(width: number, height: number): Point {
  // Wide screens: keep the flock to the right of the headline. Phones: centre it and let the scrim
  // carry the legibility.
  if (width >= 980) return { x: width * 0.7, y: height * 0.44 };
  if (width >= 640) return { x: width * 0.64, y: height * 0.4 };
  return { x: width * 0.56, y: height * 0.38 };
}

function drawScene(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { width, height, flock } = scene;
  ctx.drawImage(scene.background, 0, 0, width, height);

  for (let i = 0; i < flock.count; i += 1) {
    const x = flock.x[i] ?? 0;
    const y = flock.y[i] ?? 0;
    const vx = flock.vx[i] ?? 0;
    const vy = flock.vy[i] ?? 0;
    const speed = Math.hypot(vx, vy) || 1;
    const length = 2 + speed * 0.016;
    const tailX = x - (vx / speed) * length;
    const tailY = y - (vy / speed) * length;
    const color = (i % 23 === 0 ? '#ffd9a0' : BIRD_COLORS[i % BIRD_COLORS.length]) ?? '#9df3e5';
    const alpha = 0.62 + ((i * 37) % 31) / 100;

    ctx.strokeStyle = color;
    ctx.lineCap = 'round';

    ctx.globalAlpha = alpha * 0.18;
    ctx.lineWidth = 4.6;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(x, y);
    ctx.stroke();

    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1.65;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/**
 * Mount the sky on a canvas. Returns a teardown function — useful for hot reload, harmless in prod.
 */
export function mountSky(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return () => {};

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointerQuery = window.matchMedia('(pointer: fine)');
  let reducedMotion = motionQuery.matches;
  let scene: Scene | null = null;
  let frameId = 0;
  let lastFrame = 0;
  let visible = true;
  let disposed = false;
  let pointer: Point | null = null;
  let resizeQueued = false;

  const resize = (): void => {
    resizeQueued = false;
    const rect = canvas.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width < 2 || height < 2) return;
    if (scene !== null && scene.width === width && scene.height === height) return;

    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scene = {
      width,
      height,
      dpr,
      background: paintBackground(width, height, dpr),
      flock: createFlock({ width, height, count: defaultCount(width, height), seed: 0x5eed }),
    };

    if (reducedMotion) {
      drawStill();
    } else {
      draw();
    }
  };

  const queueResize = (): void => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(resize);
  };

  const draw = (): void => {
    if (scene !== null) drawScene(ctx, scene);
  };

  /** One still frame that already looks like a murmuration, not like the spawn state. */
  const drawStill = (): void => {
    if (scene === null) return;
    for (let i = 0; i < 420; i += 1) {
      stepFlock(scene.flock, 1 / 60, { focus: focusFor(scene.width, scene.height) });
    }
    draw();
  };

  const frame = (now: number): void => {
    if (disposed || reducedMotion) return;
    if (scene === null) {
      frameId = requestAnimationFrame(frame);
      return;
    }
    const dt = lastFrame === 0 ? 1 / 60 : (now - lastFrame) / 1000;
    lastFrame = now;
    stepFlock(scene.flock, dt, {
      focus: focusFor(scene.width, scene.height),
      pointer,
    });
    draw();
    frameId = requestAnimationFrame(frame);
  };

  const start = (): void => {
    if (disposed || reducedMotion || !visible || document.hidden) return;
    if (frameId !== 0) return;
    lastFrame = 0;
    frameId = requestAnimationFrame(frame);
  };

  const stop = (): void => {
    if (frameId !== 0) cancelAnimationFrame(frameId);
    frameId = 0;
    lastFrame = 0;
  };

  const sync = (): void => {
    if (reducedMotion) {
      stop();
      drawStill();
      return;
    }
    if (visible && !document.hidden) start();
    else stop();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!finePointerQuery.matches) return;
    const rect = canvas.getBoundingClientRect();
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerLeave = (): void => {
    pointer = null;
  };

  const onVisibility = (): void => {
    sync();
  };

  const onMotionChange = (): void => {
    reducedMotion = motionQuery.matches;
    sync();
  };

  const observer =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
            sync();
          },
          { threshold: 0.01 },
        );

  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(queueResize);

  resize();
  observer?.observe(canvas);
  resizeObserver?.observe(canvas);
  canvas.addEventListener('pointermove', onPointerMove, { passive: true });
  canvas.addEventListener('pointerleave', onPointerLeave, { passive: true });
  window.addEventListener('resize', queueResize, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  motionQuery.addEventListener('change', onMotionChange);
  sync();

  return () => {
    disposed = true;
    stop();
    observer?.disconnect();
    resizeObserver?.disconnect();
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    window.removeEventListener('resize', queueResize);
    document.removeEventListener('visibilitychange', onVisibility);
    motionQuery.removeEventListener('change', onMotionChange);
  };
}
