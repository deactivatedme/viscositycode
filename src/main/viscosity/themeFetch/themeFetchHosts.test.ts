import { describe, expect, it } from "vitest";
import { isRefusedThemeAddress, isRefusedThemeHost } from "./themeFetchHosts";

/** Hosts as `URL.hostname` produces them, which normalises IPv4 spellings and IPv6. */
function hostOf(url: string): string {
  return new URL(url).hostname;
}

describe("isRefusedThemeHost", () => {
  it.each([
    "https://localhost/",
    "https://LOCALHOST./",
    "https://themes.localhost/",
    "https://127.0.0.1/",
    "https://127.1/",
    "https://2130706433/",
    "https://0x7f.1/",
    "https://0.0.0.0/",
    "https://10.1.2.3/",
    "https://172.16.0.1/",
    "https://172.31.255.255/",
    "https://192.168.0.10/",
    "https://169.254.169.254/",
    "https://100.64.0.1/",
    "https://[::]/",
    "https://[::1]/",
    "https://[fe80::1]/",
    "https://[fc00::1]/",
    "https://[fd12:3456::1]/",
    "https://[fec0::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:10.0.0.1]/",
    "https://[::127.0.0.1]/",
    "https://224.0.0.1/",
    "https://239.255.255.250/",
    "https://240.0.0.1/",
    "https://255.255.255.255/",
    "https://198.18.0.1/",
    "https://198.19.255.255/",
    "https://[64:ff9b::127.0.0.1]/",
    "https://[64:ff9b::a9fe:a9fe]/",
  ])("refuses %s", (url) => {
    expect(isRefusedThemeHost(hostOf(url))).toBe(true);
  });

  it.each([
    "https://themes.example.com/",
    "https://raw.githubusercontent.com/",
    "https://localhost.example.com/",
    "https://8.8.8.8/",
    "https://172.32.0.1/",
    "https://172.15.0.1/",
    "https://100.128.0.1/",
    "https://169.253.0.1/",
    "https://[2606:4700::1111]/",
    "https://[::ffff:8.8.8.8]/",
    "https://198.17.0.1/",
    "https://198.20.0.1/",
    "https://223.255.255.255/",
    "https://[64:ff9b::808:808]/",
  ])("allows %s", (url) => {
    expect(isRefusedThemeHost(hostOf(url))).toBe(false);
  });
});

describe("isRefusedThemeAddress", () => {
  it.each([
    ["127.0.0.1", true],
    ["10.0.0.5", true],
    ["::1", true],
    ["::ffff:192.168.1.1", true],
    ["fe80::1%en0", true],
    ["not-an-ip", true],
    ["93.184.216.34", false],
    ["2606:2800:220:1::1", false],
    ["::ffff:8.8.8.8", false],
  ])("%s refused: %s", (address, refused) => {
    expect(isRefusedThemeAddress(address)).toBe(refused);
  });
});
