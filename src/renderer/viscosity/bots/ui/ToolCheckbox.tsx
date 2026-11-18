/**
 * ViscosityCode Bots UI: a Grok server-side tool checkbox (web search, X
 * search), with the same treatment as the Roundtable setup's Grok seat.
 */
import type { ReactNode } from "react";
import { Checkbox } from "@heroui/react";

export function ToolCheckbox(props: {
  isSelected: boolean;
  onChange: (selected: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Checkbox isSelected={props.isSelected} onChange={props.onChange}>
      <Checkbox.Content>
        <Checkbox.Control className="border border-[var(--hairline-strong)] bg-surface-secondary shadow-none">
          <Checkbox.Indicator />
        </Checkbox.Control>
        <span className="text-xs text-foreground">{props.children}</span>
      </Checkbox.Content>
    </Checkbox>
  );
}
