/**
 * ViscosityCode: the read-only playbook mark (icon + name) in compact
 * (mobile/PWA) surfaces. Nothing renders for
 * no playbook, a cleared one or a future-version binding.
 */
import { useLingui } from "@lingui/react/macro";
import { Lock } from "lucide-react";
import { threadPlaybookBinding, type ThreadConfigPlaybook } from "@/shared/viscosity/playbook";
import { PlaybookIcon } from "./playbookIcons";

export function PlaybookCompactLabel(props: {
  playbook: ThreadConfigPlaybook | undefined;
  className?: string;
}) {
  const { t } = useLingui();
  const binding = threadPlaybookBinding({ playbook: props.playbook });
  if (!binding) return null;
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1 ${props.className ?? ""}`}
      data-playbook={binding.id}
      title={
        binding.readOnly
          ? t`Playbook: ${binding.label} · Asks the agent not to edit files`
          : t`Playbook: ${binding.label}`
      }
    >
      <PlaybookIcon name={binding.icon} className="size-3 shrink-0" />
      <span className="truncate">{binding.label}</span>
      {binding.readOnly ? <Lock className="size-3 shrink-0" aria-hidden="true" /> : null}
    </span>
  );
}
