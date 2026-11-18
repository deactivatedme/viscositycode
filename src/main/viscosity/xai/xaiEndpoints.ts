/**
 * ViscosityCode: xAI endpoint selection and the guards that keep requests on
 * the two documented hosts. The US regional endpoint serves text only and only
 * grok-4.7 / grok-4.6 (docs.x.ai › Regional endpoints); images always use the
 * global endpoint.
 */
import {
  XAI_GLOBAL_BASE_URL,
  XAI_US_BASE_URL,
  XAI_US_TEXT_MODELS,
  type XaiRegion,
} from "@/shared/viscosity/xaiContract";
import { XaiError } from "./xaiErrors";

/** The only origins this client may contact. */
export const XAI_ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  new URL(XAI_GLOBAL_BASE_URL).origin,
  new URL(XAI_US_BASE_URL).origin,
]);

/** Model ids are short tokens like `grok-4.7`; anything else is refused before the network. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;

export function isValidXaiModelId(model: string): boolean {
  return MODEL_ID.test(model);
}

export function isUsRegionTextModel(model: string): boolean {
  return (XAI_US_TEXT_MODELS as readonly string[]).includes(model);
}

export function xaiBaseUrl(region: XaiRegion): string {
  return region === "us" ? XAI_US_BASE_URL : XAI_GLOBAL_BASE_URL;
}

/** Throws a `region-model` error when the US endpoint cannot serve `model`. */
export function assertRegionServesModel(region: XaiRegion, model: string): void {
  if (!isValidXaiModelId(model)) throw new XaiError("invalid-request");
  if (region === "us" && !isUsRegionTextModel(model)) throw new XaiError("region-model");
}

/** Defense in depth: refuse any URL outside the two documented xAI origins. */
export function assertAllowedXaiUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new XaiError("invalid-request");
  }
  if (parsed.protocol !== "https:" || !XAI_ALLOWED_ORIGINS.has(parsed.origin)) {
    throw new XaiError("invalid-request");
  }
  return parsed;
}

export function xaiResponsesUrl(region: XaiRegion): string {
  return `${xaiBaseUrl(region)}/responses`;
}

/** Image generation is not served by the US endpoint, so it always uses the global one. */
export function xaiImagesUrl(): string {
  return `${XAI_GLOBAL_BASE_URL}/images/generations`;
}
