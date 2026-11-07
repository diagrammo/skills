import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The plugin directory flags a plugin that reads a token from the user's
// machine (#1733). A credential comes through a sensitive userConfig option,
// never a file or an environment variable outside the plugin.
const ROOT = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('no credential read from the user machine', () => {
  it.each(['README.md', 'skills/dgmo-codebase-report/SKILL.md'])('%s names no saved session file', (path) => {
    expect(read(path)).not.toContain('session.json');
  });

  it('the test stand-in names no API key variable', () => {
    expect(read('tests/helpers/fake-dgmo.mjs')).not.toContain("env['DGMO_API_KEY']");
  });
});
