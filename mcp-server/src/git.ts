/**
 * "Save to Git" for the MCP bridge: writes a schematic export into a
 * configured git repository and commits it, so browsers that can't write
 * files directly (Safari, sandboxed panes) still get real version control.
 *
 * The repository is fixed at server start (EASYSCHEMATIC_GIT_REPO) — the app
 * can never choose a path, only a bare file name, which is sanitized to its
 * basename here. Nothing outside that one directory is ever touched.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const execFileAsync = promisify(execFile);

export interface GitSaveConfig {
  /** Absolute path of the working tree to save into. */
  repoDir: string;
  /** Optional subdirectory inside the repo (created on demand). */
  subdir?: string;
}

/** Strip anything path-like or hostile from a client-supplied file name. */
export function sanitizeFileName(name: string): string {
  const base = basename(name.trim())
    .replace(/[^a-zA-Z0-9-_ .]/g, "")
    .replace(/^\.+/, "") // no dotfiles / ".."
    .trim();
  const stem = base.replace(/\.json$/i, "") || "schematic";
  return `${stem}.json`;
}

async function git(repoDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repoDir, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

export async function saveToGit(
  config: GitSaveConfig,
  params: { fileName: string; json: string; message: string },
): Promise<{ path: string; commit: string | null }> {
  const repoDir = resolve(config.repoDir);

  // The directory must already be a git working tree — this tool commits,
  // it doesn't init repositories.
  try {
    const inside = await git(repoDir, ["rev-parse", "--is-inside-work-tree"]);
    if (inside !== "true") throw new Error("not a work tree");
  } catch {
    throw new Error(`${repoDir} is not a git repository (run "git init" there first).`);
  }

  if (typeof params.json !== "string" || params.json.length < 20) {
    throw new Error("Refusing to save: the export payload is empty.");
  }
  const message = String(params.message || "").trim() || "Update schematic";

  const fileName = sanitizeFileName(String(params.fileName || ""));
  const dir = config.subdir ? join(repoDir, config.subdir) : repoDir;
  // Belt-and-braces: the resolved target must stay inside the repo.
  const target = resolve(join(dir, fileName));
  if (!target.startsWith(repoDir + "/") && target !== join(repoDir, fileName)) {
    throw new Error("Refusing to save outside the configured repository.");
  }

  await mkdir(dir, { recursive: true });
  await writeFile(target, params.json, "utf8");

  await git(repoDir, ["add", "--", target]);

  // Identical content = nothing staged; report that honestly instead of
  // creating an empty commit.
  const staged = await git(repoDir, ["diff", "--cached", "--name-only", "--", target]);
  if (!staged) return { path: target, commit: null };

  await git(repoDir, ["commit", "-m", message, "--", target]);
  const commit = await git(repoDir, ["rev-parse", "--short", "HEAD"]);
  return { path: target, commit };
}
