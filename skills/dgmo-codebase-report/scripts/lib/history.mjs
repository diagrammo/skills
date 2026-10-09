// @ts-check
// What git remembers: releases, the biggest commits, how often each file is
// edited, and which files change together.
import { git, gitLines } from './git.mjs';

/**
 * @typedef {object} Commit
 * @property {string} sha
 * @property {string} date      committer date, ISO 8601
 * @property {string} subject
 * @property {{ path: string, added: number, deleted: number }[]} files
 */

/**
 * Every non-merge commit that touched this directory, newest first, with paths
 * relative to it. Rename detection is off, so a rename reads as a delete plus an add.
 * @param {string} cwd
 * @returns {Commit[]}
 */
export function readCommits(cwd) {
  const out = git(cwd, [
    'log',
    '--no-merges',
    '--no-renames',
    '--relative',
    '--numstat',
    '--format=%x00%H%x09%cI%x09%s',
    '--',
    '.',
  ]);
  /** @type {Commit[]} */
  const commits = [];
  for (const block of out.split('\0').slice(1)) {
    const [header = '', ...rest] = block.split('\n');
    const [sha = '', date = '', ...subject] = header.split('\t');
    const files = [];
    for (const line of rest) {
      const [added, deleted, ...path] = line.split('\t');
      if (path.length === 0) continue;
      // Binary files report `-` for both counts.
      files.push({ path: path.join('\t'), added: Number(added) || 0, deleted: Number(deleted) || 0 });
    }
    commits.push({ sha, date, subject: subject.join('\t'), files });
  }
  return commits;
}

/**
 * Tags, oldest first, each with the commit it points at.
 * @param {string} cwd
 */
export function readTags(cwd) {
  const format = '%(refname:short)%09%(creatordate:iso-strict)%09%(if)%(*objectname)%(then)%(*objectname)%(else)%(objectname)%(end)';
  return gitLines(cwd, ['for-each-ref', '--sort=creatordate', `--format=${format}`, 'refs/tags'])
    .map((line) => {
      const [name = '', date = '', sha = ''] = line.split('\t');
      return { name, date, sha };
    });
}

/**
 * The window edit frequency is counted over: the twelve months up to the
 * newest commit. Anchored on the history, not on today, so an idle repo still
 * shows how it was last worked on and a re-run on the same commit gives the
 * same numbers.
 * @param {Commit[]} commits  newest first
 * @param {number} months
 */
export function editWindow(commits, months) {
  const newest = commits[0];
  if (!newest) return null;
  const until = new Date(newest.date);
  const since = new Date(until);
  since.setUTCMonth(since.getUTCMonth() - months);
  return { since: since.toISOString(), until: until.toISOString() };
}

/**
 * Commits per file inside the window, for files that still exist.
 * @param {Commit[]} commits
 * @param {{ since: string }} window
 * @param {Set<string>} current
 */
export function editCounts(commits, window, current) {
  const since = Date.parse(window.since);
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const commit of commits) {
    if (Date.parse(commit.date) < since) continue;
    for (const { path } of commit.files) {
      if (current.has(path)) counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * How often each pair of current files was committed together, over the whole
 * history. A commit touching more than `bulkLimit` files is skipped: a
 * reformat or a vendored drop couples everything to everything and says nothing.
 * @param {Commit[]} commits
 * @param {Set<string>} current
 * @param {number} bulkLimit
 */
export function coChange(commits, current, bulkLimit) {
  /** @type {Map<string, number>} */
  const pairs = new Map();
  let skipped = 0;
  for (const commit of commits) {
    const paths = [...new Set(commit.files.map((file) => file.path).filter((path) => current.has(path)))].sort();
    if (paths.length > bulkLimit) {
      skipped++;
      continue;
    }
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const key = `${paths[i]}\0${paths[j]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }
  const list = [...pairs].map(([key, count]) => {
    const [a = '', b = ''] = key.split('\0');
    return { a, b, count };
  });
  list.sort((x, y) => y.count - x.count || (x.a + x.b < y.a + y.b ? -1 : 1));
  return { pairs: list, bulkCommitsSkipped: skipped };
}
