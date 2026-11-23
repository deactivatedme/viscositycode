import { useId, useRef, useState, type FormEvent } from "react";
import { Label, Modal } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { Paperclip } from "lucide-react";
import { MAX_PROMPT_CHARS } from "@/shared/codeShare";
import { Button, Input, Select, TextArea } from "@/renderer/components/common";
import { useCodeSharePanel } from "./codeShareCommand";
import { useCodeShareSession } from "./useCodeShareSession";
import { CodeShareClientError } from "./client";
import {
  openCodeShareSubscriptionSignIn,
  prepareCodeShareSubscriptionLaunch,
} from "./subscription";

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return [hours || null, String(minutes).padStart(2, "0"), String(seconds % 60).padStart(2, "0")]
    .filter((part) => part !== null)
    .join(":");
}

type LocalAttachment = { name: string; text: string };

export function CodeShareDialog() {
  const open = useCodeSharePanel((state) => state.open);
  const session = useCodeShareSession(open);
  const { t } = useLingui();
  const inviteId = useId();
  const promptId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const fileRead = useRef(0);
  const [invite, setInvite] = useState("");
  const [draft, setDraft] = useState("");
  const [modelId, setModelId] = useState("");
  const [attachment, setAttachment] = useState<LocalAttachment | null>(null);
  const [fileError, setFileError] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [loginProblem, setLoginProblem] = useState<string | null>(null);
  const snapshot = session.snapshot;
  const model = snapshot?.models.find((row) => row.id === modelId) ?? snapshot?.models[0];
  const subscription = model?.execution === "guest-subscription";
  const running = snapshot?.turns.find((turn) => turn.status === "running");
  const ended =
    snapshot?.status === "revoked" ||
    snapshot?.status === "expired" ||
    (snapshot && !session.seconds && snapshot.status === "active");
  const active =
    snapshot?.status === "active" &&
    session.seconds > 0 &&
    !session.offline &&
    session.problem !== "guest_session";
  const prompt = draft.trim() + (attachment ? `\n\n[${attachment.name}]\n${attachment.text}` : "");
  const tooLong = prompt.length > MAX_PROMPT_CHARS;
  const time = formatTime(session.seconds);
  const turns = snapshot?.turnsRemaining ?? 0;
  const outOfTurns = turns === 0 && !snapshot?.unlimitedTurns;

  function statusMessage(code: string) {
    switch (code) {
      case "invalid_link":
        return t({ id: "codeShare.invalidLink", message: "Paste the full CodeShare invite link." });
      case "guest_rate_limited":
        return t({
          id: "codeShare.inviteRateLimited",
          message: "Too many invite requests. Wait a minute and try again.",
        });
      case "invalid_code":
        return t({
          id: "codeShare.invalidCode",
          message: "This invite is invalid, expired, or already used.",
        });
      case "paused":
        return t({ id: "codeShare.paused", message: "The host paused CodeShare." });
      case "guest_session":
      case "revoked":
      case "expired":
      case "inactive":
        return t({ id: "codeShare.ended", message: "Shared access has ended." });
      case "offline":
        return t({
          id: "codeShare.offline",
          message: "The CodeShare host is unreachable. Try again shortly.",
        });
      case "desktop_required":
        return t({
          id: "codeShare.desktopRequired",
          message: "Open this subscription invite in the ViscosityCode desktop app.",
        });
      case "local_project_required":
        return t({
          id: "codeShare.localProjectRequired",
          message: "Open a local project to use your subscription.",
        });
      case "subscription_sign_in":
        return t({
          id: "codeShare.subscriptionRequired",
          message: "Sign in to your subscription on this device, then try again.",
        });
      case "model_unavailable":
        return t({
          id: "codeShare.modelUnavailable",
          message: "The selected model is unavailable.",
        });
      case "model_mismatch":
        return t({
          id: "codeShare.modelMismatch",
          message: "The provider reported a different model. CodeShare stopped the reply.",
        });
      case "provider_limited":
        return t({
          id: "codeShare.providerLimited",
          message: "The provider is rate-limited or out of credits.",
        });
      case "stopped":
        return t({ id: "codeShare.stopped", message: "Response stopped." });
      default:
        return t({
          id: "codeShare.requestFailed",
          message: "CodeShare couldn't complete the request. Try again.",
        });
    }
  }

  async function attach(file: File) {
    const generation = ++fileRead.current;
    setFileError(false);
    setReadingFile(true);
    try {
      if (file.size > MAX_PROMPT_CHARS * 4) throw new Error("file size");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (text.includes("\0") || text.length > MAX_PROMPT_CHARS) throw new Error("file contents");
      if (generation === fileRead.current) {
        setAttachment({ name: file.name.replace(/[\r\n]/gu, " "), text });
      }
    } catch {
      if (generation === fileRead.current) setFileError(true);
    } finally {
      if (generation === fileRead.current) setReadingFile(false);
    }
  }

  function leave() {
    fileRead.current++;
    setLoginProblem(null);
    setReadingFile(false);
    setFileError(false);
    setDraft("");
    setAttachment(null);
    setModelId("");
    session.leave();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !active ||
      !model ||
      tooLong ||
      !prompt.trim() ||
      running ||
      session.busy ||
      session.waiting ||
      readingFile ||
      outOfTurns
    )
      return;
    const text = prompt.trim();
    setLoginProblem(null);
    const dispatch = subscription
      ? session.launchSubscription(model.id, (threadId) =>
          prepareCodeShareSubscriptionLaunch(model.provider, model.model, text, threadId),
        )
      : session.send(model.id, text);
    void dispatch.then((accepted) => {
      if (accepted) {
        setDraft("");
        setAttachment(null);
        if (subscription) useCodeSharePanel.setState({ open: false });
      }
    });
  }

  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(next) => useCodeSharePanel.setState({ open: next })}
    >
      <Modal.Container>
        <Modal.Dialog
          className={
            session.connected ? "max-h-[90dvh] min-h-0 sm:max-w-[680px]" : "sm:max-w-[460px]"
          }
        >
          <Modal.CloseTrigger />
          <Modal.Header className="pr-12">
            <Modal.Heading>{t({ id: "codeShare.join", message: "Join CodeShare" })}</Modal.Heading>
            <div>
              {snapshot ? (
                <div className="flex flex-wrap gap-x-3 text-xs text-muted">
                  {!ended ? (
                    <span>{t({ id: "codeShare.timeLeft", message: `${time} left` })}</span>
                  ) : null}
                  <span>
                    {snapshot.unlimitedTurns
                      ? t`Unlimited`
                      : t({ id: "codeShare.turnsLeft", message: `${turns} turns left` })}
                  </span>
                </div>
              ) : null}
            </div>
          </Modal.Header>
          {session.connected ? (
            <>
              <Modal.Body className="min-h-0 gap-3 overflow-y-auto p-4">
                {!ended &&
                  snapshot?.turns.map((turn) => (
                    <article key={turn.id} className="flex min-w-0 flex-col gap-2">
                      <pre className="ml-5 whitespace-pre-wrap break-words rounded-md bg-default p-3 font-mono text-xs">
                        {turn.prompt}
                      </pre>
                      <div className="min-w-0 rounded-md border border-border p-3">
                        <div className="mb-1 break-words text-xs text-muted">{turn.model}</div>
                        <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                          {turn.reply ||
                            (turn.status === "running"
                              ? t({ id: "codeShare.waiting", message: "Waiting for a response…" })
                              : "")}
                        </pre>
                        {turn.issue ? (
                          <p className="mt-1 text-xs text-muted">{statusMessage(turn.issue)}</p>
                        ) : null}
                      </div>
                    </article>
                  ))}
                {ended ||
                snapshot?.status === "paused" ||
                session.offline ||
                session.problem ||
                loginProblem ? (
                  <p role="status" className="text-sm text-warning">
                    {statusMessage(
                      ended
                        ? "expired"
                        : snapshot?.status === "paused"
                          ? "paused"
                          : session.offline
                            ? "offline"
                            : (loginProblem ?? session.problem ?? ""),
                    )}
                  </p>
                ) : null}
                {!snapshot && !session.problem && !session.offline ? (
                  <p role="status" className="text-sm text-muted">
                    {t({ id: "codeShare.connecting", message: "Connecting to CodeShare…" })}
                  </p>
                ) : null}
                {active && !model ? (
                  <p role="status" className="text-sm text-muted">
                    {t({
                      id: "codeShare.noModels",
                      message: "The host has no models available for this invite.",
                    })}
                  </p>
                ) : null}
              </Modal.Body>
              <Modal.Footer className="flex-col items-stretch gap-2 border-t border-border p-4">
                <form onSubmit={submit} className="grid gap-2">
                  {subscription ? (
                    <p className="text-xs text-muted">
                      {t({
                        id: "codeShare.subscriptionLocal",
                        message: "Starts a chat in your local project using your own subscription.",
                      })}
                    </p>
                  ) : null}
                  <Label htmlFor={promptId} className="sr-only">
                    {t({ id: "codeShare.message", message: "Message" })}
                  </Label>
                  <TextArea
                    id={promptId}
                    rows={3}
                    className="w-full"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    disabled={Boolean(ended) || session.busy}
                  />
                  <input
                    ref={fileInput}
                    type="file"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void attach(file);
                    }}
                  />
                  {attachment ? (
                    <div className="flex min-w-0 items-center gap-2 text-xs">
                      <span className="truncate">{attachment.name}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => {
                          fileRead.current++;
                          setReadingFile(false);
                          setAttachment(null);
                          setFileError(false);
                        }}
                      >
                        {t({ id: "codeShare.removeFile", message: "Remove file" })}
                      </Button>
                    </div>
                  ) : null}
                  {fileError || tooLong ? (
                    <p role="alert" className="text-xs text-danger">
                      {fileError
                        ? t({
                            id: "codeShare.invalidFile",
                            message: "Choose a small UTF-8 text file.",
                          })
                        : t({
                            id: "codeShare.messageTooLong",
                            message: "The message and attached file are too long together.",
                          })}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      aria-label={t({ id: "codeShare.model", message: "Shared model" })}
                      className="min-w-32 flex-1"
                      options={
                        snapshot?.models.map((row) => ({
                          id: row.id,
                          label: row.label ?? row.model,
                          detail: row.provider,
                        })) ?? []
                      }
                      value={model?.id ?? null}
                      onChange={setModelId}
                      isDisabled={!active || !!running || session.busy}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      aria-label={t({
                        id: "codeShare.attachFile",
                        message: "Attach a local text file",
                      })}
                      isDisabled={!active || session.busy || readingFile}
                      onPress={() => fileInput.current?.click()}
                    >
                      <Paperclip className="size-4" />
                    </Button>
                    {subscription && model ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        isDisabled={!active || session.busy}
                        onPress={() => {
                          try {
                            openCodeShareSubscriptionSignIn(model.provider);
                            setLoginProblem(null);
                            useCodeSharePanel.setState({ open: false });
                          } catch (error) {
                            setLoginProblem(
                              error instanceof CodeShareClientError
                                ? error.code
                                : "subscription_sign_in",
                            );
                          }
                        }}
                      >
                        {t`Sign in`}
                      </Button>
                    ) : null}
                    {running ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        isDisabled={session.busy || session.offline}
                        onPress={() => void session.stop(running.id)}
                      >
                        {t({ id: "codeShare.stop", message: "Stop" })}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        type="submit"
                        variant="tertiary"
                        isDisabled={
                          !active ||
                          !model ||
                          outOfTurns ||
                          !prompt.trim() ||
                          tooLong ||
                          session.busy ||
                          session.waiting ||
                          readingFile
                        }
                      >
                        {subscription
                          ? t({ id: "codeShare.openLocalChat", message: "Start local chat" })
                          : t({ id: "codeShare.send", message: "Send" })}
                      </Button>
                    )}
                  </div>
                </form>
                <Button size="sm" variant="ghost" className="self-start text-muted" onPress={leave}>
                  {t({ id: "codeShare.leave", message: "Leave share" })}
                </Button>
              </Modal.Footer>
            </>
          ) : (
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void session.join(invite).then((joined) => {
                  if (joined) setInvite("");
                });
              }}
            >
              <Modal.Body className="gap-2 p-4">
                <Label htmlFor={inviteId}>
                  {t({ id: "codeShare.inviteLink", message: "Invite link" })}
                </Label>
                <Input
                  id={inviteId}
                  value={invite}
                  onChange={(event) => setInvite(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={session.busy}
                />
                {session.problem ? (
                  <p role="alert" className="text-sm text-danger">
                    {statusMessage(session.problem)}
                  </p>
                ) : null}
              </Modal.Body>
              <Modal.Footer className="px-4 pb-4">
                <Button
                  type="submit"
                  variant="tertiary"
                  isDisabled={!invite.trim() || session.busy || !session.restored}
                >
                  {t({ id: "codeShare.joinButton", message: "Join" })}
                </Button>
              </Modal.Footer>
            </form>
          )}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
