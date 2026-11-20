import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { i18n } from "@/renderer/i18n/i18n";
import { getProviderManifests } from "@/renderer/components/providers/providerManifest";

function shippedFiles(): { path: string; text: string }[] {
  const folder = import.meta.dirname;
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name),
    )
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return { path: relative(folder, path), text: readFileSync(path, "utf8") };
    });
}

describe("cloud agents isolation", () => {
  it("names no provider in this folder's shipped code", () => {
    const names = getProviderManifests().flatMap((manifest) => [
      new RegExp(`["'\`]${manifest.kind}["'\`:]`),
      new RegExp(`\\b${i18n._(manifest.label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`),
    ]);
    const offenders = shippedFiles().flatMap(({ path, text }) =>
      names.filter((name) => name.test(text)).map((name) => `${path}: ${name.source}`),
    );
    expect(offenders).toEqual([]);
  });

  it("reaches providers only through the host, never over the network", () => {
    const offenders = shippedFiles().flatMap(({ path, text }) =>
      [/\bfetch\(/u, /XMLHttpRequest/u, /EventSource/u, /https?:\/\/api\./u, /API_KEY/u]
        .filter((pattern) => pattern.test(text))
        .map((pattern) => `${path}: ${pattern.source}`),
    );
    expect(offenders).toEqual([]);
  });
});
