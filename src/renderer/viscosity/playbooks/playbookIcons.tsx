/**
 * ViscosityCode: the icons a playbook may use. Stored as lucide kebab names;
 * anything outside this list (an older or hand-edited value) draws the
 * book-marked fallback, so a stored name can never pull in arbitrary code.
 */
import { createElement } from "react";
import {
  Binary,
  Blocks,
  BookMarked,
  Brain,
  Bug,
  BugPlay,
  Compass,
  Cpu,
  Crosshair,
  FileSearch,
  FlaskConical,
  Gauge,
  MousePointerClick,
  Rocket,
  ScanEye,
  ShieldAlert,
  Swords,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export const PLAYBOOK_ICONS: Readonly<Record<string, LucideIcon>> = {
  "book-marked": BookMarked,
  binary: Binary,
  crosshair: Crosshair,
  swords: Swords,
  "scan-eye": ScanEye,
  "shield-alert": ShieldAlert,
  bug: Bug,
  "bug-play": BugPlay,
  compass: Compass,
  "flask-conical": FlaskConical,
  blocks: Blocks,
  gauge: Gauge,
  "mouse-pointer-click": MousePointerClick,
  "file-search": FileSearch,
  wrench: Wrench,
  terminal: Terminal,
  cpu: Cpu,
  brain: Brain,
  rocket: Rocket,
};

export const PLAYBOOK_ICON_NAMES = Object.keys(PLAYBOOK_ICONS);

export function PlaybookIcon(props: { name: string | undefined; className?: string }) {
  const known = props.name !== undefined && Object.hasOwn(PLAYBOOK_ICONS, props.name);
  return createElement(known ? PLAYBOOK_ICONS[props.name!]! : BookMarked, {
    className: props.className ?? "size-3.5",
    "aria-hidden": true,
  });
}
