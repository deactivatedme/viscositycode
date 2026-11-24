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
    <p class="meta">Use the owner’s shared AI access. No provider account or API key required.</p>
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
      <h1 id="chat-title">Coding chat</h1>
      <span id="remaining" class="meta"></span>
    </header>
    <div id="room-controls" hidden>
      <label for="runner">Run on</label><select id="runner"></select>
      <p class="meta">Host turns use the owner’s shared access. File work on a participant’s computer waits for their approval in the desktop app.</p>
    </div>
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
      <div><h1>Share your AI access</h1><p class="meta" id="guest-address"></p></div>
      <span class="badge host-status" id="host-status"></span>
    </div>
    <p class="notice" id="setup-status" role="status" hidden></p>
    <div class="setup-grid">
      <section class="panel setup-panel" hidden>
        <h2>Subscription connections</h2>
        <p class="meta">Connect your owner accounts with their normal browser sign-in. Sharing runs through structured ACP/SDK sessions.</p>
        <div id="subscription-connections" class="connection-list"></div>
      </section>
      <section class="panel setup-panel" id="subscription-usage" hidden>
        <h2>Subscription usage</h2>
        <p class="meta">Account-wide limits reported by each provider. Usage from your own sessions and shared sessions can count toward these limits.</p>
        <div id="subscription-usage-windows"></div>
      </section>
      <section class="panel setup-panel" hidden>
        <h2>API-key connections</h2>
        <form id="api-key-setup">
          <label for="key-provider">Provider</label><select id="key-provider"></select>
          <p id="key-state" class="meta"></p>
          <label for="provider-key">API key</label><input id="provider-key" type="password" autocomplete="new-password" spellcheck="false" required>
          <label for="provider-models">Allowed model IDs</label><textarea id="provider-models" rows="2" spellcheck="false" aria-describedby="model-ids-help"></textarea>
          <p id="model-ids-help" class="meta"></p>
          <div class="setup-actions"><button id="save-provider-key" type="submit">Save connection</button><button id="import-account-key" type="button" class="secondary" hidden>Use signed-in owner account</button><button id="remove-key" type="button" class="secondary danger">Remove key</button></div>
        </form>
        <p class="meta">Keys are encrypted on the host and never returned to this page or shared with guests.</p>
      </section>
      <section class="panel setup-panel setup-network" hidden>
        <h2>Cloudflare guest access</h2>
        <p id="cloudflare-state" class="meta" role="status"></p><p id="cloudflare-problem" class="meta"></p>
        <div class="setup-actions"><button id="connect-cloudflare" type="button" class="secondary">Connect Cloudflare</button><a id="cloudflare-login-link" class="setup-link" target="_blank" rel="noopener noreferrer" hidden>Continue Cloudflare sign-in</a></div>
        <form id="cloudflare-setup">
          <label class="select-models"><input type="checkbox" id="use-existing-tunnel"> Use an existing Cloudflare tunnel</label>
          <label for="share-hostname">Guest hostname</label><input id="share-hostname" placeholder="share.example.com" autocomplete="off" spellcheck="false" required>
          <p class="meta">Use a hostname in the domain you authorize with Cloudflare. Publishing creates its guest tunnel and DNS route. The owner dashboard stays on this computer.</p>
          <div class="setup-actions"><button id="publish-cloudflare" type="submit">Publish guest link</button><button id="check-cloudflare" type="button" class="secondary">Check public link</button><button id="stop-cloudflare" type="button" class="secondary">Stop tunnel</button></div>
        </form>
      </section>
    </div>
    <section class="panel model-settings">
      <div class="share-header"><h2>Models you share</h2><button id="refresh-models" type="button" class="secondary">Refresh sign-ins</button></div>
      <p class="meta">Claude and Codex use your signed-in subscription on this computer. Cursor uses your host API key. Guests never receive your credentials.</p>
      <p class="meta">Connect accounts above, then choose the models you want to share. Only available catalog models appear.</p>
      <form id="model-settings"><div id="enabled-model-list" class="model-list"></div><button type="submit">Save shared models</button></form>
      <p class="meta">Disabling a model stops its active shared replies and blocks it in existing invites and rooms. Per-invite choices below can narrow access further.</p>
    </section>
    <div class="owner-grid">
      <section class="panel invite-form-panel">
        <h2>Create invite</h2>
        <form id="create-invite">
          <label for="label">Guest label</label>
          <input id="label" maxlength="80" placeholder="e.g. Alex" required>
          <label for="invite-room">Shared room</label>
          <select id="invite-room"><option value="">Individual access</option></select>
          <div class="field-row">
            <div><label for="duration">Access (min)</label><input id="duration" type="number" min="1" max="43200" value="60" required></div>
            <div><label for="redeem-within">Redeem within (min)</label><input id="redeem-within" type="number" min="1" max="10080" value="1440" required></div>
            <div><label for="turn-limit">Turn limit</label><input id="turn-limit" type="number" min="0" max="500" value="25" aria-describedby="turn-limit-help" required><p id="turn-limit-help" class="meta turn-limit-help">0 means unlimited</p></div>
          </div>
          <fieldset class="model-picker">
            <legend>Allowed models</legend>
            <p class="meta" id="model-selection-help">Choose up to 64 models per invite.</p>
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
            <button id="copy-code" class="secondary">Copy app code</button>
          </div>
          <p class="meta">Paste the app code or link into Join CodeShare in ViscosityCode. Save it now. It’s shown once.</p>
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
        <div class="created">
          <h2>Shared rooms</h2>
          <form id="create-room" class="room-form">
            <label class="sr-only" for="room-name">Room name</label>
            <input id="room-name" maxlength="80" placeholder="Room name" required>
            <button type="submit" class="secondary">Create room</button>
          </form>
          <p class="meta" id="room-count"></p>
        </div>
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
.setup-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-bottom: 1rem; }
.setup-network { grid-column: 1 / -1; }
.setup-panel > p { margin-bottom: .8rem; }
.connection-list { display: grid; gap: .75rem; margin-top: 1rem; }
.connection-row { display: flex; justify-content: space-between; align-items: center; gap: .8rem; padding: .8rem 0; border-bottom: 1px solid var(--line); }
.connection-detail { display: grid; gap: .25rem; min-width: 0; }
.setup-actions { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; margin: .7rem 0; }
.setup-link { color: var(--accent); overflow-wrap: anywhere; }
.model-settings { margin-bottom: 1rem; }
.model-settings form { margin: 1rem 0; }
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
.room-form { grid-template-columns: minmax(0, 1fr) auto; }
.room-form button { margin-top: 0; }
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
  .owner .owner-grid, .setup-grid { grid-template-columns: 1fr; }
  .owner .model-list { max-height: none; }
  .topbar { min-height: 62px; margin-bottom: 1.2rem; }
  input, select, textarea { font-size: 16px; }
}
`;
