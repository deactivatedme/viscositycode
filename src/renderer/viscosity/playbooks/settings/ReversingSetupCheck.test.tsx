import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import type { McpServer } from "@/shared/contracts";
import type { LiveReEnvironment, LiveReEnvironmentReply } from "@/shared/viscosity/liveRe";
import { ReversingSetupCheck } from "./ReversingSetupCheck";

const persistence = vi.hoisted(() => ({
  loadServers: vi.fn<() => Promise<McpServer[]>>(),
  saveServers: vi.fn<(servers: McpServer[]) => Promise<void>>(),
}));
const host = vi.hoisted(() => ({ platform: "darwin" }));
vi.mock("@/renderer/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/bridge")>()),
  readBridge: () => ({ platform: host.platform }),
}));
vi.mock("@/renderer/components/mcp/mcpServersMutation", () => ({
  sharedSettingsServerPersistence: () => persistence,
}));

const mac: LiveReEnvironment = {
  environmentVersion: 1,
  helperVersion: "0.1.0",
  protocolVersion: 1,
  host: { os: "macos", arch: "aarch64" },
  tools: [
    { id: "lldb-dap", status: "found", path: "/usr/bin/lldb-dap", version: "lldb-1700" },
    { id: "developer-dir", status: "found", path: "/Library/Developer/CommandLineTools" },
    { id: "simctl", status: "missing" },
    { id: "devicectl", status: "missing" },
    { id: "adb", status: "missing" },
  ],
  sip: "enabled",
  devToolsSecurity: "enabled",
  targets: {
    macosApps: { state: "limited", reason: "sip-enabled" },
    iosSimulator: { state: "unavailable", reason: "no-xcode" },
    iosDevice: { state: "unavailable", reason: "no-xcode" },
    android: { state: "unavailable", reason: "no-adb" },
    windows: { state: "unavailable", reason: "other-os" },
  },
};
const windows: LiveReEnvironment = {
  ...mac,
  host: { os: "windows", arch: "x86_64" },
  tools: [
    { id: "lldb-dap", status: "missing" },
    { id: "adb", status: "missing" },
  ],
  sip: "not-applicable",
  targets: {
    macosApps: { state: "unavailable", reason: "other-os" },
    iosSimulator: { state: "unavailable", reason: "other-os" },
    iosDevice: { state: "unavailable", reason: "other-os" },
    android: { state: "unavailable", reason: "no-adb" },
    windows: { state: "unavailable", reason: "no-debugger" },
  },
};

let checkEnvironment: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
function install(reply: unknown) {
  checkEnvironment = vi.fn<() => Promise<unknown>>(async () => reply);
  Object.assign(window, { viscosityHost: { liveRe: { available: true, checkEnvironment } } });
}
const ok = (environment: LiveReEnvironment): LiveReEnvironmentReply => ({
  status: "ok",
  environment,
});

beforeEach(() => {
  persistence.loadServers.mockReset();
  persistence.saveServers.mockReset().mockResolvedValue(undefined);
  useSharedSettings.setState({ mcpServers: [] } as never);
});
afterEach(() => {
  Reflect.deleteProperty(window, "viscosityHost");
});

