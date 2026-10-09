#!/usr/bin/env node
// @ts-check
// Measure a repo for the codebase report: file sizes, languages, git history,
// edit frequency, the import graph and co-change coupling.
//
//   node measure.mjs [repo-dir]
//
// Writes <repo-dir>/docs/codebase-report/measurements.json and prints its path.
// Each section names the chart it feeds, the point past which that chart is
// "too much", and whether this repo crossed it — so the report can say what it
// rolled up rather than drawing an unreadable chart.
import { mkdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listFiles } from './lib/files.mjs';
import { git, hasHistory } from './lib/git.mjs';
import { coChange, editCounts, editWindow, readCommits, readTags } from './lib/history.mjs';
import { buildImportGraph } from './lib/imports.mjs';

export const SCHEMA_VERSION = 1;

/** The node a roll-up gathers what it cuts into; parenthesised, so no real directory is named it. */
export const OTHER = '(other)';

/** The report's own output; never measured, or a re-run would measure itself. */
export const OUTPUT_DIR = 'docs/codebase-report';

/**
 * Every chart's "too much" threshold and what happens past it. First guesses,
 * set generously — tune them against real repos, not in defence of these.
 */
export const LIMITS = {
  sizes: {
    maxFiles: 150,
    maxGroups: 40,
    rule: 'Past maxFiles files, sizes roll up to the top two directory levels; past maxGroups groups, the smallest join "(other)".',
  },
  languages: {
    maxSlices: 8,
    rule: 'Past maxSlices languages, the smallest join "Other".',
  },
  history: {
    maxTags: 30,
    largestCommits: 10,
    rule: 'History is the tags plus the largestCommits biggest commits by lines changed; past maxTags tags, only the newest maxTags are kept.',
  },
  edits: {
    months: 12,
    maxFiles: 40,
    rule: 'Edits count commits in the months up to the newest commit; past maxFiles files, only the most edited maxFiles are kept.',
  },
  imports: {
    maxNodes: 40,
    maxExternal: 20,
    rule: 'Past maxNodes files, the graph rolls up to directories, at least two levels deep: the depth that shows the most directories within maxNodes. If none fits, the shallowest depth that has links is used (files, when every import stays inside one directory) and its least connected nodes join "(other)". Only the maxExternal most used outside packages are listed.',
  },
  coChange: {
    maxPairs: 30,
    bulkCommitFiles: 50,
    rule: 'Commits touching more than bulkCommitFiles files are skipped; past maxPairs pairs, only the most frequent maxPairs are kept.',
  },
};

/**
 * The directory a path rolls up to, at most `depth` levels deep:
 * `a/b/c/d.ts` → `a/b`, `a/x.ts` → `a`, `x.ts` → `.`
 * @param {string} path  a file, or a directory when `isDir`
 * @param {boolean} [isDir]
 * @param {number} [depth]
 */
export function groupOf(path, isDir = false, depth = 2) {
  const parts = path.split('/');
  if (!isDir) parts.pop();
  if (parts.length === 0 || (parts.length === 1 && parts[0] === '.')) return '.';
  return parts.slice(0, depth).join('/');
}


/**
 * @param {string} dir
 */
export function measure(dir) {
  const root = realpathSync(resolve(dir));
  const hasGit = hasHistory(root);
  const shallow = hasGit && git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true';
  const files = listFiles(root, hasGit).filter((file) => !file.path.startsWith(`${OUTPUT_DIR}/`));
  const current = new Set(files.map((file) => file.path));
  // A shallow clone's oldest commit reads as adding the whole tree: it would
  // be the largest commit, an edit to every file and a pair of every two.
  const noHistory = !hasGit
    ? { available: false, reason: 'not a git repository with commits' }
    : shallow
      ? { available: false, reason: 'shallow clone: its history is cut off; run `git fetch --unshallow` and measure again' }
      : null;

  const commits = noHistory ? [] : readCommits(root);
  return {
    schema: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repo: {
      name: basename(root),
      git: hasGit,
      shallow,
      commit: hasGit ? git(root, ['rev-parse', 'HEAD']).trim() : null,
    },
    limits: LIMITS,
    sizes: sizes(files),
    languages: languages(files),
    history: noHistory ? { chart: 'event-line', ...noHistory } : history(root, commits),
    edits: noHistory ? { chart: 'scatter', ...noHistory } : edits(commits, files),
    imports: imports(root, files),
    coChange: noHistory ? { chart: 'arc', ...noHistory } : coChangeSection(commits, current),
  };
}

