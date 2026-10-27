/**
 * Canvas 2D rendering for the Sky. One `SkyRenderer` owns three surfaces:
 *
 * 1. the visible canvas (devicePixelRatio aware),
 * 2. an offscreen dusk gradient + stars painted **once per resize**,
 * 3. an offscreen motion-trail layer that is faded by a `destination-out` wash every frame and then
 *    composited over the gradient — so birds leave soft trails without smearing the wire or labels.
 *
 * The hot loop allocates nothing: bird colours are pre-blended strings, paths are rebuilt in place
 * and there is one `requestAnimationFrame` in the component, not here.
 */
import { SKY_COLORS, STATUS_SHEEN } from './palette';
import { mulberry32, type SkySimulation } from './sim';

export interface RenderOptions {
  hoverKey?: string;
  selectedKey?: string;
}

export interface SkyRenderer {
  resize(width: number, height: number, dpr: number): void;
  draw(sim: SkySimulation, opts?: RenderOptions): void;
  dispose(): void;
}

const FONT_MONO = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
const FONT_LABEL = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
const TRAIL_FADE = 'rgba(0, 0, 0, 0.34)';
const HOVER_BG = 'rgba(6, 11, 24, 0.86)';
const HOVER_TEXT = '#dbe7ff';
const TRAIL_COLOR = 'rgba(170, 214, 255, 1)';

export function createSkyRenderer(canvas: HTMLCanvasElement): SkyRenderer {
  let ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let dpr = 1;

  const background = document.createElement('canvas');
  const trail = document.createElement('canvas');
  let bgCtx: CanvasRenderingContext2D | null = null;
  let trailCtx: CanvasRenderingContext2D | null = null;

  function paintBackground(): void {
    if (!bgCtx) return;
    const g = bgCtx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, SKY_COLORS.zenith);
    g.addColorStop(0.45, SKY_COLORS.midSky);
    g.addColorStop(0.78, SKY_COLORS.horizon);
    g.addColorStop(1, SKY_COLORS.ember);
    bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    bgCtx.fillStyle = g;
    bgCtx.fillRect(0, 0, width * dpr, height * dpr);

    // A deterministic star field: same sky every reload, no flicker, ~120 dots.
    const rng = mulberry32(0x5c1e5);
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let i = 0; i < 120; i++) {
      const sx = rng() * width;
      const sy = rng() * height * 0.62;
      const a = 0.12 + rng() * 0.5;
      bgCtx.fillStyle = SKY_COLORS.stars;
      bgCtx.globalAlpha = a;
      const s = rng() > 0.92 ? 1.6 : 1;
      bgCtx.fillRect(sx, sy, s, s);
    }
    bgCtx.globalAlpha = 1;

    // A soft horizon glow behind the roosts.
    const glow = bgCtx.createLinearGradient(0, height * 0.62, 0, height);
    glow.addColorStop(0, 'rgba(255, 160, 120, 0)');
    glow.addColorStop(1, 'rgba(255, 150, 110, 0.10)');
    bgCtx.fillStyle = glow;
    bgCtx.fillRect(0, height * 0.6, width, height * 0.4);
  }

  return {
    resize(nextWidth: number, nextHeight: number, nextDpr: number): void {
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      dpr = Math.max(1, Math.min(3, nextDpr));
      const deviceW = Math.round(width * dpr);
      const deviceH = Math.round(height * dpr);
      canvas.width = deviceW;
      canvas.height = deviceH;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      background.width = deviceW;
      background.height = deviceH;
      trail.width = deviceW;
      trail.height = deviceH;
      ctx = canvas.getContext('2d');
      bgCtx = background.getContext('2d');
      trailCtx = trail.getContext('2d');
      if (trailCtx) trailCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintBackground();
    },

    draw(sim: SkySimulation, opts: RenderOptions = {}): void {
      if (!ctx) return;
      const ctx2 = ctx;
      const tctx = trailCtx;

      // 1. fade the trail layer, then draw this frame's birds into it.
      if (tctx) {
        tctx.setTransform(1, 0, 0, 1, 0, 0);
        tctx.globalCompositeOperation = 'destination-out';
        tctx.fillStyle = TRAIL_FADE;
        tctx.fillRect(0, 0, trail.width, trail.height);
        tctx.globalCompositeOperation = 'source-over';
        tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawBirds(tctx, sim);
      }

      // 2. background, then the trail composite, then the static chrome on top.
      ctx2.setTransform(1, 0, 0, 1, 0, 0);
      ctx2.clearRect(0, 0, canvas.width, canvas.height);
      ctx2.drawImage(background, 0, 0);
      if (tctx) ctx2.drawImage(trail, 0, 0);
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);

      drawWire(ctx2, sim);
      for (const roost of sim.roosts)
        drawRoost(ctx2, roost.x, roost.y, roost.width, roost.dim, roost.grow, roost.name);
      drawMigrationTrails(ctx2, sim);
      drawHalo(ctx2, sim, opts);
      drawHoverLabel(ctx2, sim, opts);
    },

    dispose(): void {
      ctx = null;
      bgCtx = null;
      trailCtx = null;
      background.width = 0;
      background.height = 0;
      trail.width = 0;
      trail.height = 0;
    },
  };
}

