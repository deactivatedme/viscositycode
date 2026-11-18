/**
 * ViscosityCode: 2D-canvas fallback for the animated background, used when
 * WebGL2 is unavailable (or its context is lost for good). Each preset is a
 * cheap approximation of its shader — a few gradients, ~100 dots, a handful of
 * strokes — drawn at a small internal resolution and capped at 15 fps by the
 * controller. Motion uses the same seamless loop as the shaders.
 */
import type { BackgroundPreset } from "../fxSettingsStore";
import type { BackgroundBackend, BackgroundFrame } from "./backend";
import { BACKGROUND_LOOP_SECONDS } from "./shaders";
import { mixRgb, rgba, type BackgroundThemeColors, type Rgb01 } from "./themeColors";

/** The fallback never animates faster than this. */
export const CANVAS2D_MAX_FPS = 15;

const TAU = Math.PI * 2;
const LOOP = BACKGROUND_LOOP_SECONDS;
const WHITE: Rgb01 = [1, 1, 1];

/** Angular speed of k whole turns per loop (k whole), as in the shaders. */
function turns(k: number): number {
  return (k * TAU) / LOOP;
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Deterministic PRNG so the particle field is identical every launch. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Particle {
  layer: 0 | 1 | 2;
  x: number;
  y: number;
  /** Core radius as a fraction of the canvas height. */
  size: number;
  twinkleTurns: number;
  phase: number;
}

/** Per layer: count, drift (whole screens per loop, x/y), size range, gain. */
const PARTICLE_LAYERS = [
  { count: 60, laps: [3, 5], size: [0.0012, 0.0026], gain: 0.45 },
  { count: 32, laps: [3, 8], size: [0.002, 0.004], gain: 0.7 },
  { count: 14, laps: [2, 11], size: [0.0035, 0.0075], gain: 0.9 },
] as const;

function createParticles(): Particle[] {
  const random = mulberry32(0x5eed);
  const particles: Particle[] = [];
  PARTICLE_LAYERS.forEach((layer, index) => {
    for (let i = 0; i < layer.count; i += 1) {
      particles.push({
        layer: index as 0 | 1 | 2,
        x: random(),
        y: random(),
        size: layer.size[0] + (layer.size[1] - layer.size[0]) * random(),
        twinkleTurns: Math.floor(20 + random() * 40),
        phase: random() * TAU,
      });
    }
  });
  return particles;
}

export class Canvas2dBackend implements BackgroundBackend {
  readonly kind = "canvas2d" as const;
  readonly contextLost = false;
  private readonly particles = createParticles();
  private preset: BackgroundPreset;
  private colors: BackgroundThemeColors;
  private disposed = false;

  private constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
    preset: BackgroundPreset,
    colors: BackgroundThemeColors,
  ) {
    this.preset = preset;
    this.colors = colors;
  }

  static create(
    canvas: HTMLCanvasElement,
    preset: BackgroundPreset,
    colors: BackgroundThemeColors,
  ): Canvas2dBackend | null {
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    } catch {
      ctx = null;
    }
    return ctx ? new Canvas2dBackend(canvas, ctx, preset, colors) : null;
  }

  setPreset(preset: BackgroundPreset): boolean {
    this.preset = preset;
    return true;
  }

  setColors(colors: BackgroundThemeColors): void {
    this.colors = colors;
  }

  resize(width: number, height: number): void {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  render(frame: BackgroundFrame): boolean {
    if (this.disposed) return false;
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    if (width <= 0 || height <= 0) return false;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = rgba(this.colors.background);
    ctx.fillRect(0, 0, width, height);
    if (this.preset === "particles") this.drawParticles(frame, width, height);
    else if (this.preset === "aurora") this.drawAurora(frame, width, height);
    else this.drawMesh(frame, width, height);
    return true;
  }

  dispose(): void {
    this.disposed = true;
  }

  private strength(frame: BackgroundFrame): number {
    // Same mapping as the WebGL shaders (shaders.ts effectStrength) so both renderers match.
    const s = (0.24 + 0.64 * clamp01(frame.intensity)) * (1 + 0.6 * clamp01(frame.energy));
    return this.colors.isDark ? s : s * 0.72;
  }

  private glow(color: Rgb01): Rgb01 {
    return this.colors.isDark ? color : mixRgb(color, WHITE, 0.35);
  }

  /** A gaussian-looking soft blob; `cx`, `cy`, `r` in canvas pixels. */
  private blob(cx: number, cy: number, r: number, color: Rgb01, alpha: number): void {
    const a = clamp01(alpha);
    if (a <= 0.002 || r <= 0) return;
    const ctx = this.ctx;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2);
    gradient.addColorStop(0, rgba(color, a));
    gradient.addColorStop(0.25, rgba(color, a * 0.78));
    gradient.addColorStop(0.5, rgba(color, a * 0.37));
    gradient.addColorStop(0.75, rgba(color, a * 0.1));
    gradient.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4);
  }

  /** Lift toward the surface colour at the bottom of the window. */
  private surfaceLift(width: number, height: number, amount: number): void {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, height, 0, height * 0.1);
    gradient.addColorStop(0, rgba(this.colors.surface, amount));
    gradient.addColorStop(1, rgba(this.colors.surface, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  private drawMesh(frame: BackgroundFrame, width: number, height: number): void {
    const { accent, accent2, surface } = this.colors;
    const t = frame.time;
    const s = this.strength(frame);
    const aspect = width / height;
    this.surfaceLift(width, height, 0.35);
    // Same blob paths as the mesh shader (x in height units, y from the bottom).
    const blobs: Array<[number, number, number, Rgb01, number]> = [
      [
        aspect * (0.25 + 0.18 * Math.sin(t * turns(5))),
        0.7 + 0.16 * Math.cos(t * turns(4) + 1),
        0.46,
        accent,
        0.95,
      ],
      [
        aspect * (0.75 + 0.16 * Math.cos(t * turns(6) + 2)),
        0.3 + 0.18 * Math.sin(t * turns(5) + 0.4),
        0.52,
        accent2,
        0.85,
      ],
      [
        aspect * (0.55 + 0.22 * Math.sin(t * turns(3) + 4)),
        0.55 + 0.2 * Math.sin(t * turns(7) + 2.5),
        0.38,
        mixRgb(accent, accent2, 0.5),
        0.6,
      ],
      [
        aspect * (0.12 + 0.1 * Math.cos(t * turns(8) + 5)),
        0.18 + 0.12 * Math.cos(t * turns(6) + 3.3),
        0.34,
        mixRgb(accent2, surface, 0.35),
        0.5,
      ],
      [
        aspect * (0.9 + 0.08 * Math.sin(t * turns(4) + 1.7)),
        0.88 + 0.08 * Math.sin(t * turns(9) + 0.9),
        0.28,
        mixRgb(accent, WHITE, 0.15),
        0.45,
      ],
    ];
    for (const [x, y, r, color, weight] of blobs) {
      this.blob(x * height, (1 - y) * height, r * height * 0.75, this.glow(color), s * weight);
    }
  }

  private drawParticles(frame: BackgroundFrame, width: number, height: number): void {
    const { accent, accent2, surface, isDark } = this.colors;
    const ctx = this.ctx;
    const t = frame.time;
    const s = this.strength(frame);
    const aspect = width / height;
    this.surfaceLift(width, height, 0.3);
    this.blob(
      aspect * (0.3 + 0.08 * Math.sin(t * turns(2))) * height,
      (1 - (0.65 + 0.06 * Math.cos(t * turns(3)))) * height,
      0.42 * height,
      this.glow(accent2),
      s * 0.35,
    );
    this.blob(
      aspect * (0.75 + 0.07 * Math.cos(t * turns(3) + 1)) * height,
      (1 - (0.3 + 0.06 * Math.sin(t * turns(2) + 2))) * height,
      0.38 * height,
      this.glow(accent),
      s * 0.28,
    );
    const layerColors: Rgb01[] = [
      this.glow(mixRgb(surface, accent2, 0.6)),
      this.glow(accent2),
      this.glow(accent),
    ];
    ctx.globalCompositeOperation = isDark ? "lighter" : "source-over";
    const progress = t / LOOP;
    for (const particle of this.particles) {
      const layer = PARTICLE_LAYERS[particle.layer];
      const x = fract(particle.x + layer.laps[0] * progress) * width;
      const y = (1 - fract(particle.y + layer.laps[1] * progress)) * height;
      const twinkle = 0.55 + 0.45 * Math.sin(t * turns(particle.twinkleTurns) + particle.phase);
      const alpha = clamp01(twinkle * s * layer.gain);
      if (alpha <= 0.01) continue;
      const radius = Math.max(0.6, particle.size * height);
      ctx.fillStyle = rgba(layerColors[particle.layer] ?? accent, alpha * 0.3);
      ctx.beginPath();
      ctx.arc(x, y, radius * 2.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba(layerColors[particle.layer] ?? accent, alpha);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private drawAurora(frame: BackgroundFrame, width: number, height: number): void {
    const { accent, accent2, surface, isDark } = this.colors;
    const ctx = this.ctx;
    const t = frame.time;
    const s = this.strength(frame);
    const aspect = width / height;
    const horizon = 0.34;
    const horizonY = (1 - horizon) * height;

    // Sky lift toward the horizon.
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
    sky.addColorStop(0, rgba(surface, 0));
    sky.addColorStop(1, rgba(surface, 0.3));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizonY);

    ctx.globalCompositeOperation = isDark ? "lighter" : "source-over";
    const segments = 24;
    for (let i = 0; i < 3; i += 1) {
      const base = 0.6 + 0.11 * i;
      const color = this.glow(
        mixRgb(accent, accent2, 0.5 + 0.5 * Math.sin(aspect * 0.65 + i * 2.1 + t * turns(4))),
      );
      const gain = s * (0.85 - 0.18 * i);
      const points: Array<[number, number]> = [];
      for (let k = 0; k <= segments; k += 1) {
        const u = k / segments;
        const x = u * aspect;
        const wave =
          0.06 * Math.sin(x * (1.6 + 0.5 * i) + t * turns(6 + 3 * i) + i * 1.7) +
          0.03 * Math.sin(x * (3.7 + i) - t * turns(11 + 2 * i) + i * 0.6);
        points.push([u * width, (1 - (base + wave)) * height]);
      }
      // Soft rise above the band.
      const rise = 0.16 * height;
      const top = (1 - base) * height;
      const fill = ctx.createLinearGradient(0, top, 0, top - rise);
      fill.addColorStop(0, rgba(color, clamp01(gain * 0.5)));
      fill.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = fill;
      ctx.beginPath();
      points.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      for (let k = points.length - 1; k >= 0; k -= 1) {
        const point = points[k];
        if (point) ctx.lineTo(point[0], point[1] - rise);
      }
      ctx.closePath();
      ctx.fill();
      // Bright lower edge: wide faint strokes under a narrow brighter one.
      ctx.lineJoin = "round";
      for (const [lineWidth, alpha] of [
        [0.07, 0.16],
        [0.025, 0.3],
        [0.007, 0.5],
      ] as const) {
        ctx.strokeStyle = rgba(color, clamp01(gain * alpha));
        ctx.lineWidth = Math.max(1, lineWidth * height);
        ctx.beginPath();
        points.forEach(([x, y], index) => (index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.stroke();
      }
    }

    // Horizon glow.
    const glowBand = ctx.createLinearGradient(
      0,
      horizonY - 0.08 * height,
      0,
      horizonY + 0.08 * height,
    );
    glowBand.addColorStop(0, rgba(this.glow(accent2), 0));
    glowBand.addColorStop(0.5, rgba(this.glow(accent2), clamp01(0.22 * s)));
    glowBand.addColorStop(1, rgba(this.glow(accent2), 0));
    ctx.fillStyle = glowBand;
    ctx.fillRect(0, horizonY - 0.08 * height, width, 0.16 * height);

    // Perspective grid: depth = 0.27 / (n - scroll) for whole n, as in the shader.
    const gridColor = this.glow(mixRgb(surface, accent, 0.65));
    const gridAlpha = (isDark ? 0.16 : 0.12) * (0.6 + 0.4 * s);
    const stroke = ctx.createLinearGradient(0, horizonY, 0, height);
    stroke.addColorStop(0, rgba(gridColor, 0));
    stroke.addColorStop(0.25, rgba(gridColor, gridAlpha * 0.6));
    stroke.addColorStop(1, rgba(gridColor, gridAlpha));
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const scroll = fract(t * (60 / LOOP));
    for (let n = 1; n < 18; n += 1) {
      const depth = 0.27 / (n - scroll);
      if (depth > horizon || depth < 0.015) continue;
      const y = (1 - (horizon - depth)) * height;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    const bottomZ = 0.27 / horizon;
    for (let m = -12; m <= 12; m += 1) {
      const xBottom = 0.5 + m / (aspect * bottomZ);
      if (xBottom < -1 || xBottom > 2) continue;
      ctx.moveTo(width / 2, horizonY);
      ctx.lineTo(xBottom * width, height);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";
  }
}
