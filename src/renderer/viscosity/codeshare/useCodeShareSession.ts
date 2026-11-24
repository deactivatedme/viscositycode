import { useEffect, useRef, useState } from "react";
import {
  CODE_SHARE_PROJECT_PROTOCOL,
  type ReserveLocalLaunch,
  type SubmitTurn,
} from "@/shared/codeShare";
import { CODE_SHARE_PROJECT_AGENT } from "@/shared/codeShareProjectAccess";
import { readBridge } from "@/renderer/bridge";
import {
  CodeShareClientError,
  CodeShareConnection,
  parseShareInvite,
  type Snapshot,
} from "./client";

import { canRunCodeShareSubscription } from "./subscription";

function errorCode(error: unknown): string {
  return error instanceof CodeShareClientError ? error.code : "invalid_response";
}

function received(snapshot: Snapshot) {
  return {
    snapshot,
    deadline: performance.now() + Math.max(0, snapshot.expiresAt - snapshot.serverNow),
  };
}

export function useCodeShareSession(open: boolean) {
  const [connection, setConnection] = useState<CodeShareConnection | null>(null);
  const [data, setData] = useState<ReturnType<typeof received> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const operation = useRef(0);
  const joining = useRef<{ value: string; claim?: string } | null>(null);
  const requestInProgress = useRef(false);
  const pendingTurn = useRef<SubmitTurn | null>(null);
  const pendingLocalLaunch = useRef<ReserveLocalLaunch | null>(null);
  const refreshNow = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open || restored) return;
    let alive = true;
    void CodeShareConnection.restore().then((saved) => {
      if (alive) {
        setConnection(saved);
        setRestored(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [open, restored]);

  useEffect(() => {
    if (!open || !connection) return;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll(client: CodeShareConnection, signal: AbortSignal) {
      let delay = 4_000;
      try {
        const snapshot = await client.snapshot(signal);
        if (signal.aborted) return;
        setData(received(snapshot));
        setNow(performance.now());
        setOffline(false);
        if (snapshot.turns.some((turn) => turn.status === "running")) delay = 650;
        setWaitingFor((id) => (id && snapshot.turns.some((turn) => turn.id === id) ? null : id));
      } catch (error) {
        if (signal.aborted) return;
        if (errorCode(error) === "guest_session") {
          setProblem("guest_session");
          return;
        }
        setOffline(true);
      }
      timer = setTimeout(refresh, delay);
    }
    function refresh() {
      clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      void poll(connection!, controller.signal);
    }
    refreshNow.current = refresh;
    refresh();
    return () => {
      refreshNow.current = null;
      controller?.abort();
      clearTimeout(timer);
    };
  }, [connection, open]);

  useEffect(() => {
    if (!open || !connection) return;
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(timer);
  }, [connection, open]);

  async function join(value: string): Promise<boolean> {
    if (requestInProgress.current) return false;
    const revision = ++operation.current;
    requestInProgress.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const invite = parseShareInvite(value);
      const stable = invite.origin + "/" + invite.code;
      const attempt = joining.current?.value === stable ? joining.current : { value: stable };
      joining.current = attempt;
      const { client, state } = await CodeShareConnection.join(
        invite,
        attempt,
        canRunCodeShareSubscription(),
      );
      if (revision !== operation.current) return false;
      if (!state.room && state.projectProtocol === CODE_SHARE_PROJECT_PROTOCOL) {
        if (!canRunCodeShareSubscription()) throw new CodeShareClientError("desktop_required");
        await readBridge().configureCodeShareProjects({
          action: "connect",
          ...client.projectAccess(),
        });
        client.markProjectChats();
        void readBridge()
          .refreshAgentStatuses([], { agentKinds: [CODE_SHARE_PROJECT_AGENT] })
          .catch(() => undefined);
      }
      joining.current = null;
      setConnection(client);
      setData(received(state));
      setNow(performance.now());
      void client.save();
      return true;
    } catch (error) {
      if (revision === operation.current) setProblem(errorCode(error));
      return false;
    } finally {
      if (revision === operation.current) {
        requestInProgress.current = false;
        setBusy(false);
      }
    }
  }

  async function send(model: string, prompt: string): Promise<boolean> {
    if (!connection || requestInProgress.current || waitingFor) return false;
    const revision = operation.current;
    const previous = pendingTurn.current;
    const input =
      previous && previous.model === model && previous.prompt === prompt
        ? previous
        : { id: crypto.randomUUID(), model, prompt };
    pendingTurn.current = input;
    requestInProgress.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const running = await connection.submit(input);
      if (revision !== operation.current) return false;
      setWaitingFor(running ? input.id : null);
      pendingTurn.current = null;
      return true;
    } catch (error) {
      if (revision === operation.current) {
        const code = errorCode(error);
        if (code !== "offline" && code !== "invalid_response") pendingTurn.current = null;
        setProblem(code);
      }
      return false;
    } finally {
      if (revision === operation.current) {
        requestInProgress.current = false;
        setBusy(false);
        refreshNow.current?.();
      }
    }
  }

  async function launchSubscription(
    model: string,
    prepare: (threadId: string) => Promise<() => Promise<boolean>>,
  ): Promise<boolean> {
    if (!connection || requestInProgress.current || waitingFor) return false;
    const revision = operation.current;
    const input =
      pendingLocalLaunch.current?.model === model
        ? pendingLocalLaunch.current
        : { id: crypto.randomUUID(), model };
    pendingLocalLaunch.current = input;
    requestInProgress.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const launch = await prepare(input.id);
      if (revision !== operation.current) return false;
      await connection.reserveLocalLaunch(input);
      if (revision !== operation.current) return false;
      // Never retry a local launch after dispatch; it may already have opened
      // a thread even if its receipt was lost. Only Mac admission is retryable.
      pendingLocalLaunch.current = null;
      return await launch();
    } catch (error) {
      if (revision === operation.current) setProblem(errorCode(error));
      return false;
    } finally {
      if (revision === operation.current) {
        requestInProgress.current = false;
        setBusy(false);
        refreshNow.current?.();
      }
    }
  }

  async function stop(id: string) {
    if (!connection || requestInProgress.current) return;
    const revision = operation.current;
    requestInProgress.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await connection.stop(id);
    } catch (error) {
      if (revision === operation.current) setProblem(errorCode(error));
    } finally {
      if (revision === operation.current) {
        requestInProgress.current = false;
        setBusy(false);
        refreshNow.current?.();
      }
    }
  }

  async function leave() {
    if (connection?.projectChats) {
      setBusy(true);
      try {
        await readBridge().configureCodeShareProjects({
          action: "disconnect",
          ...connection.projectAccess(),
        });
        void readBridge()
          .refreshAgentStatuses([], { agentKinds: [CODE_SHARE_PROJECT_AGENT] })
          .catch(() => undefined);
      } catch {
        setProblem("invalid_response");
        setBusy(false);
        return;
      }
    }
    operation.current++;
    pendingLocalLaunch.current = null;
    pendingTurn.current = null;
    joining.current = null;
    requestInProgress.current = false;
    setBusy(false);
    setWaitingFor(null);
    setConnection(null);
    setData(null);
    setProblem(null);
    setOffline(false);
    void CodeShareConnection.clearSaved();
  }

  return {
    connection,
    connected: connection !== null,
    projectChats: connection?.projectChats ?? false,
    snapshot: data?.snapshot ?? null,
    seconds: data ? Math.max(0, Math.ceil((data.deadline - now) / 1000)) : 0,
    problem,
    offline,
    busy,
    restored,
    waiting: waitingFor !== null,
    join,
    send,
    launchSubscription,
    stop,
    leave,
  };
}
