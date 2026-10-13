import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INDEX_FILE,
  INDEX_MARKER,
  LINK_NOTICE,
  OUTPUT_DIR,
  checkDiagrams,
  main,
} from '../skills/dgmo-repo-diagrams/scripts/check-diagrams.mjs';

const FAKE_DGMO = join(import.meta.dirname, 'helpers', 'fake-dgmo.mjs');

let calls: string;
let dgmo: string[];

beforeEach(() => {
  calls = join(mkdtempSync(join(tmpdir(), 'skills-fake-dgmo-')), 'calls.log');
  writeFileSync(calls, '');
  dgmo = [process.execPath, FAKE_DGMO, calls];
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A repo whose docs/diagrams holds these files. */
function repoWith(files: Record<string, string>): { repo: string; dir: string } {
  const repo = mkdtempSync(join(tmpdir(), 'skills-repo-diagrams-'));
  const dir = join(repo, OUTPUT_DIR);
  mkdirSync(dir, { recursive: true });
  for (const [file, source] of Object.entries(files)) writeFileSync(join(dir, file), source);
  return { repo, dir };
}

function callLines(): string[] {
  return readFileSync(calls, 'utf8').split('\n').filter(Boolean);
}

const ARCH = 'boxes-and-lines Service Map\n// From: src/server.ts\nWeb -> API\n';
const LOGIN = 'sequence Sign in\n// From: src/auth.ts\nUser -POST /login-> API\n';

describe('checkDiagrams', () => {
  it('writes an index listing every diagram in file order, titled from its first line, with its link', () => {
    const { repo, dir } = repoWith({ '2-sign-in.dgmo': LOGIN, '1-architecture.dgmo': ARCH, 'notes.txt': 'not a diagram' });
    const out = checkDiagrams(repo, { dgmo });
    expect(out).toBe(join(dir, INDEX_FILE));
    const index = readFileSync(out, 'utf8');
    expect(index.startsWith(INDEX_MARKER)).toBe(true);
    const rows = index.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Diagram'));
    expect(rows).toEqual([
      '| Service Map | [1-architecture.dgmo](1-architecture.dgmo) | [Open in Diagrammo](https://diagrammo.app/#fake-1-architecture.dgmo) |',
      '| Sign in | [2-sign-in.dgmo](2-sign-in.dgmo) | [Open in Diagrammo](https://diagrammo.app/#fake-2-sign-in.dgmo) |',
    ]);
  });

  it('checks every diagram with --json before it shares any', () => {
    const { repo } = repoWith({ '1-a.dgmo': ARCH, '2-b.dgmo': LOGIN });
    checkDiagrams(repo, { dgmo });
    const lines = callLines();
    expect(lines.map((line) => line.split(' ')[0]?.endsWith('.dgmo') ? 'check' : line.split(' ')[0])).toEqual([
      'check',
      'check',
      'share',
      'share',
    ]);
    expect(lines.slice(0, 2).every((line) => line.includes('--json'))).toBe(true);
  });

  it('reports every broken diagram with its file and line, and writes nothing', () => {
    const { repo, dir } = repoWith({
      '1-a.dgmo': 'boxes-and-lines A\nRENDER-ERROR\n',
      '2-b.dgmo': LOGIN,
      '3-c.dgmo': 'sequence C\nRENDER-ERROR\n',
    });
    expect(() => checkDiagrams(repo, { dgmo })).toThrow(
      /2 of 3 diagrams have errors[\s\S]*docs\/diagrams\/1-a\.dgmo: Line 2: [\s\S]*docs\/diagrams\/3-c\.dgmo: Line 2: /,
    );
    expect(existsSync(join(dir, INDEX_FILE))).toBe(false);
    expect(callLines().some((line) => line.startsWith('share'))).toBe(false);
  });

  it('lists a diagram too large for a link without one', () => {
    const { repo } = repoWith({ '1-big.dgmo': 'boxes-and-lines Big\nTOO-LARGE\n' });
    const index = readFileSync(checkDiagrams(repo, { dgmo }), 'utf8');
    expect(index).toContain('| Big | [1-big.dgmo](1-big.dgmo) | Too large for a link — open the file in Diagrammo |');
  });

  it('stops on any other share failure', () => {
    const { repo } = repoWith({ '1-a.dgmo': 'boxes-and-lines A\nSHARE-CRASH\n' });
    expect(() => checkDiagrams(repo, { dgmo })).toThrow(/dgmo share failed for 1-a\.dgmo/);
  });

  it('shares nothing and drops the Open column with links off', () => {
    const { repo } = repoWith({ '1-a.dgmo': ARCH });
    const index = readFileSync(checkDiagrams(repo, { dgmo, links: false }), 'utf8');
    expect(index).toContain('| Service Map | [1-a.dgmo](1-a.dgmo) |\n');
    expect(index).not.toContain('Open in Diagrammo');
    expect(callLines().some((line) => line.startsWith('share'))).toBe(false);
  });

  it('falls back to the file name for a diagram with no title', () => {
    const { repo } = repoWith({ '1-untitled.dgmo': '// a comment first\n\nsequence\nA -call-> B\n' });
    expect(readFileSync(checkDiagrams(repo, { dgmo }), 'utf8')).toContain('| 1-untitled | [1-untitled.dgmo]');
  });

  it('rewrites its own index but never a README.md someone else wrote', () => {
    const { repo, dir } = repoWith({ '1-a.dgmo': ARCH });
    checkDiagrams(repo, { dgmo });
    expect(() => checkDiagrams(repo, { dgmo })).not.toThrow();

    writeFileSync(join(dir, INDEX_FILE), '# Our diagrams\n\nHand-written.\n');
    expect(() => checkDiagrams(repo, { dgmo })).toThrow(/README\.md exists and was not written by this skill/);
    expect(readFileSync(join(dir, INDEX_FILE), 'utf8')).toBe('# Our diagrams\n\nHand-written.\n');
  });

  it('says where to write the diagrams when there are none', () => {
    const repo = mkdtempSync(join(tmpdir(), 'skills-repo-diagrams-'));
    expect(() => checkDiagrams(repo, { dgmo })).toThrow(/No docs\/diagrams directory/);
    mkdirSync(join(repo, OUTPUT_DIR), { recursive: true });
    expect(() => checkDiagrams(repo, { dgmo })).toThrow(/No \.dgmo files/);
  });
});

describe('main', () => {
  it('prints the index path, with the link notice on stderr, and exits 0', () => {
    const { repo, dir } = repoWith({ '1-a.dgmo': ARCH });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main([repo], { dgmo })).toBe(0);
    expect(log).toHaveBeenCalledWith(join(dir, INDEX_FILE));
    expect(error).toHaveBeenCalledWith(LINK_NOTICE);
  });

  it('exits 1 with the errors when a diagram is broken', () => {
    const { repo } = repoWith({ '1-a.dgmo': 'boxes-and-lines A\nRENDER-ERROR\n' });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main([repo], { dgmo })).toBe(1);
    expect(String(error.mock.calls[0]?.[0])).toMatch(/^Error: 1 of 1 diagrams have errors/);
  });

  it('exits 2 on an unknown flag or a second directory', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(main(['--bogus'], { dgmo })).toBe(2);
    expect(main(['a', 'b'], { dgmo })).toBe(2);
  });
});
