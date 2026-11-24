# CodeShare

Share your signed-in Claude and Codex/ChatGPT subscriptions from your Mac or a server. Create a one-time invite
with the exact models, access duration, and turn limit you want. The access clock
starts when the guest redeems the code. Guests can join from a desktop or mobile
browser.

## Start on your Mac

Set up the checkout's dependencies and build its runtime with
`bun run build:electron`. This builds into the checkout.

Start the service without provider credentials in the command line:

```sh
node dist/main/server.cjs codeshare
```

Open the **Private owner link** printed in your terminal. Keep that link private;
it changes when the service restarts. The dashboard contains the setup controls:

1. **Subscription connections** → **Connect** for Claude or Codex. Complete the
   provider's normal browser sign-in, then choose the models to share. Existing
   signed-in owner accounts are reused. Cancelling a pending attempt does not
   log out an existing account.
2. **API-key connections** → select a supported provider, enter the key in the
   password field, choose exact model IDs if required, and **Save connection**.
   Cursor and Devin can discover their key-entitled model catalogs automatically. For Devin, use a native ACP account key or **Use signed-in owner account**, which preserves native credential routing metadata. This is not an app.devin.ai cloud-service API key. A candidate
   key is checked before replacing the existing connection. Keys are encrypted
   in the host's private setup store and never returned to the dashboard.
3. **Cloudflare guest access** → **Connect Cloudflare**, authorize your domain
   in the browser, enter a guest hostname such as `share.example.com`, then
   **Publish guest link**. If the domain already has a tunnel, choose **Use an
   existing Cloudflare tunnel** and **Use existing route** to preserve that setup.
   **Check public link** verifies that the hostname
   reaches this exact CodeShare host. **Stop tunnel** also keeps it stopped
   across service restarts; publishing again resumes it.

Cloudflare setup requires `cloudflared` on the host. It uses the normal
Cloudflare account certificate, creates a named tunnel, and publishes only the
CodeShare guest listener. Existing DNS records are not overwritten. The owner
listener stays at `http://127.0.0.1:8788`. Domain authorization and live routing
must still be tested with the actual account and hostname.

Owner subscription chat runs through Claude's Agent SDK or Codex's app-server
protocol, with no terminal/print-generation fallback. OAuth credentials stay in
normal provider storage. Guests do not sign in to the owner's providers. Host text chat has no file tools and runs in a disposable directory. Approved participant file turns attach only a per-turn remote workspace MCP server; owner filesystem and shell tools, hooks, and plugins stay disabled.
Codex's restricted app-server route is qualified for **0.171.0**. Claude uses
its installed native executable explicitly because standalone distributions
prune optional SDK executables. Local model aliases are excluded from owner
sharing; choose a concrete model ID from the catalog.

Advanced environment configuration remains supported. Set
`CODESHARE_OWNER_SUBSCRIPTION_MODELS` to exact IDs from `codeshare --check-models`
to restrict owner discovery. `CODESHARE_SUBSCRIPTION_MODELS` is an alias for owner
funding. Older guest-funded grants under those IDs are revoked before owner
spending is enabled; issue fresh invites after upgrading. Dashboard key choices
override environment credentials, including explicit removal.

Create a test invite and open it in another browser session or with **Join
CodeShare** in the desktop app. Before publishing, the guest site is
`http://127.0.0.1:8787`.

Set the turn limit to `0` for unlimited prompts until the access timer expires.
Use **Shares** to extend the redemption window or active access, or revoke an invite.
In **Models you share**, enable or disable the owner's models and save. Choices
persist over restarts and apply to existing shares and rooms. Disabling a model
also stops its active shared replies. **Refresh sign-ins** updates the catalog
after signing in or out on the owner computer. Per-invite model choices can
further narrow a guest's access. All enabled models are selected initially. Set `CODESHARE_INVITE_MODELS` to a
comma-separated subset of the configured models to narrow the picker for new invites.
Existing invites retain their allowed models while those models are configured.

## Co-code in a shared room

In the owner dashboard, create a room and issue a separate time-limited invite
for every participant, including yourself. Each app shows the same conversation,
prompt authors, selected computers, and the turn queue. Only one turn can run
in a room at a time.

Rooms have no fixed participant limit. The roster is paginated in batches of 100;
invite lifetimes, model grants, and turn allowances still apply to every person.
The queue has a 12-pending-turn backpressure limit and executes one turn at a time.

