/**
 * ViscosityCode: a Roundtable participant whose brain is a Grok model on
 * the xAI Responses API (`ParticipantBrain.kind === "xai"`).
 *
 * The conversation (role/content list) lives in memory per driver, i.e. per
 * participant and Roundtable session, and is re-sent as `input` each turn.
 * When the engine recreates a driver (window reload), the history is rebuilt
 * from the session's finished turns for this participant. Requests run in the
 * main process (`getXaiBridge()`); this class never sees the API key.
 *
 * Streaming text reaches `onProgress` at most 8 times a second (2 in
 * Lightweight mode, read per turn); no callback
 * fires after `sendTurn` settles. `stop()` cancels the request and settles the
 * turn as "stopped" at once.
 */
import type {
  ParticipantDriver,
  ParticipantProfile,
  RoundtableSession,
  TurnProgressListener,
  TurnResult,
} from "@/renderer/viscosity/roundtable/types";
import {
  XAI_US_TEXT_MODELS,
  type ViscosityXaiBridge,
  type XaiChatMessage,
  type XaiRegion,
} from "@/shared/viscosity/xaiContract";
import { DEFAULT_DRIVER_TIMING } from "@/renderer/viscosity/roundtable/engine/threadPort";
import { XaiBridgeError, getXaiBridge, toXaiBridgeError } from "./xaiBridge";
import { describeXaiError } from "./xaiErrorText";

/** Oldest messages are dropped beyond this many characters (~100k tokens). */
const XAI_MAX_HISTORY_CHARS = 400_000;

interface XaiBrainConfig {
  model: string;
  region: XaiRegion;
  tools: { webSearch: boolean; xSearch: boolean };
}

export interface XaiParticipantDriverOptions {
  profile: ParticipantProfile;
  /** Finished turns seed the conversation when a driver is recreated. */
  session?: Pick<RoundtableSession, "turns">;
  /** Current standing instructions, read per request (edits apply mid-chat). Default: the profile's. */
  instructions?: () => string | undefined;
  /** Defaults to the window's bridge. */
  getBridge?: () => ViscosityXaiBridge;
  createRequestId?: () => string;
  /** Default: the thread seats' live-preview interval, read per turn (Lightweight-aware). */
  progressIntervalMs?: number;
  maxHistoryChars?: number;
}

interface ActiveTurn {
  requestId: string;
  settle: (result: TurnResult) => void;
  partialText: () => string;
}

function brainOf(profile: ParticipantProfile): XaiBrainConfig {
  if (profile.brain.kind !== "xai") {
    throw new Error(`XaiParticipantDriver needs an xAI brain (participant ${profile.id}).`);
  }
  return { model: profile.brain.model, region: profile.brain.region, tools: profile.brain.tools };
}

function seedHistory(
  profile: ParticipantProfile,
  session: Pick<RoundtableSession, "turns"> | undefined,
): XaiChatMessage[] {
  const history: XaiChatMessage[] = [];
  for (const turn of session?.turns ?? []) {
    if (turn.participantId !== profile.id || turn.status !== "done" || !turn.responseText) continue;
    history.push({ role: "user", content: turn.prompt });
    history.push({ role: "assistant", content: turn.responseText });
  }
  return history;
}

/** Drop the oldest messages until the input fits; the newest message always stays. */
export function trimXaiHistory(messages: XaiChatMessage[], maxChars: number): XaiChatMessage[] {
  let total = messages.reduce((sum, message) => sum + message.content.length, 0);
  let start = 0;
  while (total > maxChars && start < messages.length - 1) {
    total -= messages[start]?.content.length ?? 0;
    start += 1;
  }
  // Never open the window on an assistant reply without its prompt.
  while (start < messages.length - 1 && messages[start]?.role === "assistant") start += 1;
  return messages.slice(start);
}

export class XaiParticipantDriver implements ParticipantDriver {
  readonly participantId: string;
  private readonly instructions: () => string | undefined;
  private readonly brain: XaiBrainConfig;
  private readonly getBridge: () => ViscosityXaiBridge;
  private readonly createRequestId: () => string;
  private readonly progressIntervalMs: number | undefined;
  private readonly maxHistoryChars: number;
  private history: XaiChatMessage[];
  private active: ActiveTurn | undefined;
  private disposed = false;

