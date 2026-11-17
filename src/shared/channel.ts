// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { BRAND_NAME, BRAND_NAME_NIGHTLY } from "./brand";

export type PoracodeChannel = "stable" | "nightly";

export const PORACODE_CHANNELS: readonly PoracodeChannel[] = ["stable", "nightly"];

declare const __PORACODE_CHANNEL__: string | undefined;

export function normalizeChannel(value: unknown): PoracodeChannel {
  return value === "nightly" ? "nightly" : "stable";
}

export function resolvePoracodeChannel(): PoracodeChannel {
  return normalizeChannel(typeof __PORACODE_CHANNEL__ === "string" ? __PORACODE_CHANNEL__ : "");
}

// ViscosityCode: the fork has its own install identity so it never shares an
// app id, data folder, or artifact name with a real Poracode install. Keep
// scripts/electron-builder.shared.cjs in sync (channel.config-parity.test.ts).
export function productNameFor(channel: PoracodeChannel): string {
  return channel === "nightly" ? BRAND_NAME_NIGHTLY : BRAND_NAME;
}

export function appIdFor(channel: PoracodeChannel): string {
  return channel === "nightly" ? "com.viscositycode.app.nightly" : "com.viscositycode.app";
}

export function userDataDirNameFor(channel: PoracodeChannel): string {
  return channel === "nightly" ? ".viscositycode-nightly" : ".viscositycode";
}

export function updaterChannelFor(channel: PoracodeChannel): string | undefined {
  return channel === "nightly" ? "nightly" : undefined;
}

export function artifactPrefixFor(channel: PoracodeChannel): string {
  return channel === "nightly" ? "ViscosityCode-Nightly" : "ViscosityCode";
}
