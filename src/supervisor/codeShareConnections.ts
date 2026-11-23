import type { ShareConnection } from "@/shared/codeShareSetup";
import { listCodeShareSubscriptionProviders } from "@/shared/codeShareSubscriptionProviders";
import type { AgentAdapter, CodeShareLogin } from "./agents/base";

interface LoginJob {
  state: "waiting" | "connected" | "failed" | "idle";
  cancelled: boolean;
  acquiring: Promise<CodeShareLogin>;
  done: Promise<void>;
  handle?: CodeShareLogin;
}

export class CodeShareConnections {
  private readonly authenticated = new Set<string>();
  private readonly jobs = new Map<string, LoginJob>();
  private closed = false;
  constructor(
    private readonly adapters: ReadonlyMap<string, AgentAdapter>,
    private readonly refresh: () => Promise<unknown>,
  ) {}
  observe(id: string, connected: boolean): void {
    if (connected) {
      this.authenticated.add(id);
      const job = this.jobs.get(id);
      if (job?.state === "failed") job.state = "connected";
    } else this.authenticated.delete(id);
  }
  snapshot(): ShareConnection[] {
    return listCodeShareSubscriptionProviders()
      .filter(({ supportsOwnerChat }) => supportsOwnerChat)
      .map(({ id, ownerLabel }) => {
        const job = this.jobs.get(id);
        const connected = this.authenticated.has(id);
        const url = job?.state === "waiting" ? job.handle?.url() : undefined;
        return {
          id,
          label: ownerLabel,
          connected,
          state:
            job?.state === "waiting" || job?.state === "failed"
              ? job.state
              : connected
                ? "connected"
                : "idle",
          ...(url ? { url } : {}),
          ...(job?.state === "failed"
            ? { message: "Sign-in did not complete. Check the provider connection and try again." }
            : {}),
        };
      });
  }
  async connect(provider: string): Promise<void> {
    if (this.closed) throw new Error("CodeShare is closing.");
    const declaration = listCodeShareSubscriptionProviders().find(
      ({ id, supportsOwnerChat }) => id === provider && supportsOwnerChat,
    );
    const adapter = declaration && this.adapters.get(provider);
    if (!adapter?.startCodeShareLogin)
      throw new Error("This provider does not support subscription sign-in.");
    if (this.jobs.get(provider)?.state === "waiting") return;
    await this.refresh();
    if (this.closed) throw new Error("CodeShare is closing.");
    if (this.authenticated.has(provider) || this.jobs.get(provider)?.state === "waiting") return;
    const job: LoginJob = {
      state: "waiting",
      cancelled: false,
      acquiring: adapter.startCodeShareLogin(),
      done: Promise.resolve(),
    };
    this.jobs.set(provider, job);
    job.done = (async () => {
      try {
        job.handle = await job.acquiring;
        void job.handle.done.catch(() => undefined);
        if (job.cancelled) {
          await job.handle.cancel();
          return;
        }
        await job.handle.done;
        if (job.cancelled) return;
        await this.refresh();
        job.state = this.authenticated.has(provider) ? "connected" : "failed";
      } catch {
        if (!job.cancelled) job.state = "failed";
      }
    })();
  }
  async cancel(provider: string): Promise<void> {
    const job = this.jobs.get(provider);
    if (!job || job.state !== "waiting") return;
    job.cancelled = true;
    job.state = "idle";
    const handle = await job.acquiring.catch(() => undefined);
    await handle?.cancel();
    await job.done;
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.jobs.keys()].map((id) => this.cancel(id)));
  }
}
