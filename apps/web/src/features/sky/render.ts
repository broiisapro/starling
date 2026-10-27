/**
 * Canvas 2D rendering for the Sky. One `SkyRenderer` owns three surfaces:
 *
 * 1. the visible canvas (devicePixelRatio aware),
 * 2. an offscreen dusk gradient + stars painted **once per resize**,
 * 3. an offscreen motion-trail layer that is faded by a `destination-out` wash every frame and then
 *    composited over the gradient — so birds leave soft trails without smearing the wire or labels.
 *
 * The hot loop allocates nothing per bird: colours are pre-blended strings, paths are rebuilt in
 * place and there is one `requestAnimationFrame` in the component, not here. The few gradients that
 * do get created each frame (a busy roost glow, the final sweep) are bounded by the number of
 * machines, not birds.
 *
 * Epic 47 added the projector-sized roost plates, the join ripple + captions, work sparks, wire
 * labels with landing shimmers, and the all-landed sweep.
 */
import { MAX_SPARKS, noticeAlpha, noticeText, RIPPLE_LIFE, type RoostNotice, SPARK_LIFE } from './cues';
import { GAUGE_BASELINE, LABEL_BASELINE, type Roost, roostLabelFont } from './layout';
import { SKY_COLORS, STATUS_SHEEN } from './palette';
import { LANDING_SHIMMER, mulberry32, type SkySimulation } from './sim';

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
const FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, monospace';
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
      if (tctx) {
        // A blurred additive copy of the bird layer first: every flock reads as a soft glow.
        ctx2.save();
        ctx2.globalCompositeOperation = 'lighter';
        ctx2.globalAlpha = 0.55;
        ctx2.filter = `blur(${Math.round(4 * dpr)}px)`;
        ctx2.drawImage(trail, 0, 0);
        ctx2.restore();
        ctx2.drawImage(trail, 0, 0);
      }
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2.textBaseline = 'alphabetic';

      drawWire(ctx2, sim);
      for (const roost of sim.roosts) drawRoost(ctx2, roost, sim.height, sim.reducedMotion);
      drawWireLabels(ctx2, sim, sim.reducedMotion);
      // Calm mode is a static status map: no sweeping crests, sparks, beats or ripples.
      if (!sim.reducedMotion) {
        drawSweep(ctx2, sim);
        drawSparks(ctx2, sim);
        drawBeats(ctx2, sim);
      }
      drawMigrationTrails(ctx2, sim);
      drawHalo(ctx2, sim, opts);
      drawHoverLabel(ctx2, sim, opts);
      drawNotices(ctx2, sim);
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
      const size = 3.05 + (j % 3) * 0.6;
      const noseX = px + 0.9 * size * s;
      const noseY = py + -0.9 * size * c;
      const lwx = px + -1 * size * c - 1.15 * size * s;
      const lwy = py + -1 * size * s + 1.15 * size * c;
      const rwx = px + 1 * size * c - 1.15 * size * s;
      const rwy = py + 1 * size * s + 1.15 * size * c;

      ctx.strokeStyle = sheen[(i + j + sheenTick) % sheen.length] ?? SKY_COLORS.stars;
      ctx.globalAlpha = flock.alpha * (j % 5 === 0 ? 0.72 : 1);
      ctx.lineWidth = j % 4 === 0 ? 1.7 : 1.25;
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

/**
 * A roost reads, from top to bottom: busy glow, branch, a dark glass plate with the machine name
 * (projector-sized type, hub crown), and the sessions gauge (`3/5` + pips). A joining roost rises
 * out of the horizon with two ripples; a leaving one dims and its caption fades under the gauge.
 */
