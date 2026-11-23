// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { HostOwnerLease } from "@/backend/ownership/hostOwnerLease";
import { resolveHostRootPaths } from "@/backend/ownership/hostRootPaths";
import { modelIdSchema, parseModel, type ShareModel } from "@/shared/codeShare";
import { getCodeShareSubscriptionProvider } from "@/shared/codeShareSubscriptionProviders";
import { verifyCodeShareModels } from "@/host/codeshare/checkModels";
import { startCodeShareHttp } from "@/host/codeshare/http";
import {
  createProviderRunner,
  getCodeShareProvider,
  type ProviderKeys,
} from "@/host/codeshare/providers";
import { CodeShareService } from "@/host/codeshare/service";
import { CodeShareStore, shareSecret } from "@/host/codeshare/store";
import { installShutdown } from "./cliRuntime";

function readPort(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = env[name];
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error(`${name} must be a port between 1024 and 65535.`);
  return port;
}

function publicOrigin(configured: string | undefined, guestPort: number): string {
  const loopback = `http://127.0.0.1:${guestPort}`;
  if (!configured) return loopback;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("CODESHARE_PUBLIC_ORIGIN must be an HTTPS origin.");
  }
  if (url.origin === loopback && url.href === loopback + "/") return loopback;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.href !== url.origin + "/" ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]"
  ) {
    throw new Error(
      "CODESHARE_PUBLIC_ORIGIN must be an HTTPS origin with no path, query, or fragment.",
    );
  }
  return url.origin;
}

export function readCodeShareConfig(env: NodeJS.ProcessEnv): {
  adminPort: number;
  guestPort: number;
  guestOrigin: string;
  trustCloudflareClientIp: boolean;
  dataDir: string;
  models: ShareModel[];
  inviteModels?: ReadonlySet<string>;
  keys: ProviderKeys;
} {
  const guestPort = readPort(env, "CODESHARE_GUEST_PORT", 8787);
  const adminPort = readPort(env, "CODESHARE_ADMIN_PORT", 8788);
  if (guestPort === adminPort) throw new Error("CodeShare needs distinct guest and owner ports.");
  const guestOrigin = publicOrigin(env.CODESHARE_PUBLIC_ORIGIN?.trim(), guestPort);
  const trustCloudflareClientIp = env.CODESHARE_CLOUDFLARE_TUNNEL === "1";
  if (trustCloudflareClientIp && !guestOrigin.startsWith("https://"))
    throw new Error("Set an HTTPS CODESHARE_PUBLIC_ORIGIN before enabling Cloudflare client IPs.");
  const entries = [
    ...new Set(
      env.CODESHARE_MODELS?.split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
  const localEntries = [
    ...new Set(
      env.CODESHARE_SUBSCRIPTION_MODELS?.split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
  const configured = [...entries, ...localEntries];
  if (
    !configured.length ||
    configured.length > 64 ||
    new Set(configured).size !== configured.length ||
    configured.some((id) => !modelIdSchema.safeParse(id).success)
  )
    throw new Error(
      "Configure 1–64 unique model IDs across CODESHARE_MODELS and CODESHARE_SUBSCRIPTION_MODELS.",
    );
  const models: ShareModel[] = [
    ...entries.map(parseModel),
    ...localEntries.map((id) => {
      const model = parseModel(id);
      if (!getCodeShareSubscriptionProvider(model.provider))
        throw new Error("Guest sign-in models use codex:<id>, claude:<id>, or devin:<id>.");
      return { ...model, execution: "guest-subscription" as const };
    }),
  ];
  const requestedInviteModels = env.CODESHARE_INVITE_MODELS?.trim();
  const inviteModels = requestedInviteModels
    ? new Set(requestedInviteModels.split(",").map((model) => model.trim()))
    : undefined;
  if (inviteModels && [...inviteModels].some((model) => !configured.includes(model)))
    throw new Error("CODESHARE_INVITE_MODELS must list models configured on this host.");
  const keys: ProviderKeys = {};
  for (const model of models) {
    if (model.execution === "guest-subscription") continue;
    const provider = getCodeShareProvider(model.provider);
    if (!provider) throw new Error("A CodeShare model uses an unsupported provider.");
    const name = provider.keyEnvironmentVariable;
    const key = env[name]?.trim();
    if (!key || /[\r\n]/u.test(key)) throw new Error(`Set ${name} for the configured models.`);
    keys[model.provider] = key;
  }
  return {
    adminPort,
    guestPort,
    guestOrigin,
    trustCloudflareClientIp,
    models,
    ...(inviteModels ? { inviteModels } : {}),
    keys,
    dataDir: resolve(env.CODESHARE_DATA_DIR?.trim() || join(homedir(), ".viscositycode-codeshare")),
  };
}

export async function runCodeShare(args: readonly string[]): Promise<void> {
  const checkOnly = args.length === 1 && args[0] === "--check-models";
  if (args.length && !checkOnly) throw new Error("Unexpected argument. Run codeshare --help.");
  const config = readCodeShareConfig(process.env);
  const hostedModels = config.models.filter((model) => model.execution !== "guest-subscription");
  await verifyCodeShareModels(hostedModels, config.keys);
  if (checkOnly) {
    process.stdout.write(
      config.models
        .map(({ id, execution }) =>
          execution === "guest-subscription"
            ? `Checked at launch on guest desktop: ${id}\n`
            : `Verified catalogue ID: ${id}\n`,
        )
        .join(""),
    );
    return;
  }
  const paths = resolveHostRootPaths(join(config.dataDir, "share"));
  const lease = HostOwnerLease.acquire(paths, "headless");
  let service: CodeShareService | undefined;
  let listener: Awaited<ReturnType<typeof startCodeShareHttp>> | undefined;

  const dispose = async () => {
    try {
      await listener?.close();
      await service?.close();
    } finally {
      lease.release();
    }
  };

  try {
    mkdirSync(paths.dataRoot, { recursive: true, mode: 0o700 });
    const store = new CodeShareStore(join(paths.dataRoot, "codeshare.sqlite"));
    service = new CodeShareService(
      store,
      config.guestOrigin,
      config.models,
      createProviderRunner(config.keys),
      undefined,
      undefined,
      config.inviteModels,
    );
    const ownerToken = shareSecret();
    listener = await startCodeShareHttp({
      adminPort: config.adminPort,
      guestPort: config.guestPort,
      guestOrigin: config.guestOrigin,
      trustCloudflareClientIp: config.trustCloudflareClientIp,
      ownerToken,
      service,
    });
    lease.setPhase("ready");
    installShutdown("[codeshare]", dispose);
    process.stdout.write(
      `Guest site: ${config.guestOrigin}\nPrivate owner link: ${listener.ownerOrigin}/#owner=${ownerToken}\n`,
    );
  } catch (error) {
    await dispose();
    throw error;
  }
}