/** @param {import('./lib/files.mjs').FileInfo[]} files */
function sizes(files) {
  const limit = LIMITS.sizes;
  const total = {
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    lines: files.reduce((sum, file) => sum + (file.lines ?? 0), 0),
  };
  if (files.length <= limit.maxFiles) {
    return {
      chart: 'treemap',
      total,
      rolledUp: false,
      rollUpNote: null,
      entries: files.map(({ path, bytes, lines }) => ({ path, bytes, lines: lines ?? 0, files: 1 })),
    };
  }
  /** @type {Map<string, { path: string, bytes: number, lines: number, files: number }>} */
  const groups = new Map();
  for (const file of files) {
    const key = groupOf(file.path);
    const group = groups.get(key) ?? { path: key, bytes: 0, lines: 0, files: 0 };
    group.bytes += file.bytes;
    group.lines += file.lines ?? 0;
    group.files += 1;
    groups.set(key, group);
  }
  let entries = [...groups.values()].sort((a, b) => b.lines - a.lines || b.bytes - a.bytes);
  let note = `${files.length} files rolled up to ${entries.length} directories, two levels deep.`;
  if (entries.length > limit.maxGroups) {
    const kept = entries.slice(0, limit.maxGroups - 1);
    const rest = entries.slice(limit.maxGroups - 1);
    const other = { path: OTHER, bytes: 0, lines: 0, files: 0 };
    for (const entry of rest) {
      other.bytes += entry.bytes;
      other.lines += entry.lines;
      other.files += entry.files;
    }
    entries = [...kept, other];
    note += ` The smallest ${rest.length} are shown as "${OTHER}".`;
  }
  return { chart: 'treemap', total, rolledUp: true, rollUpNote: note, entries };
}

/** @param {import('./lib/files.mjs').FileInfo[]} files */
function languages(files) {
  const limit = LIMITS.languages;
  /** @type {Map<string, { language: string, files: number, lines: number, bytes: number }>} */
  const byLanguage = new Map();
  const unclassified = { files: 0, bytes: 0 };
  for (const file of files) {
    if (!file.language) {
      unclassified.files += 1;
      unclassified.bytes += file.bytes;
      continue;
    }
    const slice = byLanguage.get(file.language) ?? { language: file.language, files: 0, lines: 0, bytes: 0 };
    slice.files += 1;
    slice.lines += file.lines ?? 0;
    slice.bytes += file.bytes;
    byLanguage.set(file.language, slice);
  }
  let slices = [...byLanguage.values()].sort((a, b) => b.lines - a.lines || (a.language < b.language ? -1 : 1));
  let note = null;
  if (slices.length > limit.maxSlices) {
    const rest = slices.slice(limit.maxSlices - 1);
    const other = { language: 'Other', files: 0, lines: 0, bytes: 0 };
    for (const slice of rest) {
      other.files += slice.files;
      other.lines += slice.lines;
      other.bytes += slice.bytes;
    }
    slices = [...slices.slice(0, limit.maxSlices - 1), other];
    note = `${rest.length} smaller languages are shown as "Other": ${rest.map((slice) => slice.language).join(', ')}.`;
  }
  return { chart: 'pie', rolledUp: note !== null, rollUpNote: note, slices, unclassified };
}

/**
 * @param {string} root
 * @param {import('./lib/history.mjs').Commit[]} commits
 */