function drawRoost(ctx: CanvasRenderingContext2D, roost: Roost, skyHeight: number, still: boolean): void {
  const grow = roost.grow;
  const rise = (1 - grow) * 46;
  const y = roost.y + rise;
  const alpha = Math.min(1, 0.2 + roost.dim * 0.8);
  const half = (roost.width * (0.55 + 0.45 * grow)) / 2;
  const labelPx = roostLabelFont(skyHeight);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Gentle glow when the machine is busy.
  if (roost.busy > 0.02 && grow > 0.2) {
    const radius = roost.width * 1.1;
    const glow = ctx.createRadialGradient(roost.x, y - 10, 6, roost.x, y - 10, radius);
    glow.addColorStop(0, `rgba(120, 220, 255, ${0.3 * roost.busy * grow})`);
    glow.addColorStop(1, 'rgba(120, 220, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(roost.x - radius, y - radius, radius * 2, radius * 1.6);
  }

  // Join ripple: two rings expanding out of the branch, fading as they go.
  if (!still && roost.ripple >= 0) {
    const p = Math.min(1, roost.ripple / RIPPLE_LIFE);
    for (const lag of [0, 0.22]) {
      const q = p - lag;
      if (q <= 0) continue;
      ctx.globalAlpha = alpha * (1 - q) * 0.5;
      ctx.strokeStyle = SKY_COLORS.glow;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(roost.x, y + 2, 12 + q * roost.width * 1.25, 6 + q * 26, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = alpha;
  }

  // The branch: a shallow arch with three twigs, silhouetted against the dusk.
  ctx.strokeStyle = SKY_COLORS.roost;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(roost.x - half, y + 12);
  ctx.quadraticCurveTo(roost.x, y - 6, roost.x + half, y + 6);
  ctx.stroke();
  ctx.strokeStyle = SKY_COLORS.roostRim;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(roost.x - half, y + 12);
  ctx.quadraticCurveTo(roost.x, y - 6, roost.x + half, y + 6);
  ctx.stroke();

  ctx.strokeStyle = SKY_COLORS.roost;
  ctx.lineWidth = 2.4;
  for (const [fx, fy] of [
    [-0.45, -4],
    [0.05, 2],
    [0.5, -2],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(roost.x + half * fx, y + fy + 2);
    ctx.lineTo(roost.x + half * fx + 6, y + fy - 12);
    ctx.stroke();
  }

  if (grow < 1) {
    ctx.shadowColor = SKY_COLORS.glow;
    ctx.shadowBlur = 16 * (1 - grow);
  }

  // Name plate.
  ctx.font = `600 ${labelPx}px ${FONT_FAMILY}`;
  const maxText = Math.max(40, roost.width - (roost.isHub ? labelPx : 0) - 18);
  const label = fitText(ctx, roost.name, maxText);
  const textW = ctx.measureText(label).width;
  const crownW = roost.isHub ? labelPx * 0.95 : 0;
  const plateW = Math.min(roost.width + 26, textW + crownW + 18);
  const plateX = roost.x - plateW / 2;
  const plateY = y + LABEL_BASELINE - labelPx * 0.86;
  const plateH = labelPx * 1.5;
  ctx.shadowBlur = 0;
  ctx.fillStyle = SKY_COLORS.plate;
  ctx.strokeStyle = SKY_COLORS.plateRim;
  ctx.lineWidth = 1;
  roundedRect(ctx, plateX, plateY, plateW, plateH, 5);
  ctx.fill();
  ctx.stroke();

  const contentX = roost.x - (textW + crownW) / 2;
  if (roost.isHub) drawCrown(ctx, contentX, y + LABEL_BASELINE, labelPx * 0.66);
  ctx.fillStyle = SKY_COLORS.roostName;
  ctx.fillText(label, contentX + crownW, y + LABEL_BASELINE);

  // Sessions gauge: pips plus a "3/5" readout, small but legible under the plate.
  const gaugePx = Math.max(10, Math.round(labelPx * 0.56));
  ctx.font = `500 ${gaugePx}px ${FONT_FAMILY}`;
  const gaugeText = `${roost.activeSessions}/${roost.maxSessions}`;
  const textWidth = ctx.measureText(gaugeText).width;
  const pips = Math.max(1, Math.min(12, roost.maxSessions));
  const pipGap = gaugePx * 0.9;
  const totalW = pips * pipGap + 8 + textWidth;
  const gx = roost.x - totalW / 2;
  const gy = y + GAUGE_BASELINE - gaugePx * 0.3;
  for (let i = 0; i < pips; i++) {
    ctx.beginPath();
    ctx.fillStyle = i < roost.activeSessions ? SKY_COLORS.crown : SKY_COLORS.roostGauge;
    ctx.globalAlpha = alpha * (i < roost.activeSessions ? 0.95 : 0.32);
    ctx.arc(gx + i * pipGap + pipGap * 0.4, gy, Math.max(1.8, gaugePx * 0.22), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = SKY_COLORS.roostGauge;
  ctx.fillText(gaugeText, gx + pips * pipGap + 8, y + GAUGE_BASELINE);

  ctx.restore();
  ctx.globalAlpha = 1;

  // The local "has flown away" caption (the top toast is for joins/finishes; this one stays home).
  if (roost.left >= 0) {
    const fade = Math.max(0, 1 - roost.left / 3.8);
    if (fade > 0.01) {
      const captionPx = Math.max(10, Math.round(labelPx * 0.56));
      ctx.save();
      ctx.globalAlpha = fade * 0.8;
      ctx.font = `500 ${captionPx}px ${FONT_FAMILY}`;
      ctx.fillStyle = SKY_COLORS.roostGauge;
      const text = fitText(ctx, `${roost.name} has flown away`, roost.width + 60);
      const textWidth = ctx.measureText(text).width;
      ctx.fillText(text, roost.x - textWidth / 2, y + GAUGE_BASELINE + 16);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

/** Small hand-drawn crown: three points and a base, gold, to the left of the hub's name. */
function drawCrown(ctx: CanvasRenderingContext2D, x: number, baseline: number, size: number): void {
  const w = size * 1.15;
  const h = size * 0.8;
  ctx.beginPath();
  ctx.moveTo(x, baseline);
  ctx.lineTo(x, baseline - h * 0.7);
  ctx.lineTo(x + w * 0.28, baseline - h * 0.22);
  ctx.lineTo(x + w * 0.5, baseline - h);
  ctx.lineTo(x + w * 0.72, baseline - h * 0.22);
  ctx.lineTo(x + w, baseline - h * 0.7);
  ctx.lineTo(x + w, baseline);
  ctx.closePath();
  ctx.fillStyle = SKY_COLORS.crown;
  ctx.fill();
}

function drawWireLabels(ctx: CanvasRenderingContext2D, sim: SkySimulation, still: boolean): void {
  const merged = sim.flocks.filter((flock) => flock.status === 'merged');
  if (merged.length === 0) return;
  const span = Math.max(20, sim.wire.right - sim.wire.left - 104);
  const slot = span / Math.max(1, merged.length);
  const fontPx = Math.max(9, Math.min(13, Math.round(sim.height * 0.014)));
  ctx.font = `600 ${fontPx}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';

  for (const flock of merged) {
    const x = flock.leaderX;
    const y = sim.wire.yAt(x);
    // Only a real landing (a live status change) shimmers; a reconnect mid-run does not.
    const landing = !still && flock.landedSeq > 0 ? flock.statusTime / LANDING_SHIMMER : 1;
    const label = fitText(ctx, flock.taskKey, Math.max(24, slot - 6));
    if (landing < 1) {
      // Celebratory shimmer: an expanding ring plus a bright flash behind the key.
      const pulse = 1 - landing;
      ctx.globalAlpha = pulse * 0.75;
      ctx.strokeStyle = SKY_COLORS.shimmer;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(x, y - 5, 8 + landing * 26, 0, Math.PI * 2);
      ctx.stroke();
      const w = ctx.measureText(label).width + 8;
      ctx.globalAlpha = pulse * 0.25;
      ctx.fillStyle = SKY_COLORS.shimmer;
      ctx.fillRect(x - w / 2, y + fontPx * 0.2, w, fontPx * 1.35);
    }
    ctx.globalAlpha = 0.72 + (landing < 1 ? 0.28 * (1 - landing) : 0);
    ctx.fillStyle = SKY_COLORS.wireLabel;
    ctx.fillText(label, x, y + fontPx * 1.35 + 4);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'start';
}

/** The "all landed" wave: a bright crest that runs along the wire once the run finishes. */
function drawSweep(ctx: CanvasRenderingContext2D, sim: SkySimulation): void {
  const progress = sim.sweepProgress();
  if (progress < 0) return;
  const { wire } = sim;
  const x = wire.left + (wire.right - wire.left) * progress;
  const envelope = Math.sin(Math.PI * progress);
  const y = wire.yAt(x);
  const glow = ctx.createRadialGradient(x, y, 2, x, y, 58);
  glow.addColorStop(0, `rgba(200, 255, 230, ${0.55 * envelope})`);
  glow.addColorStop(1, 'rgba(200, 255, 230, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - 60, y - 60, 120, 120);
  ctx.globalAlpha = 0.6 * envelope;
  ctx.strokeStyle = SKY_COLORS.shimmer;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(x - 52 * (0.4 + progress), y - 2);
  ctx.lineTo(x, y - 2);
  ctx.stroke();
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

/** Tiny warm sparks on `file.edited`: a short streak whose length follows its velocity. */
function drawSparks(ctx: CanvasRenderingContext2D, sim: SkySimulation): void {
  const { sparks } = sim;
  ctx.strokeStyle = SKY_COLORS.spark;
  ctx.lineWidth = 1.3;
  for (let i = 0; i < MAX_SPARKS; i++) {
    const life = sparks.life[i] ?? 0;
    if (life <= 0) continue;
    const x = sparks.x[i] ?? 0;
    const y = sparks.y[i] ?? 0;
    ctx.globalAlpha = Math.min(1, (life / SPARK_LIFE) * 1.4);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - (sparks.vx[i] ?? 0) * 0.012, y - (sparks.vy[i] ?? 0) * 0.012);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** A `tool.call` beat: one expanding ring around the working flock, fading over ~0.4 s. */
function drawBeats(ctx: CanvasRenderingContext2D, sim: SkySimulation): void {
  for (const flock of sim.flocks) {
    if (flock.beat <= 0.02) continue;
    const radius = 12 + (1 - flock.beat) * 20;
    ctx.globalAlpha = flock.beat * 0.55;
    ctx.strokeStyle = flock.behaviour.tint;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(flock.leaderX, flock.leaderY, radius, 0, Math.PI * 2);
    ctx.stroke();
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

/**
 * Toast-like captions, top-centre: "🪺 MacBook Air joined the flock" and the all-landed line.
 * Leave captions are drawn at their roost instead (see `drawRoost`) so they read in context.
 */
function drawNotices(ctx: CanvasRenderingContext2D, sim: SkySimulation): void {
  const shown = sim.notices.filter((notice) => notice.kind !== 'left');
  if (shown.length === 0) return;
  const fontPx = Math.max(13, Math.min(20, Math.round(sim.height * 0.023)));
  ctx.font = `600 ${fontPx}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  shown.forEach((notice: RoostNotice, index) => {
    const alpha = noticeAlpha(notice, sim.simTime);
    if (alpha <= 0.01) return;
    const text = noticeText(notice);
    const w = ctx.measureText(text).width + fontPx * 2;
    const h = fontPx * 2;
    const x = sim.width / 2 - w / 2;
    const y = 14 + index * (h + 8);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = SKY_COLORS.toast;
    ctx.strokeStyle = SKY_COLORS.toastRim;
    ctx.lineWidth = 1;
    roundedRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = SKY_COLORS.toastText;
    ctx.fillText(text, sim.width / 2, y + h * 0.68);
  });
  ctx.globalAlpha = 1;
  ctx.textAlign = 'start';
}

/** Truncate with an ellipsis so a long machine name never overruns its roost plate. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1) {
    const candidate = `${text.slice(0, end)}…`;
    if (ctx.measureText(candidate).width <= maxWidth) return candidate;
    end--;
  }
  return text.slice(0, 1);
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
