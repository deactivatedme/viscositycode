// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
// Mirror of src/shared/channel.ts for use by scripts/build-desktop-artifact.mjs.
// Keep field names identical to the TS module; src/shared/channel.config-parity.test.ts
// asserts they don't drift.

const CHANNELS = ["stable", "nightly"];

// Subdirectories under `dist/` that ship in the installer. A broad `dist/**/*`
// glob would sweep up stale `dist/win-unpacked` trees from prior packaging
// runs and recursively bloat the next installer.
const PACKAGED_DIST_DIRS = ["main", "renderer"];

const PACKAGED_DIST_FILES = PACKAGED_DIST_DIRS.flatMap((dir) => [
  `dist/${dir}/**/*`,
  `!dist/${dir}/**/*.map`,
]);

function normalizeChannel(value) {
  return value === "nightly" ? "nightly" : "stable";
}

// ViscosityCode: fork install identity (mirrors src/shared/channel.ts and
// src/shared/brand.ts). It never shares an app id, data folder, or artifact
// name with a real Poracode install.
function productNameFor(channel) {
  return channel === "nightly" ? "ViscosityCode Nightly" : "ViscosityCode";
}

function appIdFor(channel) {
  return channel === "nightly" ? "com.viscositycode.app.nightly" : "com.viscositycode.app";
}

function userDataDirNameFor(channel) {
  return channel === "nightly" ? ".viscositycode-nightly" : ".viscositycode";
}

function updaterChannelFor(channel) {
  return channel === "nightly" ? "nightly" : undefined;
}

function artifactPrefixFor(channel) {
  return channel === "nightly" ? "ViscosityCode-Nightly" : "ViscosityCode";
}

/**
 * Squirrel.Mac cannot relaunch when an update changes the outer bundle and
 * executable name. Upstream kept updater ZIPs on a pre-rebrand executable name
 * to bridge old installs; ViscosityCode has no older installs to bridge, so
 * both the updater ZIP and the DMG use the product name. The artifact kind
 * parameter stays so the packaging flow is unchanged.
 */
function macExecutableNameFor(channel, _artifactKind) {
  return productNameFor(channel);
}

module.exports = {
  CHANNELS,
  PACKAGED_DIST_DIRS,
  PACKAGED_DIST_FILES,
  normalizeChannel,
  productNameFor,
  appIdFor,
  userDataDirNameFor,
  updaterChannelFor,
  artifactPrefixFor,
  macExecutableNameFor,
};
