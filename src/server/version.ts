import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The version in the package.json at `root`, or null when it cannot be read or is blank. */
export const readPackageVersion = (root: string): string | null => {
  try {
    const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown }).version;
    return typeof version === "string" && version.trim() !== "" ? version.trim() : null;
  } catch {
    return null;
  }
};

/**
 * The package's own version, so neither the server nor the inline view it serves reports one
 * release while running another. A package.json it cannot read does not stop the server; it says
 * so with 0.0.0.
 */
export const packageVersion = (root: string) => readPackageVersion(root) ?? "0.0.0";
