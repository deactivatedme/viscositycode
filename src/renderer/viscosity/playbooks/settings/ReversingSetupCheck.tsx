/**
 * ViscosityCode: "Reversing setup" in the Reversing and Live reversing
 * editors. Shows what the live_re helper found on this computer (tools and
 * per-target readiness) with install hints for the user to run. It never
 * installs or changes anything; the only actions are "Check again" and, for
 * Live reversing, adding the switched-off IDA debugger server to the app's
 * MCP settings. Desktop only: elsewhere it renders nothing.
 */
import { useEffect, useState } from "react";
import { Chip } from "@heroui/react";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { RefreshCw } from "lucide-react";
import { Button } from "@/renderer/components/common/Button";
import { sharedSettingsServerPersistence } from "@/renderer/components/mcp/mcpServersMutation";
import { readBridge } from "@/renderer/bridge";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import type { LiveReEnvironment, LiveReEnvironmentReply } from "@/shared/viscosity/liveRe";
import { getLiveReEnvironmentCheck, type CheckLiveReEnvironment } from "../liveReBridge";
import { addIdaDebuggerServer, hasIdaDebuggerServer } from "./addIdaDebuggerServer";

type TargetKey = keyof LiveReEnvironment["targets"];
type TargetState = LiveReEnvironment["targets"][TargetKey]["state"];
type ToolStatus = LiveReEnvironment["tools"][number]["status"];
type HostOs = "macos" | "windows" | "other";

const TARGET_ORDER: readonly TargetKey[] = [
  "macosApps",
  "iosSimulator",
  "iosDevice",
  "android",
  "windows",
];
const CHIP_COLOR = {
  ready: "success",
  found: "success",
  limited: "warning",
  missing: "warning",
  unavailable: "default",
  unknown: "default",
} as const satisfies Record<TargetState | ToolStatus, string>;

function hostOs(environment: LiveReEnvironment): HostOs {
  const os = environment.host.os;
  return os === "macos" || os === "windows" ? os : "other";
}

export function ReversingSetupCheck(props: { idaDebugger?: boolean }) {
  const check = getLiveReEnvironmentCheck();
  if (!check) return null;
  return <ReversingSetupPanel check={check} idaDebugger={props.idaDebugger === true} />;
}

function ReversingSetupPanel(props: { check: CheckLiveReEnvironment; idaDebugger: boolean }) {
  const { t } = useLingui();
  const [reply, setReply] = useState<LiveReEnvironmentReply | "checking">("checking");
  const { check } = props;

  useEffect(() => {
    let active = true;
    void check().then((next) => {
      if (active) setReply(next);
    });
    return () => {
      active = false;
    };
  }, [check]);

  return (
    <section
      aria-label={t`Reversing setup`}
      className="space-y-2 rounded-xl border border-[var(--hairline)] p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{t`Reversing setup`}</p>
          <p className="text-[11px] text-muted">
            {t`Which debugging tools this computer has. Nothing is installed or changed.`}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          isDisabled={reply === "checking"}
          onPress={() => {
            setReply("checking");
            void check().then(setReply);
          }}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          {t`Check again`}
        </Button>
      </div>
      {reply === "checking" ? (
        <p className="text-xs text-muted">{t`Checking…`}</p>
      ) : (
        <SetupReply reply={reply} />
      )}
      {props.idaDebugger ? <AddIdaDebugger /> : null}
    </section>
  );
}

function SetupReply(props: { reply: LiveReEnvironmentReply }) {
  const { t } = useLingui();
  const { reply } = props;
  if (reply.status === "missing") {
    // The helper is only built for macOS and Windows; elsewhere the build hint does nothing.
    const platform = readBridge()?.platform;
    if (platform !== "darwin" && platform !== "win32") {
      return (
        <p role="status" className="text-xs text-muted">
          {t`Live debugging isn't available on this platform, so live_re is unavailable.`}
        </p>
      );
    }
    return (
      <div className="space-y-1 text-xs text-muted">
        <p role="status">{t`The live debugging helper isn't part of this build, so live_re is unavailable.`}</p>
        <Hint
          text={t`Builds from source include it when Rust is installed:`}
          command="bun run prepare:live-re"
        />
      </div>
    );
  }
  if (reply.status === "update-needed") {
    return (
      <p role="status" className="text-xs text-muted">
        {t`The live debugging helper doesn't match this app version. Update ViscosityCode or rebuild the helper.`}
      </p>
    );
  }
  if (reply.status === "error") {
    const text =
      reply.code === "timeout"
        ? t`The check took too long. Try again.`
        : reply.code === "unavailable"
          ? t`The desktop app can't run the check right now. Restart ViscosityCode and try again.`
          : t`The check failed. Try again.`;
    return (
      <p role="alert" className="text-xs text-danger">
        {text}
      </p>
    );
  }
  return <EnvironmentReport environment={reply.environment} />;
}

