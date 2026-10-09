import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Fixture repos with git history: one per language the measuring scripts read. */
export const GIT_FIXTURES = ['typescript', 'python', 'go', 'rust'] as const;
/** The fixture measured without git: no history, edit frequency or co-change. */
export const NO_GIT_FIXTURE = 'no-git';

export type FixtureName = (typeof GIT_FIXTURES)[number] | typeof NO_GIT_FIXTURE;

export const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'repos');

// A nested .git cannot be committed, so history is made at test time. The
// global and system git config are shut out: the owner's (signing, hooks,
// default branch) must not change what a fixture looks like, here or in CI.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
};

export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, env: GIT_ENV, encoding: 'utf8' }).trim();
}

/**
 * Copy a fixture repo into a fresh temp directory and return its path. Every
 * fixture but `no-git` gets a git repo: one commit on `main`, tagged `v0.1.0`.
 */
export function materializeFixture(name: FixtureName): string {
  const dir = mkdtempSync(join(tmpdir(), `skills-fixture-${name}-`));
  cpSync(join(FIXTURES_DIR, name), dir, { recursive: true });
  if (name !== NO_GIT_FIXTURE) {
    git(dir, 'init', '--quiet', '--initial-branch=main');
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '-m', 'Initial commit');
    git(dir, 'tag', 'v0.1.0');
  }
  return dir;
}
