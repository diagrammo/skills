import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { coChange, editCounts, editWindow, unquote, type Commit } from '../skills/dgmo-codebase-report/scripts/lib/history.mjs';
import { LIMITS, OTHER, OUTPUT_DIR, groupOf, measure } from '../skills/dgmo-codebase-report/scripts/measure.mjs';
import { GIT_FIXTURES, NO_GIT_FIXTURE, git, materializeFixture, type FixtureName } from './helpers/fixture-repo.js';

const SCRIPT = resolve(import.meta.dirname, '..', 'skills', 'dgmo-codebase-report', 'scripts', 'measure.mjs');

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(name: FixtureName): string {
  const dir = materializeFixture(name);
  made.push(dir);
  return dir;
}

function scratch(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'skills-measure-'));
  made.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

/** A scratch tree made a git repo with one commit on `main`. */
function scratchRepo(files: Record<string, string>): string {
  const dir = scratch(files);
  git(dir, 'init', '--quiet', '--initial-branch=main');
  git(dir, 'add', '.');
  git(dir, 'commit', '--quiet', '-m', 'Initial commit');
  return dir;
}

/** Run the script the way the skill does, with the caller's environment plus `env`. */
function run(dir: string, env: Record<string, string> = {}) {
  const out = execFileSync('node', [SCRIPT, dir], { encoding: 'utf8', env: { ...process.env, ...env } }).trim();
  expect(out).toBe(join(dir, OUTPUT_DIR, 'measurements.json'));
  return JSON.parse(readFileSync(out, 'utf8'));
}

const EDGES: Record<(typeof GIT_FIXTURES)[number], string[]> = {
  typescript: ['src/index.ts>src/greet.ts', 'src/index.ts>src/util/shout.ts', 'src/legacy.js>src/greet.ts'],
  python: ['app/main.py>app/greet.py', 'app/main.py>app/shout.py'],
  go: ['cmd/hello/main.go>internal/greet'],
  rust: ['src/main.rs>src/greet.rs', 'src/main.rs>src/shout.rs'],
};

describe('measure.mjs on the fixture repos', () => {
  it.each(GIT_FIXTURES)('%s: writes every section, with history from git', (name) => {
    const dir = fixture(name);
    const m = run(dir);
    const tracked = git(dir, 'ls-files').split('\n').sort();

    expect(m.schema).toBe(1);
    expect(m.repo).toEqual({ name: expect.any(String), git: true, shallow: false, commit: git(dir, 'rev-parse', 'HEAD') });
    expect(m.limits).toEqual(LIMITS);

    expect(m.sizes.rolledUp).toBe(false);
    expect(m.sizes.entries.map((entry: { path: string }) => entry.path)).toEqual(tracked);
    expect(m.sizes.total.files).toBe(tracked.length);

    expect(m.history).toMatchObject({ available: true, commits: 1, tagCount: 1, rolledUp: false });
    expect(m.history.tags).toEqual([{ name: 'v0.1.0', date: expect.any(String), sha: git(dir, 'rev-parse', 'HEAD') }]);
    expect(m.history.largestCommits).toHaveLength(1);
    expect(m.history.largestCommits[0]).toMatchObject({ subject: 'Initial commit', files: tracked.length });

    // The window ends at the newest commit (2026-01-01, the helper's fixed date), not today.
    expect(m.edits.window).toEqual({ since: '2025-01-01T00:00:00.000Z', until: '2026-01-01T00:00:00.000Z' });
    expect(m.edits.files.map((file: { path: string }) => file.path).sort()).toEqual(tracked);
    expect(m.edits.files.every((file: { edits: number }) => file.edits === 1)).toBe(true);

    const n = tracked.length;
    expect(m.coChange.pairCount).toBe((n * (n - 1)) / 2);
    expect(m.coChange.pairs.every((pair: { count: number }) => pair.count === 1)).toBe(true);

    expect(m.imports.edges.map((edge: { from: string; to: string }) => `${edge.from}>${edge.to}`).sort()).toEqual(
      EDGES[name].sort(),
    );
    expect(m.imports.unresolved).toBe(0);
  });

  it('no-git: measures files and imports, and says history is unavailable', () => {
    const m = run(fixture(NO_GIT_FIXTURE));
    expect(m.repo.git).toBe(false);
    expect(m.repo.commit).toBeNull();
    for (const section of ['history', 'edits', 'coChange']) {
      expect(m[section]).toMatchObject({ available: false, reason: expect.any(String) });
    }
    expect(m.sizes.entries.map((entry: { path: string }) => entry.path)).toEqual(['README.md', 'src/greet.ts', 'src/index.ts']);
    expect(m.languages.slices.map((slice: { language: string }) => slice.language)).toEqual(['TypeScript', 'Markdown']);
    expect(m.imports.edges).toEqual([{ from: 'src/index.ts', to: 'src/greet.ts', count: 1 }]);
  });

  it('never measures its own output on a re-run', () => {
    const dir = fixture(NO_GIT_FIXTURE);
    const first = run(dir);
    const second = run(dir);
    expect(second.sizes.total).toEqual(first.sizes.total);
  });

  it('reads the measured repo, not one an inherited GIT_DIR points at', () => {
    const dir = fixture('go');
    const outer = resolve(import.meta.dirname, '..', '.git');
    const m = run(dir, { GIT_DIR: outer, GIT_WORK_TREE: resolve(import.meta.dirname, '..') });
    expect(m.repo.commit).toBe(git(dir, 'rev-parse', 'HEAD'));
  });
});

