#!/usr/bin/env node
/**
 * Headless smoke for the bundled ViscosityCode.app. Never opens the app.
 *
 * With a disposable PORACODE_BASE_DIR under .tmp/ it starts the bundled
 * runtime/node + lib/server.cjs `serve` the way src/sidecar.rs does (same
 * args, env, own process group), waits for the ready line, runs the shell's
 * `pairings create`, GETs the base URL, stops the server with SIGTERM and checks
 * that no process is left. A second run proves the PORACODE_PARENT_PID
 * watchdog: the server must exit on its own once its "parent" dies. A third run
 * turns the first root into what the Electron app leaves (an OS-sealed
 * `secret-key.safe` and credential mode `os-sealed`) and checks that `serve`
 * refuses it with the text src/owner.rs classifies as CredentialCustody. Then it
 * checks `codesign --verify` on the .app and the exec bits of the bundled node
 * and node-pty spawn-helper.
 *
 * Usage: node desktop-tauri/scripts/smoke.mjs [--app <ViscosityCode.app>]
 */
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLayout } from "./stage-standalone.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const appIndex = process.argv.indexOf("--app");
const app =
  appIndex > 0
    ? resolve(process.argv[appIndex + 1])
    : join(repoRoot, "desktop-tauri", "target", "release", "bundle", "macos", "ViscosityCode.app");
const standalone = join(app, "Contents", "Resources", "standalone");
const server = join(standalone, "lib", "server.cjs");
const READY = "[poracode-server] listening at:";

