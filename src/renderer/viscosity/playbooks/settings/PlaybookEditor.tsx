/**
 * ViscosityCode: the playbook editor dialog. Edits a local copy and saves it
 * whole, so a half-typed name or empty instructions never reach the host
 * setting. Phrases are canonicalized with the shared sanitizer before saving.
 */
import { useState } from "react";
import { Modal } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/renderer/components/common/Button";
import { Input } from "@/renderer/components/common/Input";
import { Select } from "@/renderer/components/common/Select";
import { TextArea } from "@/renderer/components/common/TextArea";
import { ToggleSwitch } from "@/renderer/components/common/ToggleSwitch";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { APP_THEME_OPTIONS } from "@/renderer/theme/themePresets";
import {
  MAX_PLAYBOOK_MCP_NAMES,
  PLAYBOOK_DESCRIPTION_MAX_LENGTH,
  PLAYBOOK_INSTRUCTIONS_MAX_LENGTH,
  PLAYBOOK_LABEL_MAX_LENGTH,
  PLAYBOOK_MCP_NAME_MAX_LENGTH,
  playbookThemeIdSchema,
  sanitizePlaybookPhrases,
  savedPlaybookSchema,
  type SavedPlaybook,
} from "@/shared/viscosity/playbook";
import { PLAYBOOK_ICON_NAMES, PlaybookIcon } from "../playbookIcons";
import { ReversingSetupCheck } from "./ReversingSetupCheck";

const NO_THEME = "__none";

export interface PlaybookEditorDraft {
  label: string;
  icon: string;
  description: string;
  readOnly: boolean;
  themeId: string;
  switchPhrases: string;
  exitPhrases: string;
  mcp: string;
  browserMcp: boolean;
  instructions: string;
}

export function draftFromPlaybook(playbook: SavedPlaybook): PlaybookEditorDraft {
  return {
    label: playbook.label,
    icon: playbook.icon ?? "book-marked",
    description: playbook.description ?? "",
    readOnly: playbook.readOnly === true,
    themeId: playbook.themeId ?? NO_THEME,
    switchPhrases: (playbook.switchPhrases ?? []).join("\n"),
    exitPhrases: (playbook.exitPhrases ?? []).join("\n"),
    mcp: (playbook.mcp ?? []).join(", "),
    browserMcp: playbook.browserMcp === true,
    instructions: playbook.instructions,
  };
}

/** The saved form of a draft, or undefined when it does not validate. */
export function playbookFromDraft(
  id: string,
  draft: PlaybookEditorDraft,
): SavedPlaybook | undefined {
  const switchPhrases = sanitizePlaybookPhrases(draft.switchPhrases.split("\n"));
  const exitPhrases = sanitizePlaybookPhrases(draft.exitPhrases.split("\n"));
  const mcp = [
    ...new Set(
      draft.mcp
        .split(/[,\n]/)
        .map((name) => name.trim().slice(0, PLAYBOOK_MCP_NAME_MAX_LENGTH))
        .filter(Boolean),
    ),
  ].slice(0, MAX_PLAYBOOK_MCP_NAMES);
  const description = draft.description.trim();
  const parsed = savedPlaybookSchema.safeParse({
    id,
    label: draft.label.trim(),
    icon: draft.icon,
    ...(draft.readOnly ? { readOnly: true } : {}),
    instructions: draft.instructions.trim(),
    ...(draft.themeId !== NO_THEME ? { themeId: draft.themeId } : {}),
    ...(switchPhrases.length > 0 ? { switchPhrases } : {}),
    ...(exitPhrases.length > 0 ? { exitPhrases } : {}),
    ...(description ? { description } : {}),
    ...(mcp.length > 0 ? { mcp } : {}),
    ...(draft.browserMcp ? { browserMcp: true } : {}),
  });
  return parsed.success ? parsed.data : undefined;
}

