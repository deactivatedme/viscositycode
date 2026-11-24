import { randomUUID } from "node:crypto";
import { configureSecretStorageKey } from "@/shared/secretStorage";
import { CodeShareSetupStore } from "@/host/codeshare/setupStore";
import { loadCodeShareSetupKey } from "@/host/codeshare/setupKey";
import { CodeShareProviderConfiguration } from "@/host/codeshare/providerConfiguration";
import { CodeShareCloudflareSetup } from "@/host/codeshare/cloudflareSetup";
import { CodeShareOwnerSetup } from "@/host/codeshare/setupService";
import { SupervisorClient } from "@/host/supervisor/SupervisorClient";
import { createSubscriptionRunner } from "@/host/codeshare/subscriptionRunner";
// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { HostOwnerLease } from "@/backend/ownership/hostOwnerLease";
import { resolveHostRootPaths } from "@/backend/ownership/hostRootPaths";
import { modelIdSchema, parseModel, type ShareModel } from "@/shared/codeShare";
import { getCodeShareSubscriptionProvider } from "@/shared/codeShareSubscriptionProviders";
import { startCodeShareHttp, type CodeShareHttpOptions } from "@/host/codeshare/http";
import {
  createProviderRunner,
  getCodeShareProvider,
  listCodeShareHostedProviders,
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

export function readCodeShareConfig(
  env: NodeJS.ProcessEnv,
  options: { allowMissingKeys?: boolean } = {},
): {
  adminPort: number;
  guestPort: number;
  guestOrigin: string;
  trustCloudflareClientIp: boolean;
  dataDir: string;
  models: ShareModel[];
  ownerModels?: ReadonlySet<string>;
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
      env.CODESHARE_PARTICIPANT_MODELS?.split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
  const configured = [...entries, ...localEntries];
  if (
    configured.length > 64 ||
    new Set(configured).size !== configured.length ||
    configured.some((id) => !modelIdSchema.safeParse(id).success)
  )
    throw new Error(
      "Configure 1–64 unique model IDs across CODESHARE_MODELS and CODESHARE_PARTICIPANT_MODELS.",
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
  const ownerEntries = (
    env.CODESHARE_OWNER_SUBSCRIPTION_MODELS ?? env.CODESHARE_SUBSCRIPTION_MODELS
  )
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (
    ownerEntries?.some(
      (id) =>
        !modelIdSchema.safeParse(id).success ||
        !getCodeShareSubscriptionProvider(parseModel(id).provider)?.supportsOwnerChat,
    )
  )
    throw new Error(
      "Owner subscriptions must use a supported OAuth chat provider and exact model ID.",
    );
  const ownerModels = ownerEntries ? new Set(ownerEntries) : undefined;
  if (ownerModels && [...ownerModels].some((id) => configured.includes(id)))
    throw new Error("A model cannot use both an owner's and a guest's subscription.");
  const requestedInviteModels = env.CODESHARE_INVITE_MODELS?.trim();
  const inviteModels = requestedInviteModels
    ? new Set(requestedInviteModels.split(",").map((model) => model.trim()))
    : undefined;
  if (
    inviteModels &&
    [...inviteModels].some((model) => !configured.includes(model) && !ownerModels?.has(model))
  )
    throw new Error("CODESHARE_INVITE_MODELS must list models configured on this host.");
  const keys: ProviderKeys = {};
  for (const model of models) {
    if (model.execution === "guest-subscription") continue;
    const provider = getCodeShareProvider(model.provider);
    if (!provider) throw new Error("A CodeShare model uses an unsupported provider.");
    const name = provider.keyEnvironmentVariable;
    const key = env[name]?.trim();
    if (key && /[\r\n]/u.test(key)) throw new Error(`Invalid ${name}.`);
    if (!key && !options.allowMissingKeys)
      throw new Error(`Set ${name} for the configured models.`);
    if (key) keys[model.provider] = key;
  }
  for (const provider of listCodeShareHostedProviders()) {
    const key = env[provider.keyEnvironmentVariable]?.trim();
    if (key && /[\r\n]/u.test(key)) throw new Error(`Invalid ${provider.keyEnvironmentVariable}.`);
    if (key) keys[provider.id] = key;
  }
  return {
    adminPort,
    guestPort,
    guestOrigin,
    trustCloudflareClientIp,
    models,
    ...(inviteModels ? { inviteModels } : {}),
    keys,
    ...(ownerModels ? { ownerModels } : {}),
    dataDir: resolve(env.CODESHARE_DATA_DIR?.trim() || join(homedir(), ".viscositycode-codeshare")),
  };
}

export async function runCodeShare(args: readonly string[]): Promise<void> {
  const checkOnly = args.length === 1 && args[0] === "--check-models";
  if (args.length && !checkOnly) throw new Error("Unexpected argument. Run codeshare --help.");
  const config = readCodeShareConfig(process.env, { allowMissingKeys: true });
  const paths = resolveHostRootPaths(join(config.dataDir, "share"));
  const lease = HostOwnerLease.acquire(paths, "headless");
  let supervisor: SupervisorClient | undefined;
  let service: CodeShareService | undefined;
  let setup: CodeShareOwnerSetup | undefined;
  let listener: Awaited<ReturnType<typeof startCodeShareHttp>> | undefined;
  let disposing: Promise<void> | undefined;
  const dispose = (): Promise<void> =>
    (disposing ??= (async () => {
      const failures: unknown[] = [];
      try {
        for (const close of [
          () => listener?.close(),
          () => setup?.close(),
          () => service?.close(),
          () => supervisor?.dispose(),
        ]) {
          try {
            await close();
          } catch (error) {
            failures.push(error);
          }
        }
        if (failures.length)
          throw new AggregateError(failures, "CodeShare shutdown was not confirmed.");
      } finally {
        lease.release();
      }
    })());
  try {
    mkdirSync(paths.dataRoot, { recursive: true, mode: 0o700 });
    const key = await loadCodeShareSetupKey(paths.dataRoot);
    configureSecretStorageKey(key);
    const setupStore = new CodeShareSetupStore(join(paths.dataRoot, "setup.enc"));
    await setupStore.load();
    supervisor = new SupervisorClient({
      baseDir: paths.dataRoot,
      appVersion: process.env.npm_package_version ?? "codeshare",
      isDev: false,
      supervisorPath: join(__dirname, "supervisor.cjs"),
      wslHelpersDir: join(__dirname, "wsl"),
      secretStorageKey: key,
      onEvent: () => {},
      onReset: () => {},
    });
    const providers = new CodeShareProviderConfiguration(
      config.models,
      config.keys,
      config.ownerModels,
      setupStore,
      supervisor,
    );
    const models = await providers.discover(checkOnly);
    if (checkOnly) {
      process.stdout.write(
        models
          .map(
            ({ id, execution }) =>
              `${execution === "owner-subscription" ? "Owner OAuth subscription" : execution === "guest-subscription" ? "Participant structured session" : "Verified API catalog"}: ${id}\n`,
          )
          .join(""),
      );
      await dispose();
      return;
    }
    const savedTunnel = setupStore.read().cloudflare;
    const existingHostname = setupStore.read().externalHostname;
    const initialOrigin = existingHostname
      ? `https://${existingHostname}`
      : savedTunnel?.phase === "routed"
        ? `https://${savedTunnel.hostname}`
        : config.guestOrigin;
    const runApi = createProviderRunner(providers.keys, globalThis.fetch, supervisor);
    const runSubscription = createSubscriptionRunner(supervisor);
    const store = new CodeShareStore(join(paths.dataRoot, "codeshare.sqlite"));
    service = new CodeShareService(
      store,
      initialOrigin,
      models,
      (input) =>
        input.model.execution === "owner-subscription" ? runSubscription(input) : runApi(input),
      undefined,
      undefined,
      config.inviteModels,
      () => providers.discover(),
    );
    const healthNonce = randomUUID();
    let httpOptions: CodeShareHttpOptions;
    const cloudflare = new CodeShareCloudflareSetup(
      join(paths.dataRoot, "cloudflare"),
      config.guestPort,
      setupStore,
      (origin) => {
        service!.setGuestOrigin(origin);
        httpOptions.guestOrigin = origin;
        httpOptions.trustCloudflareClientIp = true;
      },
      healthNonce,
    );
    setup = new CodeShareOwnerSetup(
      setupStore,
      providers.keys,
      supervisor,
      cloudflare,
      () => service!.refreshModels(),
      (provider) => providers.configuredModels(provider),
      () => providers.applyKeys(),
    );
    const ownerToken = shareSecret();
    httpOptions = {
      adminPort: config.adminPort,
      guestPort: config.guestPort,
      guestOrigin: initialOrigin,
      trustCloudflareClientIp:
        Boolean(existingHostname) ||
        savedTunnel?.phase === "routed" ||
        config.trustCloudflareClientIp,
      ownerToken,
      service,
      setup,
      healthNonce,
      subscriptionUsage: async (providerIds) =>
        (await supervisor!.call("getProviderUsage", { providerIds })).snapshots,
    };
    listener = await startCodeShareHttp(httpOptions);
    installShutdown("[codeshare]", dispose);
    await cloudflare.resume();
    lease.setPhase("ready");
    process.stdout.write(
      `Guest site: ${httpOptions.guestOrigin}\nPrivate owner link: ${listener.ownerOrigin}/#owner=${ownerToken}\n`,
    );
  } catch (error) {
    await dispose();
    throw error;
  }
}
