import type { GuestState } from "@/shared/codeShare";
import type { ShareRoomSnapshot, ShareRoomTurn } from "@/shared/codeShareRoom";

// Serialized into the standalone guest page; all runtime dependencies stay here.
export function roomBrowser(request: <T>(path: string, data?: object) => Promise<T>) {
  const runners = document.getElementById("runner") as HTMLSelectElement;
  const model = document.getElementById("model") as HTMLSelectElement;
  const messages = document.getElementById("messages")!;
  let roomId = "";
  let snapshot: ShareRoomSnapshot | undefined;
  let turns: ShareRoomTurn[] = [];
  let rendered = "";
  let latest: GuestState | undefined;
  let generation = 0;

  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className = "") {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = className;
    return element;
  }

  function runnerOptions(): void {
    const selected = latest?.models.find((entry) => entry.id === model.value);
    const participants = (snapshot?.members ?? [])
      .filter((member) => member.ready && member.models.includes(selected?.id ?? ""))
      .map((member) => ({ id: member.id, label: member.label }));
    const options = !selected
      ? []
      : selected.execution === "guest-subscription"
        ? (snapshot?.members ?? [])
            .filter((member) => member.ready && member.models.includes(selected.id))
            .map((member) => ({ id: member.id, label: member.label }))
        : [
            ...(selected.remoteEditing ? participants : []),
            { id: "host", label: "Host computer · text only" },
          ];
    const previous = runners.value;
    runners.replaceChildren(...options.map((option) => new Option(option.label, option.id)));
    if (options.some((option) => option.id === previous)) runners.value = previous;
  }

  function render(state: GuestState): void {
    latest = state;
    const active = state.status === "active" || state.status === "paused";
    if (!state.room || !active || roomId !== state.room.id) {
      generation++;
      roomId = state.room?.id ?? "";
      snapshot = undefined;
      turns = [];
      rendered = "";
    }
    document.getElementById("room-controls")!.hidden = !state.room;
    document.getElementById("chat-title")!.textContent = state.room?.label ?? "Coding chat";
    if (!state.room) return;
    runnerOptions();
    const revision = JSON.stringify([turns, snapshot?.memberId, active]);
    if (revision === rendered) return;
    rendered = revision;
    messages.replaceChildren(
      ...(turns.length
        ? turns.map((turn) => {
            const article = node("article", "", "turn");
            const prompt = node(
              "div",
              "",
              turn.authorId === snapshot?.memberId ? "bubble user" : "bubble",
            );
            prompt.append(node("strong", turn.authorName, "meta"), node("pre", turn.prompt));
            const reply = node("div", "", "bubble");
            reply.append(
              node("strong", turn.runnerName + " · " + turn.model, "meta"),
              node(
                "pre",
                turn.reply ||
                  (turn.status === "queued"
                    ? "Queued · waiting for the selected computer"
                    : turn.status === "running"
                      ? "Working…"
                      : turn.status),
              ),
              node("p", turn.status, "meta"),
            );
            article.append(prompt, reply);
            return article;
          })
        : [node("p", active ? "No shared messages yet." : "", "meta")]),
    );
  }

  async function refresh(state: GuestState, isCurrent = () => true): Promise<void> {
    if (!state.room || (state.status !== "active" && state.status !== "paused")) return;
    const expected = state.room.id;
    const currentGeneration = generation;
    const next = await request<ShareRoomSnapshot>(
      "room?roomProtocol=2" + (snapshot ? "&revision=" + snapshot.revision : ""),
    );
    const cursors = new Set<string>();
    let cursor = next.nextMemberCursor;
    while (cursor) {
      if (cursors.has(cursor)) throw new Error("Invalid room roster cursor.");
      cursors.add(cursor);
      const page = await request<ShareRoomSnapshot>("room?roomProtocol=2&memberCursor=" + cursor);
      next.members.push(...page.members);
      cursor = page.nextMemberCursor;
    }
    if (roomId !== expected || generation !== currentGeneration || !isCurrent()) return;
    snapshot = next;
    if (next.turns) turns = next.turns;
    render(state);
  }

  model.addEventListener("change", runnerOptions);
  return {
    render,
    refresh,
    runner: () => runners.value,
    canSend: () => snapshot?.active === true && Boolean(runners.value),
    stopId: () =>
      turns.find(
        (turn) =>
          ["queued", "running", "stopping"].includes(turn.status) &&
          (turn.authorId === snapshot?.memberId || turn.runner === snapshot?.memberId),
      )?.id,
  };
}
