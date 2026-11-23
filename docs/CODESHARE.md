# CodeShare

Host a private AI coding chat from your Mac or a server. Create a one-time invite
with the exact models, access duration, and turn limit you want. The access clock
starts when the guest redeems the code. Guests can join from a desktop or mobile
browser.

## Start on your Mac

Set up the checkout's dependencies and build its runtime with
`bun run build:electron`. This builds into the checkout.

Create a private environment file outside the repository. For example, on macOS:

```sh
mkdir -p "$HOME/.config/viscositycode"
(umask 077 && touch "$HOME/.config/viscositycode/codeshare.env")
open -e "$HOME/.config/viscositycode/codeshare.env"
```

For a subscription-only share, set `CODESHARE_SUBSCRIPTION_MODELS`. The Mac
can start CodeShare without provider API credentials:

```dotenv
CODESHARE_SUBSCRIPTION_MODELS=claude:claude-fable-5-2
```

From the checkout, start the service:

```sh
node --env-file="$HOME/.config/viscositycode/codeshare.env" dist/main/server.cjs codeshare
```

Open the **Private owner link** printed in your terminal. Keep that link private.
The owner link changes when the service restarts. Create a test invite and open
it with **Join CodeShare** in the desktop app. For local testing the guest site is
`http://127.0.0.1:8787`.

Set the turn limit to `0` for unlimited prompts until the access timer expires.
Use **Shares** to extend the redemption window or active access, or revoke an invite.
All visible models are selected initially. Set `CODESHARE_INVITE_MODELS` to a
comma-separated subset of the configured models to narrow the picker for new invites.
Existing invites retain their allowed models while those models are configured.

## Use a guest’s subscription or a Cursor key

Add `CODESHARE_SUBSCRIPTION_MODELS` to the host environment to let guests
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

For hosted Cursor, add `cursor:<model-id>` to `CODESHARE_MODELS` and set
`CODESHARE_CURSOR_API_KEY` on the Mac. Use a dedicated Cursor workspace/key
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

1. In the private owner dashboard, create an invite and send **Copy link** to the
   guest. Use a public HTTPS hostname for guests on other computers.
2. In a ViscosityCode build that includes CodeShare, the guest opens the Command
   Palette and runs **Join CodeShare**. They paste the full invite link and
   select **Join**.
3. They choose an approved model and send messages from the CodeShare dialog.
   **Attach a local text file** adds only the file the guest selected to their next
   message. **Send** sends hosted-model context to the Mac. **Start local chat**
   starts a guest subscription chat on their own device.
4. Reopen **Join CodeShare** to return to the same share. **Leave share** removes
   the saved guest credential. The owner can extend, pause, or revoke access
   from the private dashboard.

An invite containing only hosted models also works in the guest browser site.
Redeeming it grants one session. Invites with subscription models are reserved
for the desktop app. The app-to-host connection uses the same guest port as the browser site. The host serves the
app its approved model list, time, turn allowance, and responses. Shared turns
use the provider configuration on the CodeShare host.

## Share over the internet

1. Set up an HTTPS tunnel or reverse proxy with a dedicated hostname pointed at
   `http://127.0.0.1:8787`. Preserve the public hostname in the upstream
   `Host` header and forward the browser's `Origin` header. For example, a
   [named Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/get-started/)
   can provide a stable hostname without a public inbound port on your Mac.
2. Add `CODESHARE_PUBLIC_ORIGIN=https://share.example.com` to the environment
   file, substituting the actual origin. If this is a Cloudflare Tunnel and the
   guest port is reachable only through it, set `CODESHARE_CLOUDFLARE_TUNNEL=1`
   to apply per-visitor limits with Cloudflare’s client IP header. Restart CodeShare and open the new
   private owner link.
3. Create and send the guest invite. Leave the Mac awake with CodeShare and the
   tunnel running while guests need access.

The owner dashboard listens on `http://127.0.0.1:8788`. Publish only the guest
port. On a VPS, forward the owner port over SSH when you need the dashboard:

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
  stopped after admission. The dashboard shows the provider's reported token
  counts when available. Set spending limits in your provider project for billing
  control.
- CodeShare uses provider API billing. Eligible ChatGPT subscriptions can fund
  OpenAI API requests with [claimed API credits](https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions).
  The Codex signed-in usage allowance is separate.
- Chats and grants remain in the host's CodeShare database. Provider requests
  send chat context to the selected provider. Guests get text chat and can copy
  replies. The guest listener has no routes for host files, tools, or projects.
- The default data directory is `~/.viscositycode-codeshare`. You can set
  `CODESHARE_DATA_DIR`, `CODESHARE_GUEST_PORT`, and `CODESHARE_ADMIN_PORT`
  in the environment file. Keep the data directory private and reuse it to
  preserve invites and usage across restarts.
