import { afterEach, expect, it, vi } from "vitest";
import {
  createFakeXaiBridge,
  type FakeXaiBridge,
} from "@/renderer/viscosity/xai/testing/fakeXaiBridge";
import { useRoundtableStore } from "../roundtableStore";
import type { ParticipantProfile, RoundtableSession } from "../types";
import { createXaiDriver } from "./runtime";

vi.mock("@/renderer/state/dbStorage", () => ({
  createDbStorage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
}));

let bridge: FakeXaiBridge | undefined;
vi.mock("@/renderer/viscosity/xai/xaiBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/renderer/viscosity/xai/xaiBridge")>();
  return { ...actual, getXaiBridge: () => bridge ?? actual.getXaiBridge() };
});

const grok: ParticipantProfile = {
  id: "grok",
  label: "Grok",
  role: "member",
  brain: {
    kind: "xai",
    model: "grok-4.7",
    region: "global",
    tools: { webSearch: false, xSearch: false },
  },
  instructions: "Be terse.",
};

afterEach(() => {
  bridge = undefined;
  useRoundtableStore.setState({ sessions: {} });
});

it("gives a Grok seat its playbook's instructions after its own, as saved now", () => {
  bridge = createFakeXaiBridge();
  const session = {
    id: "s1",
    turns: [],
    participants: [grok],
    playbookId: "debug",
  } as unknown as RoundtableSession;
  useRoundtableStore.setState({ sessions: { s1: session } });
  const driver = createXaiDriver(grok, session);
  void driver.sendTurn("Q1");
  const first = bridge.requests[0]?.instructions ?? "";
  expect(first.startsWith('Be terse.\n\nPlaybook "Debug":\n')).toBe(true);
  bridge.emit({ requestId: bridge.requests[0]!.requestId, type: "done", text: "A1" });

  // The seat opts out: only its own instructions remain.
  useRoundtableStore.setState({
    sessions: { s1: { ...session, participants: [{ ...grok, playbookId: null }] } },
  });
  void driver.sendTurn("Q2");
  expect(bridge.requests[1]?.instructions).toBe("Be terse.");
});
