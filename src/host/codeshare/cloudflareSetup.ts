import { stripAnsiPreservingLayout } from "@/shared/ansi";
import { readBoundedResponseBody } from "@/shared/remote/responseBody";
import { stat, chmod, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writeFileAtomicAsync } from "@/shared/atomicFileAsync";
import { startManagedChildCommand, type ManagedChildCommand } from "@/shared/managedChildCommand";
import { shareHostnameSchema, type CodeShareSetupSnapshot } from "@/shared/codeShareSetup";
import type { CodeShareSetupStore } from "./setupStore";

export function cloudflareLoginUrl(output: string): string | undefined {
  for (const value of stripAnsiPreservingLayout(output).match(/https:\/\/[^\s<>"']+/gu) ?? []) {
    try {
      const url = new URL(value);
      if (
        url.hostname === "dash.cloudflare.com" &&
        url.pathname === "/argotunnel" &&
        !url.username &&
        !url.password
      )
        return url.href;
    } catch {
      /* Wait for a complete link. */
    }
  }
  return undefined;
}
export function cloudflareGuestConfig(
  hostname: string,
  tunnelId: string,
  credentials: string,
  guestPort: number,
) {
  return {
    tunnel: tunnelId,
    "credentials-file": credentials,
    "no-autoupdate": true,
    metrics: "127.0.0.1:0",
    ingress: [
      {
        hostname,
        service: `http://127.0.0.1:${guestPort}`,
        originRequest: { httpHostHeader: hostname },
      },
      { service: "http_status:404" },
    ],
  };
}

function cloudflareEnvironment(): NodeJS.ProcessEnv {
  const permitted = new Set([
    "PATH",
    "Path",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SystemRoot",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "USER",
    "LOGNAME",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
  ]);
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env))
    if (permitted.has(name) || name.startsWith("LC_")) env[name] = value;
  return { ...env, NO_AUTOUPDATE: "true", TUNNEL_FORCE_PROVISIONING_DNS: "false" };
}

type StartCommand = typeof startManagedChildCommand;
export class CodeShareCloudflareSetup {
  private login: ManagedChildCommand | undefined;
  private runner: ManagedChildCommand | undefined;
  private readonly operations = new Set<ManagedChildCommand>();
  private loginUrl: string | undefined;
  private failed = false;
  private verified = false;
  private publishing = false;
  private closed = false;
  private readonly work = new Set<Promise<unknown>>();
  private readonly lifetime = new AbortController();

  constructor(
    private readonly root: string,
    private readonly guestPort: number,
    private readonly store: CodeShareSetupStore,
    private readonly onOrigin: (origin: string) => void,
    private readonly healthNonce: string,
    private readonly start: StartCommand = startManagedChildCommand,
    private readonly request = globalThis.fetch,
    private readonly cert = join(homedir(), ".cloudflared", "cert.pem"),
  ) {}

  private own<T>(work: () => Promise<T>): Promise<T> {
    const pending = Promise.resolve().then(work);
    this.work.add(pending);
    void pending.finally(() => this.work.delete(pending)).catch(() => undefined);
    return pending;
  }

