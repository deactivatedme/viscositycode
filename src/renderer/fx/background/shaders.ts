/**
 * ViscosityCode: GLSL ES 3.00 sources for the WebGL2 background.
 *
 * One full-screen triangle (generated from gl_VertexID, no buffers) and one
 * fragment shader per preset. Every preset reads the same uniforms
 * ({@link BACKGROUND_UNIFORMS}).
 *
 * Seamless time: the renderer wraps `uTime` at {@link BACKGROUND_LOOP_SECONDS}.
 * Every motion below is either `turns(k)` (k whole turns per loop) or a drift
 * of a whole number of pattern periods per loop, so the wrap is invisible.
 */
import type { BackgroundPreset } from "../fxSettingsStore";

/** Animation time wraps here; all shader motion is periodic over this span. */
export const BACKGROUND_LOOP_SECONDS = 600;

export const BACKGROUND_UNIFORMS = [
  "uTime",
  "uResolution",
  "uIntensity",
  "uEnergy",
  "uIsDark",
  "uBg",
  "uAccent",
  "uAccent2",
  "uSurface",
] as const;
export type BackgroundUniform = (typeof BACKGROUND_UNIFORMS)[number];

export const BACKGROUND_VERTEX_SHADER = `#version 300 es
// Full-screen triangle: vertices (-1,-1), (3,-1), (-1,3).
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const PRELUDE = `#version 300 es
precision highp float;

uniform float uTime;       // seconds, wrapped to LOOP
uniform vec2 uResolution;  // drawing-buffer pixels
uniform float uIntensity;  // 0..1 user intensity
uniform float uEnergy;     // 0..1 smoothed agent output energy
uniform float uIsDark;     // 1.0 on dark themes
uniform vec3 uBg;
uniform vec3 uAccent;
uniform vec3 uAccent2;
uniform vec3 uSurface;

out vec4 outColor;

const float TAU = 6.28318530718;
const float LOOP = ${BACKGROUND_LOOP_SECONDS.toFixed(1)};

// Angular speed of k whole turns per loop (k must be a whole number).
float turns(float k) { return k * TAU / LOOP; }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

bool isDark() { return uIsDark > 0.5; }

// Overall effect strength: intensity, +60% at most from energy, gentler on light themes.
float strength() {
  float s = mix(0.22, 0.8, uIntensity) * (1.0 + 0.6 * uEnergy);
  return isDark() ? s : s * 0.55;
}

// A colour as it should glow: itself on dark themes, a lighter tint on light ones.
vec3 glowColor(vec3 c) { return isDark() ? c : mix(c, vec3(1.0), 0.35); }

// Light emission: additive on dark themes, a soft tint on light ones.
vec3 emit(vec3 base, vec3 c, float amount) {
  float a = max(amount, 0.0);
  return isDark() ? base + c * a : mix(base, c, clamp(a, 0.0, 1.0));
}

float blob(vec2 p, vec2 center, float radius) {
  vec2 d = p - center;
  return exp(-dot(d, d) / (radius * radius));
}

