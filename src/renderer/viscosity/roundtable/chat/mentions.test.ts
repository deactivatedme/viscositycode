import { describe, expect, it } from "vitest";
import type { BotProfile } from "../../bots/api";
import type { ReadyAgentBrain } from "../api";
import {
  buildRoundtableMentionTargets,
  findRoundtableMentions,
  MAX_MODEL_MENTIONS_PER_PROVIDER,
} from "./mentions";

const brains: ReadyAgentBrain[] = [
  {
    agentKind: "alpha",
    label: "Alpha",
    models: [
      { id: "a-small", label: "Small" },
      { id: "a-large", label: "Large" },
      { id: "a-large-45", label: "Large 4.5" },
      { id: "a-extra", label: "Extra" },
    ],
    defaultModel: "a-large",
    presentationModes: ["terminal", "gui"],
  },
  {
    agentKind: "beta:work",
    label: "Beta",
    models: [{ id: "b-1", label: "One" }],
    defaultModel: "b-1",
    presentationModes: ["terminal"],
  },
];

const bot: BotProfile = {
  id: "bot-1",
  label: "Scout",
  role: "member",
  brain: {
    kind: "xai",
    model: "grok-4.7",
    region: "global",
    tools: { webSearch: true, xSearch: false },
  },
  projectId: "p1",
  createdAt: 1,
};

const targets = buildRoundtableMentionTargets(brains, [bot]);

function labels(text: string): string[] {
  return findRoundtableMentions(text, targets).map((target) => target.label);
}

describe("buildRoundtableMentionTargets", () => {
  it("offers bots first, then each provider's default model and the next ones", () => {
    expect(targets.map((target) => target.label)).toEqual([
      "Scout",
      "Alpha · Large",
      "Alpha · Small",
      "Alpha · Large 4.5",
      "Beta · One",
    ]);
    expect(
      targets.filter((target) => target.kind === "model" && target.label.startsWith("Alpha")),
    ).toHaveLength(MAX_MODEL_MENTIONS_PER_PROVIDER);
  });

  it("seats models by capability, never by provider name", () => {
    const alpha = targets.find((target) => target.label === "Alpha · Large")!;
    expect(alpha.id).toBe("model:alpha:a-large");
    expect(alpha.candidate).toMatchObject({ kind: "model", presentationMode: "gui" });
    const beta = targets.find((target) => target.label === "Beta · One")!;
    expect(beta.candidate).toMatchObject({ presentationMode: "terminal", agentKind: "beta:work" });
    expect(targets[0]).toMatchObject({ id: "bot-1", kind: "bot" });
  });

  it("offers a label once", () => {
    const twin = { ...bot, id: "bot-2" };
    expect(buildRoundtableMentionTargets([], [bot, twin]).map((target) => target.id)).toEqual([
      "bot-1",
    ]);
  });
});

describe("findRoundtableMentions", () => {
  it("finds inserted mentions in order of appearance, once each", () => {
    expect(labels("@Beta · One and @Scout, then @Beta · One again")).toEqual([
      "Beta · One",
      "Scout",
    ]);
  });

  it("returns nothing for ordinary messages", () => {
    expect(labels("no mentions here")).toEqual([]);
    expect(labels("ask Scout about Alpha · Large")).toEqual([]);
  });

  it("needs a boundary on both sides", () => {
    expect(labels("mail me@Scout please")).toEqual([]);
    expect(labels("@Scouting party")).toEqual([]);
    expect(labels("(@Scout)")).toEqual(["Scout"]);
    expect(labels("@Scout.")).toEqual(["Scout"]);
  });

  it("prefers the longest label and never double-reads it as a shorter one", () => {
    expect(labels("@Alpha · Large 4.5 please review")).toEqual(["Alpha · Large 4.5"]);
    expect(labels("@Alpha · Large 4.5 vs @Alpha · Large")).toEqual([
      "Alpha · Large 4.5",
      "Alpha · Large",
    ]);
  });

  it("tolerates non-breaking spaces and letter case from the editor", () => {
    expect(labels("@alpha · large what do you think?")).toEqual(["Alpha · Large"]);
  });
});
