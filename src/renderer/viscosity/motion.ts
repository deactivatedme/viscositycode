/**
 * ViscosityCode: whether JavaScript-driven interface motion (the sidebar width
 * slide) may animate. Off only inside the desktop shell when the OS asks to
 * reduce motion; outside the shell it is always true, so upstream layouts keep
 * their own behaviour.
 */
import { VISCOSITY_SHELL_ATTRIBUTE } from "@/renderer/viscosity/shellFlag";

export function interfaceMotionAllowed(doc: Document = document): boolean {
  if (!doc.documentElement.hasAttribute(VISCOSITY_SHELL_ATTRIBUTE)) return true;
  return !doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
