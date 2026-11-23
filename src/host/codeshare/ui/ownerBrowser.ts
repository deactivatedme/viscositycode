import type { InviteView, OwnerState, ShareModel } from "@/shared/codeShare";

// This function is sent verbatim to a standalone browser. Keep its runtime
// dependencies inside the function and use type-only imports.
export function ownerBrowser(): void {
  function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
  }

  const providerLabels: Record<string, string> = {
    codex: "OpenAI · ChatGPT subscription",
    claude: "Anthropic · Claude subscription",
    devin: "Devin",
    cursor: "Cursor",
    grok: "xAI · Grok",
    xai: "xAI · Grok",
    openai: "OpenAI API",
    anthropic: "Anthropic API",
  };
  const form = byId<HTMLFormElement>("create-invite");
  const modelList = byId("model-list");
  const pause = byId<HTMLButtonElement>("pause");
  const filter = byId<HTMLSelectElement>("invite-filter");
  const selectAll = byId<HTMLInputElement>("select-all-models");
  const status = byId("status");
  const invites = byId("invites");
  const link = byId<HTMLInputElement>("invite-link");
  const createButton = byId<HTMLButtonElement>("create-button");
  const tokenKey = "codeshare-owner";
  let ownerToken = new URLSearchParams(location.hash.slice(1)).get("owner") ?? "";
  if (ownerToken) history.replaceState(null, "", location.pathname);
  try {
    if (ownerToken) sessionStorage.setItem(tokenKey, ownerToken);
    else ownerToken = sessionStorage.getItem(tokenKey) ?? "";
  } catch {
    // The current tab still works if browser storage is unavailable.
  }
  let current: OwnerState | undefined;
  let serverOffset = 0;
  let inviteCode = "";
  let inventory = "";
  let roster = "";
  let updating = false;
  let statusIsError = false;

  function notice(text: string, error = false): void {
    status.textContent = text;
    status.hidden = !text;
    statusIsError = error;
  }

  async function request<T>(path: string, data?: object): Promise<T> {
    const response = await fetch("/api/v1/owner" + path, {
      cache: "no-store",
      headers: {
        Authorization: "Bearer " + ownerToken,
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      ...(data ? { method: "POST", body: JSON.stringify(data) } : {}),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        byId("dashboard").hidden = true;
        pause.hidden = true;
      }
      throw new Error(result.message || "The host could not complete the request.");
    }
    return result as T;
  }

  function element<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className = "") {
    const node = document.createElement(tag);
    node.textContent = text;
    node.className = className;
    return node;
  }

  function timeLeft(deadline: number): string {
    const seconds = Math.max(0, Math.ceil((deadline - Date.now() - serverOffset) / 1_000));
    if (seconds < 60) return seconds + "s";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + "m " + (seconds % 60) + "s";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "h " + (minutes % 60) + "m";
    return Math.floor(hours / 24) + "d " + (hours % 24) + "h";
  }

  function renderInvite(invite: InviteView): HTMLElement {
    const title = element("div", "", "invite-title");
    const statusBadge = element("span", invite.status, "badge");
    statusBadge.dataset.state = invite.status;
    title.append(element("strong", invite.label), statusBadge);
    const clock = element("p", "", "invite-clock");
    if (invite.status === "active" || invite.status === "pending" || invite.status === "paused") {
      clock.dataset.deadline = String(invite.expiresAt ?? invite.redeemBy);
      clock.dataset.prefix = invite.expiresAt ? "Access ends in " : "Redeem within ";
    }
    const usage =
      invite.turnLimit === 0
        ? invite.turnsUsed + " used · Unlimited turns"
        : invite.turnsUsed + " / " + invite.turnLimit + " turns";
    const tokens = (invite.inputTokens + invite.outputTokens).toLocaleString();
    const card = element("article", "", "invite-row");
    const models = element("div", "", "invite-models");
    for (const id of invite.models) {
      const label = current?.models.find((model) => model.id === id)?.label ?? id;
      const chip = element("span", label, "model-chip");
      chip.title = id;
      models.append(chip);
    }
    if (invite.status === "expired" || invite.status === "revoked") clock.hidden = true;
    card.append(
      title,
      clock,
      element("p", usage + " · " + tokens + " reported tokens", "meta"),
      models,
    );
    if (invite.status === "revoked" || invite.status === "expired") return card;

    const actions = element("form", "", "invite-actions");
    const minutes = element("input", "");
    minutes.type = "number";
    minutes.min = "1";
    minutes.max = "43200";
    minutes.value = "30";
    minutes.required = true;
    minutes.setAttribute("aria-label", "Minutes to add for " + invite.label);
    const extend = element(
      "button",
      invite.expiresAt ? "Extend access" : "Extend redemption",
      "secondary",
    );
    extend.type = "submit";
    actions.append(minutes, element("span", "min", "meta"), extend);
    actions.addEventListener("submit", (event) => {
      event.preventDefault();
      void mutate(
        "/invites/" + invite.id + "/extend",
        { minutes: minutes.valueAsNumber },
        invite.expiresAt ? "Access extended." : "Redemption window extended.",
      );
    });
    const revoke = element("button", "Revoke access", "secondary danger");
    revoke.type = "button";
    revoke.addEventListener("click", () => {
      if (confirm("Revoke access for " + invite.label + "?")) {
        void mutate("/invites/" + invite.id + "/revoke", {}, "Access revoked.");
      }
    });
    actions.append(revoke);
    card.append(actions);
    return card;
  }

  function updateClocks(): void {
    for (const node of invites.querySelectorAll<HTMLElement>("[data-deadline]")) {
      node.textContent = node.dataset.prefix + timeLeft(Number(node.dataset.deadline));
    }
  }

  function syncModelSelection(): void {
    const options = modelList.querySelectorAll<HTMLInputElement>('input[name="model"]');
    const selected = new FormData(form).getAll("model").length;
    selectAll.disabled = options.length === 0;
    selectAll.checked = options.length > 0 && selected === options.length;
    selectAll.indeterminate = selected > 0 && selected < options.length;
  }

  function renderRoster(state: OwnerState): void {
    byId("active-count").textContent = String(
      state.invites.filter(
        ({ status: inviteStatus, expiresAt }) =>
          inviteStatus === "active" || (inviteStatus === "paused" && expiresAt),
      ).length,
    );
    byId("pending-count").textContent = String(
      state.invites.filter(
        ({ status: inviteStatus, expiresAt }) =>
          inviteStatus === "pending" || (inviteStatus === "paused" && !expiresAt),
      ).length,
    );
    byId("total-count").textContent = String(state.invites.length);
    const next = JSON.stringify([filter.value, state.invites, state.models]);
    if (roster === next) return;
    roster = next;
    const visible = state.invites.filter((invite) => {
      if (filter.value === "all") return true;
      if (filter.value === "ended")
        return invite.status === "expired" || invite.status === "revoked";
      if (filter.value === "active")
        return (
          invite.expiresAt !== null && (invite.status === "active" || invite.status === "paused")
        );
      return (
        invite.expiresAt === null && (invite.status === "pending" || invite.status === "paused")
      );
    });
    invites.replaceChildren(
      ...(visible.length
        ? visible.map(renderInvite)
        : [
            element(
              "p",
              state.invites.length
                ? "No shares match this filter."
                : "No shares yet. Create an invite to get started.",
              "empty-state meta",
            ),
          ]),
    );
    updateClocks();
  }

  function render(state: OwnerState): void {
    current = state;
    serverOffset = state.serverNow - Date.now();
    byId("guest-address").textContent = state.guestOrigin;
    byId("host-status").textContent = state.paused ? "Paused" : "Accepting guests";
    pause.textContent = state.paused ? "Resume sharing" : "Pause all shares";
    const models = JSON.stringify(state.models);
    if (models !== inventory) {
      inventory = models;
      const previouslyShown = new Set(
        Array.from(
          modelList.querySelectorAll<HTMLInputElement>('input[name="model"]'),
          (input) => input.value,
        ),
      );
      const selected = new Set(new FormData(form).getAll("model"));
      const groups = new Map<string, ShareModel[]>([
        ["claude", []],
        ["codex", []],
        ["cursor", []],
        ["devin", []],
        ["xai", []],
      ]);
      for (const model of state.models) {
        const group = groups.get(model.provider);
        if (group) group.push(model);
        else groups.set(model.provider, [model]);
      }
      modelList.replaceChildren(
        ...Array.from(groups, ([provider, entries]) => {
          const group = element("fieldset", "", "model-provider");
          group.append(element("legend", providerLabels[provider] ?? provider));
          if (entries.length === 0) {
            const usesKey = provider === "cursor" || provider === "xai";
            group.append(
              element("p", usesKey ? "API key needed on the host" : "No models configured", "meta"),
            );
          }
          for (const model of entries) {
            const label = element("label", "");
            const checkbox = element("input", "");
            checkbox.type = "checkbox";
            checkbox.value = model.id;
            checkbox.name = "model";
            checkbox.checked = !previouslyShown.has(model.id) || selected.has(model.id);
            const name = element("span", model.label ?? model.model);
            name.title = model.model;
            label.append(checkbox, name);
            group.append(label);
          }
          return group;
        }),
      );
    }
    syncModelSelection();
    renderRoster(state);
    byId("dashboard").hidden = false;
    pause.hidden = false;
  }

  async function refresh(): Promise<void> {
    if (updating) return;
    try {
      render(await request<OwnerState>(""));
      if (status.dataset.offline) {
        delete status.dataset.offline;
        notice("");
      }
    } catch (error) {
      status.dataset.offline = "true";
      notice(error instanceof Error ? error.message : "Could not reach the host.", true);
    }
  }

  async function mutate(path: string, data: object, message = ""): Promise<void> {
    if (updating) return;
    updating = true;
    pause.disabled = true;
    try {
      await request(path, data);
      notice(message);
    } catch (error) {
      notice(error instanceof Error ? error.message : "Could not reach the host.", true);
    } finally {
      updating = false;
      pause.disabled = false;
      await refresh();
    }
  }

  async function copy(value: string, copied: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      notice(copied);
    } catch {
      link.select();
      notice("Copy the selected invite link manually.", true);
    }
  }

  filter.addEventListener("change", () => {
    if (current) renderRoster(current);
  });
  modelList.addEventListener("change", syncModelSelection);
  selectAll.addEventListener("change", () => {
    for (const checkbox of modelList.querySelectorAll<HTMLInputElement>('input[name="model"]')) {
      checkbox.checked = selectAll.checked;
    }
    syncModelSelection();
  });

  pause.addEventListener("click", () => {
    if (current) void mutate("/pause", { paused: !current.paused });
  });
  byId("copy-link").addEventListener("click", () => {
    void copy(link.value, "Invite link copied.");
  });
  byId("copy-code").addEventListener("click", () => {
    void copy(inviteCode, "Invite code copied.");
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (updating) return;
    const models = new FormData(form).getAll("model");
    if (!models.length) {
      notice("Select at least one model.", true);
      return;
    }
    updating = true;
    createButton.disabled = true;
    notice("");
    void request<{ code: string; url: string }>("/invites", {
      label: byId<HTMLInputElement>("label").value,
      durationMinutes: byId<HTMLInputElement>("duration").valueAsNumber,
      redeemWithinMinutes: byId<HTMLInputElement>("redeem-within").valueAsNumber,
      turnLimit: byId<HTMLInputElement>("turn-limit").valueAsNumber,
      models,
    })
      .then(({ code, url }) => {
        inviteCode = code;
        link.value = url;
        byId("created").hidden = false;
        byId<HTMLInputElement>("label").value = "";
      })
      .catch((error: unknown) => {
        notice(error instanceof Error ? error.message : "Could not create the invite.", true);
      })
      .finally(() => {
        updating = false;
        createButton.disabled = false;
        void refresh();
      });
  });

  void (async () => {
    await refresh();
    setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 4_000);
    setInterval(updateClocks, 1_000);
    status.addEventListener("click", () => {
      if (!statusIsError) notice("");
    });
  })();
}
