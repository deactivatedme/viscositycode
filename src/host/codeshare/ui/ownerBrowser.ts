import type { InviteView, OwnerState } from "@/shared/codeShare";

// This function is sent verbatim to a standalone browser. Keep its runtime
// dependencies inside the function and use type-only imports.
export function ownerBrowser(): void {
  function byId<T extends HTMLElement = HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
  }

  const form = byId<HTMLFormElement>("create-invite");
  const modelList = byId("model-list");
  const pause = byId<HTMLButtonElement>("pause");
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
    const minutes = Math.max(0, Math.ceil((deadline - Date.now()) / 60_000));
    if (minutes < 60) return minutes + "m";
    return Math.floor(minutes / 60) + "h " + (minutes % 60) + "m";
  }

  function renderInvite(invite: InviteView): HTMLElement {
    const title = element("div", "", "invite-title");
    title.append(element("strong", invite.label), element("span", invite.status, "badge"));
    const clock = element("p", "", "meta");
    if (invite.status === "active" || invite.status === "pending" || invite.status === "paused") {
      clock.dataset.deadline = String(invite.expiresAt ?? invite.redeemBy);
      clock.dataset.prefix = invite.expiresAt ? "Access ends in " : "Redeem within ";
    }
    const usage = invite.turnsUsed + " / " + invite.turnLimit + " turns";
    const tokens = (invite.inputTokens + invite.outputTokens).toLocaleString();
    const card = element("article", "", "invite-row");
    card.append(
      title,
      clock,
      element("p", usage + " · " + tokens + " reported tokens", "meta"),
      element("p", invite.models.join(" · "), "meta"),
    );
    if (invite.status === "revoked" || invite.status === "expired") return card;

    const actions = element("form", "", "invite-actions");
    if (invite.expiresAt) {
      const minutes = element("input", "");
      minutes.type = "number";
      minutes.min = "1";
      minutes.max = "43200";
      minutes.value = "30";
      minutes.required = true;
      minutes.setAttribute("aria-label", "Minutes to add for " + invite.label);
      const extend = element("button", "Extend", "secondary");
      extend.type = "submit";
      actions.append(minutes, extend);
      actions.addEventListener("submit", (event) => {
        event.preventDefault();
        void mutate("/invites/" + invite.id + "/extend", { minutes: minutes.valueAsNumber });
      });
    }
    const revoke = element("button", "Revoke", "secondary danger");
    revoke.type = "button";
    revoke.addEventListener("click", () => {
      if (confirm("Revoke access for " + invite.label + "?")) {
        void mutate("/invites/" + invite.id + "/revoke", {});
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

  function render(state: OwnerState): void {
    current = state;
    byId("guest-address").textContent = state.guestOrigin;
    byId("host-status").textContent = state.paused ? "Paused" : "Accepting guests";
    pause.textContent = state.paused ? "Resume sharing" : "Pause all shares";
    const models = JSON.stringify(state.models);
    if (models !== inventory) {
      inventory = models;
      modelList.replaceChildren(
        ...state.models.map((model) => {
          const label = element("label", "");
          const checkbox = element("input", "");
          checkbox.type = "checkbox";
          checkbox.value = model.id;
          checkbox.name = "model";
          label.append(checkbox, element("span", model.provider + " / " + model.model));
          return label;
        }),
      );
    }
    const next = JSON.stringify(state.invites);
    if (roster !== next) {
      roster = next;
      invites.replaceChildren(
        ...(state.invites.length
          ? state.invites.map(renderInvite)
          : [element("p", "No invites yet.", "meta")]),
      );
    }
    updateClocks();
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

  async function mutate(path: string, data: object): Promise<void> {
    if (updating) return;
    updating = true;
    pause.disabled = true;
    try {
      await request(path, data);
      notice("");
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
