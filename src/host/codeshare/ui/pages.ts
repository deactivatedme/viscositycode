function page(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${title} · CodeShare</title>
  <link rel="stylesheet" href="/style.css">
  <script src="/client.js" defer></script>
</head>
<body>${content}</body>
</html>`;
}

export const guestPage = page(
  "Guest chat",
  `
<main class="guest frame">
  <header class="topbar">
    <div class="brand"><span class="mark" aria-hidden="true">&lt;/&gt;</span> CodeShare</div>
    <div class="meter" id="meter" hidden>
      <span class="time-dot" aria-hidden="true"></span><span id="timer" aria-label="Time remaining"></span>
    </div>
  </header>
  <div class="notice" id="connection" role="status" hidden></div>
  <section class="join panel" id="join">
    <h1>Join CodeShare</h1>
    <form id="redeem" novalidate>
      <label for="code">Invite code</label>
      <input id="code" name="code" autocomplete="off" autocapitalize="off" spellcheck="false"
        maxlength="22" placeholder="Enter your code" required>
      <button type="submit">Join chat</button>
    </form>
    <p class="notice" id="join-error" role="status" hidden></p>
  </section>
  <section id="chat" class="chat" hidden>
    <header class="chat-bar">
      <h1>Coding chat</h1>
      <span id="remaining" class="meta"></span>
    </header>
    <div id="messages" class="messages"></div>
    <p class="notice" id="chat-error" role="status" hidden></p>
    <form id="composer" class="composer">
      <label class="sr-only" for="prompt">Message</label>
      <textarea id="prompt" rows="3" placeholder="Ask a coding question or paste a snippet…" spellcheck="false"></textarea>
      <div class="composer-actions">
        <label class="sr-only" for="model">Model</label>
        <select id="model"></select>
        <button type="button" class="secondary" id="stop" hidden>Stop</button>
        <button type="submit" id="send">Send</button>
      </div>
    </form>
    <button type="button" id="switch-invite" class="secondary switch-invite" hidden>Use another invite</button>
  </section>
</main>`,
);

export const ownerPage = page(
  "Owner dashboard",
  `
<main class="owner frame">
  <header class="topbar">
    <div class="brand"><span class="mark" aria-hidden="true">&lt;/&gt;</span> CodeShare</div>
    <button class="secondary" id="pause" hidden>Pause all shares</button>
  </header>
  <p class="notice" id="status" role="status" hidden></p>
  <div id="dashboard" hidden>
    <div class="section-intro">
      <div><h1>Guest access</h1><p class="meta" id="guest-address"></p></div>
      <span class="badge host-status" id="host-status"></span>
    </div>
    <div class="owner-grid">
      <section class="panel invite-form-panel">
        <h2>Create invite</h2>
        <form id="create-invite">
          <label for="label">Guest label</label>
          <input id="label" maxlength="80" placeholder="e.g. Alex" required>
          <div class="field-row">
            <div><label for="duration">Access (min)</label><input id="duration" type="number" min="1" max="43200" value="60" required></div>
            <div><label for="redeem-within">Redeem within (min)</label><input id="redeem-within" type="number" min="1" max="10080" value="1440" required></div>
            <div><label for="turn-limit">Turn limit</label><input id="turn-limit" type="number" min="0" max="500" value="25" aria-describedby="turn-limit-help" required><p id="turn-limit-help" class="meta turn-limit-help">0 means unlimited</p></div>
          </div>
          <fieldset class="model-picker">
            <legend>Allowed models</legend>
            <label class="select-models"><input type="checkbox" id="select-all-models"> Select all models</label>
            <div id="model-list" class="model-list"></div>
          </fieldset>
          <button type="submit" id="create-button">Create invite</button>
        </form>
        <div id="created" class="created" hidden>
          <label for="invite-link">Invite link</label>
          <input id="invite-link" readonly>
          <div class="copy-row">
            <button id="copy-link" class="secondary">Copy link</button>
            <button id="copy-code" class="secondary">Copy code</button>
          </div>
          <p class="meta">Save the link now. It’s shown once.</p>
        </div>
      </section>
      <section class="panel share-panel">
        <div class="share-header">
          <h2>Shares</h2>
          <label class="sr-only" for="invite-filter">Filter shares</label>
          <select id="invite-filter">
            <option value="all">All shares</option>
            <option value="active">Active</option>
            <option value="pending">Awaiting redemption</option>
            <option value="ended">Ended</option>
          </select>
        </div>
        <dl class="share-stats">
          <div><dt>In use</dt><dd id="active-count">0</dd></div>
          <div><dt>Awaiting redemption</dt><dd id="pending-count">0</dd></div>
          <div><dt>Total</dt><dd id="total-count">0</dd></div>
        </dl>
        <div id="invites" class="invite-list"></div>
      </section>
    </div>
  </div>
</main>`,
);

export const style = `
:root {
  color-scheme: dark; font: 15px/1.5 system-ui, sans-serif;
  color: #f0f1fa; background: #14151b;
  --muted: #b3b6c7; --line: #373a49; --panel: #1c1e28; --accent: #c2b4ff;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; }
button, input, textarea, select { font: inherit; color: inherit; }
button {
  min-height: 42px; padding: .5rem .95rem; border-radius: 8px; border: 1px solid transparent;
  color: #19142c; background: var(--accent); font-weight: 650; cursor: pointer;
}
button:hover { filter: brightness(1.1); }
button:disabled { opacity: .55; cursor: default; }
button.secondary { color: inherit; background: #292b38; border-color: var(--line); }
button.danger { color: #ffc2ca; }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
input, textarea, select {
  background: #151720; border: 1px solid var(--line); border-radius: 8px; width: 100%;
  padding: .55rem .65rem; min-height: 42px;
}
textarea { resize: vertical; display: block; }
label, legend { font-weight: 600; }
input[type="checkbox"] { min-height: auto; width: 1em; height: 1em; accent-color: var(--accent); }
.frame { max-width: 72rem; padding: 0 clamp(1rem, 4vw, 3rem) 3rem; margin: 0 auto; }
.guest { max-width: 56rem; }
.topbar {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  min-height: 76px; border-bottom: 1px solid var(--line); margin-bottom: 2rem;
}
.brand { display: flex; align-items: center; gap: .65rem; font-weight: 730; letter-spacing: -.01em; }
.mark {
  display: grid; place-items: center; width: 2.1rem; height: 2.1rem; border-radius: 8px;
  color: var(--accent); background: #2d2749; font: 700 .84rem ui-monospace, monospace;
}
.meter, .badge {
  display: inline-flex; align-items: center; gap: .55rem; padding: .35rem .65rem;
  border: 1px solid var(--line); border-radius: 7px; color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.time-dot { display: inline-block; width: .5rem; height: .5rem; border-radius: 50%; background: #a7dfb3; }
.meter.warning { color: #ffdd9e; }
.meter.warning .time-dot { background: #ffca6c; }
h1, h2, p { margin: 0; }
h1 { font-size: clamp(1.6rem, 4vw, 2.1rem); line-height: 1.15; letter-spacing: -.035em; }
h2 { font-size: 1.13rem; letter-spacing: -.015em; margin-bottom: 1rem; }
.panel {
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  padding: clamp(1rem, 3vw, 1.5rem); min-width: 0;
}
.join { max-width: 29rem; margin: clamp(2rem, 12vh, 7rem) auto 0; }
.join h1 { margin-bottom: 1.4rem; }
form { display: grid; gap: .55rem; }
form > button { justify-self: start; margin-top: .45rem; }
.notice { background: #2a2527; color: #ffe0aa; padding: .65rem .85rem; border: 1px solid #574438; border-radius: 8px; margin: .75rem 0; }
.meta { color: var(--muted); font-size: .88rem; overflow-wrap: anywhere; }
.section-intro { display: flex; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: 1.3rem; }
.section-intro p { margin-top: .35rem; }
.owner-grid { display: grid; grid-template-columns: minmax(0, .95fr) minmax(0, 1.05fr); gap: 1rem; align-items: start; }
.field-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .65rem; margin-top: .45rem; }
.field-row div { display: flex; flex-direction: column; gap: .3rem; }
.field-row label { flex: 1; font-size: .82rem; }
fieldset { border: 1px solid var(--line); border-radius: 8px; padding: .65rem .8rem; margin: .65rem 0 .2rem; min-width: 0; }
.model-list { display: grid; gap: .5rem; max-height: 18rem; overflow: auto; }
.model-provider { padding: .25rem .45rem .4rem; margin: 0; }
.model-provider legend { color: var(--muted); font-size: .85rem; }
.turn-limit-help { margin: .25rem 0 0; }
.model-list label { display: flex; align-items: baseline; gap: .55rem; overflow-wrap: anywhere; font-weight: 480; }
.created { border-top: 1px solid var(--line); margin-top: 1.2rem; padding-top: 1rem; display: grid; gap: .55rem; }
.copy-row { display: flex; flex-wrap: wrap; gap: .4rem; }
.invite-list { display: grid; gap: .6rem; }
.invite-row { border: 1px solid var(--line); border-radius: 8px; padding: .75rem; display: grid; gap: .35rem; }
.invite-title { display: flex; justify-content: space-between; gap: .5rem; align-items: center; overflow-wrap: anywhere; }
.invite-title .badge { text-transform: capitalize; font-size: .8rem; }
.invite-actions { display: flex; gap: .4rem; flex-wrap: wrap; padding-top: .35rem; }
.invite-actions input { width: 5.2rem; }
.owner { --accent: #a8ccff; --panel: #171e2a; --line: #2d3a4e; --muted: #aab9d0; }
.owner .topbar { border-color: var(--line); margin-bottom: clamp(1.5rem, 4vw, 3rem); }
.owner .mark { background: #233a5e; }
.owner h1 { font-size: clamp(1.85rem, 5vw, 2.75rem); }
.owner .host-status { border-color: #3b5974; background: #1a2c42; color: #c1dbff; }
.owner .owner-grid { grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 1.25rem; }
.owner .panel { border-radius: 14px; box-shadow: 0 10px 24px #080c1338; }
.owner input, .owner select { background: #101723; }
.owner button.secondary { background: #202c3d; }
.owner .field-row { align-items: start; }
.owner .field-row label { min-height: 3em; display: flex; align-items: end; }
.owner #create-button { justify-self: stretch; color: #101a29; margin-top: .6rem; }
.model-picker { padding: .65rem; }
.select-models { display: flex; align-items: center; gap: .55rem; padding: .2rem .25rem .55rem; font-size: .88rem; }
.owner .model-list { max-height: 28rem; gap: .45rem; }
.owner .model-provider { background: #111924; padding: .25rem .55rem .4rem; }
.owner .model-provider legend { color: #c9d8ef; }
.owner .model-list label { align-items: center; min-height: 1.95rem; }
.share-header { display: flex; align-items: center; justify-content: space-between; gap: .65rem; }
.share-header h2 { margin-bottom: 0; }
.share-header select { width: auto; max-width: 65%; }
.share-stats { display: grid; gap: .5rem; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 1rem 0; }
.share-stats > div { background: #111924; border: 1px solid var(--line); border-radius: 8px; display: grid; align-content: space-between; padding: .5rem .65rem; }
.share-stats dt { color: var(--muted); font-size: .8rem; }
.share-stats dd { margin: 0; font-size: 1.35rem; font-weight: 650; font-variant-numeric: tabular-nums; }
.owner .invite-row { border-radius: 10px; padding: .85rem; }
.invite-title strong { font-size: 1.02rem; }
.invite-title [data-state="active"] { color: #a9e2c3; border-color: #315743; background: #173124; }
.invite-title [data-state="pending"], .invite-title [data-state="paused"] { color: #f4d399; border-color: #5a4929; background: #302715; }
.invite-title [data-state="revoked"] { color: #ffb9c2; border-color: #674251; }
.invite-clock { color: #c1dbff; font-variant-numeric: tabular-nums; font-weight: 560; font-size: .9rem; }
.invite-models { display: flex; flex-wrap: wrap; gap: .35rem; padding: .25rem 0; }
.model-chip { padding: .2rem .45rem; border-radius: .35rem; background: #223149; color: #d7e7ff; font-size: .8rem; overflow-wrap: anywhere; }
.owner .invite-actions { align-items: center; gap: .35rem; }
.owner .invite-actions button { margin: 0; font-size: .82rem; padding-inline: .65rem; }
.owner .invite-actions .danger { margin-left: auto; }
.owner .invite-actions input { width: 4.15rem; }
.empty-state { padding: 1rem; border: 1px dashed var(--line); border-radius: 10px; }
.chat-bar { display: flex; align-items: baseline; gap: .65rem; justify-content: space-between; margin-bottom: 1rem; }
.messages { display: grid; gap: .65rem; min-height: 8rem; margin-bottom: 1rem; }
.turn { display: grid; gap: .45rem; }
.bubble { position: relative; padding: .8rem .9rem; border-radius: 9px; border: 1px solid var(--line); background: var(--panel); overflow-wrap: anywhere; }
.bubble.user { margin-left: clamp(1rem, 10vw, 5rem); background: #28243b; }
.bubble-head { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
.bubble pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: .55rem 0 0; font: .88rem/1.6 ui-monospace, monospace; }
.bubble button { min-height: 34px; padding: .25rem .55rem; font-size: .8rem; }
.composer { background: var(--panel); padding: .7rem; border: 1px solid var(--line); border-radius: 10px; }
.composer-actions { display: flex; gap: .5rem; align-items: center; justify-content: flex-end; }
.composer-actions select { width: auto; max-width: 65%; margin-right: auto; }
.switch-invite { margin-top: .75rem; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 700px) {
  .owner .owner-grid { grid-template-columns: 1fr; }
  .owner .model-list { max-height: none; }
  .topbar { min-height: 62px; margin-bottom: 1.2rem; }
  input, select, textarea { font-size: 16px; }
}
`;
