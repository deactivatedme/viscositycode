/**
 * ViscosityCode Bots UI: create or edit a bot (fork of Poracode).
 *
 * Name, avatar (emoji or initials on a theme colour), brain, workspace
 * project, standing instructions and a memory note. The brain is either any
 * agent the Roundtable engine reports as ready for the project (picked with
 * the app's own `ProviderModelMenu`) or a Grok model over the xAI API, which
 * is offered only when the main process reports a configured key.
 */
import { type CSSProperties, useEffect, useState, type ReactNode } from "react";
import {
  Description,
  FieldError,
  Input,
  Label,
  Modal,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  toast,
} from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Check, Settings2 } from "lucide-react";
import { isHomeProject } from "@/shared/homeScope";
import { friendlyError } from "@/shared/messages";
import type { XaiRegion } from "@/shared/viscosity/xaiContract";
import { getCurrentProjectId } from "@/renderer/actions/currentProject";
import { Button } from "@/renderer/components/common/Button";
import {
  ProviderModelMenu,
  type ProviderModelSelection,
} from "@/renderer/components/common/ProviderModelMenu";
import { Select } from "@/renderer/components/common/Select";
import { TextArea } from "@/renderer/components/common/TextArea";
import { buildProviderModelMenuProviders } from "@/renderer/components/thread/buildModelPickerControls";
import { useDraftEnvironment } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useProject } from "@/renderer/state/useThread";
import { type ReadyAgentBrain, useReadyAgentBrains } from "../../roundtable/api";
import type { ParticipantBrain } from "../../roundtable/types";
import { useBots } from "../api";
import { saveBotEdits } from "../botActions";
import {
  BOT_AVATAR_COLORS,
  type BotAvatarColor,
  BOT_INSTRUCTIONS_MAX_LENGTH,
  BOT_MEMORY_MAX_LENGTH,
  BOT_NAME_MAX_LENGTH,
  botAvatarColorCss,
  botInitials,
  xaiModelsForRegion,
} from "../botModel";
import { useBotsStore } from "../botStore";
import {
  type BotDraft,
  type BotDraftError,
  botToDraft,
  defaultXaiBrain,
  draftToBotInput,
  emptyBotDraft,
  validateBotDraft,
} from "../botValidation";
import { refreshXaiKeyStatus, useXaiKeyStatus } from "@/renderer/viscosity/xai/useXaiKeyStatus";
import { BotAvatar } from "./BotAvatar";
import { ToolCheckbox } from "./ToolCheckbox";
import { XAI_BRAIN_LABEL } from "./brainLabel";

type BrainMode = "agent" | "xai";

function preferredMode(brain: ReadyAgentBrain): "gui" | "terminal" {
  return brain.presentationModes.includes("gui") ? "gui" : (brain.presentationModes[0] ?? "gui");
}

function agentBrainOf(
  ready: ReadyAgentBrain,
  model: string,
  mode: "gui" | "terminal",
): ParticipantBrain {
  return {
    kind: "agent",
    agentKind: ready.agentKind,
    ...(ready.agentInstanceId ? { agentInstanceId: ready.agentInstanceId } : {}),
    model,
    presentationMode: mode,
  };
}

/** A stored glyph that is just the name's initials is shown as "automatic" (blank). */
function initialDraft(botId: string | undefined, fallbackProjectId: string): BotDraft {
  const bot = botId ? useBotsStore.getState().bots[botId] : undefined;
  if (!bot) return emptyBotDraft(fallbackProjectId);
  const draft = botToDraft(bot);
  return draft.glyph === botInitials(bot.label) ? { ...draft, glyph: "" } : draft;
}

function Field(props: {
  label: string;
  hint?: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <TextField className="gap-1.5" isInvalid={props.error !== undefined}>
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-xs font-medium text-foreground">{props.label}</Label>
        {props.hint ? (
          <Description className="text-[11px] text-muted">{props.hint}</Description>
        ) : null}
      </div>
      {props.children}
      {props.error ? (
        <FieldError className="text-[11px] text-danger">{props.error}</FieldError>
      ) : null}
    </TextField>
  );
}

function SectionLabel(props: { children: ReactNode; error?: string | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs font-medium text-foreground">{props.children}</span>
      {props.error ? (
        <span role="alert" className="text-[11px] text-danger">
          {props.error}
        </span>
      ) : null}
    </div>
  );
}

