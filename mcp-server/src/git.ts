/**
 * Per-project git integration for the MCP bridge.
 *
 * The server is started with a ROOT directory (EASYSCHEMATIC_GIT_ROOT — e.g.
 * ~/repos) under which each project keeps its own repository. The app can:
 *   - list schematic .json files found inside git repos under the root,
 *   - open one (the server then knows exactly which repo/path it came from),
 *   - save back to an opened file's ref — written in place and committed in
 *     THAT file's repository.
 *
 * Different users clone repos to different paths; each user's server is
 * simply started with their own root, so refs stay root-relative and the
 * app never sees or supplies an absolute path. Every ref is sanitized and
 * pinned inside the root.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, readdir, stat, open } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const execFileAsync = promisify(execFile);

export interface GitConfig {
  /** Absolute path of the directory that holds the project repositories
   *  (or is itself a repository). */
  root: string;
  /** Legacy: subdirectory for ref-less first-time saves. */
  subdir?: string;
}

const MAX_LIST_FILES = 500;
const MAX_WALK_DEPTH = 5;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);

/** Strip anything path-like or hostile from a client-supplied file name. */
export function sanitizeFileName(name: string): string {
  const base = basename(name.trim())
    .replace(/[^a-zA-Z0-9-_ .]/g, "")
    .replace(/^\.+/, "")
    .trim();
  const stem = base.replace(/\.json$/i, "") || "schematic";
  return `${stem}.json`;
}

/** Resolve a root-relative ref to an absolute path, refusing anything that
 *  escapes the root or isn't a .json file. */
export function safeResolveRef(root: string, ref: string): string {
  const cleaned = String(ref).replace(/\\/g, "/");
  if (!cleaned || cleaned.includes("..") || cleaned.startsWith("/") || /^[a-zA-Z]:/.test(cleaned)) {
    throw new Error("Invalid file reference.");
  }
  if (!/\.json$/i.test(cleaned)) throw new Error("Only .json schematic files can be opened.");
  const abs = resolve(join(root, cleaned));
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error("Refusing to touch a file outside the configured root.");
  }
  return abs;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

/** Working-tree top level for the repo containing `dir`, or null. */
async function repoTopLevel(dir: string): Promise<string | null> {
  try {
    return await git(dir, ["rev-parse", "--show-toplevel"]);
  } catch {
    return null;
  }
}

/** Cheap "is this a schematic export?" sniff: reads the head of the file and
 *  looks for the version field, so package.json and friends stay out of the
 *  picker without parsing multi-MB documents. */
async function looksLikeSchematicFile(path: string): Promise<boolean> {
  let fh;
  try {
    fh = await open(path, "r");
    const buf = Buffer.alloc(512);
    const { bytesRead } = await fh.read(buf, 0, 512, 0);
    const head = buf.subarray(0, bytesRead).toString("utf8");
    return head.trimStart().startsWith("{") && /"version"\s*:/.test(head);
  } catch {
    return false;
  } finally {
    await fh?.close();
  }
}

export interface GitFileEntry {
  ref: string;
  repo: string;
  name: string;
  modifiedAt: string;
}

/** Walk the root for schematic files that live inside git repositories. */
export async function listGitSchematics(config: GitConfig): Promise<{ root: string; files: GitFileEntry[] }> {
  const root = resolve(config.root);
  const files: GitFileEntry[] = [];
  const repoCache = new Map<string, string | null>();

  const repoFor = async (dir: string): Promise<string | null> => {
    const hit = repoCache.get(dir);
    if (hit !== undefined) return hit;
    const top = await repoTopLevel(dir);
    repoCache.set(dir, top);
    return top;
  };

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_WALK_DEPTH || files.length >= MAX_LIST_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_LIST_FILES) return;
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && /\.json$/i.test(entry.name)) {
        const repo = await repoFor(dir);
        if (!repo) continue; // only version-controlled files appear in the picker
        if (!(await looksLikeSchematicFile(full))) continue;
        const st = await stat(full).catch(() => null);
        files.push({
          ref: relative(root, full).split(sep).join("/"),
          repo: relative(root, repo).split(sep).join("/") || ".",
          name: entry.name.replace(/\.json$/i, ""),
          modifiedAt: st ? st.mtime.toISOString() : new Date(0).toISOString(),
        });
      }
    }
  };

  await walk(root, 0);
  files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return { root, files };
}

const MAX_OPEN_BYTES = 50 * 1024 * 1024;

export async function openGitFile(config: GitConfig, ref: string): Promise<{ ref: string; json: string }> {
  const root = resolve(config.root);
  const abs = safeResolveRef(root, ref);
  const st = await stat(abs).catch(() => null);
  if (!st?.isFile()) throw new Error(`No such file under the git root: ${ref}`);
  if (st.size > MAX_OPEN_BYTES) throw new Error("File too large to open (max 50 MB).");
  const json = await readFile(abs, "utf8");
  return { ref, json };
}

export async function saveToGit(
  config: GitConfig,
  params: { ref?: string; fileName: string; json: string; message: string },
): Promise<{ path: string; ref: string; commit: string | null }> {
  const root = resolve(config.root);

  if (typeof params.json !== "string" || params.json.length < 20) {
    throw new Error("Refusing to save: the export payload is empty.");
  }
  const message = String(params.message || "").trim() || "Update schematic";

  // Ref mode: save exactly where the file was opened from. Ref-less mode:
  // first-time save into the root (optionally a configured subdirectory).
  let target: string;
  if (params.ref) {
    target = safeResolveRef(root, params.ref);
  } else {
    const fileName = sanitizeFileName(String(params.fileName || ""));
    const dir = config.subdir ? join(root, config.subdir) : root;
    target = resolve(join(dir, fileName));
    if (target !== join(root, fileName) && !target.startsWith(root + sep)) {
      throw new Error("Refusing to save outside the configured root.");
    }
    await mkdir(dir, { recursive: true });
  }

  await writeFile(target, params.json, "utf8");

  // Commit in the repository that actually contains the file — each project
  // keeps its own repo, so this varies per file.
  const repoDir = await repoTopLevel(dirname(target));
  if (!repoDir) {
    throw new Error(
      `${dirname(target)} is not inside a git repository — create one there ("git init") or open the file via Open from Git.`,
    );
  }

  const ref = relative(root, target).split(sep).join("/");
  await git(repoDir, ["add", "--", target]);
  const staged = await git(repoDir, ["diff", "--cached", "--name-only", "--", target]);
  if (!staged) return { path: target, ref, commit: null };

  await git(repoDir, ["commit", "-m", message, "--", target]);
  const commit = await git(repoDir, ["rev-parse", "--short", "HEAD"]);
  return { path: target, ref, commit };
}
