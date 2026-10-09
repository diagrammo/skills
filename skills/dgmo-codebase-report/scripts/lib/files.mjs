// @ts-check
// The repo's files: which ones count, how big each is, and what language it is in.
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { gitLines } from './git.mjs';

/**
 * Directories skipped when there is no git to read .gitignore from. With git,
 * `git ls-files` decides, so a committed `vendor/` is measured like any code.
 */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'target',
  'vendor',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  '.turbo',
  '.cache',
]);

/** Extension → language. Files whose extension is not here are counted as unclassified. */
const LANGUAGES = new Map([
  ['.ts', 'TypeScript'],
  ['.tsx', 'TypeScript'],
  ['.mts', 'TypeScript'],
  ['.cts', 'TypeScript'],
  ['.js', 'JavaScript'],
  ['.jsx', 'JavaScript'],
  ['.mjs', 'JavaScript'],
  ['.cjs', 'JavaScript'],
  ['.py', 'Python'],
  ['.go', 'Go'],
  ['.rs', 'Rust'],
  ['.java', 'Java'],
  ['.kt', 'Kotlin'],
  ['.swift', 'Swift'],
  ['.rb', 'Ruby'],
  ['.php', 'PHP'],
  ['.c', 'C'],
  ['.h', 'C'],
  ['.cc', 'C++'],
  ['.cpp', 'C++'],
  ['.hpp', 'C++'],
  ['.cs', 'C#'],
  ['.ex', 'Elixir'],
  ['.exs', 'Elixir'],
  ['.sh', 'Shell'],
  ['.bash', 'Shell'],
  ['.sql', 'SQL'],
  ['.html', 'HTML'],
  ['.css', 'CSS'],
  ['.scss', 'CSS'],
  ['.vue', 'Vue'],
  ['.svelte', 'Svelte'],
  ['.astro', 'Astro'],
  ['.md', 'Markdown'],
  ['.mdx', 'Markdown'],
  ['.json', 'JSON'],
  ['.yaml', 'YAML'],
  ['.yml', 'YAML'],
  ['.toml', 'TOML'],
  ['.dgmo', 'DGMO'],
]);

/** @param {string} path */
export function languageOf(path) {
  return LANGUAGES.get(extname(path).toLowerCase()) ?? null;
}

/**
 * @typedef {object} FileInfo
 * @property {string} path      repo-relative, `/`-separated
 * @property {number} bytes
 * @property {number | null} lines  null for a binary file
 * @property {string | null} language
 */

/**
 * Every file the report measures, sorted by path. With git, the tracked files;
 * without it, a walk that skips {@link SKIP_DIRS}.
 * @param {string} root
 * @param {boolean} hasGit
 * @returns {FileInfo[]}
 */
export function listFiles(root, hasGit) {
  // A Set: mid-merge, ls-files lists a conflicted path once per stage.
  const paths = new Set(hasGit ? gitLines(root, ['ls-files', '-z'], '\0') : walk(root, root));
  /** @type {FileInfo[]} */
  const files = [];
  for (const path of paths) {
    const full = join(root, path);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue; // tracked but deleted in the working tree
    }
    if (!stat.isFile()) continue; // a submodule is listed as a directory
    files.push({ path, bytes: stat.size, lines: countLines(full), language: languageOf(path) });
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * @param {string} root
 * @param {string} dir
 * @returns {string[]}
 */
function walk(root, dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walk(root, full));
    } else if (entry.isFile()) {
      out.push(relative(root, full).split(sep).join('/'));
    }
  }
  return out;
}

/**
 * Line count, or null when the first 8 KB hold a NUL byte (git's own binary test).
 * @param {string} path
 */
function countLines(path) {
  const head = Buffer.alloc(8192);
  const fd = openSync(path, 'r');
  let read;
  try {
    read = readSync(fd, head, 0, head.length, 0);
  } finally {
    closeSync(fd);
  }
  if (head.subarray(0, read).includes(0)) return null;
  const text = readFileSync(path, 'utf8');
  if (text.length === 0) return 0;
  let lines = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  return text.endsWith('\n') ? lines : lines + 1;
}