const log = (message) => console.log(`[smoke] ${message}`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer().once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Processes still running this bundle's server.cjs (the path is unique to this build). */
function leftovers() {
  try {
    return execFileSync("pgrep", ["-f", server], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

/** The shell's env (sidecar.rs server_env + parent_pid_env). */
function env(baseDir, parentPid) {
  return {
    ...process.env,
    PORACODE_BASE_DIR: baseDir,
    PORACODE_SHUTDOWN_DRAIN_DEADLINE_MS: "10000",
    PORACODE_PARENT_PID: String(parentPid),
  };
}

async function startServe(baseDir, parentPid) {
  const port = await freePort();
  const args = [server, "serve", "--no-open", "--host", "127.0.0.1", "--port", String(port)];
  log(`start: ${join(standalone, "runtime", "node")} ${args.join(" ")}`);
  // detached = setsid on unix: its own process group, like process_group(0) in the shell.
  const child = spawn(join(standalone, "runtime", "node"), args, {
    env: env(baseDir, parentPid),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exited = new Promise((done) =>
    child.once("exit", (code, signal) => done({ code, signal })),
  );
  const url = await new Promise((done, fail) => {
    let buffer = "";
    const timer = setTimeout(() => fail(new Error(`no ready line in 120 s\n${stderr}`)), 120_000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      for (const line of buffer.split("\n")) {
        if (line.trim().startsWith(READY)) {
          clearTimeout(timer);
          done(line.trim().slice(READY.length).trim());
        }
      }
    });
    // "close", not "exit": the refusal text must be fully read from stderr.
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      fail(new Error(`serve exited (${code ?? signal}) before ready\n${stderr}`));
    });
  });
  log(`ready line: ${READY} ${url}`);
  return { child, url, exited, port };
}

async function waitGone(child, exited, ms) {
  const result = await Promise.race([exited, sleep(ms).then(() => null)]);
  if (!result) throw new Error(`server ${child.pid} still running after ${ms} ms`);
  // The drain should take the group with it; give stragglers a moment.
  for (let i = 0; i < 20 && groupAlive(child.pid); i += 1) await sleep(250);
  if (groupAlive(child.pid)) throw new Error(`process group ${child.pid} still has members`);
  const left = leftovers();
  if (left) throw new Error(`processes still running ${server}: ${left}`);
  return result;
}

async function main() {
  if (!existsSync(server)) throw new Error(`no bundled server at ${server}; build the app first`);
  const tmpRoot = join(repoRoot, ".tmp");
  mkdirSync(tmpRoot, { recursive: true });
  const scratch = mkdtempSync(join(tmpRoot, "tauri-smoke-"));
  const children = [];
  try {
    // 1. serve, pair, GET, SIGTERM.
    const baseDir = join(scratch, "root");
    const run = await startServe(baseDir, process.pid);
    children.push(run.child);
    const pairing = JSON.parse(
      execFileSync(
        join(standalone, "runtime", "node"),
        [
          server,
          "pairings",
          "create",
          "--preset",
          "operator",
          "--label",
          "ViscosityCode window",
          "--ttl",
          "1m",
          "--json",
        ],
        {
          env: env(baseDir, process.pid),
          encoding: "utf8",
        },
      )
        .trim()
        .split("\n")
        .at(-1),
    );
    if (typeof pairing.localPairingUrl !== "string")
      throw new Error(`pairing failed: ${JSON.stringify(pairing)}`);
    log(
      `pairings create --json: localPairingUrl ${new URL(pairing.localPairingUrl).origin}/... (token redacted)`,
    );
    const response = await fetch(run.url);
    const html = await response.text();
    log(
      `GET ${run.url} -> ${response.status} ${response.headers.get("content-type")} (${html.length} bytes)`,
    );
    if (response.status !== 200 || !html.includes('<div id="root">'))
      throw new Error("base URL did not serve the app root");
    log('app root <div id="root"> present');
    process.kill(run.child.pid, "SIGTERM");
    const stopped = await waitGone(run.child, run.exited, 15_000);
    log(`SIGTERM -> exited ${JSON.stringify(stopped)}; process group gone; pgrep finds nothing`);

    // 2. An Electron-created root: serve must refuse, unchanged, with the text owner.rs matches.
    const dataRoot = `${baseDir}.host-v1`;
    const statePath = join(dataRoot, "host-credentials.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    writeFileSync(statePath, JSON.stringify({ ...state, mode: "os-sealed" }));
    renameSync(join(dataRoot, "secret-key.headless"), join(dataRoot, "secret-key.safe"));
    const refusal = await startServe(baseDir, process.pid).then(
      () => {
        throw new Error("serve accepted an Electron-sealed root");
      },
      (error) => error.message,
    );
    // Mirrors CREDENTIAL_CUSTODY in src/owner.rs.
    if (!refusal.includes("Credential mode change requires explicit activation"))
      throw new Error(`unexpected refusal for an Electron-sealed root:\n${refusal}`);
    if (!existsSync(join(dataRoot, "secret-key.safe")))
      throw new Error("the sealed key was touched");
    log(
      `Electron-sealed root refused: ${refusal
        .split("\n")
        .find((line) => line.includes("Credential mode"))
        ?.trim()}`,
    );
    const left = leftovers();
    if (left) throw new Error(`processes still running ${server}: ${left}`);

    // 3. Parent watchdog: the server drains when PORACODE_PARENT_PID dies.
    const parent = spawn("sleep", ["120"], { stdio: "ignore" });
    children.push(parent);
    const orphan = await startServe(join(scratch, "root-watchdog"), parent.pid);
    children.push(orphan.child);
    const killedAt = Date.now();
    parent.kill("SIGKILL");
    const watched = await waitGone(orphan.child, orphan.exited, 15_000);
    log(
      `parent ${parent.pid} killed -> server exited ${JSON.stringify(watched)} after ${Date.now() - killedAt} ms; nothing left`,
    );
  } finally {
    for (const child of children)
      if (child.exitCode === null && alive(child.pid)) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    // Only the disposable root this run created.
    rmSync(scratch, { recursive: true, force: true });
  }

  // 4. Signature and exec bits.
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], {
    stdio: "inherit",
  });
  log("codesign --verify --deep --strict: ok");
  const { node, spawnHelpers } = checkLayout(standalone);
  for (const path of [node, ...spawnHelpers]) log(`executable: ${path.slice(app.length + 1)}`);
  log("PASS");
}

main().catch((error) => {
  console.error(`[smoke] FAIL: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