// ── birds ────────────────────────────────────────────────────────────────────────────────────────
function drawBirds(ctx: CanvasRenderingContext2D, sim: SkySimulation): void {
  const { x, y, vx, vy } = sim.birds;
  const sheenTick = Math.floor(sim.simTime * 3) % 12;

  for (const flock of sim.flocks) {
    if (flock.alpha <= 0.02) continue;
    const sheen = STATUS_SHEEN[flock.status];
    const base = flock.birdOffset;
    const still = flock.behaviour.kind === 'perched' || flock.behaviour.kind === 'wirePerch';
    for (let j = 0; j < flock.birds; j++) {
      const i = base + j;
      const px = x[i] ?? 0;
      const py = y[i] ?? 0;
      const bvx = vx[i] ?? 0;
      const bvy = vy[i] ?? 0;
      const speed = Math.sqrt(bvx * bvx + bvy * bvy);
      const angle = speed > 2.5 ? Math.atan2(bvy, bvx) + Math.PI / 2 : still ? 0 : 0.35;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const size = 2.5 + (j % 3) * 0.55;
      const noseX = px + 0.9 * size * s;
      const noseY = py + -0.9 * size * c;
      const lwx = px + -1 * size * c - 1.15 * size * s;
      const lwy = py + -1 * size * s + 1.15 * size * c;
      const rwx = px + 1 * size * c - 1.15 * size * s;
      const rwy = py + 1 * size * s + 1.15 * size * c;

      ctx.strokeStyle = sheen[(i + j + sheenTick) % sheen.length] ?? SKY_COLORS.stars;
      ctx.globalAlpha = flock.alpha * (j % 5 === 0 ? 0.72 : 1);
      ctx.lineWidth = j % 4 === 0 ? 1.5 : 1.1;
      ctx.beginPath();
      ctx.moveTo(lwx, lwy);
      ctx.lineTo(noseX, noseY);
      ctx.lineTo(rwx, rwy);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// ── scenery ─────────────────────────────────────────────────────────────────────────────────────
function drawWire(ctx: CanvasRenderingContext2D, sim: SkySimulation): void {
  const { wire } = sim;
  ctx.strokeStyle = SKY_COLORS.wire;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(wire.left, wire.yAt(wire.left));
  const step = Math.max(10, (wire.right - wire.left) / 40);
  for (let x = wire.left + step; x <= wire.right; x += step) ctx.lineTo(x, wire.yAt(x));
  ctx.lineTo(wire.right, wire.yAt(wire.right));
  ctx.stroke();

  // Anchor knots.
  ctx.fillStyle = SKY_COLORS.wireLabel;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(wire.left - 1.5, wire.anchorY - 1.5, 3, 3);
  ctx.fillRect(wire.right - 1.5, wire.anchorY - 1.5, 3, 3);
  ctx.globalAlpha = 1;

  ctx.font = FONT_MONO;
  ctx.fillStyle = SKY_COLORS.wireLabel;
  ctx.globalAlpha = 0.75;
  ctx.fillText('main', wire.left + 14, wire.yAt(wire.left) - 8);
  ctx.globalAlpha = 1;
}

function drawRoost(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  dim: number,
  grow: number,
  name: string,
): void {
  const half = (width * (0.55 + 0.45 * grow)) / 2;
  ctx.save();
  ctx.globalAlpha = Math.min(1, 0.25 + dim * 0.75);
  if (grow < 1) {
    ctx.shadowColor = 'rgba(150, 210, 255, 0.55)';
    ctx.shadowBlur = 16 * (1 - grow);
  }

  // The branch: a shallow arch with three twigs, silhouetted against the dusk.
  ctx.strokeStyle = SKY_COLORS.roost;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - half, y + 12);
  ctx.quadraticCurveTo(x, y - 6, x + half, y + 6);
  ctx.stroke();
  ctx.strokeStyle = SKY_COLORS.roostRim;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - half, y + 12);
  ctx.quadraticCurveTo(x, y - 6, x + half, y + 6);
  ctx.stroke();

  ctx.strokeStyle = SKY_COLORS.roost;
  ctx.lineWidth = 2.4;
  for (const [fx, fy] of [
    [-0.45, -4],
    [0.05, 2],
    [0.5, -2],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x + half * fx, y + fy + 2);
    ctx.lineTo(x + half * fx + 6, y + fy - 12);
    ctx.stroke();
  }
  ctx.restore();

  // Label under the branch, generous letter spacing via a manual loop is unnecessary at 9px.
  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = SKY_COLORS.label;
  ctx.globalAlpha = 0.35 + dim * 0.55;
  const label = name.length > 20 ? `${name.slice(0, 19)}…` : name;
  ctx.fillText(label, x - ctx.measureText(label).width / 2, y + 26);
  ctx.globalAlpha = 1;
}

function drawMigrationTrails(ctx: CanvasRenderingContext2D, sim: SkySimulation): void {
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = TRAIL_COLOR;
  for (const flock of sim.flocks) {
    if (flock.trailLen < 2) continue;
    const cap = flock.trailLen;
    for (let i = 1; i < cap; i++) {
      const x0 = flock.trail[(i - 1) * 2] ?? 0;
      const y0 = flock.trail[(i - 1) * 2 + 1] ?? 0;
      const x1 = flock.trail[i * 2] ?? 0;
      const y1 = flock.trail[i * 2 + 1] ?? 0;
      ctx.globalAlpha = (i / cap) * 0.45;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawHalo(ctx: CanvasRenderingContext2D, sim: SkySimulation, opts: RenderOptions): void {
  const selected = opts.selectedKey ? sim.findFlock(opts.selectedKey) : undefined;
  if (!selected) return;
  const pulse = 0.75 + 0.25 * Math.sin(sim.simTime * 2.6);
  ctx.globalAlpha = 0.5 * pulse;
  ctx.strokeStyle = selected.behaviour.tint;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(selected.leaderX, selected.leaderY, 34 + Math.sin(sim.simTime * 1.7) * 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.16 * pulse;
  ctx.fillStyle = selected.behaviour.tint;
  ctx.beginPath();
  ctx.arc(selected.leaderX, selected.leaderY, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawHoverLabel(ctx: CanvasRenderingContext2D, sim: SkySimulation, opts: RenderOptions): void {
  const hovered = opts.hoverKey ? sim.findFlock(opts.hoverKey) : undefined;
  if (!hovered) return;
  const label = hovered.taskKey;
  ctx.font = FONT_LABEL;
  const w = ctx.measureText(label).width + 14;
  const x = hovered.leaderX - w / 2;
  const y = hovered.leaderY - 46;
  ctx.fillStyle = HOVER_BG;
  ctx.strokeStyle = hovered.behaviour.tint;
  ctx.lineWidth = 1;
  roundedRect(ctx, x, y, w, 20, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = HOVER_TEXT;
  ctx.fillText(label, x + 7, y + 14);
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
