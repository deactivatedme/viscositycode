import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lightweightMock } = vi.hoisted(() => ({ lightweightMock: { active: false } }));
vi.mock("@/renderer/viscosity/performance/lightweight", () => ({
  isLightweightActive: () => lightweightMock.active,
}));

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  posted: Array<{ type: string; id?: number }> = [];
  terminate = vi.fn<() => void>();
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: { type: string; id?: number }) {
    this.posted.push(message);
  }
  /** Answers the last transcribe request. */
  respond() {
    const id = this.posted.findLast((message) => message.type === "transcribe")?.id;
    this.onmessage?.({ data: { type: "result", id, text: "hello" } });
  }
}

const options = { language: "en", model: "tiny", useWebGpu: false } as const;

describe("voiceTranscription worker lifetime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWorker.instances = [];
    lightweightMock.active = false;
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("terminates the worker after 60 s idle and recreates it on the next warmup", async () => {
    const voice = await import("./voiceTranscription");
    const done = voice.transcribeVoiceAudio(new Float32Array(4), options);
    const first = FakeWorker.instances[0]!;
    first.respond();
    await expect(done).resolves.toBe("hello");

    vi.advanceTimersByTime(voice.VOICE_WORKER_IDLE_MS - 1);
    expect(first.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(first.terminate).toHaveBeenCalledTimes(1);

    voice.warmupVoiceTranscription(options);
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it("keeps the same worker when used again before the timeout", async () => {
    const voice = await import("./voiceTranscription");
    const first = voice.transcribeVoiceAudio(new Float32Array(4), options);
    FakeWorker.instances[0]!.respond();
    await first;
    vi.advanceTimersByTime(voice.VOICE_WORKER_IDLE_MS - 1_000);

    const second = voice.transcribeVoiceAudio(new Float32Array(4), options);
    vi.advanceTimersByTime(voice.VOICE_WORKER_IDLE_MS * 2);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]!.terminate).not.toHaveBeenCalled();
    FakeWorker.instances[0]!.respond();
    await second;
  });

  it("uses the 15 s timeout in Lightweight mode", async () => {
    lightweightMock.active = true;
    const voice = await import("./voiceTranscription");
    const done = voice.transcribeVoiceAudio(new Float32Array(4), options);
    FakeWorker.instances[0]!.respond();
    await done;
    vi.advanceTimersByTime(voice.VOICE_WORKER_LIGHTWEIGHT_IDLE_MS);
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledTimes(1);
  });
});
