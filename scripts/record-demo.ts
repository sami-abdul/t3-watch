/**
 * Records the README's 60-second demo from `t3-watch demo`, with its sample data only. Run it after
 * `pnpm build`, on a machine with Google Chrome and ffmpeg:
 *
 *   node scripts/record-demo.ts
 *
 * It writes `docs/demo.mp4` and `docs/demo.gif`. It starts this checkout's demo on the demo's own
 * port, the program `npx @lfg-labs/t3-watch demo` runs at the same version, and stops it at the
 * end, which removes the demo's folder; it reaches no other Watch. The terminal scenes show the
 * demo's real output, typed into a page drawn as a terminal. Chrome reports each frame it paints,
 * and ffmpeg holds each one until the next. Set CHROME or FFMPEG to use others than the ones found.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Locator, type Page } from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const SIZE = { width: 1280, height: 800 };
const COMMAND = "npx @lfg-labs/t3-watch demo";
/** How long the video runs; a scene that overruns its slot is reported. */
const LENGTH = 60;

/** Stops before anything has started. */
function fail(message: string): never {
  console.error(`record-demo: ${message}`);
  process.exit(1);
}

const CHROMES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/google/chrome/chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
];
const chrome = process.env.CHROME || CHROMES.find((path) => existsSync(path));
const ffmpeg = process.env.FFMPEG || "ffmpeg";
if (chrome === undefined) fail("Google Chrome was not found. Install it, or set CHROME to its path.");
if (!existsSync(chrome)) fail(`CHROME names ${chrome}, which does not exist.`);
if (spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status !== 0) fail("ffmpeg was not found. Install it, or set FFMPEG to its path.");
if (!existsSync(join(root, "dist", "server", "cli.js")) || !existsSync(join(root, "dist", "web"))) fail("Build the checkout first: pnpm build");

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const running = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;
/** Seconds on Node's steady clock, which a change to the wall clock does not move. */
const now = () => performance.now() / 1000;

/** What a signal has to stop: the demo from the moment it is spawned, and the browser. */
const live: { child: ChildProcess | null; folder: string | null; closeBrowser: (() => Promise<void>) | null } = { child: null, folder: null, closeBrowser: null };

interface Demo {
  readonly child: ChildProcess;
  /** What it printed to stdout, as the terminal shows it. */
  readonly lines: ReadonlyArray<string>;
  readonly link: string;
  /** The folder it keeps its sample data in, which it removes when it stops. */
  readonly folder: string | null;
}

/**
 * Stops the demo the way Ctrl-C does and waits for it, which removes its folder. One that does not
 * stop within 10 seconds is killed, and its folder removed here instead.
 */
const stopDemo = async ({ child, folder }: Pick<Demo, "child" | "folder">) => {
  if (running(child)) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGINT");
    await Promise.race([exited, wait(10_000)]);
    if (running(child)) {
      child.kill("SIGKILL");
      await Promise.race([exited, wait(2_000)]);
    }
  }
  if (folder !== null && existsSync(folder)) {
    rmSync(folder, { recursive: true, force: true });
    console.error(`record-demo: the demo left ${folder} behind; removed it`);
  }
};

