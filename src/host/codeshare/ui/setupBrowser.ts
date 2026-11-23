import type { CodeShareSetupSnapshot, ShareConnection } from "@/shared/codeShareSetup";

// Shipped verbatim into the private owner page; no runtime imports.
export function setupBrowser(
  request: <T>(path: string, data?: object) => Promise<T>,
  changed: () => Promise<void>,
) {
  const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const subscriptions = byId("subscription-connections");
  const provider = byId<HTMLSelectElement>("key-provider");
  const key = byId<HTMLInputElement>("provider-key");
  const models = byId<HTMLTextAreaElement>("provider-models");
  const keyForm = byId<HTMLFormElement>("api-key-setup");
  const hostname = byId<HTMLInputElement>("share-hostname");
  const existing = byId<HTMLInputElement>("use-existing-tunnel");
  const status = byId("setup-status");
  let snapshot: CodeShareSetupSnapshot | undefined;
  let providerInventory = "";
  let connectionInventory = "";
  let working = false;
  let polling = false;
  let lastWaiting = new Set<string>();

  function element<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className = "") {
    const node = document.createElement(tag);
    node.textContent = text;
    node.className = className;
    return node;
  }
  function message(text: string) {
    status.textContent = text;
    status.hidden = !text;
  }
  async function action(path: string, data: object, success: string): Promise<void> {
    if (working) return;
    working = true;
    for (const button of document.querySelectorAll<HTMLButtonElement>(".setup-panel button"))
      button.disabled = true;
    message("Working…");
    try {
      const value = await request<CodeShareSetupSnapshot>(path, data);
      render(value);
      message(success);
      await changed();
    } catch (error) {
      message(error instanceof Error ? error.message : "Could not complete setup.");
    } finally {
      working = false;
      connectionInventory = "";
      await refresh();
    }
  }
  function connectionRow(connection: ShareConnection): HTMLElement {
    const row = element("div", "", "connection-row");
    const detail = element("div", "", "connection-detail");
    detail.append(
      element("strong", connection.label),
      element(
        "span",
        connection.state === "waiting"
          ? "Waiting for browser sign-in"
          : connection.connected
            ? "Connected"
            : "Not connected",
        "meta",
      ),
    );
    if (connection.message) detail.append(element("p", connection.message, "meta"));
    if (connection.url) {
      const link = element("a", "Continue sign-in", "setup-link");
      link.href = connection.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      detail.append(link);
    } else if (connection.state === "waiting")
      detail.append(
        element("p", "Complete the sign-in in the browser opened on this computer.", "meta"),
      );
    const button = element(
      "button",
      connection.state === "waiting" ? "Cancel" : "Connect",
      "secondary",
    );
    button.type = "button";
    button.disabled = working || (connection.connected && connection.state !== "waiting");
    button.addEventListener(
      "click",
      () =>
        void action(
          "/setup/login",
          { provider: connection.id, cancel: connection.state === "waiting" },
          connection.state === "waiting"
            ? "Sign-in cancelled."
            : "Complete sign-in in your browser.",
        ),
    );
    row.append(detail, button);
    return row;
  }
  byId<HTMLButtonElement>("import-account-key")?.addEventListener(
    "click",
    () =>
      void action(
        "/setup/keys",
        { action: "import", provider: provider.value },
        "Native account key connected. Credentials stay on the owner computer.",
      ),
  );
  function keySelection(): void {
    const selected = snapshot?.apiKeys.find(({ id }) => id === provider.value);
    const importButton = byId<HTMLButtonElement>("import-account-key");
    if (importButton) {
      importButton.hidden = !selected?.importAccount;
      importButton.disabled = working;
    }
    key.value = "";
    models.value = selected?.models.map((id) => id.slice(id.indexOf(":") + 1)).join(", ") ?? "";
    models.required = !selected?.discoverModels;
    byId("key-state").textContent = selected?.configured
      ? "A key is configured. Enter a new key to replace it."
      : "No key configured.";
    byId<HTMLButtonElement>("remove-key").disabled = working || !selected?.configured;
    byId("model-ids-help").textContent = selected?.discoverModels
      ? "Leave empty to discover every model available to this key, or enter an exact subset."
      : "Enter exact provider model IDs, separated by commas.";
  }
  function render(value: CodeShareSetupSnapshot): void {
    snapshot = value;
    for (const section of document.querySelectorAll<HTMLElement>(".setup-panel"))
      section.hidden = false;
    const inventory = JSON.stringify(value.subscriptions);
    if (inventory !== connectionInventory) {
      connectionInventory = inventory;
      subscriptions.replaceChildren(...value.subscriptions.map(connectionRow));
    }
    const providers = JSON.stringify(value.apiKeys.map(({ id, label }) => [id, label]));
    if (providers !== providerInventory) {
      providerInventory = providers;
      provider.replaceChildren(...value.apiKeys.map(({ id, label }) => new Option(label, id)));
      keySelection();
    }
    const selected = value.apiKeys.find(({ id }) => id === provider.value);
    byId("key-state").textContent = selected?.configured
      ? "A key is configured. Enter a new key to replace it."
      : "No key configured.";
    byId<HTMLButtonElement>("remove-key").disabled = working || !selected?.configured;
    byId<HTMLButtonElement>("save-provider-key").disabled = working;
    const importButton = byId<HTMLButtonElement>("import-account-key");
    if (importButton) {
      importButton.hidden = !selected?.importAccount;
      importButton.disabled = working;
    }
    const cloudflare = value.cloudflare;
    if (cloudflare.external) existing.checked = true;
    existing.disabled = working || Boolean(cloudflare.external) || Boolean(cloudflare.tunnelId);
    byId("cloudflare-state").textContent = cloudflare.publishing
      ? "Creating the guest tunnel…"
      : cloudflare.verified
        ? "Public link verified"
        : cloudflare.external
          ? "Existing Cloudflare tunnel · public link not verified"
          : cloudflare.running
            ? "Tunnel running · public link not verified"
            : cloudflare.connected
              ? "Cloudflare signed in"
              : "Cloudflare not connected";
    byId("cloudflare-problem").textContent = cloudflare.message ?? "";
    if (cloudflare.hostname && hostname.dataset.edited !== "true")
      hostname.value = cloudflare.hostname;
    if (cloudflare.hostname === hostname.value) delete hostname.dataset.edited;
    const login = byId<HTMLButtonElement>("connect-cloudflare");
    login.textContent = cloudflare.state === "waiting" ? "Cancel sign-in" : "Connect Cloudflare";
    login.disabled =
      working ||
      Boolean(cloudflare.external) ||
      (cloudflare.connected && cloudflare.state !== "waiting");
    const link = byId<HTMLAnchorElement>("cloudflare-login-link");
    link.hidden = !cloudflare.url;
    if (cloudflare.url) link.href = cloudflare.url;
    byId<HTMLButtonElement>("publish-cloudflare").disabled =
      working || cloudflare.publishing || (!cloudflare.connected && !existing.checked);
    byId<HTMLButtonElement>("publish-cloudflare").textContent = existing.checked
      ? "Use existing route"
      : "Publish guest link";
    byId<HTMLButtonElement>("check-cloudflare").disabled =
      working || (!cloudflare.running && !cloudflare.external);
    byId<HTMLButtonElement>("stop-cloudflare").disabled = working || !cloudflare.running;
    for (const id of ["subscription-connections", "cloudflare-state"])
      byId(id).setAttribute("aria-busy", String(working));
  }
  async function refresh(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const value = await request<CodeShareSetupSnapshot>("/setup");
      const completed = value.subscriptions.some(
        (connection) =>
          lastWaiting.has(connection.id) && connection.connected && connection.state !== "waiting",
      );
      lastWaiting = new Set(
        value.subscriptions.filter(({ state }) => state === "waiting").map(({ id }) => id),
      );
      render(value);
      if (completed) {
        await request("/models/refresh", {});
        await changed();
        message("Subscription connected. Available models refreshed.");
      }
    } catch (error) {
      message(error instanceof Error ? error.message : "Could not reach owner setup.");
    } finally {
      polling = false;
    }
  }
  existing.addEventListener("change", () => {
    byId<HTMLButtonElement>("publish-cloudflare").textContent = existing.checked
      ? "Use existing route"
      : "Publish guest link";
    if (snapshot) render(snapshot);
  });
  hostname.addEventListener("input", () => {
    hostname.dataset.edited = "true";
  });
  provider.addEventListener("change", keySelection);
  keyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (working || !key.value.trim()) return;
    const selected = provider.value;
    const ids = models.value
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => (id.startsWith(selected + ":") ? id : selected + ":" + id));
    const credential = key.value.trim();
    key.value = "";
    void action(
      "/setup/keys",
      { action: "save", provider: selected, key: credential, models: ids },
      "Connection saved on the host. Models refreshed.",
    );
  });
  byId("remove-key").addEventListener("click", () => {
    const label =
      snapshot?.apiKeys.find(({ id }) => id === provider.value)?.label ?? provider.value;
    if (confirm("Remove the saved key for " + label + "? Existing shares using it will stop."))
      void action(
        "/setup/keys",
        { action: "remove", provider: provider.value },
        "Key removed. Shared access through this key is disabled.",
      );
  });
  byId("connect-cloudflare").addEventListener(
    "click",
    () =>
      void action(
        snapshot?.cloudflare.state === "waiting"
          ? "/setup/cloudflare/login/cancel"
          : "/setup/cloudflare/login",
        {},
        snapshot?.cloudflare.state === "waiting"
          ? "Cloudflare sign-in cancelled."
          : "Complete Cloudflare sign-in in your browser.",
      ),
  );
  byId<HTMLFormElement>("cloudflare-setup").addEventListener("submit", (event) => {
    event.preventDefault();
    void action(
      existing.checked ? "/setup/cloudflare/existing" : "/setup/cloudflare/publish",
      { hostname: hostname.value.trim() },
      existing.checked
        ? "Existing route selected. Check the public link to verify this host."
        : "Guest tunnel started. Check the public link to verify routing.",
    );
  });
  byId("check-cloudflare").addEventListener(
    "click",
    () => void action("/setup/cloudflare/check", {}, "Public link check completed."),
  );
  byId("stop-cloudflare").addEventListener(
    "click",
    () => void action("/setup/cloudflare/stop", {}, "Guest tunnel stopped."),
  );
  void refresh();
  setInterval(() => {
    if (!document.hidden) void refresh();
  }, 2_000);
  return { refresh };
}
