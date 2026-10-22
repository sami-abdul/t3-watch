## Why

Home groups checks by product, and the product is a guess from names: a repository joins a site
when their names match. A site on `shop.example.com` built from `acme/storefront` shows as two
products, and nothing lets anyone put them together. Build 7 kept this as a follow-up: let the
person or an agent set a service's product when its name does not match its repository.

## What Changes

- **A named product.** Each service can carry a product name. A named product wins over the guess,
  and a repository joins a named product whose name matches its own, so naming the site
  "Storefront" brings `acme/storefront` along. A rescan keeps the name; an empty name goes back to
  the guess.
- **Set from the chat.** `watch_set_product` names a service's product. It changes only how Home
  groups checks, so an agent sets it directly, as the person asks in the Watch thread, rather than
  drafting it for the page.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `watch-service`: a service's product can be named, and Home groups by it.

## Impact

`src/server/store.ts` adds a nullable `product` column to services, added on open as `pending`
was; `src/server/app.ts`, `src/server/state.ts`, `src/server/mcp.ts`, `src/web/logic.ts`, a new
`src/server/product-key.ts` that the server and the page share, and the README, with tests.
Released as 0.5.0 with `package.json` and `server.json`.
