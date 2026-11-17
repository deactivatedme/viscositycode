// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_CLI_COMMAND_NAMES,
  DESKTOP_CLI_DATA_DIR_NAMES,
} from "../../packages/poracode-cli/lib/desktopBundle.mjs";
import {
  appIdFor,
  artifactPrefixFor,
  PORACODE_CHANNELS,
  productNameFor,
  updaterChannelFor,
  userDataDirNameFor,
} from "./channel";

const requireFromHere = createRequire(import.meta.url);
const cjs = requireFromHere("../../scripts/electron-builder.shared.cjs") as {
  CHANNELS: readonly string[];
  normalizeChannel: (v: unknown) => string;
  productNameFor: (channel: string) => string;
  appIdFor: (channel: string) => string;
  userDataDirNameFor: (channel: string) => string;
  updaterChannelFor: (channel: string) => string | undefined;
  artifactPrefixFor: (channel: string) => string;
  macExecutableNameFor: (channel: string, artifactKind: "branded" | "updater") => string;
};

describe("electron-builder.shared.cjs mirrors src/shared/channel.ts", () => {
  it("exposes the same channel list", () => {
    expect([...cjs.CHANNELS]).toEqual([...PORACODE_CHANNELS]);
  });

  for (const channel of PORACODE_CHANNELS) {
    it(`agrees on every value for "${channel}"`, () => {
      expect(cjs.productNameFor(channel)).toBe(productNameFor(channel));
      expect(cjs.appIdFor(channel)).toBe(appIdFor(channel));
      expect(cjs.userDataDirNameFor(channel)).toBe(userDataDirNameFor(channel));
      expect(cjs.updaterChannelFor(channel)).toBe(updaterChannelFor(channel));
      expect(cjs.artifactPrefixFor(channel)).toBe(artifactPrefixFor(channel));
    });
  }

  it("normalizes any unknown value to stable", () => {
    expect(cjs.normalizeChannel("nightly")).toBe("nightly");
    expect(cjs.normalizeChannel("stable")).toBe("stable");
    expect(cjs.normalizeChannel(undefined)).toBe("stable");
    expect(cjs.normalizeChannel("beta")).toBe("stable");
  });

  // ViscosityCode: no legacy install to bridge, so updater ZIPs and DMGs share
  // the product name as their macOS executable name.
  it("names macOS updater ZIP and DMG executables after the product", () => {
    for (const channel of PORACODE_CHANNELS) {
      expect(cjs.macExecutableNameFor(channel, "updater")).toBe(productNameFor(channel));
      expect(cjs.macExecutableNameFor(channel, "branded")).toBe(productNameFor(channel));
    }
    expect(cjs.macExecutableNameFor("stable", "updater")).toBe("ViscosityCode");
    expect(cjs.macExecutableNameFor("nightly", "updater")).toBe("ViscosityCode Nightly");
  });
});

// ViscosityCode: the packaged desktop CLI bootstrap carries its own copy of the
// fork's command names and default host data folders.
describe("the desktop CLI bootstrap mirrors src/shared/channel.ts", () => {
  for (const channel of PORACODE_CHANNELS) {
    it(`defaults the "${channel}" desktop CLI to the channel's data folder`, () => {
      expect(DESKTOP_CLI_DATA_DIR_NAMES[channel]).toBe(userDataDirNameFor(channel));
    });
  }

  it("names the desktop commands after the fork, never upstream", () => {
    expect(DESKTOP_CLI_COMMAND_NAMES).toEqual({
      stable: "viscositycode",
      nightly: "viscositycode-next",
    });
  });
});
