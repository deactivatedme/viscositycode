/**
 * ViscosityCode: the composer's playbook picker (desktop shell only).
 *
 * Separate from the agent's Plan/Agent/Autopilot mode: it never reads or
 * writes `mode`, and the two combine freely. Picking applies at once through
 * the composer's own config path (a draft's `onConfigChange`, a live chat's
 * `changeThreadConfig`); the supervisor tells the agent on the next turn.
 */
import { useEffect, useRef, useState } from "react";
import { Description, Dropdown, Header, Label } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { BookMarked, Lock, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/renderer/components/common/Button";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { openSettingsSectionIfOffered } from "@/renderer/viscosity/commands/commandSupport";
import { useViscosityShellEnabled } from "@/renderer/viscosity/layout/tabs/shellGate";
import type { McpServer, ProjectLocation, ThreadConfig } from "@/shared/contracts";
import { mergeMcpServers } from "@/shared/contracts/mcpServer";
import { threadPlaybookBinding, type SavedPlaybook } from "@/shared/viscosity/playbook";
import { applyPlaybook, isPlaybookOutdated, matchPlaybookServers } from "./applyPlaybook";
import { useLiveReAvailable } from "./liveReBridge";
import { PlaybookIcon } from "./playbookIcons";
import { registerPanePlaybook, registerPlaybookTarget } from "./playbookTargets";
import { usePlaybookCatalog, type PlaybookCatalogEntry } from "./usePlaybooks";

const NONE_KEY = "__none";
const UPDATE_KEY = "__update";
const MANAGE_KEY = "__manage";
const EMPTY_SERVERS: readonly McpServer[] = [];

export interface PlaybookChipProps {
  /** Pane key the palette commands resolve (thread id or draft pane id). */
  targetKey: string;
  config: ThreadConfig;
  onConfigChange: (patch: Partial<ThreadConfig>) => void;
  projectMcpServers: readonly McpServer[] | undefined;
  /** The built-in browser can serve this agent and presentation. */
  browserAvailable: boolean;
  /** Where the project runs; live_re is unavailable for WSL projects. Required so no caller forgets it. */
  projectLocation: ProjectLocation | undefined;
  /** Terminal chats get instructions on the next app-sent prompt; tools only in new chats. */
  terminal: boolean;
  /** Set when the playbook's tools wait for a restart. */
  restartNote?: string | undefined;
  isDisabled?: boolean;
}

export function PlaybookChip(props: PlaybookChipProps) {
  const shell = useViscosityShellEnabled();
  if (!shell) return null;
  return <PlaybookChipInner {...props} />;
}

function PlaybookChipInner(props: PlaybookChipProps) {
  const { t } = useLingui();
  const [isOpen, setIsOpen] = useState(false);
  const catalog = usePlaybookCatalog();
  const userServers = useSharedSettings((state) => state.mcpServers);
  const servers = mergeMcpServers(userServers, props.projectMcpServers ?? EMPTY_SERVERS);
  const binding = threadPlaybookBinding(props.config);
  const current = binding ? catalog.find((entry) => entry.playbook.id === binding.id) : undefined;
  const outdated = current
    ? isPlaybookOutdated(props.config, current.playbook, current.builtIn && !current.edited)
    : false;
  const { config, onConfigChange, browserAvailable } = props;
  const liveRe = useLiveReAvailable(props.projectLocation, isOpen);
  const liveReAvailable = liveRe.available;

  function applyNow(playbook: SavedPlaybook | null, liveReReady: boolean) {
    onConfigChange(
      applyPlaybook(config, playbook, { servers, browserAvailable, liveReAvailable: liveReReady })
        .patch,
    );
  }
  // The latest render's applyNow, so a late probe answer patches the current config.
  const latestApply = useRef<typeof applyNow | undefined>(undefined);
  useEffect(() => {
    latestApply.current = applyNow;
    return () => {
      latestApply.current = undefined;
    };
  });
  function apply(playbook: SavedPlaybook | null) {
    const namesLiveRe =
      playbook !== null &&
      matchPlaybookServers(playbook.mcp, servers, false).unavailable.length > 0;
    if (!namesLiveRe || liveRe.known) {
      applyNow(playbook, liveReAvailable);
      return;
    }
    void liveRe.resolve().then((ready) => latestApply.current?.(playbook, ready));
  }
  function applyById(id: string | null) {
    if (props.isDisabled) return;
    if (id === null) {
      if (config.playbook != null) apply(null);
      return;
    }
    const entry = catalog.find((candidate) => candidate.playbook.id === id);
    if (entry) apply(entry.playbook);
  }

  // The palette's Playbook commands act on the focused pane through this picker;
  // re-registered each render so they always see the current config.
  useEffect(() =>
    registerPlaybookTarget(props.targetKey, {
      openPicker: () => setIsOpen(true),
      apply: applyById,
    }),
  );
  // The playbook theme follows this pane's own choice (two drafts can share a project).
  useEffect(
    () => registerPanePlaybook(props.targetKey, config.playbook),
    [props.targetKey, config.playbook],
  );

  function readiness(playbook: SavedPlaybook): string | undefined {
    const parts: string[] = [];
    const { found, unavailable } = matchPlaybookServers(playbook.mcp, servers, liveReAvailable);
    if (found.length > 0) parts.push(t`${found.join(", ")}: on`);
    if (unavailable.length > 0) parts.push(t`${unavailable.join(", ")}: not available here`);
    else if (found.length === 0 && (playbook.mcp?.length ?? 0) > 0)
      parts.push(t`No matching MCP server set up`);
    if (playbook.browserMcp && !browserAvailable)
      parts.push(t`Browser not available for this agent`);
    if (props.terminal && ((playbook.mcp?.length ?? 0) > 0 || playbook.browserMcp)) {
      parts.push(t`Tool changes apply to new chats`);
    }
    return parts.length > 0 ? parts.join(" · ") : undefined;
  }

  function row(entry: PlaybookCatalogEntry) {
    const { playbook } = entry;
    const ready = readiness(playbook);
    return (
      <Dropdown.Item key={playbook.id} id={playbook.id} textValue={playbook.label}>
        <PlaybookIcon name={playbook.icon} className="size-4 shrink-0 text-muted" />
        <div className="flex min-w-0 flex-1 flex-col">
          <Label className="flex items-center gap-1.5 truncate">
            {playbook.label}
            {playbook.readOnly ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted">
                <Lock className="size-2.5" aria-hidden="true" />
                <Trans>Read-only</Trans>
              </span>
            ) : null}
          </Label>
          {playbook.description ? (
            <Description className="truncate">{playbook.description}</Description>
          ) : null}
          {ready ? <Description className="truncate">{ready}</Description> : null}
        </div>
        <Dropdown.ItemIndicator />
      </Dropdown.Item>
    );
  }

  const builtIns = catalog.filter((entry) => entry.builtIn);
  const own = catalog.filter((entry) => !entry.builtIn);
  const selected = binding ? binding.id : NONE_KEY;
  const tooltip = binding
    ? binding.readOnly
      ? t`Playbook: ${binding.label} · Asks the agent not to edit files`
      : t`Playbook: ${binding.label}`
    : t`Playbook: standing instructions and tools for this chat`;

  return (
    <span className="vc-playbook-chip inline-flex items-center" data-playbook={binding?.id}>
      <Dropdown isOpen={isOpen} onOpenChange={setIsOpen}>
        <Button
          isIconOnly={!binding}
          aria-label={tooltip}
          className={`poracode-composer-menu ${binding ? "gap-1 px-2" : "min-w-9 px-2"}`}
          size="sm"
          variant="ghost"
          isDisabled={props.isDisabled ?? false}
        >
          <span title={tooltip} className="inline-flex items-center gap-1">
            {binding ? (
              <>
                <PlaybookIcon name={binding.icon} className="size-3.5" />
                <span className="max-w-28 truncate text-xs">{binding.label}</span>
                {binding.readOnly ? (
                  <Lock className="size-3 text-muted" aria-hidden="true" />
                ) : null}
              </>
            ) : (
              <BookMarked className="size-3.5" />
            )}
          </span>
        </Button>
        <Dropdown.Popover placement="top start" className="max-w-[calc(100vw-2rem)]">
          <p className="max-w-80 px-3 pt-2 pb-1 text-[11px] leading-snug text-muted">
            <Trans>
              Playbook: how the agent approaches this chat. Plan, Agent and Autopilot are separate.
            </Trans>
          </p>
          <Dropdown.Menu
            aria-label={t`Playbooks`}
            selectionMode="single"
            selectedKeys={[selected]}
            onAction={(key) => {
              const id = String(key);
              if (id === MANAGE_KEY) openSettingsSectionIfOffered("playbooks");
              else if (id === UPDATE_KEY) {
                if (current) apply(current.playbook);
              } else applyById(id === NONE_KEY ? null : id);
            }}
            className="poracode-menu max-h-[60vh] w-80 overflow-y-auto"
          >
            {[
              ...(outdated
                ? [
                    <Dropdown.Item key={UPDATE_KEY} id={UPDATE_KEY} textValue={t`Update to latest`}>
                      <RefreshCw className="size-4 text-muted" />
                      <Label className="flex-1 truncate">
                        <Trans>Update to latest</Trans>
                      </Label>
                    </Dropdown.Item>,
                  ]
                : []),
              <Dropdown.Section key="none">
                <Dropdown.Item id={NONE_KEY} textValue={t`None`}>
                  <X className="size-4 text-muted" />
                  <Label className="flex-1 truncate">
                    <Trans>None</Trans>
                  </Label>
                  <Dropdown.ItemIndicator />
                </Dropdown.Item>
              </Dropdown.Section>,
              <Dropdown.Section key="built-in">
                <Header>
                  <Trans>Built-in</Trans>
                </Header>
                {builtIns.map(row)}
              </Dropdown.Section>,
              ...(own.length > 0
                ? [
                    <Dropdown.Section key="own">
                      <Header>
                        <Trans>Yours</Trans>
                      </Header>
                      {own.map(row)}
                    </Dropdown.Section>,
                  ]
                : []),
              <Dropdown.Section key="manage">
                <Dropdown.Item id={MANAGE_KEY} textValue={t`Manage playbooks…`}>
                  <SlidersHorizontal className="size-4 text-muted" />
                  <Label className="flex-1 truncate">
                    <Trans>Manage playbooks…</Trans>
                  </Label>
                </Dropdown.Item>
              </Dropdown.Section>,
            ]}
          </Dropdown.Menu>
          {props.restartNote ? (
            <p className="border-t border-border px-3 py-1.5 text-[11px] leading-snug text-muted">
              {props.restartNote}
            </p>
          ) : null}
        </Dropdown.Popover>
      </Dropdown>
      {binding ? (
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={t`Turn off the ${binding.label} playbook`}
          className="min-w-6 px-1"
          isDisabled={props.isDisabled ?? false}
          onPress={() => apply(null)}
        >
          <X className="size-3" />
        </Button>
      ) : null}
    </span>
  );
}