Choose a ready desktop computer for an owner-funded model, then that participant
clicks **Run here** to approve sharing files in their selected local project with
the owner/provider. The owner pays through their Claude/Codex subscription or
Devin native account key. The participant needs no provider account for this turn.
Only project-relative text-file search, read, create, and compare-before-write
operations are available. File contents go to the selected owner provider.
Ignored/private files and linked files cannot be read or edited, and ignore-policy files are read-only. Ambiguous Windows device and short-alias paths are refused. Choose a project folder; home directories and their ancestors cannot be approved. Local native projects are supported;
WSL project approval is not yet supported. There is no remote shell tool. File turns are bounded to ten minutes (or earlier access expiry), 500 file requests, and 128,000 characters per file operation.

The owner model runs in a dedicated SDK/ACP session with host file and shell tools
disabled. The selected computer executes file operations through its own supervisor.
A reconnect reuses request IDs, so accepted writes are not replayed. Stop and access
revocation wait for that computer to drain its file grant before the room advances.
Host restart moves active owner-funded file turns to stopping rather than rerunning
inference. Reopen the room on the selected computer to confirm completion or stop.
**Host computer** remains available for text-only turns.

Optional participant-subscription models still launch an ordinary GUI provider
thread after **Run here**; that participant supplies their own sign-in and billing.

Desktop and mobile browsers can join the same shared conversation, see prompt
authors and replies, and queue turns for the host or a ready participant. Local
file execution and its approval stay in the selected participant’s desktop app.

The host queues more prompts while a turn is running. If a computer disconnects
mid-turn, the queue waits for that computer's confirmed result or stop before
moving on. Reopen the room on that computer to reconnect to its run.

## Participant subscriptions and Cursor keys

Add `CODESHARE_PARTICIPANT_MODELS` to the host environment to let guests
launch local chats through their signed-in ViscosityCode providers. Use
`codex:<model-id>`, `claude:<model-id>`, or `devin:<model-id>` from the
guest’s provider catalog.

A subscription-only host starts without provider keys. The guest redeems the
invite in the desktop app, selects a model, and uses **Sign in** if needed.
**Start local chat** checks the guest’s account and exact model locally, then
reserves one turn from the invite and opens a normal chat in the guest’s local
project. The Mac receives a model ID and reservation ID. The local prompt,
file contents, reply, and provider authentication stay with the guest’s
desktop and selected provider. The invite limits when local chats can start.
Once started, they are ordinary local chats billed and controlled by the
guest’s own account.

Devin requires the guest’s own licensed Devin account and a model available
in its local catalog. Devin Ultra is a cloud agent mode, so `ultra` is not a
substitute for a model ID in this list.

For hosted Cursor, set `CODESHARE_CURSOR_API_KEY` on the Mac. CodeShare
discovers the key’s exact Cloud Agents model IDs. Optionally add
`cursor:<model-id>` entries to `CODESHARE_MODELS` to restrict that catalog. Use a dedicated Cursor workspace/key
without Cloud Agents secrets or connected private repositories. CodeShare
checks the authenticated Cloud Agents catalog and rejects keys that can see
saved secrets. Cursor jobs use an isolated cloud workspace, and only the
approved model ID and prompt history are sent. A Cursor job returns its final
reply after completion. CodeShare requests cancellation when the guest stops
the run or loses access. Cursor verifies model selection against its catalog.
The run response currently lacks a served-model ID.

## Hosted text API models

Hosted text API routes use `CODESHARE_MODELS` and the configured provider’s
API key. An existing OpenAI API configuration looks like this:

```dotenv
CODESHARE_MODELS=openai:gpt-5.4-mini
CODESHARE_OPENAI_API_KEY=replace-with-your-project-api-key
```

