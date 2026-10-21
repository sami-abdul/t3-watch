import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { projectStaysLine } from "./cli.ts";
import type { ProcResult } from "./proc.ts";
import { existingWatchProject, makeWatchProject, WORKSPACE_NOTE, workspaceFolder, writeWorkspace } from "./project.ts";

/** No Watch project in T3 yet, without reading this machine's real T3 database. */
const none = () => null;

const dirs: Array<string> = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "t3w-project-"));
  dirs.push(dir);
  return dir;
};

/** A fake t3 CLI: answers --version as T3 does unless told otherwise, and project add as given. */
const t3 = (add: Partial<ProcResult>, options: { missing?: boolean; version?: Partial<ProcResult> } = {}) => {
  const calls: Array<string> = [];
  const run = async (command: string, args: ReadonlyArray<string>) => {
    calls.push([command, ...args].join(" "));
    const base = { code: 0, stdout: "", stderr: "", missing: false, timedOut: false };
    if (options.missing === true) return { ...base, code: null, missing: true } as ProcResult;
    if (args[0] === "--version") return { ...base, stdout: "t3 v0.1.1-nightly.20261019.3360\n", ...options.version } as ProcResult;
    return { ...base, ...add } as ProcResult;
  };
  return { calls, run };
};

describe("the Watch project's folder", () => {
  it("lives in the platform's data folder, outside Watch's own", () => {
    const watch = "/home/u/.t3-watch";
    expect(workspaceFolder("linux", {}, "/home/u", watch)).toBe("/home/u/.local/share/t3-watch/workspace");
    expect(workspaceFolder("linux", { XDG_DATA_HOME: "/srv/data" }, "/home/u", watch)).toBe("/srv/data/t3-watch/workspace");
    // The XDG spec ignores a relative XDG_DATA_HOME.
    expect(workspaceFolder("linux", { XDG_DATA_HOME: "data" }, "/home/u", watch)).toBe("/home/u/.local/share/t3-watch/workspace");
    expect(workspaceFolder("darwin", {}, "/Users/u", "/Users/u/.t3-watch")).toBe("/Users/u/Library/Application Support/t3-watch/workspace");
    // Never inside the folder that holds Watch's keys, nor around it.
    expect(workspaceFolder("linux", {}, "/home/u", "/home/u/.local/share/t3-watch")).toBe("/home/u/.t3-watch-workspace");
    expect(workspaceFolder("linux", {}, "/home/u", "/home/u/.local/share/t3-watch/workspace/keys")).toBe("/home/u/.t3-watch-workspace");
    // A folder whose name starts with two dots is still inside its parent.
    expect(workspaceFolder("linux", { XDG_DATA_HOME: "/srv/..data" }, "/home/u", "/srv")).toBe("/home/u/.t3-watch-workspace");
    // Watch's folder holding the whole home leaves nowhere safe.
    expect(workspaceFolder("linux", {}, "/home/u", "/home")).toBeNull();
  });

  it("gets its two notes once, keeping any the person edited", () => {
    const folder = join(scratch(), "workspace");
    writeWorkspace(folder);
    expect(readFileSync(join(folder, "AGENTS.md"), "utf8")).toBe(WORKSPACE_NOTE);
    expect(readFileSync(join(folder, "CLAUDE.md"), "utf8")).toBe(WORKSPACE_NOTE);
    writeFileSync(join(folder, "CLAUDE.md"), "My own notes\n");
    writeWorkspace(folder);
    expect(readFileSync(join(folder, "CLAUDE.md"), "utf8")).toBe("My own notes\n");
  });
});