describe('git edge cases', () => {
  it('lists a file once when a merge stopped on a conflict in it', () => {
    const dir = scratchRepo({ 'a.ts': "import _ from 'lodash';\nexport const v = 0;\n" });
    git(dir, 'checkout', '--quiet', '-b', 'side');
    writeFileSync(join(dir, 'a.ts'), "import _ from 'lodash';\nexport const v = 1;\n");
    git(dir, 'commit', '--quiet', '-am', 'side');
    git(dir, 'checkout', '--quiet', 'main');
    writeFileSync(join(dir, 'a.ts'), "import _ from 'lodash';\nexport const v = 2;\n");
    git(dir, 'commit', '--quiet', '-am', 'main');
    expect(() => git(dir, 'merge', '--quiet', 'side')).toThrow();
    expect(git(dir, 'ls-files').split('\n')).toEqual(['a.ts', 'a.ts', 'a.ts']);

    const m = measure(dir);
    expect(m.sizes.total.files).toBe(1);
    expect(m.sizes.entries.map((entry) => entry.path)).toEqual(['a.ts']);
    expect(m.imports.external).toEqual([{ name: 'lodash', files: 1 }]);
  });

  it('matches a non-ASCII file name between ls-files and the history', () => {
    const dir = scratchRepo({ 'café.ts': 'x\n', 'main.ts': 'y\n' });
    writeFileSync(join(dir, 'café.ts'), 'x2\n');
    writeFileSync(join(dir, 'main.ts'), 'y2\n');
    git(dir, 'commit', '--quiet', '-am', 'both');

    const m = measure(dir);
    if (!('files' in m.edits) || !('pairs' in m.coChange)) throw new Error('expected git history');
    expect((m.edits.files ?? []).map((file) => [file.path, file.edits])).toEqual([
      ['café.ts', 2],
      ['main.ts', 2],
    ]);
    expect(m.coChange.pairs).toEqual([{ a: 'café.ts', b: 'main.ts', count: 2 }]);
  });

  it('says a shallow clone has no usable history rather than reading its cut-off as a commit', () => {
    const full = scratchRepo({ 'a.ts': '1\n', 'b.ts': '1\n' });
    for (let i = 2; i <= 3; i++) {
      writeFileSync(join(full, 'a.ts'), `${i}\n`);
      git(full, 'commit', '--quiet', '-am', `edit ${i}`);
    }
    const shallow = mkdtempSync(join(tmpdir(), 'skills-shallow-'));
    made.push(shallow);
    git(tmpdir(), 'clone', '--quiet', '--depth', '1', `file://${full}`, shallow);

    const m = measure(shallow);
    expect(m.repo).toMatchObject({ git: true, shallow: true });
    for (const section of ['history', 'edits', 'coChange'] as const) {
      expect(m[section]).toMatchObject({ available: false, reason: expect.stringMatching(/shallow/) });
    }
    expect(m.sizes.total.files).toBe(2);
  });

  it('decodes the paths git still quotes', () => {
    expect(unquote('"tab\\there.ts"')).toBe('tab\there.ts');
    expect(unquote('"caf\\303\\251 \\"q\\".ts"')).toBe('café "q".ts');
    expect(unquote('plain.ts')).toBe('plain.ts');
  });
});

