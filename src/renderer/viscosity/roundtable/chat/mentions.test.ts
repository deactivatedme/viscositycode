import { describe, expect, it } from "vitest";
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

const targets = buildRoundtableMentionTargets(brains);

function labels(text: string): string[] {
  return findRoundtableMentions(text, targets).map((target) => target.label);
}

describe("buildRoundtableMentionTargets", () => {
  it("offers each provider's default model and the next ones", () => {
    expect(targets.map((target) => target.label)).toEqual([
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
  });

  it("offers a label once", () => {
    const twin = { ...brains[1]!, agentKind: "beta:home" };
    expect(buildRoundtableMentionTargets([brains[1]!, twin]).map((target) => target.id)).toEqual([
      "model:beta:work:b-1",
    ]);
  });
});

describe("findRoundtableMentions", () => {
  it("finds inserted mentions in order of appearance, once each", () => {
    expect(labels("@Beta · One and @Alpha · Small, then @Beta · One again")).toEqual([
      "Beta · One",
      "Alpha · Small",
    ]);
  });

  it("returns nothing for ordinary messages", () => {
    expect(labels("no mentions here")).toEqual([]);
    expect(labels("ask Beta · One about Alpha · Large")).toEqual([]);
  });

  it("needs a boundary on both sides", () => {
    expect(labels("mail me@Beta · One please")).toEqual([]);
    expect(labels("@Beta · Ones party")).toEqual([]);
    expect(labels("(@Beta · One)")).toEqual(["Beta · One"]);
    expect(labels("@Beta · One.")).toEqual(["Beta · One"]);
  });

  it("prefers the longest label and never double-reads it as a shorter one", () => {
    expect(labels("@Alpha · Large 4.5 please review")).toEqual(["Alpha · Large 4.5"]);
    expect(labels("@Alpha · Large 4.5 vs @Alpha · Large")).toEqual([
      "Alpha · Large 4.5",
      "Alpha · Large",
    ]);
  });

  it("ignores short provider or model names, which turn up in ordinary messages", () => {
    expect(labels("@beta what do you think?")).toEqual([]);
    expect(labels("@small and @large 4.5")).toEqual([]);
    const shipped = buildRoundtableMentionTargets([
      {
        agentKind: "kimi",
        label: "Kimi Code",
        models: [{ id: "default", label: "Default" }],
        defaultModel: "default",
        presentationModes: ["gui"],
      },
      {
        agentKind: "qwen",
        label: "qwen-code",
        models: [{ id: "q", label: "Coder" }],
        defaultModel: "q",
        presentationModes: ["gui"],
      },
    ]);
    for (const text of ["/** @default 5 */", "npm i -g @qwen-code/qwen-code"]) {
      expect(findRoundtableMentions(text, shipped)).toEqual([]);
    }
  });

  it("tolerates non-breaking spaces and letter case from the editor", () => {
    expect(labels("@alpha · large what do you think?")).toEqual(["Alpha · Large"]);
  });
});