function EnvironmentReport(props: { environment: LiveReEnvironment }) {
  const { t } = useLingui();
  const { environment } = props;
  const os = hostOs(environment);
  const toolLabels: Record<string, string> = {
    "lldb-dap": t`LLDB debugger (lldb-dap)`,
    "developer-dir": t`Xcode or Command Line Tools`,
    simctl: t`iOS Simulator tools (simctl)`,
    devicectl: t`iOS device tools (devicectl)`,
    adb: t`Android Debug Bridge (adb)`,
  };
  const targetLabels: Record<TargetKey, string> = {
    macosApps: t`macOS apps`,
    iosSimulator: t`iOS Simulator`,
    iosDevice: t`iOS devices`,
    android: t`Android`,
    windows: t`Windows programs`,
  };
  const toolStatus: Record<ToolStatus, string> = {
    found: t`Found`,
    missing: t`Not found`,
    unknown: t`Unknown`,
  };
  const targetStatus: Record<TargetState, string> = {
    ready: t`Ready`,
    limited: t`Limited`,
    unavailable: t`Unavailable`,
  };
  // Rows for another operating system's targets are noise; the report marks them `other-os`.
  const targets = TARGET_ORDER.filter((key) => environment.targets[key].reason !== "other-os");
  return (
    <div className="space-y-3">
      <ul aria-label={t`Tools`} className="space-y-1.5">
        {environment.tools.map((tool) => {
          const hint =
            tool.status === "missing"
              ? toolHint(tool.id, os)
              : tool.status === "unknown" && tool.id === "lldb-dap"
                ? {
                    text: msg`lldb-dap was found but cannot start. Run lldb-dap --version to see why.`,
                  }
                : undefined;
          return (
            <li key={tool.id} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-foreground">
                  {toolLabels[tool.id] ?? tool.id}
                </span>
                <Chip size="sm" variant="soft" color={CHIP_COLOR[tool.status]}>
                  {toolStatus[tool.status]}
                </Chip>
              </div>
              {(tool.status === "found" || tool.status === "unknown") &&
              (tool.version ?? tool.path) ? (
                <p className="truncate font-mono text-[11px] text-muted" title={tool.path}>
                  {tool.version ?? tool.path}
                </p>
              ) : null}
              {hint ? (
                <Hint text={t(hint.text)} {...(hint.command ? { command: hint.command } : {})} />
              ) : null}
            </li>
          );
        })}
      </ul>
      <ul aria-label={t`Targets`} className="space-y-1.5">
        {targets.map((key) => {
          const target = environment.targets[key];
          return (
            <li key={key} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-foreground">{targetLabels[key]}</span>
                <Chip size="sm" variant="soft" color={CHIP_COLOR[target.state]}>
                  {targetStatus[target.state]}
                </Chip>
              </div>
              <p className="text-[11px] text-muted">{t(targetReason(target.reason))}</p>
            </li>
          );
        })}
      </ul>
      {os === "macos" && environment.sip !== "disabled" ? (
        <p className="text-[11px] text-muted">
          {t`System Integrity Protection is on, as it should be. It blocks debugging Apple-signed and hardened apps; use your own builds, copies or the iOS Simulator instead. Live reversing never asks you to turn it off.`}
        </p>
      ) : null}
    </div>
  );
}