export function PlaybookEditor(props: {
  id: string;
  initial: SavedPlaybook;
  title: string;
  onSave: (playbook: SavedPlaybook) => boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState(() => draftFromPlaybook(props.initial));
  const [error, setError] = useState<string | undefined>();
  const customThemes = useSharedSettings((state) => state.customThemes);
  const mcpServers = useSharedSettings((state) => state.mcpServers);
  const update = (patch: Partial<PlaybookEditorDraft>) => {
    setError(undefined);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const themeOptions = [
    { id: NO_THEME, label: t`None` },
    ...APP_THEME_OPTIONS,
    ...customThemes
      .filter((theme) => playbookThemeIdSchema.safeParse(theme.id).success)
      .map((theme) => ({ id: theme.id, label: theme.label })),
  ];
  // A theme this app does not know (removed, or from a newer app) stays selectable.
  if (!themeOptions.some((option) => option.id === draft.themeId)) {
    themeOptions.push({ id: draft.themeId, label: draft.themeId });
  }
  const configuredNames = mcpServers.map((server) => server.name).join(", ");

  function save() {
    const playbook = playbookFromDraft(props.id, draft);
    if (!playbook) {
      setError(t`Give the playbook a name and instructions.`);
      return;
    }
    if (!props.onSave(playbook)) {
      setError(
        t`This playbook couldn't be saved. You may have reached the limit of saved playbooks.`,
      );
      return;
    }
    props.onClose();
  }

  const field = "flex min-w-0 flex-col gap-1";
  const caption = "text-[11px] text-muted";
  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && props.onClose()}>
      <Modal.Container placement="center" scroll="inside" size="md">
        <Modal.Dialog className="sm:max-w-xl">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{props.title}</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="space-y-3 p-4">
            <div className={field}>
              <span className={caption}>{t`Name`}</span>
              <Input
                aria-label={t`Playbook name`}
                value={draft.label}
                maxLength={PLAYBOOK_LABEL_MAX_LENGTH}
                variant="secondary"
                className="h-8 min-w-0 text-sm"
                onChange={(event) => update({ label: event.target.value })}
              />
            </div>
            <div className={field}>
              <span className={caption}>{t`Icon`}</span>
              <div role="radiogroup" aria-label={t`Icon`} className="flex flex-wrap gap-1">
                {PLAYBOOK_ICON_NAMES.map((name) => (
                  <Button
                    key={name}
                    isIconOnly
                    size="sm"
                    variant={draft.icon === name ? "secondary" : "ghost"}
                    aria-label={name}
                    aria-pressed={draft.icon === name}
                    onPress={() => update({ icon: name })}
                  >
                    <PlaybookIcon name={name} className="size-4" />
                  </Button>
                ))}
              </div>
            </div>
            <div className={field}>
              <span className={caption}>{t`Description`}</span>
              <Input
                aria-label={t`Playbook description`}
                value={draft.description}
                maxLength={PLAYBOOK_DESCRIPTION_MAX_LENGTH}
                variant="secondary"
                className="h-8 min-w-0 text-sm"
                onChange={(event) => update({ description: event.target.value })}
              />
            </div>
            <ToggleSwitch isSelected={draft.readOnly} onChange={(readOnly) => update({ readOnly })}>
              <span className="text-sm">{t`Ask the agent not to edit files`}</span>
            </ToggleSwitch>
            <div className={field}>
              <span className={caption}>{t`Theme`}</span>
              <Select
                aria-label={t`Playbook theme`}
                options={themeOptions}
                value={draft.themeId}
                onChange={(themeId) => update({ themeId })}
              />
              <span className={caption}>
                {t`Shown while a chat with this playbook is on screen, if Let playbooks change the theme is on.`}
              </span>
            </div>
            <div className={field}>
              <span
                className={caption}
              >{t`MCP servers to switch on (names, separated by commas)`}</span>
              <Input
                aria-label={t`MCP server names`}
                value={draft.mcp}
                variant="secondary"
                className="h-8 min-w-0 text-sm"
                onChange={(event) => update({ mcp: event.target.value })}
              />
              {configuredNames ? (
                <span className={caption}>{t`Configured: ${configuredNames}`}</span>
              ) : null}
            </div>
            <ToggleSwitch
              isSelected={draft.browserMcp}
              onChange={(browserMcp) => update({ browserMcp })}
            >
              <span className="text-sm">{t`In-app browser`}</span>
            </ToggleSwitch>
            <div className={field}>
              <span className="flex items-center justify-between">
                <span className={caption}>{t`Instructions for the agent`}</span>
                <span className={`${caption} tabular-nums`}>
                  {draft.instructions.length} / {PLAYBOOK_INSTRUCTIONS_MAX_LENGTH}
                </span>
              </span>
              <TextArea
                aria-label={t`Playbook instructions`}
                value={draft.instructions}
                maxLength={PLAYBOOK_INSTRUCTIONS_MAX_LENGTH}
                rows={10}
                variant="secondary"
                className="font-mono text-xs"
                onChange={(event) => update({ instructions: event.target.value })}
              />
            </div>
            {props.id === "reversing" || props.id === "live-reversing" ? (
              <ReversingSetupCheck idaDebugger={props.id === "live-reversing"} />
            ) : null}
            {error ? (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={props.onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Button variant="primary" onPress={save}>
              <Trans>Save</Trans>
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
