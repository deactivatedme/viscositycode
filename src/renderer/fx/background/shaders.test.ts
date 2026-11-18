import { describe, expect, it } from "vitest";
import { BACKGROUND_PRESETS } from "../fxSettingsStore";
import { internalSizeFor } from "./backend";
import {
  BACKGROUND_FRAGMENT_SHADERS,
  BACKGROUND_LOOP_SECONDS,
  BACKGROUND_UNIFORMS,
  BACKGROUND_VERTEX_SHADER,
} from "./shaders";

// Compiling GLSL needs a GPU context, which jsdom lacks; these checks keep the
// preset table complete and every shader on the shared uniform contract.
describe("background shaders", () => {
  it("has exactly one fragment shader per preset", () => {
    expect(Object.keys(BACKGROUND_FRAGMENT_SHADERS).sort()).toEqual([...BACKGROUND_PRESETS].sort());
  });

  it.each(BACKGROUND_PRESETS)("%s is GLSL ES 3.00 on the shared uniform contract", (preset) => {
    const source = BACKGROUND_FRAGMENT_SHADERS[preset];
    expect(source.startsWith("#version 300 es\n")).toBe(true);
    expect(source).toContain("precision highp float;");
    for (const uniform of BACKGROUND_UNIFORMS) {
      expect(source).toMatch(new RegExp(`uniform \\w+ ${uniform};`));
    }
    expect(source).toContain("out vec4 outColor;");
    expect(source).toMatch(/void main\(\) \{[\s\S]*outColor = finish\(/);
    expect(source).toContain(`const float LOOP = ${BACKGROUND_LOOP_SECONDS.toFixed(1)};`);
  });

  it("only uses whole-turn angular speeds, so the time wrap is seamless", () => {
    for (const source of Object.values(BACKGROUND_FRAGMENT_SHADERS)) {
      for (const match of source.matchAll(/turns\(([\d.]+)\)/g)) {
        const k = Number(match[1]);
        expect(Number.isInteger(k)).toBe(true);
      }
    }
  });

  it("draws a buffer-less full-screen triangle", () => {
    expect(BACKGROUND_VERTEX_SHADER.startsWith("#version 300 es\n")).toBe(true);
    expect(BACKGROUND_VERTEX_SHADER).toContain("gl_VertexID");
    expect(BACKGROUND_VERTEX_SHADER).not.toContain(" in vec");
  });
});

describe("internalSizeFor", () => {
  it("renders WebGL at about half the device resolution", () => {
    expect(internalSizeFor("webgl2", 1440, 900, 2)).toEqual({ width: 1440, height: 900 });
    expect(internalSizeFor("webgl2", 1280, 800, 1)).toEqual({ width: 640, height: 400 });
  });

  it("caps the longest side", () => {
    expect(internalSizeFor("webgl2", 2560, 1440, 2)).toEqual({ width: 1600, height: 900 });
    expect(internalSizeFor("canvas2d", 2560, 1440, 2)).toEqual({ width: 640, height: 360 });
  });

  it("keeps the 2D fallback small and tolerates bad input", () => {
    expect(internalSizeFor("canvas2d", 1000, 600, 2)).toEqual({ width: 350, height: 210 });
    expect(internalSizeFor("webgl2", 0, Number.NaN, 0)).toEqual({ width: 1, height: 1 });
  });
});