describe('imports', () => {
  it('records outside packages by package name and leaves out node: and the Go standard library', () => {
    const dir = scratch({
      'a.ts': "import React from 'react';\nimport { x } from '@scope/pkg/sub';\nimport fs from 'node:fs';\nexport * from './b';\n",
      'b.ts': "const lazy = () => import('react');\nexport {};\n",
      'go.mod': 'module example.com/m\n',
      'main.go': 'package main\n\nimport (\n\t"fmt"\n\tyaml "gopkg.in/yaml.v3"\n\t"github.com/acme/tool/sub"\n)\n',
      'lib.rs': 'use serde::Deserialize;\nuse std::fmt;\n',
    });
    const m = measure(dir);
    expect(m.imports.external).toEqual([
      { name: 'react', files: 2 },
      { name: '@scope/pkg', files: 1 },
      { name: 'github.com/acme/tool', files: 1 },
      { name: 'gopkg.in/yaml.v3', files: 1 },
      { name: 'serde', files: 1 },
    ]);
    expect(m.imports.edges).toEqual([{ from: 'a.ts', to: 'b.ts', count: 1 }]);
  });

  it('resolves the @/ and ~/ source-root aliases instead of calling them packages', () => {
    const m = measure(
      scratch({
        'src/lib/utils.ts': '',
        'src/app.ts': "import { cn } from '@/lib/utils';\nimport x from '~/missing';\n",
      }),
    );
    expect(m.imports.edges).toEqual([{ from: 'src/app.ts', to: 'src/lib/utils.ts', count: 1 }]);
    expect(m.imports.external).toEqual([]);
    expect(m.imports.unresolved).toBe(1);
  });

  it('resolves a Go module whose go.mod is in a subdirectory', () => {
    const m = measure(
      scratch({
        'backend/go.mod': 'module github.com/acme/app\n',
        'backend/cmd/main.go': 'package main\n\nimport "github.com/acme/app/internal/greet"\n',
        'backend/internal/greet/greet.go': 'package greet\n',
      }),
    );
    expect(m.imports.edges).toEqual([{ from: 'backend/cmd/main.go', to: 'backend/internal/greet', count: 1 }]);
    expect(m.imports.external).toEqual([]);
  });

  it('records a Go dependency by the module go.mod requires, else by its host\'s depth', () => {
    const m = measure(
      scratch({
        'go.mod': 'module example.com/m\n\nrequire (\n\tgithub.com/acme/kit/v2 v2.0.0\n\tgoogle.golang.org/grpc v1.60.0 // indirect\n)\n',
        'a.go': 'package m\n\nimport (\n\t"google.golang.org/grpc"\n\t"google.golang.org/grpc/codes"\n\t"github.com/acme/kit/v2/log"\n)\n',
        'b.go': 'package m\n\nimport (\n\t"go.uber.org/zap"\n\t"go.uber.org/zap/zapcore"\n\t"golang.org/x/net/http2"\n)\n',
        'c.go': 'package m\n\nimport "go.uber.org/zap"\n',
      }),
    );
    expect(m.imports.external).toEqual([
      { name: 'go.uber.org/zap', files: 2 },
      { name: 'github.com/acme/kit/v2', files: 1 },
      { name: 'golang.org/x/net', files: 1 },
      { name: 'google.golang.org/grpc', files: 1 },
    ]);
  });

  it('expands Rust use braces and reads Python imports split over lines', () => {
    const m = measure(
      scratch({
        'src/main.rs': 'mod a;\nmod b;\nuse crate::{a::f, b as bee, self};\n',
        'src/a.rs': '',
        'src/b.rs': 'use super::{a};\n',
        'pkg/__init__.py': '',
        'pkg/x.py': '',
        'pkg/y.py': '',
        'pkg/main.py': 'from . import (\n    x,  # first\n    y as why,\n)\n',
      }),
    );
    expect(m.imports.edges.map((edge) => `${edge.from}>${edge.to}`).sort()).toEqual([
      'pkg/main.py>pkg/x.py',
      'pkg/main.py>pkg/y.py',
      'src/b.rs>src/a.rs',
      'src/main.rs>src/a.rs',
      'src/main.rs>src/b.rs',
    ]);
  });

  it('counts lines with or without a final newline, and none for a binary file', () => {
    const m = measure(scratch({ 'a.txt': 'x\ny', 'b.txt': 'x\n', 'c.txt': '', 'd.bin': 'x\u0000y\n' }));
    expect(m.sizes.entries.map((entry) => [entry.path, entry.lines])).toEqual([
      ['a.txt', 2],
      ['b.txt', 1],
      ['c.txt', 0],
      ['d.bin', 0],
    ]);
  });

  it('reads a bare path that names a repo file as a baseUrl import, not a package', () => {
    const m = measure(
      scratch({
        'src/utils/cn.ts': '',
        'src/app.ts': "import { cn } from 'utils/cn';\nimport React from 'react';\n",
      }),
    );
    expect(m.imports.edges.map((edge) => `${edge.from}>${edge.to}`).sort()).toEqual([
      'src/app.ts>src/utils/cn.ts',
    ]);
    expect(m.imports.external).toEqual([{ name: 'react', files: 1 }]);
  });

  it('exits 1 with a one-line message when the directory does not exist', () => {
    let failure: { status?: number; stderr?: string } = {};
    try {
      execFileSync('node', [SCRIPT, join(tmpdir(), 'skills-measure-no-such-dir')], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      failure = error as typeof failure;
    }
    expect(failure.status).toBe(1);
    expect(failure.stderr).toMatch(/^measure\.mjs: .*no such file/m);
  });

  it('counts a relative import that names no file as unresolved', () => {
    const m = measure(scratch({ 'a.ts': "import { gone } from './gone';\n" }));
    expect(m.imports.unresolved).toBe(1);
    expect(m.imports.edges).toEqual([]);
  });

  it('resolves Rust super:: and nested mod.rs modules', () => {
    const m = measure(
      scratch({
        'src/lib.rs': 'pub mod net;\n',
        'src/net/mod.rs': 'mod http;\n',
        'src/net/http.rs': 'use super::super::util;\nuse crate::net;\n',
        'src/util.rs': '',
      }),
    );
    expect(m.imports.edges.map((edge) => `${edge.from}>${edge.to}`).sort()).toEqual([
      'src/lib.rs>src/net/mod.rs',
      'src/net/http.rs>src/net/mod.rs',
      'src/net/http.rs>src/util.rs',
      'src/net/mod.rs>src/net/http.rs',
    ]);
  });
});

describe('roll-ups past each chart limit', () => {
  it('sizes roll up to two directory levels, and the smallest groups to "other"', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < LIMITS.sizes.maxGroups + 5; i++) {
      for (let j = 0; j < 4; j++) files[`pkg${i}/deep/er/f${j}.ts`] = 'x\n'.repeat(i + 1);
    }
    files['top.ts'] = 'x\n';
    const m = measure(scratch(files));
    expect(m.sizes.rolledUp).toBe(true);
    expect(m.sizes.total.files).toBe(Object.keys(files).length);
    expect(m.sizes.entries).toHaveLength(LIMITS.sizes.maxGroups);
    const top = LIMITS.sizes.maxGroups + 4; // the biggest package: 4 files of top + 1 lines each
    expect(m.sizes.entries[0]).toEqual({ path: `pkg${top}/deep`, bytes: 4 * 2 * (top + 1), lines: 4 * (top + 1), files: 4 });
    expect(m.sizes.entries.at(-1)?.path).toBe(OTHER);
    const summed = m.sizes.entries.reduce((sum: number, entry: { files: number }) => sum + entry.files, 0);
    expect(summed).toBe(m.sizes.total.files);
    expect(m.sizes.rollUpNote).toMatch(/rolled up/);
  });

  it('languages past the slice limit join "Other"', () => {
    const exts = ['ts', 'py', 'go', 'rs', 'rb', 'java', 'c', 'sh', 'sql', 'css'];
    const files = Object.fromEntries(exts.map((ext, i) => [`f.${ext}`, 'x\n'.repeat(exts.length - i)]));
    const m = measure(scratch(files));
    expect(m.languages.slices).toHaveLength(LIMITS.languages.maxSlices);
    expect(m.languages.slices.at(-1)).toMatchObject({ language: 'Other', files: 3, lines: 3 + 2 + 1 });
    expect(m.languages.rolledUp).toBe(true);
  });

  it('a large import graph rolls up to directories and drops self-links', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < LIMITS.imports.maxNodes; i++) {
      files[`a/x/f${i}.ts`] = `import './g${i}';\nimport '../../b/y/h${i}';\n`;
      files[`a/x/g${i}.ts`] = '';
      files[`b/y/h${i}.ts`] = '';
    }
    const m = measure(scratch(files));
    expect(m.imports.rolledUp).toBe(true);
    expect(m.imports.nodes).toEqual(['a/x', 'b/y']);
    expect(m.imports.edges).toEqual([{ from: 'a/x', to: 'b/y', count: LIMITS.imports.maxNodes }]);
  });

  it('keeps a hub whose importers are all cut, by linking it to "(other)"', () => {
    const files: Record<string, string> = { 'h/hub/z.ts': '' };
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 5; j++) files[`p${i}/a/f${j}.ts`] = "import '../b/g';\n";
      files[`p${i}/b/g.ts`] = '';
    }
    for (let k = 0; k < 30; k++) files[`l${k}/x/f.ts`] = "import '../../h/hub/z';\n";
    const m = measure(scratch(files));
    // 71 directories: 40 in pairs (degree 5), the hub (30), 30 leaves (1).
    expect(m.imports.nodes.length).toBeLessThanOrEqual(LIMITS.imports.maxNodes);
    expect(m.imports.edges).toContainEqual({ from: OTHER, to: 'h/hub', count: 30 });
    expect(m.imports.rollUpNote).toContain(`The ${71 - (LIMITS.imports.maxNodes - 1)} least connected are shown as "${OTHER}".`);
  });

  it('a flat directory past the limit stays at file level instead of drawing nothing', () => {
    const n = LIMITS.imports.maxNodes + 5;
    const files: Record<string, string> = {};
    for (let i = 0; i < n; i++) files[`src/f${i}.ts`] = i + 1 < n ? `import './f${i + 1}';\n` : '';
    const m = measure(scratch(files));
    expect(m.imports.rolledUp).toBe(true);
    expect(m.imports.nodes).toHaveLength(LIMITS.imports.maxNodes);
    expect(m.imports.nodes).toContain(OTHER);
    expect(m.imports.edges.length).toBeGreaterThan(0);
    expect(m.imports.rollUpNote).toMatch(/file level/);
  });

  it('survives an import graph with more edges than a call takes arguments', () => {
    const files: Record<string, string> = {};
    const names = Array.from({ length: 320 }, (_, i) => `d${i % 8}/f${i}`);
    for (const name of names) {
      files[`${name}.ts`] = names.filter((other) => other !== name).map((other) => `import '../${other}';`).join('\n');
    }
    const m = measure(scratch(files));
    expect(m.imports.rolledUp).toBe(true);
    expect(m.imports.nodes).toHaveLength(8);
  });

  it('a monorepo rolls up deeper than two levels, where its imports are', () => {
    // Every import stays inside one package, so two or three levels would draw nothing.
    const files: Record<string, string> = {};
    for (let i = 0; i < 15; i++) {
      files[`packages/p${i}/src/x/f.ts`] = "import '../y/g';\n";
      files[`packages/p${i}/src/x/f2.ts`] = "import '../y/g';\n";
      files[`packages/p${i}/src/y/g.ts`] = '';
    }
    const m = measure(scratch(files));
    expect(m.imports.rolledUp).toBe(true);
    expect(m.imports.nodes).toHaveLength(30);
    expect(m.imports.edges).toHaveLength(15);
    expect(m.imports.edges[0]).toEqual({ from: 'packages/p0/src/x', to: 'packages/p0/src/y', count: 2 });
    expect(m.imports.rollUpNote).toMatch(/4 levels deep/);
  });
});

