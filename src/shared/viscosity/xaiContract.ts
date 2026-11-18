/**
 * ViscosityCode: renderer ⇄ main contract for the xAI (Grok) API client.
 *
 * Follows the owner-confirmed xAI spec:
 * - Base URL https://api.x.ai/v1; optional US regional https://us.api.x.ai/v1
 *   (text models grok-4.7 / grok-4.6 only, no image/voice).
 * - Auth: Bearer key from XAI_API_KEY, or a key the user stores (OS-encrypted
 *   with Electron safeStorage in the main process; never exposed to pages).
 * - Text: Responses API POST /v1/responses with `input` (not `messages`).
 * - Server-side tools inside the Responses API: web_search, x_search.
 * - Images: grok-imagine-image-2.0 (global endpoint only).
 *
 * Requests run in the Electron main process behind a fork-owned preload
 * namespace (`window.viscosityHost.xai`) — the upstream IPC procedure map is
 * untouched. Desktop only; other clients report `available: false`.
 */

export const XAI_GLOBAL_BASE_URL = "https://api.x.ai/v1";
export const XAI_US_BASE_URL = "https://us.api.x.ai/v1";
export const XAI_DEFAULT_TEXT_MODEL = "grok-4.7";
export const XAI_US_TEXT_MODELS = ["grok-4.7", "grok-4.6"] as const;
export const XAI_IMAGE_MODEL = "grok-imagine-image-2.0";

export type XaiRegion = "global" | "us";

export interface XaiKeyStatus {
  /** Whether a key is usable right now. */
  configured: boolean;
  /** Where it comes from: the XAI_API_KEY environment variable wins over a stored key. */
  source: "env" | "stored" | "none";
  /** Last 4 characters only, for display. */
  hint?: string;
}

export interface XaiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface XaiResponseRequest {
  /** Renderer-chosen id used to route stream events and cancel. */
  requestId: string;
  model: string;
  region: XaiRegion;
  /** Conversation so far, sent as the Responses API `input`. */
  input: XaiChatMessage[];
  /** Optional standing instructions (bot persona). */
  instructions?: string;
  tools: { webSearch: boolean; xSearch: boolean };
}

export type XaiStreamEvent =
  | { requestId: string; type: "delta"; text: string }
  | {
      requestId: string;
      type: "done";
      text: string;
      usage?: { inputTokens?: number; outputTokens?: number };
    }
  | { requestId: string; type: "error"; message: string; status?: number };

export interface XaiImageRequest {
  requestId: string;
  prompt: string;
}

export interface XaiImageResult {
  /** data: URLs or https URLs returned by the API. */
  images: string[];
}

/** Preload namespace shape (`window.viscosityHost.xai`). */
export interface ViscosityXaiBridge {
  available: boolean;
  keyStatus(): Promise<XaiKeyStatus>;
  setKey(key: string): Promise<XaiKeyStatus>;
  clearKey(): Promise<XaiKeyStatus>;
  /** Starts a streamed response; events arrive through `onEvent`. */
  respond(request: XaiResponseRequest): Promise<void>;
  cancel(requestId: string): Promise<void>;
  generateImage(request: XaiImageRequest): Promise<XaiImageResult>;
  onEvent(listener: (event: XaiStreamEvent) => void): () => void;
}

/** IPC channel names (fork-owned prefix; not part of the upstream procedure map). */
export const XAI_IPC = {
  keyStatus: "viscosity:xai:key-status",
  setKey: "viscosity:xai:set-key",
  clearKey: "viscosity:xai:clear-key",
  respond: "viscosity:xai:respond",
  cancel: "viscosity:xai:cancel",
  generateImage: "viscosity:xai:generate-image",
  event: "viscosity:xai:event",
} as const;