describe("the Watch project in T3", () => {
  it("is found in T3's own database, read only, by its folder or Watch's note, not by title alone", () => {
    const t3Home = scratch();
    const ours = join(scratch(), "workspace");
    expect(existingWatchProject(ours, t3Home)).toBeNull();
    mkdirSync(join(t3Home, "userdata"));
    const file = join(t3Home, "userdata", "statev2.sqlite");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE projection_projects (project_id TEXT, title TEXT, workspace_root TEXT, updated_at TEXT, deleted_at TEXT)");
    const add = (id: string, root: string, updated: string, deleted: string | null = null) =>
      db.prepare("INSERT INTO projection_projects VALUES (?, 'Watch', ?, ?, ?)").run(id, root, updated, deleted);
    // A repository the person named Watch is not Watch's project.
    const repo = scratch();
    writeFileSync(join(repo, "AGENTS.md"), "# My watchOS app\n");
    add("repo", repo, "2026-10-21T10:00:00Z");
    add("gone", ours, "2026-10-21T09:00:00Z", "2026-10-21T09:30:00Z");
    expect(existingWatchProject(ours, t3Home)).toBeNull();
    // Its own folder counts even with the folder missing; a moved one counts by its note.
    add("own", ours, "2026-10-21T08:00:00Z");
    expect(existingWatchProject(ours, t3Home)).toBe(ours);
    const moved = scratch();
    writeWorkspace(moved);
    add("moved", moved, "2026-10-21T11:00:00Z");
    expect(existingWatchProject(ours, t3Home)).toBe(moved);
    db.close();
    writeFileSync(file, "not a database");
    expect(existingWatchProject(ours, t3Home)).toBeNull();
  });

  it("is added once, with each outcome said plainly", async () => {
    const folder = join(scratch(), "workspace");
    const added = t3({ code: 0 });
    expect(await makeWatchProject(added.run, folder, none)).toBe(`T3 Code: added a project named Watch, in ${folder}. Start a thread there and say "Show me Watch".`);
    expect(added.calls).toEqual(["t3 --version", `t3 project add ${folder} --title Watch --log-level error`]);
    expect(existsSync(join(folder, "AGENTS.md"))).toBe(true);
    // Already in T3, wherever its folder: no second project, and a deleted note comes back.
    const elsewhere = join(scratch(), "workspace");
    const known = t3({ code: 0 });
    expect(await makeWatchProject(known.run, folder, () => elsewhere)).toBe(`T3 Code: the Watch project is already there, in ${elsewhere}.`);
    expect(known.calls).toEqual(["t3 --version"]);
    expect(readFileSync(join(elsewhere, "CLAUDE.md"), "utf8")).toBe(WORKSPACE_NOTE);
    // A folder deleted outright comes back; one that is there keeps its notes as the person left them.
    rmSync(elsewhere, { recursive: true });
    await makeWatchProject(t3({ code: 0 }).run, folder, () => elsewhere);
    expect(readFileSync(join(elsewhere, "AGENTS.md"), "utf8")).toBe(WORKSPACE_NOTE);
    rmSync(join(elsewhere, "CLAUDE.md"));
    await makeWatchProject(t3({ code: 0 }).run, folder, () => elsewhere);
    expect(existsSync(join(elsewhere, "CLAUDE.md"))).toBe(false);
    // T3's own words, on stdout as the real CLI prints them.
    const already = t3({ code: 1, stdout: `[20:37:48.173] ERROR (#1): ProjectAlreadyExistsError: An active project already exists for '${folder}'.\n    at file:///t3:1:1` });
    expect(await makeWatchProject(already.run, folder, none)).toBe(`T3 Code: T3 already has a project for ${folder}, so install added none.`);
    const locked = t3({
      code: 1,
      stdout: "[20:37:46.737] INFO (#20): Migrations ran successfully {\n  migrations: [ '4_ErrorEvents' ]\n}\n[20:37:48.173] ERROR (#1): DatabaseLockedError: the state database is locked\n    at x",
    });
    expect(await makeWatchProject(locked.run, folder, none)).toBe("T3 Code: could not add the Watch project: DatabaseLockedError: the state database is locked");
    // A reason without the word error still comes through; nothing at all gives the exit code.
    const denied = t3({ code: 1, stdout: "[20:37:46.737] INFO (#20): Migrations ran successfully {\n  migrations: [ '1_A' ]\n}", stderr: "EACCES: permission denied, open '/home/u/.t3/userdata/statev2.sqlite'" });
    expect(await makeWatchProject(denied.run, folder, none)).toBe("T3 Code: could not add the Watch project: EACCES: permission denied, open '/home/u/.t3/userdata/statev2.sqlite'");
    expect(await makeWatchProject(t3({ code: 2 }).run, folder, none)).toBe("T3 Code: could not add the Watch project: exit 2");
    expect(await makeWatchProject(t3({ code: null, timedOut: true }).run, folder, none)).toContain("did not finish within a minute");
  });

  it("writes nothing unless the t3 command answers as T3 Code", async () => {
    const folder = join(scratch(), "workspace");
    const missing = t3({}, { missing: true });
    expect(await makeWatchProject(missing.run, folder, none)).toBe("T3 Code: not found, so there is no Watch project. With T3 Code installed, install adds one.");
    expect(missing.calls).toEqual(["t3 --version"]);
    const other = t3({}, { version: { stdout: "Usage: t3 [OPTIONS] FILE\n" } });
    expect(await makeWatchProject(other.run, folder, none)).toBe("T3 Code: the t3 command did not answer as T3 Code (Usage: t3 [OPTIONS] FILE), so there is no Watch project.");
    expect(await makeWatchProject(t3({}, { version: { code: null, timedOut: true } }).run, folder, none)).toContain("no answer within 30 seconds");
    expect(existsSync(folder)).toBe(false);
  });

  it("says when there is no safe folder for it", async () => {
    const { calls, run } = t3({ code: 0 });
    expect(await makeWatchProject(run, null, none)).toContain("there is no safe place for a Watch project");
    expect(calls).toEqual([]);
  });

  it("says so when the folder cannot be made, and goes on", async () => {
    const blocker = join(scratch(), "a-file");
    writeFileSync(blocker, "");
    const { calls, run } = t3({ code: 0 });
    expect(await makeWatchProject(run, join(blocker, "workspace"), none)).toMatch(/^T3 Code: could not make the Watch folder at .*a-file\/workspace: /);
    expect(calls).toEqual(["t3 --version"]);
  });

  it("is left by uninstall, which says what stays and how to remove the project", () => {
    expect(projectStaysLine(null, null)).toBeNull();
    expect(projectStaysLine(null, "/home/u/ws", () => false)).toBeNull();
    expect(projectStaysLine(null, "/home/u/ws", () => true)).toBe("T3 Code: the Watch folder stays, at /home/u/ws.");
    // T3 removes a project with threads only with --force, which deletes the threads too.
    expect(projectStaysLine("/home/u/Watch Threads", "/home/u/ws")).toBe(
      "T3 Code: the Watch project stays, with its threads and its folder, /home/u/Watch Threads. To delete the project and its threads: t3 project remove --force '/home/u/Watch Threads'",
    );
  });
});
