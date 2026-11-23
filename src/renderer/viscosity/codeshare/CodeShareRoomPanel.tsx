import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Label, Modal } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { MAX_PROMPT_CHARS, type ShareModel } from "@/shared/codeShare";
import type { ShareRoomRef, ShareRoomSnapshot, ShareRoomTurn } from "@/shared/codeShareRoom";
import { openThread } from "@/renderer/actions/threadActions";
import { Button, Select, TextArea } from "@/renderer/components/common";
import { CodeShareClientError, type CodeShareConnection } from "./client";
import { useCodeSharePanel } from "./codeShareCommand";
import {
  readCodeShareRoomThreadId,
  resumeCodeShareRoomTurn,
  runCodeShareRoomTurn,
} from "./roomWorker";
import { openCodeShareSubscriptionSignIn, readCodeShareLocalProject } from "./subscription";

interface Props {
  connection: CodeShareConnection;
  room: ShareRoomRef;
  models: readonly ShareModel[];
  inactive: boolean;
  outOfTurns: boolean;
  leave: () => void;
}

interface QueuedPrompt {
  id: string;
  model: string;
  runner: string;
  prompt: string;
}

export function CodeShareRoomPanel({
  connection,
  room,
  models,
  inactive,
  outOfTurns,
  leave,
}: Props) {
  const { t } = useLingui();
  const promptId = useId();
  const [snapshot, setSnapshot] = useState<ShareRoomSnapshot | null>(null);
  const [turns, setTurns] = useState<ShareRoomTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [modelId, setModelId] = useState("");
  const [runnerId, setRunnerId] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const [workerId, setWorkerId] = useState<string>();
  const [workerRequested, setWorkerRequested] = useState(false);
  const pendingPrompt = useRef<QueuedPrompt | undefined>(undefined);
  const workingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let revision: number | undefined;
    async function refresh() {
      if (controller.signal.aborted) return;
      try {
        const value = await connection.roomSnapshot(revision, controller.signal);
        if (controller.signal.aborted) return;
        revision = value.revision;
        setSnapshot(value);
        if (value.turns) setTurns(value.turns);
        setOnline(true);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof CodeShareClientError && error.code === "inactive") {
          revision = undefined;
          setTurns([]);
          setSnapshot(null);
        }
        setOnline(false);
      }
      setWorkerId(readCodeShareRoomThreadId(room.id));
      timer = setTimeout(() => void refresh(), 800);
    }
    resumeCodeShareRoomTurn(connection, room.id);
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
      void connection.setRoomReady(false).catch(() => {});
    };
  }, [connection, room.id]);

  const member = snapshot?.members.find((seat) => seat.id === snapshot.memberId);
  const model = models.find((item) => item.id === modelId) ?? models[0];
  const runners = !model
    ? []
    : model.execution === "guest-subscription"
      ? (snapshot?.members ?? [])
          .filter((seat) => seat.ready && seat.models.includes(model.id))
          .map((seat) => ({ id: seat.id, label: seat.label }))
      : [
          ...(model.remoteEditing
            ? (snapshot?.members ?? [])
                .filter((seat) => seat.ready && seat.models.includes(model.id))
                .map((seat) => ({ id: seat.id, label: seat.label }))
            : []),
          { id: "host", label: t({ id: "codeShare.room.hostComputer", message: "Host computer" }) },
        ];
  const runner = runners.find((option) => option.id === runnerId) ?? runners[0];
  const active = !inactive && online && snapshot?.active === true;
  const head = turns.find((turn) => ["queued", "running", "stopping"].includes(turn.status));
  const canRunHere = head?.status === "queued" && head.runner === member?.id && member?.ready;
  let localProject: ReturnType<typeof readCodeShareLocalProject> | undefined;
  try {
    if (canRunHere || !member?.ready) localProject = readCodeShareLocalProject();
  } catch {
    localProject = undefined;
  }

  async function change(action: () => Promise<unknown>) {
    if (workingRef.current) return;
    workingRef.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(error instanceof CodeShareClientError ? error.code : "room_error");
    } finally {
      setBusy(false);
      workingRef.current = false;
    }
  }

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!model || !runner || !prompt || prompt.length > MAX_PROMPT_CHARS || !active || outOfTurns)
      return;
    const previous = pendingPrompt.current;
    const input =
      previous?.prompt === prompt && previous.model === model.id && previous.runner === runner.id
        ? previous
        : { id: crypto.randomUUID(), model: model.id, runner: runner.id, prompt };
    pendingPrompt.current = input;
    void change(async () => {
      await connection.sendRoomTurn(input);
      pendingPrompt.current = undefined;
      setDraft("");
    });
  }

  async function acceptRun(turn: ShareRoomTurn, projectId: string) {
    setWorkerRequested(true);
    setProblem(null);
    try {
      await runCodeShareRoomTurn(connection, room, turn, projectId);
    } catch (error) {
      setProblem(error instanceof CodeShareClientError ? error.code : "room_error");
    } finally {
      setWorkerRequested(false);
    }
  }

  function turnStatus(status: ShareRoomTurn["status"]) {
    switch (status) {
      case "queued":
        return t`Queued`;
      case "running":
        return t`Running`;
      case "stopping":
        return t({ id: "codeShare.room.stopping", message: "Stopping" });
      case "complete":
        return t`Finished`;
      case "cancelled":
        return t`Cancelled`;
      case "failed":
        return t`Failed`;
    }
  }

  const runHere = t({ id: "codeShare.room.runHere", message: "Run here" });
  const readyLabel = t({
    id: "codeShare.room.allowRuns",
    message: "Allow requests on this computer",
  });
  const runnerLabel = t({ id: "codeShare.room.runOn", message: "Run on" });

  return (
    <>
      <Modal.Body className="min-h-0 gap-3 overflow-y-auto p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted">{t`Participants`}</span>
            {(snapshot?.members ?? []).map((seat) => (
              <span className="rounded-full border border-border px-2 py-1" key={seat.id}>
                {seat.label}
                {seat.ready ? " · " + t`Ready` : ""}
              </span>
            ))}
          </div>
          <Button
            size="sm"
            variant={member?.ready ? "secondary" : "tertiary"}
            isDisabled={!active || busy || (!member?.ready && !localProject)}
            onPress={() => void change(() => connection.setRoomReady(!member?.ready))}
          >
            {member?.ready
              ? t({ id: "codeShare.room.stopReceiving", message: "Stop receiving requests" })
              : readyLabel}
          </Button>
        </div>
        {!online ? (
          <p role="status" className="text-xs text-muted">
            {inactive
              ? t({ id: "codeShare.ended", message: "Shared access has ended." })
              : t`Offline`}
          </p>
        ) : null}
        {online && !snapshot?.active ? (
          <p role="status" className="text-xs text-muted">{t`Paused`}</p>
        ) : null}
        {turns.map((turn) => (
          <article className="grid gap-1 rounded-lg border border-border p-3" key={turn.id}>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
              <strong className="text-foreground">{turn.authorName}</strong>
              <span>
                {turn.runner === "host"
                  ? t({ id: "codeShare.room.hostComputer", message: "Host computer" })
                  : turn.runnerName}
              </span>
              <span>{models.find((entry) => entry.id === turn.model)?.label ?? turn.model}</span>
              <span>{turnStatus(turn.status)}</span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm">{turn.prompt}</p>
            {turn.reply ? (
              <pre className="whitespace-pre-wrap break-words rounded-md bg-default p-2 text-xs">
                {turn.reply}
              </pre>
            ) : null}
            {active && turn === head && canRunHere && localProject ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="tertiary"
                  isDisabled={busy || !!workerId || workerRequested}
                  onPress={() => void acceptRun(turn, localProject.id)}
                >
                  {runHere}
                </Button>
                <span className="text-xs text-muted">
                  {t`Project`} · {localProject.name}
                </span>
                {turn.execution === "owner" ? (
                  <span className="text-xs text-muted">
                    {t({
                      id: "codeShare.room.fileApproval",
                      message: "Owner-funded turn: share and edit files in this project.",
                    })}
                  </span>
                ) : null}
              </div>
            ) : null}
            {active &&
            (turn.authorId === member?.id || turn.runner === member?.id) &&
            (turn.status === "queued" || turn.status === "running") ? (
              <Button
                size="sm"
                variant="ghost"
                className="justify-self-start"
                isDisabled={busy}
                onPress={() => void change(() => connection.stopRoomTurn(turn.id))}
              >
                {t`Stop`}
              </Button>
            ) : null}
          </article>
        ))}
      </Modal.Body>
      <Modal.Footer className="grid gap-3 px-4 pb-4">
        {workerId ? (
          <Button
            size="sm"
            variant="secondary"
            onPress={() => {
              openThread(workerId);
              useCodeSharePanel.setState({ open: false });
            }}
          >{t`Open thread`}</Button>
        ) : null}
        {problem ? (
          <p role="alert" className="text-xs text-danger">
            {problem === "subscription_sign_in"
              ? t({
                  id: "codeShare.subscriptionRequired",
                  message: "Sign in to your subscription on this device, then try again.",
                })
              : t({
                  id: "codeShare.room.failed",
                  message: "The room could not apply that action. Try again.",
                })}
            {problem === "subscription_sign_in" && head ? (
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  openCodeShareSubscriptionSignIn(head.model.split(":", 1)[0] ?? "");
                  useCodeSharePanel.setState({ open: false });
                }}
              >{t`Sign in`}</Button>
            ) : null}
          </p>
        ) : null}
        <form className="grid gap-2" onSubmit={send}>
          <Label htmlFor={promptId} className="sr-only">
            {t({ id: "codeShare.message", message: "Message" })}
          </Label>
          <TextArea
            id={promptId}
            value={draft}
            rows={3}
            maxLength={MAX_PROMPT_CHARS}
            disabled={!active || busy}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label={t({ id: "codeShare.model", message: "Shared model" })}
              className="min-w-32 flex-1"
              options={models.map((row) => ({
                id: row.id,
                label: row.label ?? row.model,
                detail: row.provider,
              }))}
              value={model?.id ?? null}
              onChange={setModelId}
              isDisabled={!active || busy}
            />
            <Select
              aria-label={runnerLabel}
              className="min-w-28 flex-1"
              options={runners}
              value={runner?.id ?? null}
              onChange={setRunnerId}
              isDisabled={!active || busy || runners.length === 0}
            />
            <Button
              type="submit"
              size="sm"
              variant="tertiary"
              isDisabled={!active || busy || !runner || !draft.trim() || outOfTurns}
            >
              {t`Send`}
            </Button>
          </div>
        </form>
        <Button
          size="sm"
          variant="ghost"
          className="justify-self-start"
          onPress={leave}
          isDisabled={!!workerId || workerRequested}
        >
          {t({ id: "codeShare.anotherInvite", message: "Use another invite" })}
        </Button>
      </Modal.Footer>
    </>
  );
}