/** Starts the demo and reads what it prints, or stops it and throws after 20 seconds. */
const startDemo = async (): Promise<Demo> => {
  // /tmp where there is one, so the folder the demo names reads as it would for most people.
  const env = { ...process.env, ...(existsSync("/tmp") ? { TMPDIR: "/tmp" } : {}) };
  const child = spawn(process.execPath, [join(root, "bin", "t3-watch.js"), "demo"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  live.child = child;
  // Its output is all read only once it closes, which can come after it exits.
  const closed = new Promise((resolve) => child.once("close", resolve));
  let out = "";
  let err = "";
  child.stdout!.on("data", (chunk: Buffer) => {
    out += chunk.toString();
    live.folder = /lives in (\S+) until it stops/.exec(out)?.[1] ?? null;
  });
  child.stderr!.on("data", (chunk: Buffer) => (err += chunk.toString()));
  for (let waited = 0; !out.includes("Stop it with Ctrl-C"); waited += 100) {
    if (!running(child) || waited > 20_000) {
      await stopDemo({ child, folder: live.folder });
      await Promise.race([closed, wait(2_000)]);
      throw new Error(`the demo did not start:\n${`${out}${err}`.trim()}`);
    }
    await wait(100);
  }
  const link = /https?:\/\/\S+\/signin\?code=\S+/.exec(out)?.[0];
  const folder = live.folder;
  if (link === undefined) {
    await stopDemo({ child, folder });
    throw new Error(`the demo printed no sign-in link:\n${out.trim()}`);
  }
  return { child, lines: out.trim().split("\n"), link, folder };
};

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A page drawn as a terminal: the prompt, then each line typed or printed into it; then a closing card. */
const TERMINAL = `<!doctype html><html><head><style>
  html, body { margin: 0; height: 100%; background: #f4f4f5; }
  body { display: grid; place-items: center; font-family: "DejaVu Sans Mono", Menlo, monospace; }
  .window { width: 1140px; height: 600px; background: #16181d; border-radius: 12px; box-shadow: 0 24px 60px rgba(0,0,0,.28); overflow: hidden; }
  .bar { height: 36px; background: #24272e; display: flex; align-items: center; gap: 8px; padding: 0 14px; }
  .bar i { width: 12px; height: 12px; border-radius: 50%; display: block; }
  pre { margin: 0; padding: 22px 26px; color: #e4e4e7; font-family: inherit; font-size: 21px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  .prompt { color: #4ade80; }
  .caret { display: inline-block; width: 10px; height: 21px; background: #e4e4e7; vertical-align: text-bottom; animation: blink 1s steps(1) infinite; }
  .link { color: #93c5fd; text-decoration: underline; }
  @keyframes blink { 50% { opacity: 0; } }
  .end { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(244,244,245,.92); opacity: 0; transition: opacity .6s ease; }
  .end.on { opacity: 1; }
  .card { background: #fff; border-radius: 18px; padding: 40px 56px; box-shadow: 0 24px 60px rgba(0,0,0,.18); text-align: center;
    font-family: system-ui, "DejaVu Sans", sans-serif; color: #18181b; }
  .card h1 { margin: 0 0 22px; font-size: 38px; font-weight: 700; }
  .card code { display: block; margin: 8px 0; padding: 10px 18px; border-radius: 10px; background: #16181d; color: #e4e4e7; font: 24px "DejaVu Sans Mono", monospace; white-space: nowrap; }
  .card p { margin: 22px 0 0; font-size: 22px; color: #52525b; }
</style></head><body><div class="window"><div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div><pre id="screen"></pre></div>
<div class="end" id="end"><div class="card"><h1>Free and open source</h1><code>npm install -g @lfg-labs/t3-watch</code><code>t3-watch install</code><p>github.com/sami-abdul/t3-watch</p></div></div></body></html>`;

declare global {
  interface Window {
    /** Adds the caption bar and the pointer to the page, once. */
    t3wOverlay?: () => void;
  }
}

/**
 * The caption bar and the pointer, on every page the video shows: an init script defines them for
 * each document, and each helper makes sure they are there before it uses them.
 */
const OVERLAY = () => {
  window.t3wOverlay = () => {
    if (document.getElementById("t3w-caption") !== null || document.body === null) return;
    const style = document.createElement("style");
    style.textContent = `
      #t3w-caption { position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%); max-width: 1000px; padding: 14px 26px; border-radius: 14px;
        background: rgba(17,17,19,.86); color: #fff; font: 600 25px/1.35 system-ui, "DejaVu Sans", sans-serif; text-align: center; z-index: 2147483646;
        pointer-events: none; opacity: 0; transition: opacity .35s ease; white-space: pre-line; }
      #t3w-caption.on { opacity: 1; }
      #t3w-pointer { position: fixed; left: 1180px; top: 700px; width: 26px; height: 26px; z-index: 2147483647; pointer-events: none;
        transition: left .7s cubic-bezier(.4,0,.2,1), top .7s cubic-bezier(.4,0,.2,1), transform .12s ease; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
      #t3w-pointer.press { transform: scale(.8); }`;
    document.head.append(style);
    const caption = document.createElement("div");
    caption.id = "t3w-caption";
    const pointer = document.createElement("div");
    pointer.id = "t3w-pointer";
    pointer.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 10.5-6.5 1.3 3.8 7.4-2.9 1.5-3.8-7.5L4 20z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    document.body.append(caption, pointer);
  };
  document.addEventListener("DOMContentLoaded", () => window.t3wOverlay?.());
};

const caption = (page: Page, text: string) =>
  page.evaluate(async (words) => {
    window.t3wOverlay?.();
    const bar = document.getElementById("t3w-caption")!;
    bar.classList.remove("on");
    await new Promise((resolve) => setTimeout(resolve, bar.textContent === "" ? 0 : 350));
    bar.textContent = words;
    bar.classList.add("on");
  }, text);

const movePointer = (page: Page, x: number, y: number) =>
  page.evaluate(([left, top]) => {
    window.t3wOverlay?.();
    Object.assign(document.getElementById("t3w-pointer")!.style, { left: `${left}px`, top: `${top}px` });
  }, [x, y]);

/** Glides the pointer to the middle of `target`, presses, then clicks it for real unless told not to. */
const press = async (page: Page, target: Locator, click = true) => {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null) throw new Error(`nothing to press for ${String(target)}`);
  await movePointer(page, box.x + box.width / 2 - 4, box.y + box.height / 2 - 2);
  await wait(800);
  await page.evaluate(() => (window.t3wOverlay?.(), document.getElementById("t3w-pointer")!.classList.add("press")));
  await wait(140);
  await page.evaluate(() => document.getElementById("t3w-pointer")!.classList.remove("press"));
  if (click) await target.click();
};

const glideScroll = (page: Page, top: number) => page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), top);

