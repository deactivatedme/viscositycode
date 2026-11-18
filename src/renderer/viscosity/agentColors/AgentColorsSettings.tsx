/**
 * ViscosityCode: the "Agent colours" block of Settings → Appearance.
 *
 * Lists the installed agents with the colour each one shows (the owner's
 * pick, its driver's colour for another account of an agent, or the
 * automatic one), a palette picker and a per-agent reset, plus the switch for
 * the pane, tab and sidebar markers. Colours are a per-device view preference
 * (agentColorsStore.ts). Swatches paint palette values directly, so they read
 * correctly in any window, with or without the generated stylesheet.
 */
import { useState } from "react";
import { Popover } from "@heroui/react";
import { Check, RotateCcw } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { useCompactLayout } from "@/renderer/adaptiveLayout";
import { isChatSidebarSurface } from "@/renderer/clientSurface";
import { Button, ToggleSwitch } from "@/renderer/components/common";
import { ProviderIcon } from "@/renderer/components/providers/ProviderIcon";
import { EffectsSettingsGroup } from "@/renderer/fx/settings/EffectsSettingsControls";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { shouldEnableViscosityShell } from "@/renderer/viscosity/shellFlag";
import { SettingRow } from "@/renderer/views/SettingsOverlay/parts/SettingsForm";
import { agentKindAttribute } from "./api";
import { useAgentColors } from "./agentColorsStore";
import { AGENT_COLOR_PALETTE, agentColorCss, findAgentColor } from "./palette";
import { buildAgentColorRows, type AgentColorRow } from "./settingsModel";

/** Whether this window shows the markers: the same rule that sets `html[data-vc-shell]`. */
function useMarkersShownInThisWindow(): boolean {
  const compactLayout = useCompactLayout();
  return shouldEnableViscosityShell({
    windowKind: document.documentElement.dataset.windowKind,
    compactLayout,
    chatSidebarSurface: isChatSidebarSurface(),
  });
}

function AgentColorPicker(props: { row: AgentColorRow }) {
  const { t } = useLingui();
  const { row } = props;
  const setColor = useAgentColors((state) => state.setColor);
  const [open, setOpen] = useState(false);
  const agent = row.label;
  const current = t(findAgentColor(row.color).label);

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <Button
          size="sm"
          variant="secondary"
          aria-label={t`Colour for ${agent}: ${current}`}
          className="w-[132px] shrink-0 justify-start gap-2"
        >
          <span
            aria-hidden="true"
            data-vc-agent-swatch={row.color}
            className="size-3.5 shrink-0 rounded-full border border-border"
            style={{ background: agentColorCss(row.color) }}
          />
          <span className="min-w-0 truncate">{current}</span>
        </Button>
      </Popover.Trigger>
      {open ? (
        <Popover.Content placement="bottom end" className="p-0">
          <Popover.Dialog aria-label={t`Colour for ${agent}`} className="p-2">
            <div
              role="group"
              aria-label={t`Colour for ${agent}`}
              className="grid grid-cols-7 gap-1.5"
            >
              {AGENT_COLOR_PALETTE.map((color) => {
                const selected = color.id === row.color;
                const name = t(color.label);
                return (
                  <button
                    key={color.id}
                    type="button"
                    aria-pressed={selected}
                    aria-label={name}
                    title={name}
                    data-vc-agent-color={color.id}
                    className={`flex size-6 items-center justify-center rounded-full border text-background outline-none transition-colors focus-visible:focus-ring ${
                      selected ? "border-foreground" : "border-border hover:border-muted"
                    }`}
                    style={{ background: color.css }}
                    onClick={() => {
                      setColor(row.kind, color.id);
                      setOpen(false);
                    }}
                  >
                    {selected ? <Check aria-hidden="true" className="size-3.5" /> : null}
                  </button>
                );
              })}
            </div>
          </Popover.Dialog>
        </Popover.Content>
      ) : null}
    </Popover>
  );
}

function AgentColorListItem(props: { row: AgentColorRow }) {
  const { t } = useLingui();
  const { row } = props;
  const resetColor = useAgentColors((state) => state.resetColor);
  const agent = row.label;
  const driver = row.inheritedFromLabel ?? "";
  const source =
    row.source === "custom"
      ? t`Your colour`
      : row.source === "inherited"
        ? t`Same as ${driver}`
        : t`Automatic`;

  return (
    <li className="flex items-center gap-3 py-1" {...agentKindAttribute(row.kind)}>
      <span aria-hidden="true" className="inline-flex shrink-0">
        <ProviderIcon
          kind={row.kind}
          icon={row.icon}
          fallbackLabel={row.label}
          className="size-4 text-foreground/80"
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{row.label}</p>
        <p className="text-xs text-muted">{source}</p>
      </div>
      <AgentColorPicker row={row} />
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={t`Reset colour for ${agent}`}
        isDisabled={row.source !== "custom"}
        onPress={() => resetColor(row.kind)}
      >
        <RotateCcw className="size-3.5" />
      </Button>
    </li>
  );
}

export function AgentColorsSettings() {
  const { t } = useLingui();
  const shownHere = useMarkersShownInThisWindow();
  const enabled = useAgentColors((state) => state.enabled);
  const overrides = useAgentColors((state) => state.colors);
  const setEnabled = useAgentColors((state) => state.setEnabled);
  const agentStatuses = useAgentStatusesStore((state) => state.agentStatuses);
  const wslAgentStatuses = useAgentStatusesStore((state) => state.wslAgentStatuses);
  const rows = buildAgentColorRows(agentStatuses, wslAgentStatuses, overrides);

  return (
    <EffectsSettingsGroup
      anchorId="appearance.agentColors"
      title={t`Agent colours`}
      description={
        shownHere
          ? t`Each agent has its own colour, so you can tell its panes, tabs, and threads apart at a glance.`
          : t`Each agent has its own colour. The markers show when this device uses the desktop layout.`
      }
      lead={
        <SettingRow
          anchorId="appearance.agentColorMarkers"
          title={t`Colour panes and tabs by agent`}
          description={t`A thin line in the agent's colour on its pane header, its tab, and its threads in the sidebar.`}
        >
          <ToggleSwitch
            aria-label={t`Colour panes and tabs by agent`}
            isSelected={enabled}
            onChange={setEnabled}
          />
        </SettingRow>
      }
    >
      {rows.length === 0 ? (
        <p className="text-xs text-muted">{t`No agents are installed yet.`}</p>
      ) : (
        <ul aria-label={t`Installed agents`} className="space-y-1">
          {rows.map((row) => (
            <AgentColorListItem key={row.kind} row={row} />
          ))}
        </ul>
      )}
    </EffectsSettingsGroup>
  );
}
