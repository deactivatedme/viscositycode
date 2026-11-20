/**
 * ViscosityCode: Settings → Playbooks. Built-ins first (Edit saves an edited
 * copy, Reset removes it), then the user's own (Edit, Duplicate, Delete). The
 * list is the host setting `playbooks`; the three switches at the top are this
 * device's view preferences.
 */
import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Copy, Lock, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/renderer/components/common/Button";
import { ConfirmDialog } from "@/renderer/components/common/ConfirmDialog";
import { ToggleSwitch } from "@/renderer/components/common/ToggleSwitch";
import { ThreadDockIconButton } from "@/renderer/components/thread/ThreadDockUI";
import { SettingRow, SettingsPage } from "@/renderer/views/SettingsOverlay/parts/SettingsForm";
import { PLAYBOOK_LABEL_MAX_LENGTH, type SavedPlaybook } from "@/shared/viscosity/playbook";
import { PlaybookIcon } from "../playbookIcons";
import {
  newCustomPlaybookId,
  removeSavedPlaybook,
  savePlaybook,
  usePlaybookCatalog,
  type PlaybookCatalogEntry,
} from "../usePlaybooks";
import { setPlaybookViewPrefs, usePlaybookViewPref } from "../viewPrefs";
import { PlaybookEditor } from "./PlaybookEditor";

type Editing = { id: string; initial: SavedPlaybook; title: string };
type Confirming = { kind: "delete" | "reset"; entry: PlaybookCatalogEntry };

export function PlaybooksSettings() {
  const { t } = useLingui();
  const catalog = usePlaybookCatalog();
  const themeOverride = usePlaybookViewPref("themeOverride");
  const [editing, setEditing] = useState<Editing | undefined>();
  const [confirming, setConfirming] = useState<Confirming | undefined>();
  const [removeFailed, setRemoveFailed] = useState(false);
  const takenIds = new Set(catalog.map((entry) => entry.playbook.id));

  function startNew() {
    setEditing({
      id: newCustomPlaybookId(takenIds),
      initial: { id: "new", label: t`New playbook`, icon: "book-marked", instructions: "" },
      title: t`New playbook`,
    });
  }
  function duplicate(playbook: SavedPlaybook) {
    const suffix = t` copy`;
    const label = `${playbook.label.slice(0, PLAYBOOK_LABEL_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`;
    setEditing({
      id: newCustomPlaybookId(takenIds),
      initial: { ...playbook, label },
      title: t`New playbook`,
    });
  }
  function confirm() {
    if (confirming) setRemoveFailed(!removeSavedPlaybook(confirming.entry.playbook.id));
    setConfirming(undefined);
  }

  function row(entry: PlaybookCatalogEntry) {
    const { playbook } = entry;
    return (
      <li key={playbook.id} className="flex items-center gap-3 px-3 py-2.5">
        <PlaybookIcon name={playbook.icon} className="size-4 shrink-0 text-muted" />
        <button
          type="button"
          className="min-w-0 flex-1 rounded text-left"
          onClick={() =>
            setEditing({ id: playbook.id, initial: playbook, title: t`Edit ${playbook.label}` })
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{playbook.label}</span>
            {playbook.readOnly ? (
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                <Lock className="size-3" aria-hidden="true" />
                {t`Read-only`}
              </span>
            ) : null}
            {entry.edited ? <span className="shrink-0 text-xs text-muted">{t`Edited`}</span> : null}
          </span>
          {playbook.description ? (
            <span className="mt-0.5 block truncate text-xs text-muted">{playbook.description}</span>
          ) : null}
        </button>
        <ThreadDockIconButton
          label={t`Edit ${playbook.label}`}
          onPress={() =>
            setEditing({ id: playbook.id, initial: playbook, title: t`Edit ${playbook.label}` })
          }
        >
          <Pencil className="size-3.5" />
        </ThreadDockIconButton>
        <ThreadDockIconButton
          label={t`Duplicate ${playbook.label}`}
          onPress={() => duplicate(playbook)}
        >
          <Copy className="size-3.5" />
        </ThreadDockIconButton>
        {entry.builtIn ? (
          entry.edited ? (
            <ThreadDockIconButton
              label={t`Reset ${playbook.label}`}
              onPress={() => setConfirming({ kind: "reset", entry })}
            >
              <RotateCcw className="size-3.5" />
            </ThreadDockIconButton>
          ) : null
        ) : (
          <ThreadDockIconButton
            danger
            label={t`Delete ${playbook.label}`}
            onPress={() => setConfirming({ kind: "delete", entry })}
          >
            <Trash2 className="size-3.5" />
          </ThreadDockIconButton>
        )}
      </li>
    );
  }

  const builtIns = catalog.filter((entry) => entry.builtIn);
  const own = catalog.filter((entry) => !entry.builtIn);
  const listClass = "overflow-hidden rounded-xl border border-[var(--hairline)]";
  return (
    <SettingsPage
      title={t`Playbooks`}
      description={t`Playbooks are work modes for a chat: standing instructions for the agent and the tools it needs.`}
      actions={
        <Button size="sm" variant="tertiary" onPress={startNew}>
          <Plus className="size-4" />
          {t`New playbook`}
        </Button>
      }
    >
      <SettingRow
        anchorId="playbooks.theme"
        title={t`Let playbooks change the theme`}
        description={t`A chat's playbook can restyle the app while that chat is on screen. Only on this device.`}
      >
        <ToggleSwitch
          aria-label={t`Let playbooks change the theme`}
          isSelected={themeOverride}
          onChange={(value) => setPlaybookViewPrefs({ themeOverride: value })}
        />
      </SettingRow>
      <div id="playbooks.list" data-settings-anchor="playbooks.list" className="space-y-3">
        {removeFailed ? (
          <p role="alert" className="text-xs text-danger">
            {t`This change couldn't be saved. Try again.`}
          </p>
        ) : null}
        <p className="text-xs font-medium text-muted">{t`Built-in`}</p>
        <ul className={`${listClass} divide-y divide-[var(--hairline)]`}>{builtIns.map(row)}</ul>
        <p className="text-xs font-medium text-muted">{t`Yours`}</p>
        {own.length > 0 ? (
          <ul className={`${listClass} divide-y divide-[var(--hairline)]`}>{own.map(row)}</ul>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--hairline-strong)] px-4 py-5 text-center text-xs text-muted">
            {t`No playbooks of your own yet. Duplicate a built-in or start a new one.`}
          </div>
        )}
        <p className="text-[11px] text-muted">
          {t`Chats keep the version they started with; use Update to latest in the picker to refresh one.`}
        </p>
        <p className="text-[11px] text-muted">
          {t`Read-only asks the agent not to edit files: an instruction, not a permission.`}
        </p>
      </div>
      {editing ? (
        <PlaybookEditor
          key={editing.id}
          id={editing.id}
          initial={editing.initial}
          title={editing.title}
          onSave={savePlaybook}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
      <ConfirmDialog
        isOpen={confirming !== undefined}
        title={
          confirming?.kind === "reset"
            ? t`Reset ${confirming.entry.playbook.label}?`
            : t`Delete ${confirming?.entry.playbook.label ?? ""}?`
        }
        body={
          confirming?.kind === "reset"
            ? t`Your edits are replaced by the built-in text. Chats already using it keep their copy.`
            : t`This cannot be undone. Chats already using it keep their copy.`
        }
        confirmLabel={confirming?.kind === "reset" ? t`Reset` : t`Delete`}
        onClose={() => setConfirming(undefined)}
        onConfirm={confirm}
      />
    </SettingsPage>
  );
}
