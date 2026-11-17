/**
 * ViscosityCode brand identity (fork of Poracode — see FORK_CHANGES.md).
 *
 * The fork keeps upstream's internal identifiers (`PORACODE_*` env vars,
 * `poracode-*` storage keys, IPC channels, protocol schemas) because they are
 * compatibility boundaries and merge hotspots. Only what a user can *see* is
 * rebranded. `brandText` converts upstream display text that names the
 * upstream product, so localized catalogs and shared messages need no edits.
 */

export const BRAND_NAME = "ViscosityCode";
export const BRAND_NAME_NIGHTLY = "ViscosityCode Nightly";
export const UPSTREAM_BRAND_NAME = "Poracode";

const UPSTREAM_BRAND_PATTERN = /\bPoracode\b/g;

/** Replace the upstream product name in user-visible text with the fork's name. */
export function brandText(text: string): string {
  return text.includes(UPSTREAM_BRAND_NAME)
    ? text.replace(UPSTREAM_BRAND_PATTERN, BRAND_NAME)
    : text;
}
