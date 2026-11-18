/**
 * ViscosityCode: WebGL2 background backend — one program, one full-screen
 * triangle, no buffers. Exactly one context is created per canvas; `dispose`
 * releases it (`WEBGL_lose_context`) so xterm's per-terminal WebGL contexts
 * keep their budget.
 */
import type { BackgroundPreset } from "../fxSettingsStore";
import type { BackgroundBackend, BackgroundFrame } from "./backend";
import {
  BACKGROUND_FRAGMENT_SHADERS,
  BACKGROUND_UNIFORMS,
  BACKGROUND_VERTEX_SHADER,
  type BackgroundUniform,
} from "./shaders";
import type { BackgroundThemeColors } from "./themeColors";

/**
 * Low-power, no-frills context. `failIfMajorPerformanceCaveat` refuses
 * software GL (a blocklisted GPU), where the 2D fallback is far cheaper.
 */
export const BACKGROUND_WEBGL_ATTRIBUTES: WebGLContextAttributes & { desynchronized: boolean } = {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: "low-power",
  desynchronized: true,
  failIfMajorPerformanceCaveat: true,
};

type UniformLocations = Record<BackgroundUniform, WebGLUniformLocation | null>;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) || gl.isContextLost()) return shader;
  if (import.meta.env.DEV) {
    console.warn("[viscosity-fx] background shader failed to compile", gl.getShaderInfoLog(shader));
  }
  gl.deleteShader(shader);
  return null;
}

function link(gl: WebGL2RenderingContext, fragmentSource: string): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, BACKGROUND_VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = vertex && fragment ? gl.createProgram() : null;
  if (program && vertex && fragment) {
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
  }
  if (vertex) gl.deleteShader(vertex);
  if (fragment) gl.deleteShader(fragment);
  if (!program) return null;
  if (gl.getProgramParameter(program, gl.LINK_STATUS) || gl.isContextLost()) return program;
  if (import.meta.env.DEV) {
    console.warn("[viscosity-fx] background program failed to link", gl.getProgramInfoLog(program));
  }
  gl.deleteProgram(program);
  return null;
}

export class WebGl2Backend implements BackgroundBackend {
  readonly kind = "webgl2" as const;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uniforms: UniformLocations | null = null;
  private preset: BackgroundPreset;
  private colors: BackgroundThemeColors;
  private disposed = false;

  private constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    preset: BackgroundPreset,
    colors: BackgroundThemeColors,
  ) {
    this.preset = preset;
    this.colors = colors;
  }

  /** A ready backend, or null when WebGL2 is unavailable or the shader does not build. */
  static create(
    canvas: HTMLCanvasElement,
    preset: BackgroundPreset,
    colors: BackgroundThemeColors,
  ): WebGl2Backend | null {
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext(
        "webgl2",
        BACKGROUND_WEBGL_ATTRIBUTES,
      ) as WebGL2RenderingContext | null;
    } catch {
      gl = null;
    }
    if (!gl) return null;
    const backend = new WebGl2Backend(canvas, gl, preset, colors);
    if (!backend.build()) {
      backend.dispose();
      return null;
    }
    return backend;
  }

  /** (Re)create GPU resources: after creation and after a context restore. */
  build(): boolean {
    const gl = this.gl;
    if (this.disposed || gl.isContextLost()) return false;
    const program = link(gl, BACKGROUND_FRAGMENT_SHADERS[this.preset]);
    if (!program) return false;
    if (this.program) gl.deleteProgram(this.program);
    this.program = program;
    const uniforms = {} as UniformLocations;
    for (const name of BACKGROUND_UNIFORMS) uniforms[name] = gl.getUniformLocation(program, name);
    this.uniforms = uniforms;
    if (!this.vao) this.vao = gl.createVertexArray();
    return true;
  }

  /**
   * Rebuild after `webglcontextrestored`. Objects from the lost context are
   * invalid in the restored one, so they are dropped, not deleted.
   */
  restore(): boolean {
    this.program = null;
    this.vao = null;
    this.uniforms = null;
    return this.build();
  }

  get contextLost(): boolean {
    return this.gl.isContextLost();
  }

  setPreset(preset: BackgroundPreset): boolean {
    if (preset === this.preset && this.program) return true;
    const previous = this.preset;
    this.preset = preset;
    if (this.gl.isContextLost()) return true; // rebuilt on restore
    if (this.build()) return true;
    this.preset = previous;
    return false;
  }

  setColors(colors: BackgroundThemeColors): void {
    this.colors = colors;
  }

  resize(width: number, height: number): void {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  render(frame: BackgroundFrame): boolean {
    const gl = this.gl;
    const u = this.uniforms;
    if (this.disposed || !this.program || !u || gl.isContextLost()) return false;
    const { width, height } = this.canvas;
    const c = this.colors;
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.uniform1f(u.uTime, frame.time);
    gl.uniform2f(u.uResolution, width, height);
    gl.uniform1f(u.uIntensity, frame.intensity);
    gl.uniform1f(u.uEnergy, frame.energy);
    gl.uniform1f(u.uIsDark, c.isDark ? 1 : 0);
    gl.uniform3f(u.uBg, c.background[0], c.background[1], c.background[2]);
    gl.uniform3f(u.uAccent, c.accent[0], c.accent[1], c.accent[2]);
    gl.uniform3f(u.uAccent2, c.accent2[0], c.accent2[1], c.accent2[2]);
    gl.uniform3f(u.uSurface, c.surface[0], c.surface[1], c.surface[2]);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    if (!gl.isContextLost()) {
      if (this.program) gl.deleteProgram(this.program);
      if (this.vao) gl.deleteVertexArray(this.vao);
    }
    this.program = null;
    this.vao = null;
    this.uniforms = null;
    // Give the context back now instead of waiting for GC: Chromium caps live
    // WebGL contexts (~16) and every visible terminal holds one.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
