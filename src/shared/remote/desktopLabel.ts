// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
/** "ViscosityCode on host" → "host"; the brand prefix is noise inside the app.
 *  Upstream "Poracode on …" and legacy "Lightcode on …" labels are stripped too. */
export function desktopTitle(label: string): string {
  // ViscosityCode: also strip the fork's own prefix.
  const stripped = label.replace(/^(?:ViscosityCode|Poracode|Lightcode)\s+on\s+/i, "");
  return stripped || label;
}