For Claude, add `anthropic:<model-id>` to the comma-separated list and set
`CODESHARE_ANTHROPIC_API_KEY`. Choose models that support text streaming
through [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
or [Anthropic Messages](https://platform.claude.com/docs/en/build-with-claude/streaming).
Supported models and limits depend on your provider project.

For Grok, add `xai:<model-id>` and set `CODESHARE_XAI_API_KEY`. That key uses
[xAI API billing](https://docs.x.ai/developers/faq/accounts).

Use exact model IDs from the selected provider's catalogue. The host requests
each ID with its configured credential before opening the guest listener. You
can run just this read-only check from the checkout:

```sh
node --env-file="$HOME/.config/viscositycode/codeshare.env" dist/main/server.cjs codeshare --check-models
```

A catalogue check confirms availability for the credential. During an OpenAI, Anthropic, or xAI text turn,
CodeShare checks the response's model separately and stops replies that report
a different model. A dated snapshot of the requested model family is accepted
when the request used the undated ID.

## Join in ViscosityCode

1. In the private owner dashboard, create an individual invite, then send
   **Copy app code** or **Copy link** to the recipient. Use a public HTTPS
   hostname for guests on other computers.
2. In ViscosityCode, press **Cmd+K** on Mac or **Ctrl+K** on Windows, select
   **Join CodeShare**, paste the invite code or link, and click **Join**.
3. Open a local project in Chat mode. Pick an invited model under **CodeShare**
   in the normal model picker and send a prompt. The owner host runs the
   corresponding structured session. Approve file access in the chat when a
   coding model requests it. Text-only models have no file access.
4. **Join CodeShare** shows the remaining invite allowance. **Leave share**
   removes the saved guest credential. The owner can extend, pause, or revoke
   access from the private dashboard. An existing thread remains bound to the
   invite under which it was started.

For a shared room, create the room first and choose it on a separate invite
for each participant. Recipients redeem their invites the same way in the
desktop app. They see a shared conversation in the room panel and can approve
file work on an explicitly selected computer. New dashboard invites require
the desktop app. Previously issued browser-capable invites retain their old
redemption behavior until they expire or are revoked.

## Share over the internet

Use the dashboard's Cloudflare connection and publishing controls described
above. A saved, routed tunnel resumes when CodeShare restarts unless it was
stopped in the dashboard. Leave the host awake and the service running while
guests need access. Changing hostnames creates the new route; old DNS records
remain in your Cloudflare account for you to manage.

For an externally managed tunnel or reverse proxy, point a dedicated HTTPS
hostname at `http://127.0.0.1:8787`, preserving the public Host and browser
Origin headers. Set `CODESHARE_PUBLIC_ORIGIN` to that HTTPS origin. Only enable
`CODESHARE_CLOUDFLARE_TUNNEL=1` when this guest listener is reached exclusively
through the trusted Cloudflare tunnel. A dashboard-managed hostname takes
precedence over these environment settings.

On a remote server, reach the private owner dashboard through SSH:

```sh
ssh -N -L 8788:127.0.0.1:8788 user@your-vps
```

## Invite rate limits

CodeShare allows 12 redemption attempts per source and 240 across the guest
listener per minute. Browser and desktop redemption share these thresholds.
Opening the invite page and creating desktop claims have separate limits.
Throttled requests receive HTTP 429 and a `Retry-After` header. The private
owner dashboard uses a separate listener.

The service uses the connecting IP by default. Without a trusted visitor
header, requests from the same reverse proxy share one source bucket. Enable
the Cloudflare setting only for a guest listener routed exclusively through
that tunnel.

## Controls and data

- **Pause all shares** stops active responses and blocks new ones. Invite clocks
  keep running. Use **Extend** to add time to an active invite and **Revoke**
  to end access immediately.
- Each accepted turn uses one turn from the invite allowance, including work
  stopped after admission. In **Shares**, the dashboard shows reported input
  and output tokens per invite, including shared-room turns attributed to the
  person who sent the prompt. It also shows how many turns provided a report.
- Owner subscription models consume the owner's Claude or Codex/ChatGPT usage
  allowance through Claude’s Agent SDK or Codex’s app-server protocol. API models consume the
  configured key's billing/plan allowance. CodeShare never substitutes an API key
  for a missing subscription. New Claude SDK and Codex app-server turns contribute
  reported tokens when the runtime returns a count. Older turns and turns without
  a provider report still count against the invite's turn limit. Token counts
  measure only CodeShare traffic and do not predict remaining account quota.
  The private dashboard also shows provider-reported, account-wide usage
  windows and reset times for connected subscriptions when available.
- Chats and grants remain in the host's CodeShare database. Provider requests
  send chat context to the selected provider. Guests get text chat and can copy
  replies. The guest listener has no routes for host files, tools, or projects.
- The default data directory is `~/.viscositycode-codeshare`. You can set
  `CODESHARE_DATA_DIR`, `CODESHARE_GUEST_PORT`, and `CODESHARE_ADMIN_PORT`
  in the environment file. When a model previously used by guest-funded grants is first enabled for owner
  funding, those older grants are revoked; issue fresh invites to authorize
  owner spending. Keep the data directory private and reuse it to
  preserve invites and usage across restarts.

## Setup persistence and current coverage

`setup.enc` stores encrypted API credentials, model selections, and tunnel
identity. `setup-key.json` is its versioned private host key; back up both with
the CodeShare data directory. Unknown future versions are refused without
rewriting them. Native provider OAuth storage and Cloudflare's normal account
certificate remain managed by their respective tools.

The dashboard currently connects Claude and Codex subscriptions, plus the
OpenAI, Anthropic, xAI, and Cursor API routes, plus Devin native account keys through a dedicated ACP session. Devin is qualified against **3000.14.30833 (a165b2eb0a68)** and refuses other versions until requalified. Its exact models come from the key-entitled native catalog.
Native iOS and Android have no CodeShare setup screen. The private browser
owner dashboard is shared by desktop and mobile browsers.
