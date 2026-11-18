/**
 * ViscosityCode Roundtable UI: the "New Roundtable" setup dialog.
 *
 * Seats 2–5 participants. Each agent seat picks provider + model with the
 * app's own `ProviderModelMenu`, limited to the agents the engine reports as
 * ready (installed, enabled, signed in, with models); a Grok model over the
 * xAI API is offered only when the main process reports a configured key.
 * Start stays disabled until the form is valid; the reason is always shown.
 */
import { useState } from "react";
import {
  Checkbox,
  Input,
  Label,
  Modal,
  NumberField,
  Radio,
  RadioGroup,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  toast,
} from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Plus, Settings2, Sparkles, X } from "lucide-react";
import { isHomeProject } from "@/shared/homeScope";
import { XAI_US_TEXT_MODELS } from "@/shared/viscosity/xaiContract";
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
import { useXaiKeyStatus } from "@/renderer/viscosity/xai/useXaiKeyStatus";
import { type ReadyAgentBrain, startRoundtable, useReadyAgentBrains } from "../api";
import type { ParticipantBrain, ParticipantRole, RoundtablePattern } from "../types";
import { postOpeningMessage } from "./openingMessage";
import { ParticipantAvatar } from "./ParticipantAvatar";
import {
  defaultMaxRounds,
  MAX_PARTICIPANTS,
  MAX_ROUNDS_LIMIT,
  PATTERN_DESCRIPTIONS,
  PATTERN_LABELS,
  patternUsesOwnWorktrees,
  ROLE_LABELS,
  ROUNDTABLE_PATTERNS,
  ROUNDTABLE_ROLES,
} from "./patterns";
import {
  closeRoundtableSetup,
  openRoundtableTab,
  type RoundtableSetupRequest,
  useRoundtableViewStore,
} from "./roundtableViewStore";
import {
  addSeat,
  agentBrainFor,
  brainLabel,
  buildStartInput,
  canAddSeat,
  changePattern,
  initialSeats,
  nextReadyBrain,
  preferredPresentationMode,
  removeSeat,
  type RoundtableSetupDraft,
  roundsApply,
  seatFromProfile,
  type SetupProblem,
  type SetupSeat,
  updateSeat,
  validateSetup,
  type WorktreeMode,
  xaiBrain,
} from "./setupModel";

/** Setup checks that need live data (ready agents, the xAI key) on top of `validateSetup`. */
export type SetupBlocker = SetupProblem | "agent-unavailable" | "xai-unavailable";

export function findSetupBlocker(
  draft: RoundtableSetupDraft,
  ready: readonly ReadyAgentBrain[],
  xaiConfigured: boolean,
): SetupBlocker | null {
  const problem = validateSetup(draft);
  if (problem) return problem;
  const readyKinds = new Set(ready.map((brain) => brain.agentKind));
  for (const seat of draft.seats) {
    if (seat.brain.kind === "agent" && !readyKinds.has(seat.brain.agentKind)) {
      return "agent-unavailable";
    }
    if (seat.brain.kind === "xai" && !xaiConfigured) return "xai-unavailable";
  }
  return null;
}

function useBlockerMessage(blocker: SetupBlocker | null): string {
  const { t } = useLingui();
  switch (blocker) {
    case null:
      return "";
    case "no-project":
      return t`Choose a project.`;
    case "no-task":
      return t`Describe the task.`;
    case "too-few-participants":
      return t`Seat at least two participants.`;
    case "too-many-participants":
      return t`Seat at most five participants.`;
    case "missing-model":
      return t`Pick a model for every participant.`;
    case "invalid-rounds":
      return t`Rounds must be between 1 and ${MAX_ROUNDS_LIMIT}.`;
    case "agent-unavailable":
      return t`A participant's agent is not signed in for this project.`;
    case "xai-unavailable":
      return t`Grok over the xAI API needs an API key in Settings.`;
  }
}