interface Frame {
  readonly file: string;
  /** When Chrome painted it, in seconds; the time between two frames is Chrome's own. */
  readonly at: number;
  /** When it reached this script, on Node's steady clock, which the end shares. */
  readonly arrived: number;
}

/** Plays the scenes into `dir` as frames, with the demo running, and returns them with the end time. */
const play = async (demo: Demo, dir: string) => {
  const frames: Array<Frame> = [];
  const writes: Array<Promise<void>> = [];
  let writeError: unknown = null;
  let capturing = true;
  const overruns: Array<string> = [];
  // The script's own signal handlers close the browser after the demo, so Playwright's must not
  // exit first.
  const browser = await chromium.launch({ executablePath: chrome, headless: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
  live.closeBrowser = () => browser.close().catch(() => undefined);
  try {
    const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, colorScheme: "light" });
    await context.addInitScript(OVERLAY);
    // "Ask why" copies its question; the page says so only when it may.
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(demo.link).origin });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      // Acknowledged first and written in the background, so the scenes keep their pace.
      void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
      if (!capturing) return;
      const file = join(dir, `${String(frames.length).padStart(5, "0")}.jpg`);
      const arrived = now();
      const last = frames.at(-1);
      // A frame without Chrome's time takes the time since the last one by this script's clock.
      const at = metadata.timestamp ?? (last === undefined ? arrived : last.at + (arrived - last.arrived));
      frames.push({ file, at, arrived });
      writes.push(writeFile(file, Buffer.from(data, "base64")).catch((error: unknown) => void (writeError ??= error)));
    });

    await page.setContent(TERMINAL);
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 1 });
    const started = now();
    const until = async (second: number, scene: string) => {
      const late = now() - (started + second);
      if (late > 0.5) overruns.push(`${scene} ran ${late.toFixed(1)}s past ${second}s`);
      await wait(Math.max(0, -late * 1000));
    };
    const screen = (html: string) => page.evaluate((markup) => (document.getElementById("screen")!.innerHTML = markup), html);
    const prompt = `<span class="prompt">$</span> `;
    const printed = demo.lines.map((line) => escape(line).replace(escape(demo.link), `<span class="link">${escape(demo.link)}</span>`)).join("\n");

    // 0:00 One command.
    await caption(page, "One command runs a Watch on sample data. Nothing leaves your machine.");
    await screen(`${prompt}<span class="caret"></span>`);
    await wait(700);
    for (let i = 1; i <= COMMAND.length; i++) {
      await screen(`${prompt}${escape(COMMAND.slice(0, i))}<span class="caret"></span>`);
      await wait(55);
    }
    await wait(400);
    await screen(`${prompt}${escape(COMMAND)}\n${printed}\n<span class="caret"></span>`);
    await until(6, "the command");

    // 0:06 The link, then Sign in.
    await press(page, page.locator(".link"), false);
    await page.goto(demo.link);
    await caption(page, "The link signs this browser in, once.");
    await press(page, page.getByRole("button", { name: "Sign in" }));
    await page.getByText("1 thing is broken").waitFor();
    await caption(page, "Home leads with what's broken.");
    await until(11, "signing in");

    // 0:11 The agent's note on the broken check, zoomed: the app zooms, not the page, so the
    // caption and the pointer stay as they are.
    const [x, y] = await page.getByText("Health endpoint answers").first().evaluate((name) => {
      // The card holding the check: the first box around its name as wide as the page's column,
      // its middle measured from the app's own box, which the zoom scales around.
      let box: Element | null = name;
      while (box !== null && box.getBoundingClientRect().width < 600) box = box.parentElement;
      const card = (box ?? name).getBoundingClientRect();
      const app = document.getElementById("root")!.getBoundingClientRect();
      return [card.left + card.width / 2 - app.left, card.top + card.height / 2 - app.top];
    });
    const zoom = (scale: number) =>
      page.evaluate(([at, by, s]) => {
        const app = document.getElementById("root")!;
        app.style.transition = "transform .9s cubic-bezier(.4,0,.2,1)";
        app.style.transformOrigin = `${at}px ${by}px`;
        app.style.transform = s === 1 ? "none" : `scale(${s})`;
      }, [x!, y!, scale]);
    await caption(page, "Your agent looked into it before you opened the page.");
    await zoom(1.55);
    await until(19, "the agent's note");
    await zoom(1);
    await wait(950);
    // The app is no longer the box its fixed parts sit in.
    await page.evaluate(() => document.getElementById("root")!.removeAttribute("style"));
    await until(20, "zooming out");

    // 0:20 Ask why.
    await caption(page, "Ask your Watch thread in T3 Code, Claude Code or Codex for more.");
    await press(page, page.getByRole("button", { name: "Ask why" }).first());
    await page.getByText("Paste it into your Watch thread").first().waitFor();
    await until(25, "Ask why");

    // 0:25 A check the agent wrote, turned on.
    await caption(page, "Agents write new checks. You decide which ones run.");
    await press(page, page.getByRole("button", { name: "Turn on" }).first());
    await page.getByText("10 checks on").first().waitFor();
    // The row it was on is gone, so the pointer moves out of the way.
    await movePointer(page, 1150, 300);
    await until(32, "Turn on");

    // 0:32 The products and their checks.
    await caption(page, "CI, cloud accounts, API keys, sites and nightly jobs, found in your projects.");
    await press(page, page.getByRole("button", { name: "Show checks" }));
    await wait(900);
    const height = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    await glideScroll(page, Math.round(height * 0.45));
    await wait(2600);
    await glideScroll(page, height);
    await until(42, "the products");

    // 0:42 Details: the key and signed alerts, the Keys heading near the top.
    await press(page, page.getByText("Details", { exact: true }).last());
    await page.getByRole("button", { name: "Send a test alert" }).waitFor();
    await caption(page, "Keys stay on your machine. Alerts are signed.");
    const keys = await page.getByText("Keys (").first().evaluate((heading) => heading.getBoundingClientRect().top + window.scrollY);
    await glideScroll(page, Math.max(0, Math.round(keys - 40)));
    await wait(1600);
    // The demo sent a test of its own as it started, so the press shows only in its own answer.
    const answered = page.waitForResponse((response) => response.url().endsWith("/api/alerts/test") && response.ok());
    await press(page, page.getByRole("button", { name: "Send a test alert" }));
    await answered;
    await page.getByText("accepted a signed test alert").first().waitFor();
    await until(52, "Details");

    // 0:52 Ctrl-C stops the demo and removes its folder; then the closing card.
    await page.setContent(TERMINAL);
    await screen(`${prompt}${escape(COMMAND)}\n${printed}\n<span class="caret"></span>`);
    await caption(page, "Ctrl-C stops it and removes its folder.");
    await wait(1200);
    await stopDemo(demo);
    await screen(`${prompt}${escape(COMMAND)}\n${printed}\n^C\n${prompt}<span class="caret"></span>`);
    await until(55.5, "Ctrl-C");
    await page.evaluate(() => {
      document.getElementById("t3w-caption")!.classList.remove("on");
      document.getElementById("end")!.classList.add("on");
    });
    await until(LENGTH, "the closing card");
    const ended = now();
    capturing = false;
    await cdp.send("Page.stopScreencast");
    await Promise.all(writes);
    if (writeError !== null) throw new Error(`a frame could not be saved: ${String(writeError)}`);
    if (frames.length < 2) throw new Error("Chrome sent no frames");
    return { frames, ended, overruns };
  } finally {
    await browser.close().catch(() => undefined);
    live.closeBrowser = null;
  }
};