function history(root, commits) {
  const limit = LIMITS.history;
  const allTags = readTags(root);
  const tags = allTags.slice(-limit.maxTags);
  const largestCommits = commits
    .map((commit) => ({
      sha: commit.sha,
      date: commit.date,
      subject: commit.subject,
      files: commit.files.length,
      linesChanged: commit.files.reduce((sum, file) => sum + file.added + file.deleted, 0),
    }))
    .sort((a, b) => b.linesChanged - a.linesChanged || (a.date < b.date ? 1 : -1))
    .slice(0, limit.largestCommits);
  const dropped = allTags.length - tags.length;
  return {
    chart: 'event-line',
    available: true,
    commits: commits.length,
    firstCommit: commits.at(-1)?.date ?? null,
    lastCommit: commits[0]?.date ?? null,
    tagCount: allTags.length,
    rolledUp: dropped > 0,
    rollUpNote: dropped > 0 ? `Only the newest ${tags.length} of ${allTags.length} tags are shown.` : null,
    tags,
    largestCommits,
  };
}

/**
 * @param {import('./lib/history.mjs').Commit[]} commits
 * @param {import('./lib/files.mjs').FileInfo[]} files
 */
function edits(commits, files) {
  const limit = LIMITS.edits;
  const window = editWindow(commits, limit.months);
  if (!window) return { chart: 'scatter', available: false, reason: 'no commits' };
  const byPath = new Map(files.map((file) => [file.path, file]));
  const counts = editCounts(commits, window, new Set(byPath.keys()));
  const all = [...counts]
    .map(([path, count]) => ({ path, edits: count, bytes: byPath.get(path)?.bytes ?? 0, lines: byPath.get(path)?.lines ?? 0 }))
    .sort((a, b) => b.edits - a.edits || (a.path < b.path ? -1 : 1));
  const kept = all.slice(0, limit.maxFiles);
  const rolledUp = all.length > kept.length;
  return {
    chart: 'scatter',
    available: true,
    window,
    editedFiles: all.length,
    rolledUp,
    rollUpNote: rolledUp ? `Only the ${kept.length} most edited of ${all.length} edited files are shown.` : null,
    files: kept,
  };
}

/**
 * @param {string} root
 * @param {import('./lib/files.mjs').FileInfo[]} files
 */
function imports(root, files) {
  const limit = LIMITS.imports;
  const graph = buildImportGraph(root, files.map((file) => file.path));
  const external = [...graph.external]
    .map(([name, count]) => ({ name, files: count }))
    .sort((a, b) => b.files - a.files || (a.name < b.name ? -1 : 1))
    .slice(0, limit.maxExternal);
  let edges = graph.edges.map(({ from, to }) => ({ from, to, count: 1 }));
  let nodes = nodesOf(edges);
  let note = null;
  if (nodes.length > limit.maxNodes) {
    // Not a fixed depth: two levels flatten a monorepo's `packages/<name>/src/...`
    // into one node per package, and every import inside a package vanishes.
    // A loop, not Math.max(...): a big graph has more edges than V8 takes arguments.
    let deepest = 2;
    for (const edge of graph.edges) {
      deepest = Math.max(deepest, dirDepth(edge.from, false), dirDepth(edge.to, edge.toPackage));
    }
    /** @type {{ depth: number | null, edges: { from: string, to: string, count: number }[], nodes: number }[]} */
    const levels = [];
    for (let depth = 2; depth <= deepest; depth++) {
      const rolled = rollUpEdges(graph.edges, depth);
      levels.push({ depth, edges: rolled, nodes: nodesOf(rolled).length });
    }
    // Files themselves, last: when every import stays inside one directory,
    // every directory level is empty and only the files have links to draw.
    levels.push({ depth: null, edges, nodes: nodes.length });
    const fitting = levels.filter((level) => level.nodes > 0 && level.nodes <= limit.maxNodes);
    const chosen =
      fitting.sort((a, b) => b.nodes - a.nodes || (a.depth ?? Infinity) - (b.depth ?? Infinity))[0] ??
      levels.find((level) => level.nodes > 0);
    edges = chosen?.edges ?? [];
    nodes = nodesOf(edges);
    note =
      chosen?.depth === null
        ? `${graph.edges.length} file imports stay inside one directory each, so the graph stays at file level.`
        : `${graph.edges.length} file imports rolled up to ${edges.length} links between ${nodes.length} directories, up to ${chosen?.depth} levels deep.`;
    if (nodes.length > limit.maxNodes) {
      // The least connected join one "other" node rather than vanish: dropping
      // them would also drop every link a kept hub has to them.
      /** @type {Map<string, number>} */
      const degree = new Map();
      for (const edge of edges) {
        degree.set(edge.from, (degree.get(edge.from) ?? 0) + edge.count);
        degree.set(edge.to, (degree.get(edge.to) ?? 0) + edge.count);
      }
      const ranked = [...degree].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([node]) => node);
      const keep = new Set(ranked.slice(0, limit.maxNodes - 1));
      /** @type {Map<string, { from: string, to: string, count: number }>} */
      const merged = new Map();
      for (const edge of edges) {
        const from = keep.has(edge.from) ? edge.from : OTHER;
        const to = keep.has(edge.to) ? edge.to : OTHER;
        if (from === to) continue;
        const key = `${from}\0${to}`;
        const entry = merged.get(key) ?? { from, to, count: 0 };
        entry.count += edge.count;
        merged.set(key, entry);
      }
      edges = [...merged.values()];
      nodes = nodesOf(edges);
      note += ` The ${ranked.length - keep.size} least connected are shown as "${OTHER}".`;
    }
  }
  edges.sort((a, b) => b.count - a.count || (a.from + a.to < b.from + b.to ? -1 : 1));
  return {
    chart: 'arc',
    rolledUp: note !== null,
    rollUpNote: note,
    nodes,
    edges,
    external,
    unresolved: graph.unresolved,
  };
}