  private async hasCertificate(): Promise<boolean> {
    try {
      const file = await stat(this.cert);
      return file.isFile() && file.size > 0;
    } catch {
      return false;
    }
  }
  async snapshot(): Promise<CodeShareSetupSnapshot["cloudflare"]> {
    const connected = await this.hasCertificate();
    const saved = this.store.read();
    const config = saved.cloudflare;
    return {
      id: "cloudflare",
      label: "Cloudflare",
      connected,
      state: this.login ? "waiting" : this.failed ? "failed" : connected ? "connected" : "idle",
      ...(this.login && this.loginUrl ? { url: this.loginUrl } : {}),
      ...(this.failed
        ? { message: "Cloudflare setup needs attention. Check domain access and try again." }
        : {}),
      ...(config
        ? { hostname: config.hostname, tunnelId: config.tunnelId }
        : saved.externalHostname
          ? { hostname: saved.externalHostname, external: true }
          : {}),
      running: Boolean(this.runner),
      verified: this.verified,
      publishing: this.publishing,
    };
  }
  connect(): Promise<void> {
    return this.own(() => this.connectAccount());
  }
  private async connectAccount(): Promise<void> {
    if (this.closed) throw new Error("CodeShare is closing.");
    if (this.login || (await this.hasCertificate())) return;
    if (this.closed || this.login) return;
    this.failed = false;
    this.loginUrl = undefined;
    // Native cloudflared login intentionally uses its normal account certificate.
    // Upstream login refuses to overwrite an existing certificate.
    const login = this.start("cloudflared", ["tunnel", "login"], {
      timeoutMs: 5 * 60_000,
      env: cloudflareEnvironment(),
      onOutput: (output) => {
        this.loginUrl = cloudflareLoginUrl(output) ?? this.loginUrl;
      },
    });
    this.login = login;
    void login.done
      .then(
        async () => {
          this.failed = !(await this.hasCertificate());
        },
        () => {
          this.failed = true;
        },
      )
      .finally(() => {
        if (this.login === login) this.login = undefined;
        this.loginUrl = undefined;
      });
  }
  async cancelLogin(): Promise<void> {
    const login = this.login;
    await login?.cancel();
    if (this.login === login) this.login = undefined;
    this.loginUrl = undefined;
    this.failed = false;
  }
  private async command(args: string[]): Promise<string> {
    if (this.closed) throw new Error("CodeShare is closing.");
    const command = this.start(
      "cloudflared",
      ["tunnel", "--origincert", this.cert, "--no-autoupdate", ...args],
      {
        timeoutMs: 30_000,
        env: cloudflareEnvironment(),
      },
    );
    this.operations.add(command);
    try {
      return await command.done;
    } finally {
      this.operations.delete(command);
    }
  }
  useExisting(value: string): Promise<void> {
    return this.own(async () => {
      const hostname = shareHostnameSchema.parse(value);
      if (this.closed || this.publishing) throw new Error("Cloudflare setup is busy.");
      if (this.store.read().cloudflare)
        throw new Error(
          "This dashboard already manages a tunnel. Keep its existing management mode.",
        );
      await this.store.update((current) => ({ ...current, externalHostname: hostname }));
      if (this.closed) return;
      this.onOrigin(`https://${hostname}`);
      this.verified = false;
    });
  }
  publish(value: string): Promise<void> {
    return this.own(() => this.publishHost(value));
  }
  private async publishHost(value: string): Promise<void> {
    const hostname = shareHostnameSchema.parse(value);
    if (this.store.read().externalHostname)
      throw new Error("Use the existing-tunnel mode for this host.");
    if (this.closed || this.publishing) throw new Error("Cloudflare setup is busy.");
    this.publishing = true;
    if (!(await this.hasCertificate())) {
      this.publishing = false;
      throw new Error("Connect your Cloudflare account first.");
    }
    if (this.closed) {
      this.publishing = false;
      throw new Error("CodeShare is closing.");
    }
    const existing = this.store.read().cloudflare;
    this.publishing = true;
    this.failed = false;
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      let tunnelId = existing?.tunnelId;
      const credentials = join(this.root, "tunnel-credentials.json");
      if (!tunnelId) {
        const output = await this.command([
          "create",
          "--output",
          "json",
          "--credentials-file",
          credentials,
          "codeshare-" + randomUUID(),
        ]);
        tunnelId = z.object({ id: z.uuid() }).parse(JSON.parse(output)).id;
        await chmod(credentials, 0o600);
        // Journal ownership before DNS changes. A failed later step can be retried
        // against this exact tunnel without replacing an unrelated DNS record.
        await this.store.update((current) => ({
          ...current,
          cloudflare: { hostname, tunnelId: tunnelId!, enabled: false, phase: "created" },
        }));
      }
      if (existing?.phase !== "routed" || existing.hostname !== hostname)
        await this.command(["route", "dns", tunnelId, hostname]);
      if (this.closed) throw new Error("CodeShare is closing.");
      await this.store.update((current) => ({
        ...current,
        cloudflare: { hostname, tunnelId: tunnelId!, enabled: true, phase: "routed" },
      }));
      if (this.closed) throw new Error("CodeShare is closing.");
      await this.startTunnel(hostname, tunnelId, credentials);
    } catch (error) {
      this.failed = true;
      throw error;
    } finally {
      this.publishing = false;
    }
  }
  private async startTunnel(
    hostname: string,
    tunnelId: string,
    credentials: string,
  ): Promise<void> {
    if (this.closed) throw new Error("CodeShare is closing.");
    await this.stopTunnel();
    const configPath = join(this.root, "tunnel.json");
    await writeFileAtomicAsync(
      configPath,
      JSON.stringify(cloudflareGuestConfig(hostname, tunnelId, credentials, this.guestPort)),
      { mode: 0o600 },
    );
    this.onOrigin(`https://${hostname}`);
    if (this.closed) throw new Error("CodeShare is closing.");
    const runner = this.start(
      "cloudflared",
      ["tunnel", "--config", configPath, "--no-autoupdate", "run", tunnelId],
      {
        timeoutMs: 0,
        captureOutput: false,
        env: cloudflareEnvironment(),
      },
    );
    this.runner = runner;
    this.verified = false;
    void runner.done
      .catch(() => {
        if (!this.closed && this.runner === runner) this.failed = true;
      })
      .finally(() => {
        if (this.runner === runner) {
          this.runner = undefined;
          this.verified = false;
        }
      });
  }
  resume(): Promise<void> {
    return this.own(() => this.resumeSaved());
  }
  private async resumeSaved(): Promise<void> {
    if (this.closed) return;
    const saved = this.store.read();
    if (saved.externalHostname) {
      this.onOrigin(`https://${saved.externalHostname}`);
      return;
    }
    const config = saved.cloudflare;
    if (!config || !config.enabled || config.phase !== "routed") return;
    try {
      const credentials = join(this.root, "tunnel-credentials.json");
      // Validate identity before handing an existing credential file to cloudflared.
      const credentialReceipt = z
        .object({ TunnelID: z.uuid() })
        .parse(JSON.parse(await readFile(credentials, "utf8")));
      if (credentialReceipt.TunnelID !== config.tunnelId)
        throw new Error("Cloudflare credential identity does not match.");
      await this.startTunnel(config.hostname, config.tunnelId, credentials);
    } catch {
      this.failed = true;
    }
  }
  check(): Promise<boolean> {
    return this.own(() => this.checkPublic());
  }
  private async checkPublic(): Promise<boolean> {
    const saved = this.store.read();
    const hostname = saved.externalHostname ?? saved.cloudflare?.hostname;
    if (!hostname || (!saved.externalHostname && !this.runner)) return false;
    try {
      const response = await this.request(`https://${hostname}/.well-known/codeshare-health`, {
        signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(8_000)]),
        redirect: "error",
        cache: "no-store",
      });
      const bytes = await readBoundedResponseBody(response, 8192);
      const body = z
        .object({ nonce: z.string() })
        .safeParse(JSON.parse(new TextDecoder().decode(bytes)));
      this.verified = response.ok && body.success && body.data.nonce === this.healthNonce;
    } catch {
      this.verified = false;
    }
    return this.verified;
  }
  disable(): Promise<void> {
    return this.own(async () => {
      if (this.publishing)
        throw new Error("Wait for publishing to finish before stopping the tunnel.");
      await this.store.update((current) => ({
        ...current,
        ...(current.cloudflare ? { cloudflare: { ...current.cloudflare, enabled: false } } : {}),
      }));
      await this.stopTunnel();
    });
  }
  async stopTunnel(): Promise<void> {
    const runner = this.runner;
    this.runner = undefined;
    this.verified = false;
    await runner?.cancel();
  }
  async close(): Promise<void> {
    this.closed = true;
    this.lifetime.abort();
    await Promise.all([
      this.stopTunnel(),
      this.login?.cancel(),
      ...[...this.operations].map((command) => command.cancel()),
    ]);
    await Promise.allSettled([...this.work]);
  }
}