function initialDraft(request: RoundtableSetupRequest): RoundtableSetupDraft {
  const pattern = request.pattern ?? "build-review";
  const projects = useAppStore.getState().projects;
  const projectId =
    request.projectId ??
    getCurrentProjectId() ??
    (projects.find((project) => !isHomeProject(project)) ?? projects[0])?.id;
  return {
    title: request.title ?? "",
    task: request.task ?? "",
    projectId,
    pattern,
    seats: request.participants?.map(seatFromProfile) ?? [],
    maxRounds: defaultMaxRounds(pattern) ?? defaultMaxRounds("build-review") ?? 4,
    worktreeMode: "current",
    branchName: "",
    ...(request.originThreadId ? { originThreadId: request.originThreadId } : {}),
    // Seats that arrive with the request (bots, an invited chat) keep their roles.
    rolesCustomized: (request.participants?.length ?? 0) > 0,
  };
}

function XaiSeatControls(props: {
  brain: Extract<ParticipantBrain, { kind: "xai" }>;
  seatNumber: number;
  onChange: (brain: ParticipantBrain) => void;
}) {
  const { t } = useLingui();
  const { brain, seatNumber } = props;
  return (
    <div className="vc-rt-seat__xai">
      <span className="vc-rt-seat__api-label">
        <Trans>Grok (xAI API)</Trans>
      </span>
      <Select
        aria-label={t`Grok model for participant ${seatNumber}`}
        className="w-[112px] shrink-0"
        options={XAI_US_TEXT_MODELS.map((model) => ({ id: model, label: model }))}
        value={brain.model}
        onChange={(model) => props.onChange({ ...brain, model })}
      />
      <Select
        aria-label={t`xAI region for participant ${seatNumber}`}
        className="w-[104px] shrink-0"
        options={[
          { id: "global", label: t`Global` },
          { id: "us", label: t`US only` },
        ]}
        value={brain.region}
        onChange={(region) =>
          props.onChange({ ...brain, region: region === "us" ? "us" : "global" })
        }
      />
      <Checkbox
        isSelected={brain.tools.webSearch}
        onChange={(webSearch) => props.onChange({ ...brain, tools: { ...brain.tools, webSearch } })}
      >
        <Checkbox.Content>
          <Checkbox.Control className="border border-[var(--hairline-strong)] bg-surface-secondary shadow-none">
            <Checkbox.Indicator />
          </Checkbox.Control>
          <Trans>Web search</Trans>
        </Checkbox.Content>
      </Checkbox>
      <Checkbox
        isSelected={brain.tools.xSearch}
        onChange={(xSearch) => props.onChange({ ...brain, tools: { ...brain.tools, xSearch } })}
      >
        <Checkbox.Content>
          <Checkbox.Control className="border border-[var(--hairline-strong)] bg-surface-secondary shadow-none">
            <Checkbox.Indicator />
          </Checkbox.Control>
          <Trans>X search</Trans>
        </Checkbox.Content>
      </Checkbox>
    </div>
  );
}

function SeatRow(props: {
  seat: SetupSeat;
  index: number;
  ready: readonly ReadyAgentBrain[];
  providers: ReturnType<typeof buildProviderModelMenuProviders>;
  onBrainChange: (brain: ParticipantBrain) => void;
  onRoleChange: (role: ParticipantRole) => void;
  onRemove: () => void;
}) {
  const { t, i18n } = useLingui();
  const { seat, ready } = props;
  const seatNumber = props.index + 1;
  const roleOptions = ROUNDTABLE_ROLES.map((role) => ({
    id: role,
    label: i18n._(ROLE_LABELS[role]),
  }));
  const label = seat.label ?? brainLabel(seat.brain, ready);

  function onProviderModelChange(next: ProviderModelSelection) {
    const target = ready.find((brain) => brain.agentKind === next.agentKind);
    if (!target) return;
    const mode =
      next.presentationMode && target.presentationModes.includes(next.presentationMode)
        ? next.presentationMode
        : preferredPresentationMode(target);
    props.onBrainChange(agentBrainFor(target, next.model, mode));
  }

  return (
    <li className="vc-rt-seat" data-vc-rt-seat={seat.id} aria-label={t`Participant ${seatNumber}`}>
      <span aria-hidden="true" className="vc-rt-seat__number">
        {seatNumber}
      </span>
      <ParticipantAvatar
        participant={{ label, brain: seat.brain, ...(seat.avatar ? { avatar: seat.avatar } : {}) }}
      />
      <div className="vc-rt-seat__brain">
        {seat.brain.kind === "agent" ? (
          <ProviderModelMenu
            providers={props.providers}
            triggerAppearance="field"
            menuLabel={t`Provider and model for participant ${seatNumber}`}
            currentAgentKind={seat.brain.agentKind}
            currentModel={seat.brain.model}
            presentationMode={seat.brain.presentationMode}
            onChange={onProviderModelChange}
          />
        ) : (
          <XaiSeatControls
            brain={seat.brain}
            seatNumber={seatNumber}
            onChange={props.onBrainChange}
          />
        )}
      </div>
      <Select
        aria-label={t`Role of participant ${seatNumber}`}
        className="w-[116px] shrink-0"
        options={roleOptions}
        value={seat.role}
        onChange={(value) => {
          const role = ROUNDTABLE_ROLES.find((candidate) => candidate === value);
          if (role) props.onRoleChange(role);
        }}
      />
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={t`Remove participant ${seatNumber}`}
        className="text-muted"
        onPress={props.onRemove}
      >
        <X className="size-3.5" />
      </Button>
    </li>
  );
}

