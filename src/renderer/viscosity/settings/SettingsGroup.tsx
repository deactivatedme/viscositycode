/**
 * ViscosityCode: a titled block of settings rows, matching the existing
 * settings patterns (Audio's titled groups). Used by Agent colours and Smart start.
 */
import type { ReactNode } from "react";

/** A titled block of rows; `disabled` dims the rows a master switch has turned off. */
export function SettingsGroup(props: {
  title: string;
  description: string;
  disabled?: boolean;
  /** Rows that stay fully visible above the dimmed ones (the master switch). */
  lead?: ReactNode;
  /** Makes the whole group a settings-search target (its rows have no anchors of their own). */
  anchorId?: string;
  children: ReactNode;
}) {
  return (
    <section
      {...(props.anchorId ? { id: props.anchorId, "data-settings-anchor": props.anchorId } : {})}
      className={`space-y-4 ${props.anchorId ? "scroll-mt-4" : ""}`}
      aria-label={props.title}
    >
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-semibold text-foreground">{props.title}</h2>
        <p className="mt-1 text-xs text-muted">{props.description}</p>
      </div>
      {props.lead}
      <div className={`space-y-4 transition-opacity ${props.disabled ? "opacity-40" : ""}`}>
        {props.children}
      </div>
    </section>
  );
}
