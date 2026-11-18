import { describe, expect, it } from "vitest";
import { XAI_GLOBAL_BASE_URL, XAI_US_BASE_URL } from "@/shared/viscosity/xaiContract";
import {
  XAI_ALLOWED_ORIGINS,
  assertAllowedXaiUrl,
  assertRegionServesModel,
  xaiBaseUrl,
  xaiImagesUrl,
  xaiResponsesUrl,
} from "./xaiEndpoints";

describe("xAI endpoints", () => {
  it("uses the global base by default and the US base for region us", () => {
    expect(xaiBaseUrl("global")).toBe(XAI_GLOBAL_BASE_URL);
    expect(xaiBaseUrl("us")).toBe(XAI_US_BASE_URL);
    expect(xaiResponsesUrl("global")).toBe("https://api.x.ai/v1/responses");
    expect(xaiResponsesUrl("us")).toBe("https://us.api.x.ai/v1/responses");
  });

  it("always generates images on the global endpoint", () => {
    expect(xaiImagesUrl()).toBe("https://api.x.ai/v1/images/generations");
  });

  it("only allows the two documented origins", () => {
    expect([...XAI_ALLOWED_ORIGINS].sort()).toEqual(["https://api.x.ai", "https://us.api.x.ai"]);
  });
});

describe("region/model guard", () => {
  it("lets the US endpoint serve only grok-4.7 and grok-4.6", () => {
    expect(() => assertRegionServesModel("us", "grok-4.7")).not.toThrow();
    expect(() => assertRegionServesModel("us", "grok-4.6")).not.toThrow();
    for (const model of ["grok-latest", "grok-imagine-image-2.0", "grok-4.5", "GROK-4.7"]) {
      expect(() => assertRegionServesModel("us", model)).toThrow(
        expect.objectContaining({ code: "region-model" }),
      );
    }
  });

  it("lets the global endpoint take any well-formed model id", () => {
    expect(() => assertRegionServesModel("global", "grok-4.7")).not.toThrow();
    expect(() => assertRegionServesModel("global", "grok-code-fast-1")).not.toThrow();
  });

  it("rejects malformed model ids before any request", () => {
    for (const model of ["", "../responses", "grok 4", "a".repeat(80), "grok-4.7?x=1"]) {
      expect(() => assertRegionServesModel("global", model)).toThrow(
        expect.objectContaining({ code: "invalid-request" }),
      );
    }
  });
});

describe("URL allow-list", () => {
  it("accepts xAI URLs and refuses everything else", () => {
    expect(assertAllowedXaiUrl("https://api.x.ai/v1/responses").host).toBe("api.x.ai");
    expect(assertAllowedXaiUrl("https://us.api.x.ai/v1/responses").host).toBe("us.api.x.ai");
    for (const url of [
      "http://api.x.ai/v1/responses",
      "https://api.x.ai.evil.example/v1",
      "https://eu.api.x.ai/v1/responses",
      "https://api.x.ai:8443/v1/responses",
      "not a url",
    ]) {
      expect(() => assertAllowedXaiUrl(url)).toThrow(
        expect.objectContaining({ code: "invalid-request" }),
      );
    }
  });
});
