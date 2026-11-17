// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { describe, expect, it } from "vitest";
import {
  buildForwardEnterErrorPageHtml,
  buildLocalPairingManifestJson,
  buildLocalPairingPageHtml,
} from "./pairingPage";

describe("buildLocalPairingPageHtml", () => {
  it("shows the leaf fingerprint for self-signed TLS so a web client can compare it by hand", () => {
    const html = buildLocalPairingPageHtml({
      httpBaseUrl: "https://192.168.1.20:49152",
      certFingerprint: "a".repeat(64),
    });
    expect(html).toContain("Browsers cannot pin");
    expect(html).toContain("Certificate fingerprint");
    expect(html).toContain(`sha256:${"a".repeat(64)}`);
  });

  it("omits the fingerprint block on plaintext hosts", () => {
    const html = buildLocalPairingPageHtml({ httpBaseUrl: "http://127.0.0.1:49152" });
    expect(html).not.toContain("Certificate fingerprint");
    expect(html).not.toContain("Browsers cannot pin");
  });

  // ViscosityCode: server-rendered pages carry the fork's name and colours.
  it("brands the pairing fallback, error page and manifest as ViscosityCode", () => {
    const pages = [
      buildLocalPairingPageHtml({ httpBaseUrl: "http://127.0.0.1:49152" }),
      buildForwardEnterErrorPageHtml(),
    ];
    for (const html of pages) {
      expect(html).toContain("<title>ViscosityCode");
      expect(html).toContain('<meta name="theme-color" content="#0a0a0b" />');
      expect(html).not.toMatch(/Poracode|#070709/u);
    }
    expect(pages[0]).toContain("Rebuild ViscosityCode so");
    for (const channel of ["stable", "nightly"] as const) {
      const manifest = JSON.parse(buildLocalPairingManifestJson(channel)) as Record<string, string>;
      expect(manifest.name).toBe(channel === "nightly" ? "ViscosityCode Nightly" : "ViscosityCode");
      expect(manifest.background_color).toBe("#0a0a0b");
      expect(manifest.theme_color).toBe("#0a0a0b");
    }
  });
});
