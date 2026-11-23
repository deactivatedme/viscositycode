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
      <span class="badge" id="host-status"></span>
    </div>
    <div class="owner-grid">
      <section class="panel">
        <h2>Create invite</h2>
        <form id="create-invite">
          <label for="label">Guest label</label>
          <input id="label" maxlength="80" placeholder="e.g. Alex" required>
          <div class="field-row">
            <div><label for="duration">Access (min)</label><input id="duration" type="number" min="1" max="43200" value="60" required></div>
            <div><label for="redeem-within">Redeem within (min)</label><input id="redeem-within" type="number" min="1" max="10080" value="1440" required></div>
            <div><label for="turn-limit">Turn limit</label><input id="turn-limit" type="number" min="1" max="500" value="25" required></div>
          </div>
          <fieldset><legend>Allowed models</legend><div id="model-list" class="model-list"></div></fieldset>
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
      <section class="panel">
        <h2>Invites</h2>
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
.model-list { display: grid; gap: .25rem; max-height: 14rem; overflow: auto; }
.model-list label { display: flex; align-items: baseline; gap: .55rem; overflow-wrap: anywhere; font-weight: 480; }
.created { border-top: 1px solid var(--line); margin-top: 1.2rem; padding-top: 1rem; display: grid; gap: .55rem; }
.copy-row { display: flex; flex-wrap: wrap; gap: .4rem; }
.invite-list { display: grid; gap: .6rem; }
.invite-row { border: 1px solid var(--line); border-radius: 8px; padding: .75rem; display: grid; gap: .35rem; }
.invite-title { display: flex; justify-content: space-between; gap: .5rem; align-items: center; overflow-wrap: anywhere; }
.invite-title .badge { text-transform: capitalize; font-size: .8rem; }
.invite-actions { display: flex; gap: .4rem; flex-wrap: wrap; padding-top: .35rem; }
.invite-actions input { width: 5.2rem; }
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
  .owner-grid { grid-template-columns: 1fr; }
  .topbar { min-height: 62px; margin-bottom: 1.2rem; }
  input, select, textarea { font-size: 16px; }
}
`;
