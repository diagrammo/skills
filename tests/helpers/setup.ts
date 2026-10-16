import { afterEach } from 'vitest';
import { removeTempDirs } from './tmp.js';

// Every tempDir() is removed on success and on failure; /tmp is a quota-limited tmpfs on anchor.
afterEach(removeTempDirs);
