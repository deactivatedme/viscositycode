import type { roomBrowser } from "./roomBrowser";
import type { ChatTurn, GuestState } from "@/shared/codeShare";

// This function is sent verbatim to a standalone browser. Keep its runtime
// dependencies inside the function and use type-only imports.
export function guestBrowser(createRoom: typeof roomBrowser): void {
  function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
  }

  const code = byId<HTMLInputElement>("code");
  const join = byId("join");
  const chat = byId("chat");
  const send = byId<HTMLButtonElement>("send");
  const stop = byId<HTMLButtonElement>("stop");
  const prompt = byId<HTMLTextAreaElement>("prompt");
  const models = byId<HTMLSelectElement>("model");
  const messages = byId("messages");
  const timer = byId("timer");
  const meter = byId("meter");
  const switchInvite = byId("switch-invite");
  const issueText: Record<string, string> = {
    paused: "The host paused CodeShare.",
    revoked: "The host revoked this invite.",
    expired: "This invite has expired.",
    stopped: "Response stopped.",
    restarted: "The host restarted during this response.",
    provider_unavailable: "The provider disconnected or timed out. You can send the message again.",
    provider_access: "The provider refused the host’s credentials. Ask the host to check access.",
    provider_limited:
      "The provider is rate-limited or out of credits. Try later or select another model.",
    model_mismatch: "The provider reported a different model. CodeShare stopped the reply.",
    model_unavailable:
      "The provider could not find this model. Select another model or ask the host.",
    request_rejected:
      "This model rejected the request. Try a shorter message or a different model.",
    response_limit: "This response reached the host’s output limit.",
  };
  let state: GuestState | undefined;
  let expiresAt = 0;
  let turnId: string | undefined;
  let modelInventory = "";
  let sending = false;
  let joining = false;
  let switching = false;
  let timerHandle: ReturnType<typeof setTimeout> | undefined;
  let refreshVersion = 0;
  let pending: { id: string; model: string; prompt: string; runner?: string } | undefined;
  let transcript = "";

  const room = createRoom(request);

  function notice(id: string, text: string): void {
    const target = byId(id);
    target.textContent = text;
    target.hidden = !text;
  }

  async function request<T>(path: string, data?: object): Promise<T> {
    const response = await fetch("/api/v1/" + path, {
      cache: "no-store",
      ...(data
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(path.startsWith("room/") ? { ...data, protocolVersion: 2 } : data),
          }
        : {}),
    });
    const result = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(result.message || "Could not complete this request."), {
        status: response.status,
      });
    return result as T;
  }

  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className = "") {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = className;
    return element;
  }

  function bubble(label: string, text: string, user: boolean): HTMLElement {
    const message = node("div", "", user ? "bubble user" : "bubble");
    const head = node("div", "", "bubble-head");
    head.append(node("strong", label, "meta"));
    if (text && !user) {
      const copy = node("button", "Copy", "secondary");
      copy.type = "button";
      copy.addEventListener("click", () => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            copy.textContent = "Copied";
          })
          .catch(() => {
            notice("chat-error", "Select the reply to copy it manually.");
          });
      });
      head.append(copy);
    }
    message.append(head, node("pre", text));
    return message;
  }

  function turnView(turn: ChatTurn): HTMLElement {
    const article = node("article", "", "turn");
    article.append(bubble("You", turn.prompt, true));
    const text = turn.reply || (turn.status === "running" ? "Waiting for a response…" : "");
    const assistant = bubble(turn.model, text, false);
    if (turn.issue) {
      assistant.append(
        node("p", issueText[turn.issue] ?? "The response ended unexpectedly.", "meta"),
      );
      const retry = node("button", "Reuse message", "secondary");
      retry.type = "button";
      retry.addEventListener("click", () => {
        prompt.value = turn.prompt;
        if ([...models.options].some((option) => option.value === turn.model))
          models.value = turn.model;
        prompt.focus();
      });
      assistant.append(retry);
    }
    article.append(assistant);
    return article;
  }

  function updateControls(): void {
    const active = state?.status === "active" && performance.now() < expiresAt;
    send.disabled =
      !active ||
      !models.value ||
      sending ||
      (!state?.room && Boolean(turnId)) ||
      (Boolean(state?.room) && !room.canSend()) ||
      (state?.turnsRemaining === 0 && !state.unlimitedTurns);
    prompt.disabled = !active || sending;
    models.disabled = !active || sending || (!state?.room && Boolean(turnId));
    stop.hidden = !(state?.room ? room.stopId() : turnId) || !active;
  }

  function tick(): void {
    if (!state) return;
    const seconds = Math.max(0, Math.ceil((expiresAt - performance.now()) / 1000));
    const hours = Math.floor(seconds / 3600);
    const remainingMinutes = Math.floor(seconds / 60) % 60;
    const remainingSeconds = seconds % 60;
    timer.textContent =
      state.status === "revoked"
        ? "Revoked"
        : state.status === "expired" || !seconds
          ? "Expired"
          : (hours ? hours + ":" : "") +
            String(remainingMinutes).padStart(2, "0") +
            ":" +
            String(remainingSeconds).padStart(2, "0") +
            " left";
    meter.classList.toggle("warning", seconds <= 300);
    updateControls();
  }

  function render(next: GuestState): void {
    state = next;
    expiresAt = performance.now() + Math.max(0, next.expiresAt - next.serverNow);
    if (switching) return;
    room.render(next);
    const running = next.turns.find((turn) => turn.status === "running");
    turnId = running?.id;
    if (pending && next.turns.some((turn) => turn.id === pending?.id)) {
      if (prompt.value.trim() === pending.prompt) prompt.value = "";
      pending = undefined;
    }
    const previousModel = models.value;
    const inventory = JSON.stringify(next.models);
    if (inventory !== modelInventory) {
      modelInventory = inventory;
      models.replaceChildren(
        ...next.models.map((model) => new Option(model.label ?? model.model, model.id)),
      );
      if (next.models.some((model) => model.id === previousModel)) models.value = previousModel;
    }
    const remaining = next.turnsRemaining;
    byId("remaining").textContent = next.unlimitedTurns
      ? "Unlimited turns"
      : remaining + (remaining === 1 ? " turn left" : " turns left");
    switchInvite.hidden = next.status === "active" || next.status === "paused";
    const revision = JSON.stringify(next.turns);
    if (!next.room && transcript !== revision) {
      const follow =
        Boolean(running) &&
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 130;
      transcript = revision;
      messages.replaceChildren(
        ...(next.turns.length
          ? next.turns.map(turnView)
          : [node("p", next.status === "active" ? "No messages yet." : "", "meta")]),
      );
      if (follow) window.scrollTo(0, document.documentElement.scrollHeight);
    }
    const banner =
      next.status === "paused" || next.status === "expired" || next.status === "revoked"
        ? issueText[next.status]
        : next.models.length === 0
          ? "The host has no available models for this invite."
          : "";
    notice("connection", banner ?? "");
    join.hidden = true;
    chat.hidden = false;
    meter.hidden = false;
    tick();
  }

  function schedule(delay: number): void {
    clearTimeout(timerHandle);
    timerHandle = setTimeout(() => {
      void refresh();
    }, delay);
  }

  async function refresh(): Promise<void> {
    if (switching || sending || joining) return;
    const version = ++refreshVersion;
    try {
      const next = await request<GuestState>("session");
      if (version !== refreshVersion) return;
      render(next);
      await room.refresh(next, () => version === refreshVersion && !switching);
      if (version !== refreshVersion) return;
      tick();
      schedule(next.room || turnId ? 750 : 4_000);
    } catch (error) {
      if (version !== refreshVersion) return;
      const status = (error as { status?: number })?.status;
      if (status === 401) {
        state = undefined;
        chat.hidden = true;
        join.hidden = false;
        meter.hidden = true;
        notice("connection", "");
        return;
      }
      notice("connection", "Couldn’t reach CodeShare. Reconnecting…");
      schedule(3_000);
    }
  }

  function captureInvite(): void {
    const invite = new URLSearchParams(location.hash.slice(1)).get("invite");
    if (!invite) return;
    history.replaceState(null, "", location.pathname);
    if (
      state?.status === "active" &&
      !confirm("Switching invites ends access to this chat in this browser. Continue?")
    )
      return;
    switching = true;
    chat.hidden = true;
    meter.hidden = true;
    join.hidden = false;
    code.value = invite;
    code.focus();
  }

  byId<HTMLFormElement>("redeem").addEventListener("submit", (event) => {
    event.preventDefault();
    if (joining) return;
    if (!/^[A-Za-z0-9_-]{22}$/u.test(code.value.trim())) {
      notice("join-error", "Enter a valid invite code.");
      return;
    }
    joining = true;
    refreshVersion++;
    const button = byId<HTMLFormElement>("redeem").querySelector("button")!;
    button.disabled = true;
    notice("join-error", "");
    void request<GuestState>("redeem?rooms=2", { code: code.value.trim() })
      .then((next) => {
        switching = false;
        pending = undefined;
        prompt.value = "";
        code.value = "";
        notice("chat-error", "");
        render(next);
        schedule(next.room ? 100 : 4_000);
        prompt.focus();
      })
      .catch((error: unknown) => {
        notice(
          "join-error",
          error instanceof Error ? error.message : "Could not redeem the invite.",
        );
      })
      .finally(() => {
        button.disabled = false;
        joining = false;
      });
  });

  byId<HTMLFormElement>("composer").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = prompt.value.trim();
    if (!text || send.disabled) return;
    if (text.length > 16_000) {
      notice("chat-error", "Keep your message under 16,000 characters.");
      return;
    }
    sending = true;
    refreshVersion++;
    updateControls();
    notice("chat-error", "");
    const model = models.value;
    const runner = state?.room ? room.runner() : undefined;
    const input =
      pending?.prompt === text && pending.model === model && pending.runner === runner
        ? pending
        : { id: crypto.randomUUID(), model, prompt: text, ...(runner ? { runner } : {}) };
    pending = input;
    void request(state?.room ? "room/turns" : "turns", input)
      .then(() => {
        prompt.value = "";
        pending = undefined;
        turnId = input.id;
      })
      .catch((error: unknown) => {
        if ((error as { status?: number })?.status) pending = undefined;
        notice(
          "chat-error",
          error instanceof Error ? error.message : "Could not send your message.",
        );
      })
      .finally(() => {
        sending = false;
        updateControls();
        void refresh();
      });
  });

  models.addEventListener("change", updateControls);
  byId("runner").addEventListener("change", updateControls);

  stop.addEventListener("click", () => {
    const id = state?.room ? room.stopId() : turnId;
    if (!id) return;
    stop.disabled = true;
    void request(state?.room ? "room/stop" : "stop", { id })
      .catch(() => {
        notice("chat-error", "Could not reach the host to stop this reply.");
      })
      .finally(() => {
        stop.disabled = false;
        void refresh();
      });
  });
  switchInvite.addEventListener("click", () => {
    switching = true;
    join.hidden = false;
    chat.hidden = true;
    meter.hidden = true;
    code.focus();
  });
  window.addEventListener("online", () => {
    void refresh();
  });
  window.addEventListener("hashchange", captureInvite);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
  setInterval(tick, 250);
  captureInvite();
  void refresh();
}
