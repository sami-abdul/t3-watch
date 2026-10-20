## 1. Sign-in links

- [x] 1.1 `src/server/store.ts`, `src/server/signin.ts`, `src/server/signin.test.ts`: codes stored
      hashed with a 10-minute expiry and taken once.
- [x] 1.2 `src/server/http.ts`, `src/server/http.test.ts`, `src/server/chat.test.ts`: `/signin`
      takes a code once; the token form goes.
- [x] 1.3 `src/server/cli.ts`, `src/server/cli.test.ts`, `src/server/config.ts`,
      `src/server/config.test.ts`, `README.md`: `url` and `install` print a one-time link; `start`
      points at `t3-watch url`.
- [x] 1.4 `src/server/mcp.ts`, `src/server/chat.test.ts`: `watch_sign_in_link` and the agent
      instructions for it.

## 2. Loopback listener

- [x] 2.1 `src/server/cli.ts`, `src/server/config.ts`, `src/server/config.test.ts`, `README.md`:
      also listen on 127.0.0.1 when `host` names one non-loopback address.

## 3. npm package

- [x] 3.1 `package.json`, `.gitignore`: metadata, `prepack`, `prepublishOnly`, `files`.
- [ ] 3.2 `README.md`: install from npm, after the first publish.

## 4. Review follow-ups

- [x] 4.1 `src/server/http.ts`, `src/server/http.test.ts`, `src/server/signin.ts`,
      `src/server/chat.test.ts`: opening a link shows a Sign in button that posts the code, so a
      link preview cannot spend it.
- [ ] 4.2 `src/server/store.ts`, `src/server/signin.ts`, `src/server/signin.test.ts`,
      `src/server/http.ts`, `src/server/extend.ts`, `src/server/cli.ts`, `src/server/cli.test.ts`,
      `src/server/chat.test.ts`, `README.md`: a browser gets its own session, never the access
      token; `t3-watch signout` ends every browser session.
- [ ] 4.3 `src/server/store.ts`: the busy timeout comes before WAL; one write per sign-in try.
- [ ] 4.4 `src/server/http.ts`, `src/server/mcp.ts`, `src/server/cli.ts`: one expiry constant in
      every message; the install comment matches what it prints.
- [ ] 4.5 `src/server/cli.ts`, `src/server/cli.test.ts`: `url` warns when no Watch answers for
      that folder; its test ignores port and host overrides.

## 5. Verification

- [ ] 5.1 `pnpm test`; `pnpm typecheck`; `pnpm build`;
      `openspec validate add-sign-in-links-and-npm-package --strict`.
- [ ] 5.2 `npm pack`; `npm install -g --prefix <scratch> <tarball>`; `t3-watch` help, start and
      status from the scratch prefix.
- [ ] 5.3 On the running install: a one-time link signs a browser in once and is refused the
      second time; 127.0.0.1:8460 and the tailnet address both answer.