vec4 finish(vec3 color) {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float vignette = 1.0 - smoothstep(0.3, 1.2, length(uv - 0.5) * 1.3);
  color = mix(uBg, color, mix(0.7, 1.0, vignette));
  // Dither to break 8-bit banding in the soft gradients.
  color += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  return vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

const MESH = `${PRELUDE}
// Slow gradient mesh: five soft colour blobs moved through a sinusoidal domain warp.
void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = gl_FragCoord.xy / max(uResolution.y, 1.0);
  float t = uTime;

  vec2 q = p;
  q += 0.10 * vec2(sin(q.y * 2.3 + t * turns(9.0)), cos(q.x * 2.1 - t * turns(7.0)));
  q += 0.05 * vec2(sin(q.y * 4.7 - t * turns(13.0) + 1.3), cos(q.x * 4.3 + t * turns(11.0) + 0.7));

  vec2 c0 = vec2(aspect * (0.25 + 0.18 * sin(t * turns(5.0))), 0.70 + 0.16 * cos(t * turns(4.0) + 1.0));
  vec2 c1 = vec2(aspect * (0.75 + 0.16 * cos(t * turns(6.0) + 2.0)), 0.30 + 0.18 * sin(t * turns(5.0) + 0.4));
  vec2 c2 = vec2(aspect * (0.55 + 0.22 * sin(t * turns(3.0) + 4.0)), 0.55 + 0.20 * sin(t * turns(7.0) + 2.5));
  vec2 c3 = vec2(aspect * (0.12 + 0.10 * cos(t * turns(8.0) + 5.0)), 0.18 + 0.12 * cos(t * turns(6.0) + 3.3));
  vec2 c4 = vec2(aspect * (0.90 + 0.08 * sin(t * turns(4.0) + 1.7)), 0.88 + 0.08 * sin(t * turns(9.0) + 0.9));

  float s = strength();
  vec3 color = mix(uBg, uSurface, 0.35 * (1.0 - smoothstep(0.0, 0.9, p.y)));
  color = mix(color, glowColor(uAccent), clamp(s * 0.95 * blob(q, c0, 0.46), 0.0, 1.0));
  color = mix(color, glowColor(uAccent2), clamp(s * 0.85 * blob(q, c1, 0.52), 0.0, 1.0));
  color = mix(color, glowColor(mix(uAccent, uAccent2, 0.5)), clamp(s * 0.6 * blob(q, c2, 0.38), 0.0, 1.0));
  color = mix(color, glowColor(mix(uAccent2, uSurface, 0.35)), clamp(s * 0.5 * blob(q, c3, 0.34), 0.0, 1.0));
  color = mix(color, glowColor(mix(uAccent, vec3(1.0), 0.15)), clamp(s * 0.45 * blob(q, c4, 0.28), 0.0, 1.0));
  outColor = finish(color);
}
`;

const PARTICLES = `${PRELUDE}
// One particle per grid cell. The cell pattern repeats every \`period\` cells and
// the layer drifts \`laps\` whole periods per loop, so the wrap is seamless.
float particleLayer(vec2 p, float cells, float period, vec2 laps, float seed) {
  float t = uTime;
  vec2 g = p * cells + laps * period * (t / LOOP);
  vec2 id = floor(g);
  vec2 f = fract(g);
  vec2 key = mod(id, period) + seed;
  float present = step(0.45, hash12(key));
  vec2 h = hash22(key + 17.0);
  vec2 orbit = 0.06 * vec2(
    sin(t * turns(floor(6.0 + h.x * 10.0)) + h.y * TAU),
    cos(t * turns(floor(5.0 + h.y * 10.0)) + h.x * TAU)
  );
  vec2 pos = 0.3 + 0.4 * h + orbit;
  float size = mix(0.03, 0.065, hash12(key + 3.1));
  vec2 d = f - pos;
  float d2 = dot(d, d);
  float core = exp(-d2 / (size * size));
  float halo = 0.3 * exp(-d2 / (size * size * 4.84));
  float twinkle = 0.55 + 0.45 * sin(t * turns(floor(20.0 + hash12(key + 9.7) * 40.0)) + hash12(key + 1.3) * TAU);
  return (core + halo) * present * twinkle;
}

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = gl_FragCoord.xy / max(uResolution.y, 1.0);
  float t = uTime;
  float s = strength();

  // Faint nebula for depth.
  vec3 color = mix(uBg, uSurface, 0.3 * (1.0 - smoothstep(0.0, 1.0, p.y)));
  vec2 n0 = vec2(aspect * (0.3 + 0.08 * sin(t * turns(2.0))), 0.65 + 0.06 * cos(t * turns(3.0)));
  vec2 n1 = vec2(aspect * (0.75 + 0.07 * cos(t * turns(3.0) + 1.0)), 0.3 + 0.06 * sin(t * turns(2.0) + 2.0));
  color = mix(color, glowColor(uAccent2), clamp(s * 0.35 * blob(p, n0, 0.55), 0.0, 1.0));
  color = mix(color, glowColor(uAccent), clamp(s * 0.28 * blob(p, n1, 0.5), 0.0, 1.0));

  // Three depth layers: far (small, slow, dim) to near (large, faster, bright).
  float farLayer = particleLayer(p, 26.0, 128.0, vec2(-1.0, -1.0), 3.0);
  float midLayer = particleLayer(p, 16.0, 64.0, vec2(-1.0, -2.0), 41.0);
  float nearLayer = particleLayer(p, 9.0, 32.0, vec2(-1.0, -3.0), 97.0);
  color = emit(color, glowColor(mix(uSurface, uAccent2, 0.6)), farLayer * s * 0.45);
  color = emit(color, glowColor(uAccent2), midLayer * s * 0.7);
  color = emit(color, glowColor(uAccent), nearLayer * s * 0.9);
  outColor = finish(color);
}
`;

const AURORA = `${PRELUDE}
// Aurora curtains over a subtle perspective grid.
void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 uv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
  float x = uv.x * aspect;
  float t = uTime;
  float s = strength();
  const float horizon = 0.34;

  vec3 color = mix(uBg, uSurface, 0.3 * (1.0 - smoothstep(horizon, 1.0, uv.y)));

  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float base = 0.6 + 0.11 * fi;
    float wave = 0.06 * sin(x * (1.6 + 0.5 * fi) + t * turns(6.0 + 3.0 * fi) + fi * 1.7)
      + 0.03 * sin(x * (3.7 + fi) - t * turns(11.0 + 2.0 * fi) + fi * 0.6);
    float y = uv.y - (base + wave);
    // Bright lower edge, long soft fade upward, and a wide haze around the band.
    float edge = exp(-y * y / 0.0018);
    float rise = smoothstep(-0.015, 0.0, y) * exp(-max(y, 0.0) * 6.0);
    float haze = exp(-y * y / 0.02);
    // Fine, shifting rays: two layered frequencies with shallow modulation.
    float rays = 0.72
      + 0.18 * sin(x * 21.0 + 1.5 * sin(x * 4.0 + t * turns(17.0 + fi)) + t * turns(23.0))
      + 0.10 * sin(x * 53.0 - t * turns(31.0) + fi * 2.3);
    float curtain = edge * 0.6 * mix(1.0, rays, 0.35) + rise * 0.5 * rays + haze * 0.18;
    vec3 c = mix(uAccent, uAccent2, 0.5 + 0.5 * sin(x * 1.3 + fi * 2.1 + t * turns(4.0)));
    color = emit(color, glowColor(c), curtain * s * (0.85 - 0.18 * fi));
  }

  // Horizon glow.
  float hy = (uv.y - horizon) * 12.0;
  color = emit(color, glowColor(uAccent2), 0.16 * s * exp(-hy * hy));

  // Perspective grid on the ground plane, scrolling toward the viewer. The
  // derivatives are taken for every pixel (fwidth is undefined inside
  // non-uniform control flow); the sky is masked out afterwards.
  float below = horizon - uv.y;
  float z = 0.09 / max(below, 0.002);
  vec2 g = vec2((uv.x - 0.5) * aspect * z * 3.0, z * 3.0 + t * (60.0 / LOOP));
  vec2 w = max(fwidth(g), vec2(1e-4));
  vec2 a = abs(fract(g - 0.5) - 0.5) / w;
  float line = 1.0 - min(min(a.x, a.y), 1.0);
  float fade = step(0.0, below) * smoothstep(0.015, 0.16, below)
    * (0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.34, below)));
  float gridStrength = (isDark() ? 0.16 : 0.12) * (0.6 + 0.4 * s);
  color = emit(color, glowColor(mix(uSurface, uAccent, 0.65)), line * fade * gridStrength);
  outColor = finish(color);
}
`;

/** Fragment shader per preset. Typed as a total record so a new preset cannot ship without one. */
export const BACKGROUND_FRAGMENT_SHADERS: Record<BackgroundPreset, string> = {
  mesh: MESH,
  particles: PARTICLES,
  aurora: AURORA,
};