  constructor(options: XaiParticipantDriverOptions) {
    this.instructions = options.instructions ?? (() => options.profile.instructions);
    this.participantId = options.profile.id;
    this.brain = brainOf(options.profile);
    this.getBridge = options.getBridge ?? getXaiBridge;
    this.createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
    this.progressIntervalMs = options.progressIntervalMs;
    this.maxHistoryChars = options.maxHistoryChars ?? XAI_MAX_HISTORY_CHARS;
    this.history = seedHistory(options.profile, options.session);
  }

  /** Conversation so far (copy), for tests and diagnostics. */
  conversation(): XaiChatMessage[] {
    return [...this.history];
  }

  async ensureStarted(): Promise<void> {
    const bridge = this.getBridge();
    if (!bridge.available) throw new XaiBridgeError("unavailable");
    if (
      this.brain.region === "us" &&
      !(XAI_US_TEXT_MODELS as readonly string[]).includes(this.brain.model)
    ) {
      throw new XaiBridgeError("region-model");
    }
    let configured: boolean;
    try {
      configured = (await bridge.keyStatus()).configured;
    } catch (error) {
      throw toXaiBridgeError(error);
    }
    if (!configured) throw new XaiBridgeError("no-key");
  }

  sendTurn(prompt: string, onProgress?: TurnProgressListener): Promise<TurnResult> {
    if (this.disposed) return Promise.resolve({ status: "stopped", text: "" });
    if (this.active) {
      return Promise.resolve({ status: "failed", text: "", error: describeXaiError("busy") });
    }
    const bridge = this.getBridge();
    if (!bridge.available) {
      return Promise.resolve({
        status: "failed",
        text: "",
        error: describeXaiError("unavailable"),
      });
    }
    const requestId = this.createRequestId();
    const userMessage: XaiChatMessage = { role: "user", content: prompt };
    const input = trimXaiHistory([...this.history, userMessage], this.maxHistoryChars);
    const progressIntervalMs = this.progressIntervalMs ?? DEFAULT_DRIVER_TIMING.progressMs;

    return new Promise<TurnResult>((resolve) => {
      let text = "";
      let emitted = "";
      let lastEmitAt = Number.NEGATIVE_INFINITY;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;

      const emitProgress = () => {
        timer = undefined;
        if (settled || !onProgress || text === emitted) return;
        emitted = text;
        lastEmitAt = Date.now();
        onProgress(text);
      };
      const scheduleProgress = () => {
        if (!onProgress || timer !== undefined) return;
        const wait = lastEmitAt + progressIntervalMs - Date.now();
        if (wait <= 0) emitProgress();
        else timer = setTimeout(emitProgress, wait);
      };

      const settle = (result: TurnResult) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        unsubscribe();
        if (this.active?.requestId === requestId) this.active = undefined;
        if (result.status === "done") {
          this.history = [
            ...this.history,
            userMessage,
            { role: "assistant", content: result.text },
          ];
        }
        resolve(result);
      };

      const unsubscribe = bridge.onEvent((event) => {
        if (event.requestId !== requestId || settled) return;
        if (event.type === "delta") {
          text += event.text;
          scheduleProgress();
        } else if (event.type === "done") {
          settle({ status: "done", text: event.text || text });
        } else if (event.code === "cancelled") {
          settle({ status: "stopped", text });
        } else {
          settle({
            status: "failed",
            text,
            error: event.code ? describeXaiError(event.code, event.detail) : event.message,
          });
        }
      });

      this.active = { requestId, settle, partialText: () => text };

      const instructions = this.instructions()?.trim();
      bridge
        .respond({
          requestId,
          model: this.brain.model,
          region: this.brain.region,
          input,
          tools: { ...this.brain.tools },
          ...(instructions ? { instructions } : {}),
        })
        .catch((error: unknown) => {
          settle({ status: "failed", text, error: toXaiBridgeError(error).message });
        });
    });
  }

  async stop(): Promise<void> {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    active.settle({ status: "stopped", text: active.partialText() });
    try {
      await this.getBridge().cancel(active.requestId);
    } catch {
      // The turn is already settled; a failed cancel only leaves main to time out.
    }
  }

  threadId(): string | undefined {
    return undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    void this.stop();
  }
}
