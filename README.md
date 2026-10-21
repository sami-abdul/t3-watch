# t3-watch

Watch keeps an eye on the systems you run: CI, cloud accounts, API keys, URLs and scheduled jobs.
It sets itself up from the projects and logins already on your machine, runs its checks on its
own clock without spending model tokens, and wakes your agent only when something changes.

- **The page** is for knowing and deciding: what's broken, what's waiting for you, and one-click
  Turn on, Pause and Add key. Keys are pasted here, never in chat.
- **The chat** is for understanding and authoring. A "Watch" thread in [T3 Code](https://t3.codes)
  (or any MCP client) investigates failures, writes new checks and shows the page inline.

## Install

Watch needs Node 24 or newer, on a machine that stays on.

```sh
npm install -g @lfg-labs/t3-watch
t3-watch install
```

`install` runs Watch in the background at login (systemd on Linux, launchd on macOS), adds its MCP
server to Codex and Claude Code, and prints a sign-in link for the page. A sign-in link works
once, within 10 minutes, so a copy left in a terminal, a log or a chat is useless after use. For
each other browser, `t3-watch url` prints a new one, or ask your Watch thread for the page. A
browser gets its own session, never the access token agents use, and `t3-watch signout` signs
every browser out while agents keep working.

To run from a checkout instead, clone this repository, run `pnpm install && pnpm build`, then
`node bin/t3-watch.js install`.

On Linux, `loginctl enable-linger $USER` keeps it running while you're logged out. To reach the
page from your phone, put it behind Tailscale (`tailscale serve --bg --https=8461 http://127.0.0.1:8460`)
and set `publicUrl` in `~/.t3-watch/config.json` to that address. If `host` there is a tailnet
address, Watch listens on 127.0.0.1 as well, so `tailscale serve` can front it on another port.

## First run

Open the page and press **Set up Watch**. It reads the git repositories under `~/Projects` (and
`~/code`, `~/src`, `~/dev` if they exist), finds the vendors your code uses, tests the `gh` login,
each AWS CLI profile and any vendor keys in `.env` files, and runs every suggested check once.
Untick what you don't want and press **Watch these**.

Watch only reads. Keys it finds are stored encrypted in `~/.t3-watch`, and their values never
reach the page, a log or an agent.

## The Watch thread

Make a thread in T3 Code, name it Watch, and say "Show me Watch". The agent calls `watch_home`.
On Codex threads the page appears inline and its buttons work; on other providers you get the same
state as text.

Things to ask:

- "What's broken?" or "Why did CI fail on api?"
- "Pause the Stripe checks until Monday."
- "Make sure the nightly import ran." The agent drafts a check, runs it once, and leaves it for you
  to turn on.
- "Watch Missive too." The agent writes a vendor description and tests it with your key.
- "Set up alerts." Alerts in the page's Details walks you through three steps. Press **Make a
  signing secret**, which the page shows once. Say "Set up alerts" here: the agent creates a T3
  webhook task bound to the thread that checks Watch's signature, asks you to paste the secret
  into a private T3 card, gives Watch the task's address, and sends a test alert. The task
  accepts it only when it holds Watch's secret. **Send a test alert** on the page, or
  `t3-watch alerts test` in a terminal, sends another whenever you want to check, and
  `t3-watch alerts` says how the last one went. The secret never passes through the chat, Watch
  refuses one sent over MCP, and only the webhook's host shows on the page. From then on, a check that starts failing, recovers or can't
  run wakes the thread, and the agent looks into it before you open it. Checks that keep passing
  send nothing. A check that was passing counts as failing only when two runs in a row do not
  pass; Watch runs it again within a minute of the first, so one dropped request wakes nobody. A
  recovery counts at once.

## When Watch's own connection drops

When a check that needs the internet stops passing, Watch first asks whether it can reach the
internet at all. If neither `https://www.gstatic.com/generate_204` nor
`https://one.one.one.one/cdn-cgi/trace` answers within 5 seconds, it holds the result: the run
shows in the check's history as held, the check keeps its last result, and nothing alerts. Home
and the Watch thread's status say when Watch lost its connection. Heartbeats and checks on this
machine are never held, and a check's failures are held for at most an hour of its runs in a row,
in case the probe addresses are what is blocked.

If your network blocks those two addresses, list ones it allows as `probeUrls` in
`~/.t3-watch/config.json` and restart Watch. An empty list turns holding off. Watch notices a
blocked list on its own: when the addresses fail twice in an hour right after a check reached the
internet, it stops holding and says so on Home until one of them answers or Watch restarts.

## Vendors

Each vendor is a JSON file in [`catalog/`](catalog): how to spot it in a project, which variable
holds its key, how to send the key, which read-only call proves the key works, and which checks
to offer. Adding a vendor is a file, not a release. Watch only sends GET requests to the API
origin a description names.

Shipped: Stripe, Pipedrive, Missive, Asana, Airtable, Jotform, Calendly, Vimeo, Sentry, OpenAI,
Anthropic. Xero is recognised, but sign-in vendors aren't supported yet.

Check kinds that need no vendor file: `http`, `github` (through `gh`; for a scheduled workflow, name
it in `workflow` and add `maxAgeSeconds`, so a schedule GitHub skipped or disabled fails instead of
staying green),
`aws_metric` (through the AWS CLI) and `heartbeat` (a job pings a URL; add `?status=fail` when it
fails).

## Development

```sh
pnpm dev          # the service from source, on 127.0.0.1:8460
pnpm test         # unit and integration tests
pnpm typecheck
pnpm build        # server, page and the inline view
```

Design and requirements live in [`openspec/`](openspec).