describe("ReversingSetupCheck", () => {
  it("renders nothing without the desktop bridge", () => {
    const { container } = render(<ReversingSetupCheck idaDebugger />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows tools, this OS's targets, Mac hints and the SIP note; it only checks", async () => {
    install(ok(mac));
    render(<ReversingSetupCheck />);
    const tools = await screen.findByRole("list", { name: "Tools" });
    expect(within(tools).getByText("LLDB debugger (lldb-dap)")).toBeInTheDocument();
    expect(within(tools).getByText("lldb-1700")).toBeInTheDocument();
    expect(within(tools).getAllByText("Not found")).toHaveLength(3);
    expect(
      within(tools).getByText("brew install --cask android-platform-tools"),
    ).toBeInTheDocument();
    expect(within(tools).getAllByText("sudo xcode-select -s /Applications/Xcode.app")).toHaveLength(
      2,
    );
    const targets = screen.getByRole("list", { name: "Targets" });
    expect(within(targets).getByText("macOS apps")).toBeInTheDocument();
    expect(within(targets).getByText("Limited")).toBeInTheDocument();
    expect(within(targets).queryByText("Windows programs")).not.toBeInTheDocument();
    expect(screen.getByText(/System Integrity Protection is on/)).toBeInTheDocument();
    // No install or run action: the only control is Check again.
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Check again",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(checkEnvironment).toHaveBeenCalledTimes(2));
  });

  it("gives Windows hints and hides the Mac targets", async () => {
    install(ok(windows));
    render(<ReversingSetupCheck />);
    expect(await screen.findByText("winget install LLVM.LLVM")).toBeInTheDocument();
    expect(screen.getByText("winget install Google.PlatformTools")).toBeInTheDocument();
    expect(screen.getByText("Windows programs")).toBeInTheDocument();
    expect(screen.getByText("Needs the LLDB debugger (lldb-dap).")).toBeInTheDocument();
    expect(screen.queryByText("macOS apps")).not.toBeInTheDocument();
    expect(screen.queryByText(/System Integrity Protection/)).not.toBeInTheDocument();
  });

  it("explains an lldb-dap that is installed but cannot start", async () => {
    install(
      ok({
        ...windows,
        tools: [
          { id: "lldb-dap", status: "unknown", path: "C:\\LLVM\\bin\\lldb-dap.exe" },
          { id: "adb", status: "found", path: "C:\\adb.exe" },
        ],
        targets: {
          ...windows.targets,
          windows: { state: "limited", reason: "debugger-needs-python" },
        },
      }),
    );
    render(<ReversingSetupCheck />);
    expect(await screen.findByText(/cannot load Python/)).toBeInTheDocument();
    expect(screen.getByText("C:\\LLVM\\bin\\lldb-dap.exe")).toBeInTheDocument();
    expect(screen.getByText(/lldb-dap was found but cannot start/)).toBeInTheDocument();
    expect(screen.queryByText("winget install LLVM.LLVM")).not.toBeInTheDocument();
  });

  it.each([
    [{ status: "missing" }, /isn't part of this build/],
    [{ status: "update-needed" }, /doesn't match this app version/],
    [{ status: "error", code: "timeout" }, /took too long/],
    [{ environmentVersion: 2 }, /The check failed/],
  ])("handles the %o reply", async (reply, text) => {
    install(reply);
    render(<ReversingSetupCheck />);
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("offers the build command only where a helper can be built", async () => {
    install({ status: "missing" });
    const onMac = render(<ReversingSetupCheck />);
    expect(await screen.findByText("bun run prepare:live-re")).toBeInTheDocument();
    onMac.unmount();
    host.platform = "linux";
    try {
      render(<ReversingSetupCheck />);
      expect(await screen.findByText(/isn't available on this platform/)).toBeInTheDocument();
      expect(screen.queryByText("bun run prepare:live-re")).not.toBeInTheDocument();
    } finally {
      host.platform = "darwin";
    }
  });

  it("reports a bridge that rejects as unavailable", async () => {
    install(undefined);
    checkEnvironment.mockRejectedValue(new Error("No handler registered"));
    render(<ReversingSetupCheck />);
    expect(await screen.findByText(/can't run the check right now/)).toBeInTheDocument();
  });

  it("adds the IDA debugger server through the app's MCP settings, then shows Added", async () => {
    install(ok(mac));
    const ida: McpServer = {
      id: "srv-ida",
      name: "ida-pro-mcp",
      description: "",
      enabled: true,
      timeoutMs: 30_000,
      transport: { type: "stdio", command: "ida-pro-mcp", args: [], env: {} },
    };
    persistence.loadServers.mockResolvedValue([ida]);
    persistence.saveServers.mockImplementation(async (servers) => {
      useSharedSettings.setState({ mcpServers: servers } as never);
    });
    render(<ReversingSetupCheck idaDebugger />);
    expect(
      screen.getByText(
        /follows the chat's approval setting: it asks for your approval unless the chat skips approvals/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add IDA debugger server" }));
    expect(await screen.findByRole("button", { name: "Added" })).toBeDisabled();
    expect(persistence.saveServers).toHaveBeenCalledExactlyOnceWith([
      ida,
      expect.objectContaining({
        name: "ida-pro-mcp-debug",
        enabled: false,
        transport: expect.objectContaining({ args: ["--unsafe"] }),
      }),
    ]);
  });
});
