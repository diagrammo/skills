// @ts-check
// One way to run git: in the measured directory, deaf to the caller's GIT_* variables.
import { execFileSync } from 'node:child_process';

// A hook or `git rebase -x` exports GIT_DIR and friends; with them set, git
// reads the CALLER's repository instead of the one being measured.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));

/**
 * @param {string} cwd
 * @param {string[]} args
 */
export function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    env: ENV,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {string} [separator]
 */
export function gitLines(cwd, args, separator = '\n') {
  return git(cwd, args)
    .split(separator)
    .filter((line) => line.length > 0);
}

/**
 * True when `cwd` is inside a git work tree that has at least one commit.
 * @param {string} cwd
 */
export function hasHistory(cwd) {
  try {
    git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}
