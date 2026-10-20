import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const made: string[] = [];

/**
 * A fresh temp directory under the OS temp dir, removed after the test by tests/helpers/setup.ts.
 * Returned with symlinks resolved, as the scripts resolve their start: on macOS the temp dir is
 * /var/folders/…, a link to /private/var/folders/….
 */
export function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
