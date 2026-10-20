## Why

The page's only sign-in link carries its long-lived access token. Only the service's own user can
print it, and printing it anywhere an agent or a log can see leaks the token, so the owner could
not open the page from another machine. HTTPS through `tailscale serve` needs a loopback listener
while the page still sits on a tailnet address. Installing takes a git clone and a build, and
leaves `t3-watch` off the PATH.

## What Changes

- **One-time sign-in links.** `t3-watch url`, `install` and a new MCP tool, `watch_sign_in_link`,
  make a link that signs a browser in once, within 10 minutes. Codes are stored hashed in Watch's
  database, so the CLI can make one while the service runs. `/signin` takes only these codes; the
  link with the access token goes away. The agent instructions let the Watch thread hand a link
  to the person who asks for the page, and still forbid reading Watch's files.
- **Loopback listener.** When `host` names one non-loopback address, Watch also listens on
  127.0.0.1 at the same port, so a local proxy such as `tailscale serve` can reach the page while
  it stays on the tailnet address. A loopback bind that fails is logged, not fatal.
- **npm package.** Package metadata, a `prepack` build and a checked `files` list, so the packed
  tarball runs after `npm install -g`. Verified by installing the packed tarball into a scratch
  prefix. Publishing waits for an npm login, and the README moves to npm after the first publish.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-service`: sign-in by one-time code, the loopback listener, packaging.
- `watch-chat`: the sign-in link tool and its instructions.

## Impact

New `src/server/signin.ts` and its test; `src/server/store.ts` gains a `signin_codes` table
(created if missing, so existing databases keep working); `src/server/http.ts`,
`src/server/cli.ts`, `src/server/config.ts`, `src/server/mcp.ts`, `package.json`, `README.md` and
their tests. Links with `?token=` stop working; browsers already signed in keep their cookie.
