#!/usr/bin/env node
/**
 * set-executable.cjs
 *
 * Sets the executable bit (chmod +x) on the compiled CLI entry points after
 * `tsc` runs. TypeScript does NOT preserve or set the executable bit, so
 * npm/npx would refuse to run the bin with exit code 126 on macOS/Linux.
 *
 * This is a no-op on Windows (where executable bits don't apply).
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Files that must be executable as declared in package.json#bin
const EXECUTABLES = [
  path.join(__dirname, '..', 'dist', 'cli', 'index.js'),
  path.join(__dirname, '..', 'dist', 'index.js'),
];

// 0o755 = rwxr-xr-x
const EXEC_MODE = 0o755;

if (process.platform === 'win32') {
  // Windows doesn't have POSIX file modes — skip silently
  console.log('[set-executable] Skipping chmod on Windows.');
  process.exit(0);
}

let allOk = true;
for (const file of EXECUTABLES) {
  if (!fs.existsSync(file)) {
    console.error(`[set-executable] ERROR: Expected file not found: ${file}`);
    allOk = false;
    continue;
  }
  try {
    fs.chmodSync(file, EXEC_MODE);
    console.log(`[set-executable] chmod +x ${path.relative(process.cwd(), file)}`);
  } catch (err) {
    console.error(`[set-executable] ERROR: Failed to chmod ${file}: ${err.message}`);
    allOk = false;
  }
}

process.exit(allOk ? 0 : 1);
