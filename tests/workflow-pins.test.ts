import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const github = resolve(import.meta.dirname, '..', '.github');
const workflows = resolve(github, 'workflows');

/**
 * Every action a workflow runs is pinned to a full commit SHA, with the
 * release it is in as a comment: `owner/action@<40 hex> # vX.Y.Z`
 * (diagrammo/diagrammo#1798, one slice of #1779). A tag like `@v6` can be
 * moved to any commit by whoever controls the action, and the CI job runs it
 * on every push and pull request.
 *
 * Local actions (`./path`) and `docker://` images are not tags, so they are
 * out of scope. `.github/dependabot.yml` keeps the pins current.
 */
describe('workflow action pins', () => {
  const files = readdirSync(workflows).filter((f) => /\.ya?ml$/.test(f));

  const uses = files.flatMap((file) =>
    readFileSync(resolve(workflows, file), 'utf8')
      .split('\n')
      .map((line, i) => ({ file, line: i + 1, text: line }))
      .filter(({ text }) => /^\s*(-\s*)?uses:/.test(text)),
  );

  it('finds the workflows it is checking', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(uses.length).toBeGreaterThan(0);
  });

  it('pins every third-party action to a commit SHA with its version', () => {
    const unpinned = uses
      .filter(({ text }) => !/uses:\s*['"]?(\.\/|docker:\/\/)/.test(text))
      .filter(({ text }) => !/uses:\s*[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v\d+\.\d+\.\d+\s*$/.test(text))
      .map(({ file, line, text }) => `${file}:${line} ${text.trim()}`);
    expect(unpinned).toEqual([]);
  });

  it('has Dependabot keep the github-actions pins current', () => {
    const config = readFileSync(resolve(github, 'dependabot.yml'), 'utf8');
    expect(config).toMatch(/package-ecosystem:\s*['"]?github-actions['"]?/);
  });
});