/**
 * How many directory levels a path sits under (`a/b/c.ts` → 2), or spans when it is a directory.
 * @param {string} path
 * @param {boolean} isDir
 */
function dirDepth(path, isDir) {
  if (path === '.') return 0;
  return path.split('/').length - (isDir ? 0 : 1);
}

/**
 * File-to-file edges as directory-to-directory links, counted; a link inside one directory is dropped.
 * @param {{ from: string, to: string, toPackage: boolean }[]} fileEdges
 * @param {number} depth
 */
function rollUpEdges(fileEdges, depth) {
  /** @type {Map<string, { from: string, to: string, count: number }>} */
  const rolled = new Map();
  for (const edge of fileEdges) {
    const from = groupOf(edge.from, false, depth);
    const to = groupOf(edge.to, edge.toPackage, depth);
    if (from === to) continue;
    const key = `${from}\0${to}`;
    const entry = rolled.get(key) ?? { from, to, count: 0 };
    entry.count += 1;
    rolled.set(key, entry);
  }
  return [...rolled.values()];
}

/** @param {{ from: string, to: string }[]} edges */
function nodesOf(edges) {
  return [...new Set(edges.flatMap((edge) => [edge.from, edge.to]))].sort();
}

/**
 * @param {import('./lib/history.mjs').Commit[]} commits
 * @param {Set<string>} current
 */
function coChangeSection(commits, current) {
  const limit = LIMITS.coChange;
  const { pairs, bulkCommitsSkipped } = coChange(commits, current, limit.bulkCommitFiles);
  const kept = pairs.slice(0, limit.maxPairs);
  const rolledUp = pairs.length > kept.length;
  return {
    chart: 'arc',
    available: true,
    pairCount: pairs.length,
    bulkCommitsSkipped,
    rolledUp,
    rollUpNote: rolledUp ? `Only the ${kept.length} most frequent of ${pairs.length} file pairs are shown.` : null,
    pairs: kept,
  };
}

/**
 * Measure `dir` and write the report's measurements.json; returns its path.
 * @param {string} dir
 */
export function writeMeasurements(dir) {
  const measurements = measure(dir);
  const outDir = join(realpathSync(resolve(dir)), OUTPUT_DIR);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'measurements.json');
  // Temp file plus rename, so a reader never sees half a file.
  const temp = `${out}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(measurements, null, 2)}\n`);
  renameSync(temp, out);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    console.log(writeMeasurements(process.argv[2] ?? '.'));
  } catch (error) {
    console.error(`measure.mjs: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
