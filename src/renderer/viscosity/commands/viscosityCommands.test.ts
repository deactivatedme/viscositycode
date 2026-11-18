import { describe, expect, it } from "vitest";
import type { AppCommand } from "@/renderer/commands/registry";
import { registerViscosityCommands, viscosityCommands } from "./viscosityCommands";

function command(id: string): AppCommand {
  return { id, title: id, group: "Test", run: () => undefined };
}

function ids(): string[] {
  return viscosityCommands()
    .map((entry) => entry.id)
    .filter((id) => id.startsWith("test."));
}

describe("fork command registry", () => {
  it("replaces a feature's commands by key and keeps registration order", () => {
    const disposeA = registerViscosityCommands("test.a", () => [command("test.a.1")]);
    const disposeB = registerViscosityCommands("test.b", () => [command("test.b.1")]);
    const disposeA2 = registerViscosityCommands("test.a", () => [command("test.a.2")]);
    try {
      expect(ids()).toEqual(["test.a.2", "test.b.1"]);
    } finally {
      disposeA();
      disposeA2();
      disposeB();
    }
    expect(ids()).toEqual([]);
  });

  it("only unregisters the exact registration (a stale cleanup keeps its replacement)", () => {
    const stale = registerViscosityCommands("test.c", () => [command("test.c.old")]);
    const current = registerViscosityCommands("test.c", () => [command("test.c.new")]);
    stale();
    expect(ids()).toEqual(["test.c.new"]);
    current();
    expect(ids()).toEqual([]);
  });

  it("skips a failing factory without breaking the other commands", () => {
    const broken = registerViscosityCommands("test.broken", () => {
      throw new Error("boom");
    });
    const fine = registerViscosityCommands("test.fine", () => [command("test.fine.1")]);
    try {
      expect(ids()).toEqual(["test.fine.1"]);
    } finally {
      broken();
      fine();
    }
  });
});
