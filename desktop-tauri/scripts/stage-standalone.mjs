#!/usr/bin/env node
/**
 * Stage the darwin-arm64 standalone archive for the Tauri bundle.
 *
 * By default it rebuilds everything with the darwin steps of the CI recipe in
 * .github/workflows/_server-artifact.yml (codex-protocol:gen, build:web,
 * prepare-server-native, the package-asset, agent-plugin and Rust helper
 * prepares, assemble-server-tarball.mjs, verify-server-tarball-contents.mjs),
 * then build-standalone-archive.mjs. CI's ci-rebuild-node-pty.sh is left out:
 * it points node-gyp at a CI Node install, and prepare-server-native checks the
 * local node-pty build instead. --reuse skips the build and stages the existing
 * dist/standalone archive, printing its build commit and time; a release build
 * must not pass it, because the version stays the same across host changes.
 *
 * It extracts the archive with the system tar (keeps exec bits) into
 * desktop-tauri/resources/standalone/ and checks the layout the shell's sidecar
 * expects.
 *
 * Usage: node desktop-tauri/scripts/stage-standalone.mjs [--reuse]
 */
import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET = "darwin-arm64";
const NODE_VERSION = "v26.13.0";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const stageDir = join(repoRoot, "desktop-tauri", "resources", "standalone");
const version = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;
const archive = join(repoRoot, "dist", "standalone", `poracode-${version}-${TARGET}.tar.gz`);

function run(command, args) {
  console.log(`$ ${command} ${args.join(" ")}`);
  // CARGO_BUILD_JOBS keeps the Rust helper builds light on an 8 GB machine.
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { CARGO_BUILD_JOBS: "2", ...process.env },
  });
}

function buildArchive() {
  const tarball = join(repoRoot, "dist", `poracode-server-${version}-${TARGET}.tar.gz`);
  run("bun", ["run", "codex-protocol:gen"]);
  run("bun", ["run", "build:web"]);
  run("node", ["scripts/prepare-server-native.mjs", "--require-target", TARGET]);
  for (const script of [
    "prepare:package-assets",
    "prepare:agent-plugins",
    "prepare:computer-use-helper",
    "prepare:mcp-relay",
    "prepare:git-helper",
  ]) {
    run("bun", ["run", script]);
  }
  run("node", ["scripts/assemble-server-tarball.mjs", "--target", TARGET]);
  run("node", [
    "scripts/verify-server-tarball-contents.mjs",
    "--tarball",
    tarball,
    "--overlay-root",
    join(repoRoot, "dist", "server-native"),
    "--target",
    TARGET,
  ]);
  run("node", [
    "scripts/build-standalone-archive.mjs",
    "--server-tarball",
    tarball,
    "--server-artifact",
    join(repoRoot, "dist", "server-artifact.json"),
    "--target",
    TARGET,
    "--out-dir",
    join(repoRoot, "dist", "standalone"),
  ]);
}

/** Says which build a reused archive came from; the version alone does not. */
function describeReused() {
  if (!existsSync(archive)) throw new Error(`--reuse: no ${archive}; run without --reuse`);
  const artifact = JSON.parse(readFileSync(join(repoRoot, "dist", "server-artifact.json"), "utf8"));
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  console.warn(
    `--reuse: staging ${archive}\n  built ${artifact.builtAt} from ${artifact.sourceRevision ?? "an unknown commit"}` +
      ` (HEAD ${head}; uncommitted changes are not recorded). Do not ship this without a rebuild.`,
  );
}

function assertExecutable(path) {
  accessSync(path, constants.X_OK);
}

/** Throws unless `dir` has the layout the sidecar launches; returns the checked paths. */
export function checkLayout(dir) {
  const node = join(dir, "runtime", "node");
  for (const path of [
    node,
    join(dir, "lib", "server.cjs"),
    join(dir, "renderer", "index.html"),
    join(dir, "standalone.json"),
  ]) {
    if (!existsSync(path)) throw new Error(`missing ${path}`);
  }
  assertExecutable(node);
  const reported = execFileSync(node, ["--version"], { encoding: "utf8" }).trim();
  if (reported !== NODE_VERSION)
    throw new Error(`runtime/node reports ${reported}, expected ${NODE_VERSION}`);
  const spawnHelpers = execFileSync(
    "find",
    [dir, "-name", "spawn-helper", "-path", "*node-pty*", "-type", "f"],
    {
      encoding: "utf8",
    },
  )
    .split("\n")
    .filter(Boolean);
  if (spawnHelpers.length === 0) throw new Error("no node-pty spawn-helper in the archive");
  spawnHelpers.forEach(assertExecutable);
  return { node, spawnHelpers };
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error(
      `stage-standalone builds ${TARGET} and must run on it (build-standalone-archive.mjs builds for its host)`,
    );
  }
  if (process.argv.includes("--reuse")) describeReused();
  else buildArchive();
  // resources/standalone/ is a gitignored build output owned by this script.
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  run("tar", ["-xzpf", archive, "-C", stageDir]);
  const { spawnHelpers } = checkLayout(stageDir);
  console.log(
    `staged ${archive}\n  -> ${stageDir}\n  runtime/node ${NODE_VERSION}, spawn-helper executable: ${spawnHelpers.length}`,
  );
}
