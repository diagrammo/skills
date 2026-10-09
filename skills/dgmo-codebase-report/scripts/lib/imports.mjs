// @ts-check
// The import graph for TypeScript/JavaScript, Python, Go and Rust: which repo
// file (or Go package) each file reaches, and which outside packages it uses.
// Read with regular expressions, not parsers — good enough to draw, and it
// needs no toolchain for any of the four languages.
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, posix } from 'node:path';

const JS_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

// Python's standard library is not told apart from its dependencies: knowing
// it needs a Python, and a report that lists `os` among the externals is still true.

/** @param {string} path */
export function importLanguage(path) {
  const ext = posix.extname(path).toLowerCase();
  if (JS_EXTS.includes(ext)) return 'js';
  if (ext === '.py') return 'python';
  if (ext === '.go') return 'go';
  if (ext === '.rs') return 'rust';
  return null;
}

/**
 * @typedef {object} ImportGraph
 * @property {{ from: string, to: string, toPackage: boolean }[]} edges
 *   `to` is a file, or — `toPackage` — the directory of a Go package
 * @property {Map<string, number>} external        outside package → number of files importing it
 * @property {number} unresolved                   relative imports that matched no file
 */

/**
 * @param {string} root
 * @param {string[]} paths  every measured file, repo-relative
 * @returns {ImportGraph}
 */
export function buildImportGraph(root, paths) {
  const files = new Set(paths);
  const goModules = readGoModules(root, paths);
  const goDirs = new Set(paths.filter((path) => path.endsWith('.go')).map((path) => posix.dirname(path)));
  /** @type {Map<string, { from: string, to: string, toPackage: boolean }>} */
  const edges = new Map();
  /** @type {Map<string, number>} */
  const external = new Map();
  let unresolved = 0;

  for (const path of paths) {
    const language = importLanguage(path);
    if (!language) continue;
    let source;
    try {
      source = readFileSync(join(root, path), 'utf8');
    } catch {
      continue;
    }
    const found =
      language === 'js'
        ? jsImports(path, source, files)
        : language === 'python'
          ? pythonImports(path, source, files)
          : language === 'go'
            ? goImports(source, goDirs, goModules)
            : rustImports(path, source, files);
    for (const to of found.internal) {
      if (to !== path) edges.set(`${path}\0${to}`, { from: path, to, toPackage: language === 'go' });
    }
    for (const name of new Set(found.external)) external.set(name, (external.get(name) ?? 0) + 1);
    unresolved += found.unresolved;
  }
  return { edges: [...edges.values()], external, unresolved };
}

/**
 * @typedef {{ internal: string[], external: string[], unresolved: number }} Found
 */

// ---------------------------------------------------------------- JS / TS

const JS_SPECIFIERS = [
  /\bimport\s+(?:type\s+)?[\w*${}\s,]*?\s*from\s*['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?[\w*${}\s,]*?\s*from\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/**
 * @param {string} path
 * @param {string} source
 * @param {Set<string>} files
 * @returns {Found}
 */
export function jsImports(path, source, files) {
  /** @type {Found} */
  const found = { internal: [], external: [], unresolved: 0 };
  const specifiers = new Set();
  for (const pattern of JS_SPECIFIERS) {
    for (const match of source.matchAll(pattern)) if (match[1]) specifiers.add(match[1]);
  }
  for (const spec of specifiers) {
    // A regex reads strings too; anything that cannot be a module name is not one.
    if (!/^[@~\w./][\w@./:+~-]*$/.test(spec)) continue;
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const target = resolveJs(posix.join(posix.dirname(path), spec), files);
      if (target) found.internal.push(target);
      else found.unresolved++;
    } else if (spec.startsWith('@/') || spec.startsWith('~/')) {
      // The usual source-root alias (Next.js, Vite, shadcn): never a package.
      // Tried against `src/`, then the root; tsconfig `paths` are not read.
      const rest = spec.slice(2);
      const target = resolveJs(posix.join('src', rest), files) ?? resolveJs(rest, files);
      if (target) found.internal.push(target);
      else found.unresolved++;
    } else if (!spec.startsWith('node:') && !builtinModules.includes(spec.split('/')[0] ?? spec)) {
      // `@scope/pkg/sub` → `@scope/pkg`; `pkg/sub` → `pkg`.
      const parts = spec.split('/');
      found.external.push(spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec));
    }
  }
  return found;
}

/**
 * A relative specifier to the file it names: as written, with an extension
 * added, with a `.js` written for a `.ts` source (TypeScript's ESM rule), or
 * a directory's index file.
 * @param {string} base
 * @param {Set<string>} files
 */
