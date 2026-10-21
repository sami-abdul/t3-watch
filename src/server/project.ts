/**
 * The Watch thread's own project in T3 Code: a folder with no code, so a thread there starts
 * without a repository's hooks, skills or memory, and its agent is not one step from editing it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { watchHome } from "./config.ts";
import { firstLine, type RunProc } from "./proc.ts";
import { t3Home } from "./providers.ts";

const within = (child: string, parent: string) => {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
};

/**
 * Where the folder lives: the platform's data folder, or a folder in home beside it, and never
 * inside Watch's own folder, which holds its keys and token, nor around it. Null when Watch's
 * folder holds the whole home folder, so nowhere is safe. A relative XDG_DATA_HOME is ignored, as
 * the XDG spec says.
 */
export const workspaceFolder = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env, home = homedir(), watchFolder = watchHome()) => {
  const xdg = env.XDG_DATA_HOME?.trim() ?? "";
  const data = isAbsolute(xdg) ? xdg : join(home, ".local", "share");
  const preferred = platform === "darwin" ? join(home, "Library", "Application Support", "t3-watch", "workspace") : join(data, "t3-watch", "workspace");
  return [preferred, join(home, ".t3-watch-workspace")].find((folder) => !within(folder, watchFolder) && !within(watchFolder, folder)) ?? null;
};

/** What Claude Code (CLAUDE.md) and Codex (AGENTS.md) read when a thread starts in the folder. */
export const WORKSPACE_NOTE = `# Watch

T3 Code keeps your Watch threads in this folder. It holds no code on purpose, so a thread here
starts without any repository's hooks, skills or memory.

In a Watch thread, use the t3-watch tools: start with watch_home, or watch_status for text. Code
fixes belong in a coding thread in that repository, ending in a pull request.
`;

/** How Watch's own notes begin, which marks a folder as Watch's even after it moved. */
const NOTE_MARK = WORKSPACE_NOTE.split("\n").slice(0, 3).join("\n");

const isWatchFolder = (root: string) =>
  ["AGENTS.md", "CLAUDE.md"].some((name) => {
    try {
      return readFileSync(join(root, name), "utf8").startsWith(NOTE_MARK);
    } catch {
      return false;
    }
  });

/** Makes the folder and its two notes, leaving notes that are already there as they are. */
export const writeWorkspace = (folder: string) => {
  mkdirSync(folder, { recursive: true });
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const file = join(folder, name);
    if (!existsSync(file)) writeFileSync(file, WORKSPACE_NOTE);
  }
};

/**
 * The folder of Watch's own project in T3 Code: a project titled Watch whose folder is this one,
 * or holds Watch's notes, the most recently updated first. Read from T3's own database without
 * writing. Null when there is none, or when the database cannot be read; install then asks T3,
 * which refuses a second project for the same folder. A project of the person's that happens to
 * be called Watch, such as a repository, is not it.
 */
export const existingWatchProject = (workspace: string, folder = t3Home()): string | null => {
  const file = join(folder, "userdata", "statev2.sqlite");
  if (!existsSync(file)) return null;
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      // T3 may be writing; wait out a short lock rather than miss a project and add a second.
      db.exec("PRAGMA busy_timeout = 5000");
      const rows = db
        .prepare("SELECT workspace_root FROM projection_projects WHERE title = 'Watch' AND deleted_at IS NULL ORDER BY updated_at DESC")
        .all() as Array<{ workspace_root?: unknown }>;
      const roots = rows.map((row) => row.workspace_root).filter((root): root is string => typeof root === "string");
      return roots.find((root) => resolve(root) === resolve(workspace) || isWatchFolder(root)) ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
};

const LOG_LINE = /^\[[^\]]+\]\s+(INFO|DEBUG|TRACE|WARN)\b/;

/** What went wrong, from T3's output past its startup logging and stack frames. */
const reason = (output: string) => {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    // Startup logs, stack frames and the brackets of logged objects say nothing about the failure.
    .filter((line) => !/^[[\]{}(),;'"\s]*$/.test(line) && !LOG_LINE.test(line) && !line.startsWith("at "));
  // T3's own ERROR line first, then an error's name, then the last thing it said.
  const pick = lines.find((l) => /\bERROR\b/.test(l)) ?? lines.find((l) => /\b\w*Error:/.test(l)) ?? lines.at(-1);
  const line = pick?.replace(/^\[[^\]]*\]\s*(ERROR\s*\(#\d+\):\s*)?/, "").trim();
  return line === undefined || line === "" ? null : line.slice(0, 200);
};

/**
 * Adds a project named Watch to T3 Code for the folder, making the folder first, and says how
 * that went. Nothing is written unless the t3 command answers as T3 Code's, and a Watch project
 * T3 already has, wherever its folder, is left as it is rather than joined by a second.
 */
export const makeWatchProject = async (run: RunProc, folder: string | null, lookup: (folder: string) => string | null = existingWatchProject) => {
  if (folder === null)
    return "T3 Code: Watch's own folder, T3_WATCH_HOME, holds your whole home folder, so there is no safe place for a Watch project. Give Watch a folder of its own.";
  const version = await run("t3", ["--version"], { timeoutMs: 30_000 });
  if (version.missing) return "T3 Code: not found, so there is no Watch project. With T3 Code installed, install adds one.";
  if (version.code !== 0 || !/^t3 v?\d/.test(version.stdout.trim()))
    return `T3 Code: the t3 command did not answer as T3 Code (${version.timedOut ? "no answer within 30 seconds" : firstLine(version.stderr || version.stdout) || `exit ${version.code}`}), so there is no Watch project.`;
  const existing = lookup(folder);
  if (existing !== null) {
    // A folder deleted outright comes back, so threads there still start; one that is there is
    // left as it is, notes and all.
    if (!existsSync(existing))
      try {
        writeWorkspace(existing);
      } catch {
        // T3 says what is wrong when a thread starts there.
      }
    return `T3 Code: the Watch project is already there, in ${existing}.`;
  }
  try {
    writeWorkspace(folder);
  } catch (error) {
    return `T3 Code: could not make the Watch folder at ${folder}: ${error instanceof Error ? error.message : String(error)}`;
  }
  // Only errors: T3's startup logging would bury the one line that matters.
  const result = await run("t3", ["project", "add", folder, "--title", "Watch", "--log-level", "error"], { timeoutMs: 60_000 });
  if (result.code === 0) return `T3 Code: added a project named Watch, in ${folder}. Start a thread there and say "Show me Watch".`;
  // A project for this folder under another name, renamed or added by hand: not added twice.
  if (/ProjectAlreadyExists/.test(`${result.stderr}\n${result.stdout}`)) return `T3 Code: T3 already has a project for ${folder}, so install added none.`;
  if (result.timedOut) return "T3 Code: t3 project add did not finish within a minute, so there may be no Watch project yet.";
  // T3 prints its errors on stdout; stderr is read too, for whatever runs it.
  return `T3 Code: could not add the Watch project: ${reason(`${result.stdout}\n${result.stderr}`) ?? `exit ${result.code}`}`;
};