/** Install hints are descriptors, translated by the caller (the `msg` macro only works in components). */
function toolHint(
  id: string,
  os: HostOs,
): { text: MessageDescriptor; command?: string } | undefined {
  switch (id) {
    case "lldb-dap":
      if (os === "macos")
        return {
          text: msg`Install Xcode, or the Command Line Tools with:`,
          command: "xcode-select --install",
        };
      if (os === "windows")
        return {
          text: msg`Install LLVM, which includes lldb-dap:`,
          command: "winget install LLVM.LLVM",
        };
      return { text: msg`Install LLDB with lldb-dap from your package manager.` };
    case "developer-dir":
      return { text: msg`Install the Command Line Tools:`, command: "xcode-select --install" };
    case "simctl":
    case "devicectl":
      return {
        text: msg`Install Xcode from the App Store, then select it:`,
        command: "sudo xcode-select -s /Applications/Xcode.app",
      };
    case "adb":
      if (os === "macos")
        return {
          text: msg`Install Android SDK Platform-Tools (or download them from developer.android.com):`,
          command: "brew install --cask android-platform-tools",
        };
      if (os === "windows")
        return {
          text: msg`Install Android SDK Platform-Tools:`,
          command: "winget install Google.PlatformTools",
        };
      return { text: msg`Install Android SDK Platform-Tools from developer.android.com.` };
    default:
      return undefined;
  }
}

function targetReason(reason: string): MessageDescriptor {
  switch (reason) {
    case "ready":
      return msg`Ready to debug.`;
    case "sip-enabled":
      return msg`Your own, ad-hoc signed and non-hardened builds only.`;
    case "no-developer-dir":
      return msg`Needs Xcode or the Command Line Tools.`;
    case "no-xcode":
      return msg`Needs the full Xcode app.`;
    case "development-signed-only":
      return msg`Development-signed apps with get-task-allow only.`;
    case "debuggable-apps-only":
      return msg`Debuggable apps, or any app on a rooted test device.`;
    case "no-adb":
      return msg`Needs Android SDK Platform-Tools (adb).`;
    case "no-debugger":
      return msg`Needs the LLDB debugger (lldb-dap).`;
    case "debugger-needs-python":
      return msg`LLDB is installed but cannot load Python. Install the Python version your LLVM release was built against (on Windows, the one matching its python3XX.dll). Reinstalling LLVM does not fix this.`;
    case "debugger-missing-library":
      return msg`LLDB is installed but a library it needs is missing. Reinstall LLDB or LLVM.`;
    case "debugger-failed":
      return msg`LLDB is installed but could not start. Run lldb-dap --version to see the error.`;
    default:
      return msg`Not available on this computer.`;
  }
}

/** An install hint for the user to run themselves; the command is selectable, never run. */
function Hint(props: { text: string; command?: string }) {
  return (
    <p className="text-[11px] text-muted">
      {props.text}
      {props.command ? (
        <>
          {" "}
          <code className="rounded bg-[var(--hairline)] px-1 font-mono select-all">
            {props.command}
          </code>
        </>
      ) : null}
    </p>
  );
}

function AddIdaDebugger() {
  const { t } = useLingui();
  const added = useSharedSettings((state) => hasIdaDebuggerServer(state.mcpServers));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<"no-source" | "failed" | undefined>();

  async function add() {
    setBusy(true);
    setProblem(undefined);
    try {
      const result = await addIdaDebuggerServer({
        persistence: sharedSettingsServerPersistence(),
        discover: async () =>
          (await readBridge().discoverExternalMcpServers({ sourceScope: "user" })).groups.flatMap(
            (group) => group.servers,
          ),
        description: t`IDA Pro with its debugger tools (--unsafe). Switched on per chat by Live reversing.`,
      });
      if (result === "no-source") setProblem("no-source");
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5 border-t border-[var(--hairline)] pt-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">{t`IDA debugger server`}</p>
        <Button size="sm" variant="tertiary" isDisabled={added || busy} onPress={() => void add()}>
          {added ? t`Added` : t`Add IDA debugger server`}
        </Button>
      </div>
      <p className="text-[11px] text-muted">
        {t`Adds a copy of your ida-pro-mcp server named ida-pro-mcp-debug, started with --unsafe so the agent can use IDA's debugger tools on a session you start in IDA. It is added switched off; Live reversing turns it on only in its own chats, and each tool call follows the chat's approval setting: it asks for your approval unless the chat skips approvals (Autopilot or full access). Your agents' own config files are not changed.`}
      </p>
      {problem ? (
        <p role="alert" className="text-[11px] text-danger">
          {problem === "no-source"
            ? t`No ida-pro-mcp server found. Add it in Settings → MCP servers first.`
            : t`The server couldn't be saved. Try again.`}
        </p>
      ) : null}
    </div>
  );
}