function resolveJs(base, files) {
  const candidates = [base];
  const ext = posix.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  if (ext === '.js' || ext === '.jsx') candidates.push(`${stem}.ts`, `${stem}.tsx`);
  if (ext === '.mjs') candidates.push(`${stem}.mts`);
  if (ext === '.cjs') candidates.push(`${stem}.cts`);
  for (const e of JS_EXTS) candidates.push(`${base}${e}`);
  for (const e of JS_EXTS) candidates.push(`${base}/index${e}`);
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

// ---------------------------------------------------------------- Python

/**
 * @param {string} path
 * @param {string} source
 * @param {Set<string>} files
 * @returns {Found}
 */
export function pythonImports(path, source, files) {
  /** @type {Found} */
  const found = { internal: [], external: [], unresolved: 0 };
  const packageDir = posix.dirname(path);
  // Module roots an absolute import can start from: the repo root, `src/`,
  // and the directory above the file's top package.
  const roots = new Set(['.', 'src', topPackageParent(path, files)]);

  for (const match of source.matchAll(/^\s*from\s+(\.*)([\w.]*)\s+import\s+\(?([^)\n]*)/gm)) {
    const dots = match[1]?.length ?? 0;
    const module = match[2] ?? '';
    const names = (match[3] ?? '').split(',').map((name) => name.trim().split(/\s+/)[0] ?? '').filter(Boolean);
    if (dots > 0) {
      let dir = packageDir;
      for (let i = 1; i < dots; i++) dir = posix.dirname(dir);
      const base = module ? posix.join(dir, ...module.split('.')) : dir;
      const hit = resolvePython(base, names, files);
      if (hit.length) found.internal.push(...hit);
      else found.unresolved++;
    } else {
      const hit = resolvePythonAbsolute(module, names, roots, files);
      if (hit.length) found.internal.push(...hit);
      else found.external.push(module.split('.')[0] ?? module);
    }
  }
  for (const match of source.matchAll(/^\s*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/gm)) {
    for (const part of (match[1] ?? '').split(',')) {
      const module = part.trim().split(/\s+/)[0] ?? '';
      const hit = resolvePythonAbsolute(module, [], roots, files);
      if (hit.length) found.internal.push(...hit);
      else found.external.push(module.split('.')[0] ?? module);
    }
  }
  return found;
}

/**
 * The directory holding the outermost package (a run of `__init__.py`
 * directories) that contains `path`.
 * @param {string} path
 * @param {Set<string>} files
 */
function topPackageParent(path, files) {
  let dir = posix.dirname(path);
  while (dir !== '.' && files.has(posix.join(dir, '__init__.py'))) dir = posix.dirname(dir);
  return dir;
}

/**
 * @param {string} module
 * @param {string[]} names
 * @param {Set<string>} roots
 * @param {Set<string>} files
 */
function resolvePythonAbsolute(module, names, roots, files) {
  if (!module) return [];
  for (const root of roots) {
    const hit = resolvePython(posix.join(root, ...module.split('.')), names, files);
    if (hit.length) return hit;
  }
  return [];
}

/**
 * `from base import a, b`: each name that is a submodule file, else the module itself.
 * @param {string} base
 * @param {string[]} names
 * @param {Set<string>} files
 */
function resolvePython(base, names, files) {
  /** @type {string[]} */
  const hits = [];
  for (const name of names) {
    const sub = moduleFile(posix.join(base, name), files);
    if (sub) hits.push(sub);
  }
  if (hits.length < names.length || names.length === 0) {
    const self = moduleFile(base, files);
    if (self) hits.push(self);
  }
  return hits;
}

/**
 * @param {string} base
 * @param {Set<string>} files
 */
function moduleFile(base, files) {
  const normal = posix.normalize(base);
  if (files.has(`${normal}.py`)) return `${normal}.py`;
  if (files.has(`${normal}/__init__.py`)) return `${normal}/__init__.py`;
  return null;
}

// ---------------------------------------------------------------- Go

/**
 * Every go.mod's module path and the directory it is rooted in, longest path
 * first so a nested module wins over the one above it.
 * @param {string} root
 * @param {string[]} paths
 * @returns {{ module: string, dir: string }[]}
 */
function readGoModules(root, paths) {
  const modules = [];
  for (const path of paths) {
    if (posix.basename(path) !== 'go.mod') continue;
    let text;
    try {
      text = readFileSync(join(root, path), 'utf8');
    } catch {
      continue;
    }
    const match = /^module\s+(\S+)/m.exec(text);
    if (match?.[1]) modules.push({ module: match[1], dir: posix.dirname(path) });
  }
  return modules.sort((a, b) => b.module.length - a.module.length);
}

/**
 * Go imports packages, not files, so an internal edge ends at the package's directory.
 * @param {string} source
 * @param {Set<string>} goDirs  every directory holding a .go file
 * @param {{ module: string, dir: string }[]} modules  from {@link readGoModules}
 * @returns {Found}
 */
export function goImports(source, goDirs, modules) {
  /** @type {Found} */
  const found = { internal: [], external: [], unresolved: 0 };
  /** @type {string[]} */
  const specs = [];
  for (const block of source.matchAll(/^import\s*\(([\s\S]*?)\)/gm)) {
    for (const line of (block[1] ?? '').matchAll(/"([^"]+)"/g)) if (line[1]) specs.push(line[1]);
  }
  for (const single of source.matchAll(/^import\s+(?:[\w.]+\s+)?"([^"]+)"/gm)) if (single[1]) specs.push(single[1]);

  for (const spec of specs) {
    const owner = modules.find(({ module }) => spec === module || spec.startsWith(`${module}/`));
    if (owner) {
      const dir = posix.join(owner.dir, spec.slice(owner.module.length + 1));
      if (goDirs.has(dir)) found.internal.push(dir);
      else found.unresolved++;
    } else if (spec.includes('.') && spec.split('/')[0]?.includes('.')) {
      // A host-qualified path (github.com/x/y) is a dependency; record the module root.
      found.external.push(spec.split('/').slice(0, 3).join('/'));
    }
    // Anything else (fmt, net/http) is the standard library and is left out.
  }
  return found;
}

// ---------------------------------------------------------------- Rust

/**
 * `mod x;` declarations and `use crate::/super::/self::` paths, resolved to
 * module files. Paths starting with any other crate name are dependencies.
 * @param {string} path
 * @param {string} source
 * @param {Set<string>} files
 * @returns {Found}
 */
export function rustImports(path, source, files) {
  /** @type {Found} */
  const found = { internal: [], external: [], unresolved: 0 };
  const moduleDir = rustModuleDir(path);
  const crateRoot = rustCrateRoot(path, files);

  for (const match of source.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm)) {
    const target = rustModuleFile(posix.join(moduleDir, match[1] ?? ''), files);
    if (target) found.internal.push(target);
    else found.unresolved++;
  }
  for (const match of source.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([\w:]+)/gm)) {
    const segments = (match[1] ?? '').split('::').filter(Boolean);
    const head = segments.shift();
    let dir;
    if (head === 'crate') dir = crateRoot;
    else if (head === 'self') dir = moduleDir;
    else if (head === 'super') {
      dir = posix.dirname(moduleDir);
      while (segments[0] === 'super') {
        segments.shift();
        dir = posix.dirname(dir);
      }
    } else if (head && rustModuleFile(posix.join(moduleDir, head), files)) {
      // A 2018-edition path may start with a module in scope: `use greet::x`.
      dir = moduleDir;
      segments.unshift(head);
    } else {
      if (head && !['std', 'core', 'alloc'].includes(head)) found.external.push(head);
      continue;
    }
    if (dir === null) continue;
    // Walk the path as far as module files exist; the deepest one is the edge.
    let target = null;
    for (const segment of segments) {
      const next = rustModuleFile(posix.join(dir, segment), files);
      if (!next) break;
      target = next;
      dir = posix.join(dir, segment);
    }
    if (target) found.internal.push(target);
  }
  return found;
}

/**
 * The directory a file's child modules live in: beside `main.rs`, `lib.rs`
 * and `mod.rs`, otherwise in a directory named after the file.
 * @param {string} path
 */
function rustModuleDir(path) {
  const name = posix.basename(path);
  if (name === 'main.rs' || name === 'lib.rs' || name === 'mod.rs') return posix.dirname(path);
  return path.slice(0, -'.rs'.length);
}

/**
 * The directory of the crate root (`lib.rs` or `main.rs`) above `path`.
 * @param {string} path
 * @param {Set<string>} files
 */
function rustCrateRoot(path, files) {
  let dir = posix.dirname(path);
  for (;;) {
    if (files.has(posix.join(dir, 'lib.rs')) || files.has(posix.join(dir, 'main.rs'))) return dir;
    if (dir === '.' || dir === '') return null;
    dir = posix.dirname(dir);
  }
}

/**
 * @param {string} base
 * @param {Set<string>} files
 */
function rustModuleFile(base, files) {
  const normal = posix.normalize(base);
  if (files.has(`${normal}.rs`)) return `${normal}.rs`;
  if (files.has(`${normal}/mod.rs`)) return `${normal}/mod.rs`;
  return null;
}