function XaiBrainControls(props: {
  brain: Extract<ParticipantBrain, { kind: "xai" }>;
  onChange: (brain: ParticipantBrain) => void;
}) {
  const { t } = useLingui();
  const { brain } = props;
  const regionOptions = [
    { id: "global", label: t`Global (api.x.ai)` },
    { id: "us", label: t`United States only (us.api.x.ai)` },
  ];
  const models = xaiModelsForRegion(brain.region).map((model) => ({ id: model, label: model }));
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Select
          aria-label={t`Grok model`}
          options={models}
          value={brain.model}
          onChange={(model) => props.onChange({ ...brain, model })}
        />
        <Select
          aria-label={t`xAI region`}
          options={regionOptions}
          value={brain.region}
          onChange={(value) => {
            const region: XaiRegion = value === "us" ? "us" : "global";
            const allowed = xaiModelsForRegion(region);
            props.onChange({
              ...brain,
              region,
              model: allowed.includes(brain.model) ? brain.model : (allowed[0] ?? brain.model),
            });
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <ToolCheckbox
          isSelected={brain.tools.webSearch}
          onChange={(webSearch) =>
            props.onChange({ ...brain, tools: { ...brain.tools, webSearch } })
          }
        >
          <Trans>Web search</Trans>
        </ToolCheckbox>
        <ToolCheckbox
          isSelected={brain.tools.xSearch}
          onChange={(xSearch) => props.onChange({ ...brain, tools: { ...brain.tools, xSearch } })}
        >
          <Trans>X search</Trans>
        </ToolCheckbox>
      </div>
    </div>
  );
}

export function BotEditorDialog(props: { botId?: string; onClose: () => void }) {
  const { t, i18n } = useLingui();
  const editing = props.botId !== undefined;
  const bots = useBots();
  const savedBot = bots.find((bot) => bot.id === props.botId);
  const projects = useAppStore((state) => state.projects);
  const workspaceProjects = projects.filter((project) => !isHomeProject(project));
  const [draft, setDraft] = useState<BotDraft>(() =>
    initialDraft(
      props.botId,
      getCurrentProjectId() ?? workspaceProjects[0]?.id ?? projects[0]?.id ?? "",
    ),
  );
  const [brainMode, setBrainMode] = useState<BrainMode>(draft.brain?.kind ?? "agent");
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const project = useProject(draft.projectId);
  const environment = useDraftEnvironment(project);
  const hiddenModels = useSharedSettings((state) => state.hiddenModels);
  const ready = useReadyAgentBrains(draft.projectId || undefined);
  const xaiDefaults = useBotsStore((state) => state.xaiDefaults);
  const xaiKey = useXaiKeyStatus();
  const xaiAvailable = xaiKey.available;
  const xaiConfigured = xaiKey.status?.configured === true;
  const xaiStatusKnown = xaiKey.status !== undefined || xaiKey.error !== undefined;

  // Re-read on open: the key may have been added in Settings since the last read.
  useEffect(() => {
    void refreshXaiKeyStatus();
  }, []);

  // Agent mode always shows a concrete pick: the first ready agent's default
  // model until the user chooses (derived during render, not in an effect).
  const firstReady = ready[0];
  if (brainMode === "agent" && draft.brain?.kind !== "agent" && firstReady) {
    setDraft({
      ...draft,
      brain: agentBrainOf(firstReady, firstReady.defaultModel, preferredMode(firstReady)),
    });
  }

  const readyByKind = new Map(ready.map((brain) => [brain.agentKind, brain]));
  const providers = buildProviderModelMenuProviders(
    environment.agentStatuses.filter((agent) => readyByKind.has(agent.kind)),
    {
      resolvePresentationMode: (agent) => {
        const brain = readyByKind.get(agent.kind);
        return brain ? preferredMode(brain) : agent.capabilities.presentationMode;
      },
      hiddenModelsByAgent: hiddenModels,
    },
  );

  const validation = validateBotDraft(draft, {
    readyAgents: ready,
    xaiKeyConfigured: xaiConfigured,
    projectIds: new Set(projects.map((candidate) => candidate.id)),
    otherBotNames: bots.filter((bot) => bot.id !== props.botId).map((bot) => bot.label),
    ...(savedBot ? { savedBrain: savedBot.brain } : {}),
  });

  function errorText(error: BotDraftError | undefined): string | undefined {
    if (!showErrors || !error) return undefined;
    switch (error) {
      case "required":
        return t`Required.`;
      case "too-long":
        return t`Too long.`;
      case "duplicate-name":
        return t`Another bot already has this name.`;
      case "invalid-glyph":
        return t`Use one emoji or up to two letters.`;
      case "agent-unavailable":
        return t`This agent is not installed, enabled and signed in for the project.`;
      case "model-required":
        return t`Pick a model.`;
      case "xai-key-missing":
        return t`Add your xAI API key first.`;
      case "xai-model-region":
        return t`This model is not served in the selected region.`;
      case "project-missing":
        return t`Pick a workspace project.`;
    }
  }

  function colorName(color: BotAvatarColor): string {
    switch (color) {
      case "accent":
        return t`Theme accent`;
      case "project-icon-blue":
        return t`Blue`;
      case "project-icon-violet":
        return t`Violet`;
      case "project-icon-pink":
        return t`Pink`;
      case "project-icon-red":
        return t`Red`;
      case "project-icon-orange":
        return t`Orange`;
      case "project-icon-amber":
        return t`Amber`;
      case "project-icon-green":
        return t`Green`;
      case "project-icon-teal":
        return t`Teal`;
    }
  }

  function update(patch: Partial<BotDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function changeBrainMode(mode: BrainMode) {
    setBrainMode(mode);
    if (mode === "xai") {
      update({ brain: draft.brain?.kind === "xai" ? draft.brain : defaultXaiBrain(xaiDefaults) });
    } else if (draft.brain?.kind !== "agent") {
      update({ brain: savedBot?.brain.kind === "agent" ? savedBot.brain : null });
    }
  }

  function onProviderModelChange(next: ProviderModelSelection) {
    const target = readyByKind.get(next.agentKind);
    if (!target) return;
    const mode =
      next.presentationMode && target.presentationModes.includes(next.presentationMode)
        ? next.presentationMode
        : preferredMode(target);
    update({ brain: agentBrainOf(target, next.model, mode) });
  }

  function openKeySettings() {
    props.onClose();
    usePanelStore.getState().openSettingsSection("bots", "bots.xaiKey");
  }

  async function save() {
    setShowErrors(true);
    if (!validation.valid || !draft.brain || saving) return;
    const input = draftToBotInput({ ...draft, brain: draft.brain });
    setSaving(true);
    try {
      if (props.botId) await saveBotEdits(props.botId, input);
      else useBotsStore.getState().createBot(input);
      props.onClose();
    } catch (error) {
      toast.danger(friendlyError(error));
    } finally {
      setSaving(false);
    }
  }

  const projectOptions = (workspaceProjects.length > 0 ? workspaceProjects : projects).map(
    (candidate) => ({ id: candidate.id, label: candidate.name }),
  );
  const previewName = draft.name.trim() || t`Bot`;
  const agentBrain = draft.brain?.kind === "agent" ? draft.brain : undefined;
  const xaiBrain = draft.brain?.kind === "xai" ? draft.brain : undefined;

  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && props.onClose()}>
      <Modal.Container placement="center" scroll="inside">
        <Modal.Dialog className="sm:max-w-[520px]" data-vc-bot-editor="">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>
              {editing ? <Trans>Edit bot</Trans> : <Trans>New bot</Trans>}
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className="p-4">
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <BotAvatar
                  bot={{ label: previewName, avatar: { glyph: draft.glyph, color: draft.color } }}
                  size="lg"
                />
                <div className="grid min-w-0 flex-1 grid-cols-[1fr_96px] gap-3">
                  <Field label={t`Name`} error={errorText(validation.errors.name)}>
                    <Input
                      aria-label={t`Bot name`}
                      placeholder={t`Reviewer`}
                      maxLength={BOT_NAME_MAX_LENGTH}
                      value={draft.name}
                      onChange={(event) => update({ name: event.target.value })}
                    />
                  </Field>
                  <Field label={t`Avatar`} error={errorText(validation.errors.glyph)}>
                    <Input
                      aria-label={t`Avatar emoji or initials`}
                      placeholder={botInitials(previewName)}
                      value={draft.glyph}
                      onChange={(event) => update({ glyph: event.target.value })}
                    />
                  </Field>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <SectionLabel>
                  <Trans>Colour</Trans>
                </SectionLabel>
                <div role="group" aria-label={t`Avatar colour`} className="flex flex-wrap gap-1.5">
                  {BOT_AVATAR_COLORS.map((color) => {
                    const selected = draft.color === color;
                    const style = { background: botAvatarColorCss(color) } as CSSProperties;
                    return (
                      <button
                        key={color}
                        type="button"
                        aria-pressed={selected}
                        aria-label={colorName(color)}
                        data-vc-bot-color={color}
                        className="flex size-6 items-center justify-center rounded-full text-white outline-none focus-visible:focus-ring"
                        style={style}
                        onClick={() => update({ color })}
                      >
                        {selected ? <Check aria-hidden="true" className="size-3.5" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <SectionLabel error={errorText(validation.errors.brain)}>
                  <Trans>Brain</Trans>
                </SectionLabel>
                <ToggleButtonGroup
                  aria-label={t`Brain`}
                  className="h-8 w-fit [&_button]:h-8 [&_button]:min-h-0 [&_button]:min-w-0 [&_button]:px-3"
                  selectionMode="single"
                  disallowEmptySelection
                  size="sm"
                  selectedKeys={[brainMode]}
                  onSelectionChange={(keys) => {
                    const mode = [...keys][0];
                    if (mode === "agent" || mode === "xai") changeBrainMode(mode);
                  }}
                >
                  <ToggleButton id="agent">
                    <Trans>Agent</Trans>
                  </ToggleButton>
                  <ToggleButton id="xai" isDisabled={!xaiAvailable}>
                    {i18n._(XAI_BRAIN_LABEL)}
                  </ToggleButton>
                </ToggleButtonGroup>
                {brainMode === "agent" ? (
                  agentBrain ? (
                    <ProviderModelMenu
                      providers={providers}
                      triggerAppearance="field"
                      menuLabel={t`Agent and model for this bot`}
                      currentAgentKind={agentBrain.agentKind}
                      currentModel={agentBrain.model}
                      presentationMode={agentBrain.presentationMode}
                      onChange={onProviderModelChange}
                    />
                  ) : (
                    <p className="text-xs text-muted">
                      {environment.isDetectingAgents ? (
                        <Trans>Looking for your agents…</Trans>
                      ) : (
                        <Trans>
                          No signed-in agent can run in this project. Install or sign in to an
                          agent, or use Grok over the xAI API.
                        </Trans>
                      )}
                    </p>
                  )
                ) : !xaiAvailable ? (
                  <p className="text-xs text-muted">
                    <Trans>Grok bots work only in the desktop app.</Trans>
                  </p>
                ) : xaiConfigured && xaiBrain ? (
                  <XaiBrainControls brain={xaiBrain} onChange={(brain) => update({ brain })} />
                ) : xaiStatusKnown ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-fit px-0 text-[var(--link)]"
                    onPress={openKeySettings}
                  >
                    <Settings2 aria-hidden="true" className="size-3.5" />
                    <Trans>Add your xAI API key in Settings → Bots</Trans>
                  </Button>
                ) : null}
                <p className="text-[11px] text-muted">
                  {brainMode === "agent" ? (
                    <Trans>
                      Runs on your existing subscription and login, with the agent's own approval
                      settings. You still approve its actions.
                    </Trans>
                  ) : (
                    <Trans>
                      Uses your xAI API key, which stays in the desktop app's main process.
                    </Trans>
                  )}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <SectionLabel error={errorText(validation.errors.project)}>
                  <Trans>Workspace</Trans>
                </SectionLabel>
                <Select
                  aria-label={t`Workspace project`}
                  options={projectOptions}
                  value={draft.projectId}
                  placeholder={t`Choose a project`}
                  onChange={(projectId) => update({ projectId })}
                />
              </div>

              <Field
                label={t`Standing instructions`}
                hint={t`What this bot does and how it answers`}
                error={errorText(validation.errors.instructions)}
              >
                <TextArea
                  aria-label={t`Standing instructions`}
                  autoSize
                  maxRows={8}
                  rows={3}
                  maxLength={BOT_INSTRUCTIONS_MAX_LENGTH}
                  placeholder={t`Review my changes for bugs and explain each fix in one sentence.`}
                  value={draft.instructions}
                  onChange={(event) => update({ instructions: event.target.value })}
                />
              </Field>

              <Field
                label={t`Memory`}
                hint={t`Notes the bot keeps between chats`}
                error={errorText(validation.errors.memory)}
              >
                <TextArea
                  aria-label={t`Memory note`}
                  autoSize
                  maxRows={6}
                  rows={2}
                  maxLength={BOT_MEMORY_MAX_LENGTH}
                  placeholder={t`We use pnpm and Vitest. Prefer small pull requests.`}
                  value={draft.memory}
                  onChange={(event) => update({ memory: event.target.value })}
                />
              </Field>
              {editing && savedBot?.brain.kind === "agent" ? (
                <p className="text-[11px] text-muted">
                  <Trans>
                    Instructions and memory reach an agent at the start of a session. Use New
                    session to apply changes.
                  </Trans>
                </p>
              ) : null}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="ghost" className="text-muted">
              <Trans>Cancel</Trans>
            </Button>
            <Button variant="tertiary" isPending={saving} onPress={() => void save()}>
              {editing ? <Trans>Save</Trans> : <Trans>Create bot</Trans>}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
