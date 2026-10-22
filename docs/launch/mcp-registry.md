# MCP Registry listing: draft

Not submitted. This is the entry Watch would send to the official MCP Registry at
`registry.modelcontextprotocol.io`, kept here until the listing is approved. Nothing in this
folder publishes anything on its own.

## The entry

Saved as `server.json`, this is the whole submission:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.sami-abdul/t3-watch",
  "title": "t3-watch",
  "description": "Watches your CI, cloud accounts, API keys, sites and nightly jobs, and wakes your agent on a change.",
  "version": "0.4.0",
  "websiteUrl": "https://github.com/sami-abdul/t3-watch#readme",
  "repository": {
    "url": "https://github.com/sami-abdul/t3-watch",
    "source": "github",
    "id": "1420374175"
  },
  "packages": [
    {
      "registryType": "npm",
      "registryBaseUrl": "https://registry.npmjs.org",
      "identifier": "@lfg-labs/t3-watch",
      "version": "0.4.0",
      "runtimeHint": "npx",
      "transport": {
        "type": "stdio"
      },
      "packageArguments": [
        {
          "type": "positional",
          "value": "mcp"
        }
      ]
    }
  ]
}
```

It passes the registry's 2025-12-11 schema, checked on 2026-10-22. The description is at the
registry's limit of 100 characters.

## What a client does with it

A client that installs from the registry runs `npx @lfg-labs/t3-watch@0.4.0 mcp`, Watch's MCP
server over stdio. That server only relays. It passes each message to the Watch service on the
same machine with the token from Watch's own config, so the entry holds no key or token. Until
someone runs `t3-watch install`, every tool answers that Watch is not reachable and names the
command to start it. The README's install steps come first, and the listing points there.

## Before it is submitted

1. Settle the name. `io.github.sami-abdul/t3-watch` needs a GitHub sign-in as the repository's
   owner. A domain name the publisher owns, written in reverse, works too and needs a DNS record
   on that domain instead; it stays the same if the repository moves. The name cannot be changed
   once published, only replaced by a new entry.
2. Add `"mcpName"` with that name to `package.json` and release the version the entry names. The
   registry reads `mcpName` from the published package to check who owns it, and 0.3.0 does not
   have it, so the entry names 0.4.0, the next release.
3. Install the publisher, with `brew install mcp-publisher` or the binary from the registry's
   releases, and save the entry above as `server.json` in an empty folder.
4. Run `mcp-publisher validate` there, then `mcp-publisher login github` and
   `mcp-publisher publish`.
5. Confirm it is listed:
   `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.sami-abdul/t3-watch"`.

The registry hosts only this entry, and the package stays on npm. Its docs say MCP server
marketplaces are its main readers and pull new entries from it regularly, for example hourly.
