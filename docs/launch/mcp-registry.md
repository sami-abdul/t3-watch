# The MCP Registry listing

Watch's entry in the official MCP Registry at `registry.modelcontextprotocol.io` is
[`server.json`](../../server.json), named `ai.lfglabs/t3-watch`. The registry hosts only that
entry; the package stays on npm as `@lfg-labs/t3-watch`. `src/server/release.test.ts` keeps the
entry in step with `package.json` and the README, so a release cannot name an entry its package
does not carry.

## What a client does with it

A client that installs from the registry runs `npx @lfg-labs/t3-watch mcp`, Watch's MCP server
over stdio, at the version the entry names. That server only relays. It passes each message to
the Watch service on the same machine with the token from Watch's own config, so the entry holds
no key or token. Until someone runs `t3-watch install`, every tool answers that Watch is not
reachable and names the command to start it. The README's install steps come first, and the
entry links there.

## Publishing a new version

The registry keeps the entry each version shipped with, so the description and the version change
with a release, never after one.

1. Raise `version` in `package.json` and both versions in `server.json` together. The tests fail
   until they agree.
2. Release that version to npm. The registry reads `mcpName` from the published package to check
   who owns it.
3. Sign in. The `ai.lfglabs` names are proven by a TXT record on the apex of lfglabs.ai,
   `v=MCPv1; k=ed25519; p=` and the public key, so the publisher signs in with that key's private
   half, as hex. Keep the key file outside this repository, and read the key from it inside the
   command, so it never lands in the shell's history:

   ```sh
   key=~/keys/mcp-registry.pem  # wherever it lives, outside the repository
   mcp-publisher login dns --domain lfglabs.ai --private-key "$(openssl pkey -in "$key" -noout -text | grep -A3 'priv:' | tail -n +2 | tr -d ' :\n')"
   ```

   `mcp-publisher` takes the key only as an argument, so other users of the machine can see it in
   the process list while the command runs; sign in from a machine only you use. A sign-in lasts
   five minutes. A new key replaces the TXT record rather than adding a second, since the registry
   tries a stale record first and fails.
4. From the repository's root, run `mcp-publisher validate`, then `mcp-publisher publish`.
5. Confirm it is listed:
   `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=ai.lfglabs/t3-watch"`.

The registry's docs say MCP server marketplaces are its main readers and pull new entries from it
regularly, for example hourly.
