import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { viscosityCommands } from "@/renderer/viscosity/commands/viscosityCommands";
import { CodeShareDialog } from "./CodeShareDialog";
import { JOIN_CODE_SHARE_COMMAND, useCodeSharePanel } from "./codeShareCommand";

const local = vi.hoisted(() => ({
  configure: vi.fn<(input: unknown) => Promise<{ connected: boolean }>>(),
  refresh: vi.fn<() => Promise<void>>(),
  signIn: vi.fn<(provider: string) => void>(),
  prepare:
    vi.fn<
      (
        provider: string,
        model: string,
        prompt: string,
        threadId: string,
      ) => Promise<() => Promise<boolean>>
    >(),
}));
vi.mock("@/renderer/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/renderer/bridge")>()),
  readBridge: () => ({
    configureCodeShareProjects: local.configure,
    refreshAgentStatuses: local.refresh,
  }),
}));
vi.mock("./subscription", () => ({
  canRunCodeShareSubscription: () => true,
  openCodeShareSubscriptionSignIn: local.signIn,
  prepareCodeShareSubscriptionLaunch: local.prepare,
}));

vi.mock("@/renderer/state/remoteServers/tokenVault", () => ({
  getDesktopToken: vi.fn<() => Promise<null>>().mockResolvedValue(null),
  setDesktopToken: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  deleteDesktopToken: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

afterEach(() => {
  useCodeSharePanel.setState({ open: false });
  vi.unstubAllGlobals();
  local.configure.mockReset();
  local.refresh.mockReset();
});

it("installs a redeemed app code into the guest model catalog instead of opening guest chat", async () => {
  local.configure.mockResolvedValue({ connected: true });
  local.refresh.mockResolvedValue();
  const token = "A".repeat(43);
  const origin = "https://share.example.test";
  const state = {
    serverNow: Date.now(),
    expiresAt: Date.now() + 60_000,
    status: "active",
    turnsRemaining: 4,
    projectProtocol: 1,
    models: [{ id: "demo:one", provider: "demo", model: "one", remoteEditing: true }],
    turns: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/claim")) return Response.json({ claim: token + "." + "B".repeat(43) });
      if (path.endsWith("/redeem")) return Response.json({ token, state });
      return Response.json(state);
    }),
  );
  useCodeSharePanel.setState({ open: true });
  render(<CodeShareDialog />);
  fireEvent.change(await screen.findByLabelText("Invite code or link"), {
    target: { value: "CS1." + btoa(origin) + "." + "A".repeat(22) },
  });
  const join = screen.getByRole("button", { name: "Join" });
  await waitFor(() => expect(join).toBeEnabled());
  fireEvent.click(join);
  expect(await screen.findByText(/project’s model picker/)).toBeInTheDocument();
  expect(local.configure).toHaveBeenCalledWith({ action: "connect", origin, token });
  expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Leave share" }));
  await waitFor(() =>
    expect(local.configure).toHaveBeenLastCalledWith({ action: "disconnect", origin, token }),
  );
});

it("opens from the registered command, joins, submits to the approved model, and displays its answer", async () => {
  const token = "A".repeat(43);
  const model = { id: "demo:one", provider: "demo", model: "one" };
  const initial = {
    serverNow: Date.now(),
    expiresAt: Date.now() + 60_000,
    status: "active",
    turnsRemaining: 4,
    models: [model],
    turns: [],
  };
  let snapshot: object = initial;
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/claim")) return Response.json({ claim: token + "." + "B".repeat(43) });
    if (path.endsWith("/redeem")) return Response.json({ token, state: initial });
    if (path.endsWith("/turns")) {
      const input = JSON.parse(String(init?.body)) as { id: string; prompt: string; model: string };
      snapshot = {
        ...initial,
        turnsRemaining: 3,
        turns: [
          {
            ...input,
            seq: 1,
            reply: "Example reply",
            status: "complete",
            issue: null,
            inputTokens: 2,
            outputTokens: 1,
          },
        ],
      };
      return Response.json({ id: input.id, status: "complete" });
    }
    return Response.json(snapshot);
  });
  vi.stubGlobal("fetch", fetcher);
  render(<CodeShareDialog />);
  act(() => {
    void viscosityCommands()
      .find((command) => command.id === JOIN_CODE_SHARE_COMMAND)
      ?.run();
  });
  fireEvent.change(await screen.findByLabelText("Invite code or link"), {
    target: { value: "https://share.example.test/#invite=" + "A".repeat(22) },
  });
  const join = screen.getByRole("button", { name: "Join" });
  await waitFor(() => expect(join).toBeEnabled());
  fireEvent.click(join);
  const message = await screen.findByLabelText("Message");
  fireEvent.change(message, { target: { value: "Review this snippet" } });
  const snippet = "export const local = true;";
  const file = Object.assign(new File([snippet], "fixture.ts"), {
    arrayBuffer: async () => new TextEncoder().encode(snippet).buffer,
  });
  fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, {
    target: { files: [file] },
  });
  expect(await screen.findByText("fixture.ts")).toBeInTheDocument();
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/turns"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("Example reply")).toBeInTheDocument();
  expect(screen.getByText("3 turns left")).toBeInTheDocument();
  const submitted = fetcher.mock.calls.find(([url]) => String(url).endsWith("/turns"));
  expect(JSON.parse(String(submitted?.[1]?.body))).toMatchObject({
    model: model.id,
    prompt: "Review this snippet\n\n[fixture.ts]\n" + snippet,
  });
});

it("opens the guest's official sign-in and reserves a launch without sending the local prompt", async () => {
  const token = "A".repeat(43);
  const model = {
    id: "claude:claude-fable-5-2",
    provider: "claude",
    model: "claude-fable-5-2",
    execution: "guest-subscription",
  };
  const state = {
    serverNow: Date.now(),
    expiresAt: Date.now() + 60_000,
    status: "active",
    turnsRemaining: 4,
    models: [model],
    turns: [],
  };
  const launch = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
  local.prepare.mockResolvedValueOnce(launch);
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/claim")) return Response.json({ claim: token + "." + "B".repeat(43) });
    if (path.endsWith("/redeem")) return Response.json({ token, state });
    if (path.endsWith("/local-launch")) return Response.json({ ok: true });
    return Response.json(state);
  });
  vi.stubGlobal("fetch", fetcher);
  const { unmount } = render(<CodeShareDialog />);
  act(() => useCodeSharePanel.setState({ open: true }));
  fireEvent.change(await screen.findByLabelText("Invite code or link"), {
    target: { value: "https://share.example.test/#invite=" + "A".repeat(22) },
  });
  const join = screen.getByRole("button", { name: "Join" });
  await waitFor(() => expect(join).toBeEnabled());
  fireEvent.click(join);
  const signIn = await screen.findByRole("button", { name: "Sign in" });
  fireEvent.click(signIn);
  expect(local.signIn).toHaveBeenCalledWith("claude");
  act(() => useCodeSharePanel.setState({ open: true }));
  fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "local-private" } });
  fireEvent.click(screen.getByRole("button", { name: "Start local chat" }));
  await waitFor(() => expect(launch).toHaveBeenCalledOnce());
  expect(local.prepare).toHaveBeenCalledWith(
    "claude",
    model.model,
    "local-private",
    expect.any(String),
  );
  const request = fetcher.mock.calls.find(([url]) => String(url).endsWith("/local-launch"));
  expect(JSON.parse(String(request?.[1]?.body))).toEqual({
    model: model.id,
    id: expect.any(String),
  });
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/turns"))).toBe(false);
  unmount();
});
