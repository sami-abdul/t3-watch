# The public site

The static page lives at https://t3-watch.lfglabs.ai on the appin60 Cloudflare Pages account,
project `t3-watch`. Source is in `site/`. It uses the README's recording and sample Home screenshot
from `docs/`, with no analytics, external fonts or runtime dependencies.

```sh
pnpm build:site
wrangler pages deploy site/dist --project-name t3-watch --branch main
```

Use the appin60 LFG-products credential from the host's credential store through environment
variables. Never put a token in a command, log or tracked file. Check the latest Codex weekly
usage before a deployment or release step and stop at 70 percent.

The custom domain is attached to the Pages project. Its one authorized DNS record is a proxied
CNAME, `t3-watch.lfglabs.ai` to `t3-watch.pages.dev`, with automatic TTL. No apex record changes.
An existing record that differs needs review before replacement.

After deploying, verify the custom domain over HTTPS, `/.well-known/security.txt`, `/og.png`,
`/favicon.svg`, `/assets/home.png` and `/assets/demo.mp4`. Check that the video plays, both Copy
buttons work, and the page has no horizontal overflow at phone and desktop widths.

`site/og.svg` is the editable source for the 1200 by 630 `site/og.png` social image. Render it at
its native size after editing. `security.txt` expires on 24 October 2027 and names
contact@lfglabs.ai.