describe('history helpers', () => {
  const commit = (date: string, ...paths: string[]): Commit => ({
    sha: date,
    date,
    subject: '',
    files: paths.map((path) => ({ path, added: 1, deleted: 0 })),
  });

  it('counts edits only inside the window that ends at the newest commit', () => {
    const commits = [
      commit('2024-06-01T00:00:00Z', 'a', 'b'),
      commit('2023-07-01T00:00:00Z', 'a'),
      commit('2023-05-01T00:00:00Z', 'a', 'gone'),
    ];
    const window = editWindow(commits, 12);
    expect(window).toEqual({ since: '2023-06-01T00:00:00.000Z', until: '2024-06-01T00:00:00.000Z' });
    expect(Object.fromEntries(editCounts(commits, window!, new Set(['a', 'b'])))).toEqual({ a: 2, b: 1 });
    expect(editWindow([], 12)).toBeNull();
  });

  it('skips bulk commits and counts the pairs that change together', () => {
    const current = new Set(['a', 'b', 'c']);
    const result = coChange(
      [commit('3', 'a', 'b'), commit('2', 'a', 'b', 'gone'), commit('1', 'a', 'b', 'c')],
      current,
      2,
    );
    expect(result).toEqual({ pairs: [{ a: 'a', b: 'b', count: 2 }], bulkCommitsSkipped: 1 });
  });

  it('groups a path by its top two directory levels', () => {
    expect(groupOf('a/b/c/d.ts')).toBe('a/b');
    expect(groupOf('a/x.ts')).toBe('a');
    expect(groupOf('x.ts')).toBe('.');
    expect(groupOf('internal/greet', true)).toBe('internal/greet');
    expect(groupOf('.', true)).toBe('.');
  });
});