function NoAgentsNotice(props: { detecting: boolean }) {
  if (props.detecting) {
    return (
      <p className="vc-rt-setup__notice" role="status">
        <Trans>Looking for installed agents…</Trans>
      </p>
    );
  }
  return (
    <div className="vc-rt-setup__notice" role="status">
      <p>
        <Trans>
          No signed-in agents for this project. Install an agent and sign in to it in Settings →
          Agents, then come back.
        </Trans>
      </p>
      <Button
        size="sm"
        variant="tertiary"
        onPress={() => {
          closeRoundtableSetup();
          usePanelStore.getState().openSettingsSection("agentsGeneral");
        }}
      >
        <Settings2 aria-hidden="true" className="size-3.5" />
        <Trans>Open Settings → Agents</Trans>
      </Button>
    </div>
  );
}

export function RoundtableSetupDialog(props: { request: RoundtableSetupRequest }) {
  const { t, i18n } = useLingui();
  const [draft, setDraft] = useState(() => initialDraft(props.request));
  const [seeded, setSeeded] = useState(draft.seats.length > 0);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Every project a thread can run in, Home included (the current one is preselected).
  const projects = useAppStore((state) => state.projects);
  const project = projects.find((candidate) => candidate.id === draft.projectId);
  const ready = useReadyAgentBrains(draft.projectId);
  const { agentStatuses, isDetectingAgents } = useDraftEnvironment(project);
  const hiddenModels = useSharedSettings((state) => state.hiddenModels);
  // Only the key's status reaches the page; the key stays in the main process.
  const xaiKey = useXaiKeyStatus();
  const xaiConfigured = xaiKey.available && xaiKey.status?.configured === true;

  // Seat two different ready agents once the engine reports them (unless the
  // request brought its own seats or the user already edited the table).
  if (!seeded && ready.length > 0) {
    setSeeded(true);
    setDraft((current) =>
      current.seats.length > 0
        ? current
        : { ...current, seats: initialSeats(ready, current.pattern) },
    );
  }

  const readyByKind = new Map(ready.map((brain) => [brain.agentKind, brain]));
  const providers = buildProviderModelMenuProviders(
    agentStatuses.filter((agent) => readyByKind.has(agent.kind)),
    {
      resolvePresentationMode: (agent) => {
        const brain = readyByKind.get(agent.kind);
        return brain ? preferredPresentationMode(brain) : agent.capabilities.presentationMode;
      },
      hiddenModelsByAgent: hiddenModels,
    },
  );

  const blocker = findSetupBlocker(draft, ready, xaiConfigured);
  const blockerMessage = useBlockerMessage(blocker);
  const ownWorktrees = patternUsesOwnWorktrees(draft.pattern);

  function edit(next: (current: RoundtableSetupDraft) => RoundtableSetupDraft) {
    setStartError(null);
    setDraft(next);
  }

  function addAgentSeat() {
    edit((current) => {
      const brain = nextReadyBrain(ready, current.seats);
      return brain ? addSeat(current, agentBrainFor(brain)) : current;
    });
  }

  async function start() {
    if (blocker || starting) return;
    setStarting(true);
    setStartError(null);
    const opening = useRoundtableViewStore.getState().setup;
    const input = buildStartInput(draft, ready);
    let sessionId: string;
    try {
      sessionId = await startRoundtable(input);
    } catch (error) {
      setStarting(false);
      setStartError(error instanceof Error ? error.message : String(error));
      return;
    }
    // An open chat waits for messages: its task is the first one, so the
    // participants answer right away. The session has started either way, so
    // a failed post is only reported.
    if (input.pattern === "open") {
      await postOpeningMessage(sessionId, input.task, input.participants).catch((error: unknown) =>
        toast.danger(error instanceof Error ? error.message : String(error)),
      );
    }
    // Dismissed while starting: the session runs and is listed, but the
    // window does not jump to it.
    if (useRoundtableViewStore.getState().setup !== opening) return;
    closeRoundtableSetup();
    // Never switch to the Roundtable by itself: its tab appears in the
    // background and the user opens it when they want to.
    openRoundtableTab(sessionId);
    toast.success(t`Roundtable started`);
  }

  const footerMessage = startError ?? blockerMessage;
  const seatCount = draft.seats.length;

  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && closeRoundtableSetup()}>
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="vc-rt-setup sm:max-w-[680px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>
              <Trans>New Roundtable</Trans>
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex flex-col gap-4 p-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
              <TextField
                value={draft.title}
                onChange={(title) => edit((current) => ({ ...current, title }))}
              >
                <Label>
                  <Trans>Title</Trans>
                </Label>
                <Input placeholder={t`Optional`} />
              </TextField>
              <Select
                label={t`Project`}
                options={projects.map((candidate) => ({
                  id: candidate.id,
                  label: candidate.name,
                }))}
                value={draft.projectId ?? null}
                onChange={(projectId) => edit((current) => ({ ...current, projectId }))}
              />
            </div>

            <TextField
              isRequired
              value={draft.task}
              onChange={(task) => edit((current) => ({ ...current, task }))}
            >
              <Label>
                <Trans>Task</Trans>
              </Label>
              <TextArea
                rows={4}
                className="min-h-24 resize-y"
                placeholder={t`What should the table work on?`}
              />
            </TextField>

            <fieldset className="vc-rt-setup__section">
              <legend className="vc-rt-setup__legend">
                <Trans>Pattern</Trans>
              </legend>
              <RadioGroup
                aria-label={t`Pattern`}
                className="vc-rt-setup__patterns !grid gap-2 sm:grid-cols-2 [&_[data-slot=radio]]:!mt-0"
                value={draft.pattern}
                onChange={(value) => {
                  const pattern = ROUNDTABLE_PATTERNS.find((candidate) => candidate === value);
                  if (pattern) edit((current) => changePattern(current, pattern));
                }}
              >
                {ROUNDTABLE_PATTERNS.map((pattern: RoundtablePattern) => (
                  <div
                    key={pattern}
                    className="vc-rt-pattern"
                    data-selected={draft.pattern === pattern || undefined}
                  >
                    <Radio className="group w-full cursor-pointer" value={pattern}>
                      <Radio.Content className="block w-full cursor-pointer px-3 py-2">
                        <span className="block text-sm font-medium text-foreground">
                          {i18n._(PATTERN_LABELS[pattern])}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {i18n._(PATTERN_DESCRIPTIONS[pattern])}
                        </span>
                      </Radio.Content>
                    </Radio>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>

            <fieldset className="vc-rt-setup__section">
              <legend className="vc-rt-setup__legend">
                <Trans>
                  Participants ({seatCount}/{MAX_PARTICIPANTS})
                </Trans>
              </legend>
              {ready.length === 0 ? <NoAgentsNotice detecting={isDetectingAgents} /> : null}
              {draft.seats.length > 0 ? (
                <ol className="vc-rt-seats" aria-label={t`Participants`}>
                  {draft.seats.map((seat, index) => (
                    <SeatRow
                      key={seat.id}
                      seat={seat}
                      index={index}
                      ready={ready}
                      providers={providers}
                      onBrainChange={(brain) =>
                        edit((current) => updateSeat(current, seat.id, { brain }))
                      }
                      onRoleChange={(role) =>
                        edit((current) => updateSeat(current, seat.id, { role }))
                      }
                      onRemove={() => edit((current) => removeSeat(current, seat.id))}
                    />
                  ))}
                </ol>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  isDisabled={!canAddSeat(draft) || ready.length === 0}
                  onPress={addAgentSeat}
                >
                  <Plus aria-hidden="true" className="size-3.5" />
                  <Trans>Add participant</Trans>
                </Button>
                {xaiConfigured ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    isDisabled={!canAddSeat(draft)}
                    onPress={() => edit((current) => addSeat(current, xaiBrain()))}
                  >
                    <Sparkles aria-hidden="true" className="size-3.5" />
                    <Trans>Add Grok (xAI API)</Trans>
                  </Button>
                ) : null}
              </div>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="vc-rt-setup__section">
                {roundsApply(draft.pattern) ? (
                  <NumberField
                    minValue={1}
                    maxValue={MAX_ROUNDS_LIMIT}
                    step={1}
                    value={draft.maxRounds}
                    onChange={(value) => {
                      if (value === undefined || Number.isNaN(value)) return;
                      edit((current) => ({ ...current, maxRounds: Math.floor(value) }));
                    }}
                  >
                    <Label>
                      <Trans>Max rounds</Trans>
                    </Label>
                    <NumberField.Group>
                      <NumberField.DecrementButton />
                      <NumberField.Input />
                      <NumberField.IncrementButton />
                    </NumberField.Group>
                  </NumberField>
                ) : (
                  <>
                    <span className="vc-rt-setup__legend">
                      <Trans>Max rounds</Trans>
                    </span>
                    <p className="text-xs text-muted">
                      <Trans>Unlimited: the chat runs until you stop it.</Trans>
                    </p>
                  </>
                )}
              </div>
              <div className="vc-rt-setup__section">
                <span className="vc-rt-setup__legend">
                  <Trans>Checkout</Trans>
                </span>
                {ownWorktrees ? (
                  <p className="text-xs text-muted">
                    <Trans>Each participant builds on its own new worktree.</Trans>
                  </p>
                ) : (
                  <>
                    <ToggleButtonGroup
                      aria-label={t`Checkout`}
                      className="h-8 w-fit [&_button]:h-8 [&_button]:min-h-0 [&_button]:min-w-0 [&_button]:px-3"
                      selectionMode="single"
                      disallowEmptySelection
                      size="sm"
                      selectedKeys={[draft.worktreeMode]}
                      onSelectionChange={(keys) => {
                        const mode = [...keys][0] as WorktreeMode | undefined;
                        if (mode) edit((current) => ({ ...current, worktreeMode: mode }));
                      }}
                    >
                      <ToggleButton id="current">
                        <Trans>Current checkout</Trans>
                      </ToggleButton>
                      <ToggleButton id="new-branch">
                        <Trans>New branch</Trans>
                      </ToggleButton>
                    </ToggleButtonGroup>
                    <TextField
                      aria-label={t`Branch name`}
                      isDisabled={draft.worktreeMode !== "new-branch"}
                      value={draft.branchName}
                      onChange={(branchName) => edit((current) => ({ ...current, branchName }))}
                    >
                      <Input placeholder={t`Branch name (optional)`} />
                    </TextField>
                  </>
                )}
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer className="items-center">
            <p
              className="vc-rt-setup__status mr-auto min-w-0 flex-1 text-xs"
              data-tone={startError ? "error" : undefined}
              aria-live="polite"
            >
              {footerMessage}
            </p>
            <Button slot="close" variant="ghost" className="text-muted">
              <Trans>Cancel</Trans>
            </Button>
            <Button
              variant="tertiary"
              isDisabled={blocker !== null}
              isPending={starting}
              onPress={() => void start()}
            >
              <Trans>Start</Trans>
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