/** ffmpeg's concat list quotes a path in single quotes, and a quote inside it as '\''. */
const quoted = (path: string) => `'${path.replace(/'/g, "'\\''")}'`;

/** How long each frame holds: until Chrome painted the next, and the last until the recording ended. */
const durations = (frames: ReadonlyArray<Frame>, ended: number) =>
  frames.map((frame, i) => Math.max(0.001, i + 1 < frames.length ? frames[i + 1]!.at - frame.at : ended - frame.arrived));

const encode = (dir: string, frames: ReadonlyArray<Frame>, ended: number) => {
  const held = durations(frames, ended);
  const list = frames.map((frame, i) => `file ${quoted(frame.file)}\nduration ${held[i]!.toFixed(4)}`);
  writeFileSync(join(dir, "frames.txt"), `${list.join("\n")}\nfile ${quoted(frames.at(-1)!.file)}\n`);
  const run = (args: ReadonlyArray<string>) => {
    const result = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`ffmpeg failed: ${args.join(" ")}`);
  };
  // Made here first, so a failure leaves the README's pair as it was.
  const mp4 = join(dir, "demo.mp4");
  const gif = join(dir, "demo.gif");
  run(["-f", "concat", "-safe", "0", "-i", join(dir, "frames.txt"), "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-movflags", "+faststart", mp4]);
  // Fewer frames and colours than the video, since it plays at the top of the README; the MP4 is
  // still the sharper and the lighter of the two.
  run(["-i", mp4, "-vf", "fps=8,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle", "-loop", "0", gif]);
  return [mp4, gif].map((made) => {
    const into = join(root, "docs", made.slice(dir.length + 1));
    copyFileSync(made, into);
    return into;
  });
};

const dir = mkdtempSync(join(tmpdir(), "t3w-record-"));
// Stopped from outside, it still stops the demo, closes the browser and removes the frames.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
  process.once(signal, () => {
    console.error(`record-demo: ${signal}, stopping`);
    const child = live.child;
    void (child === null ? Promise.resolve() : stopDemo({ child, folder: live.folder }))
      .then(() => live.closeBrowser?.())
      .finally(() => {
        rmSync(dir, { recursive: true, force: true });
        process.exit(130);
      });
  });
try {
  const demo = await startDemo();
  const { frames, ended, overruns } = await play(demo, dir);
  for (const file of encode(dir, frames, ended)) console.log(`${file.slice(root.length)}: ${(statSync(file).size / 1e6).toFixed(1)} MB`);
  const length = durations(frames, ended).reduce((sum, held) => sum + held, 0);
  if (overruns.length > 0 || length > LENGTH + 2) console.error(`record-demo: the video runs ${length.toFixed(1)}s; ${overruns.join("; ") || "no scene overran"}`);
} catch (error) {
  console.error(`record-demo: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (live.child !== null) await stopDemo({ child: live.child, folder: live.folder });
  rmSync(dir, { recursive: true, force: true });
}
