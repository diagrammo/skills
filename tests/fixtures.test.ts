import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURES_DIR, GIT_FIXTURES, NO_GIT_FIXTURE, git, materializeFixture } from './helpers/fixture-repo.js';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the fixture repos', () => {
  it('are exactly one per measured language plus one without git', () => {
    expect(readdirSync(FIXTURES_DIR).sort()).toEqual([...GIT_FIXTURES, NO_GIT_FIXTURE].sort());
  });

  it.each(GIT_FIXTURES)('%s materializes as a git repo with a tagged commit on main', (name) => {
    const dir = materializeFixture(name);
    made.push(dir);
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(git(dir, 'tag', '--list')).toBe('v0.1.0');
    expect(git(dir, 'status', '--porcelain')).toBe('');
    expect(git(dir, 'ls-files').split('\n').length).toBeGreaterThan(1);
  });

  it('no-git materializes without a repository', () => {
    const dir = materializeFixture(NO_GIT_FIXTURE);
    made.push(dir);
    expect(existsSync(join(dir, '.git'))).toBe(false);
    expect(existsSync(join(dir, 'src', 'index.ts'))).toBe(true);
  });
});
