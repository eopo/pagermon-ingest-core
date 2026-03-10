import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function hasGitDirectory(startDir) {
  let currentDir = startDir;

  while (true) {
    if (existsSync(resolve(currentDir, '.git'))) {
      return true;
    }

    const parentDir = resolve(currentDir, '..');
    if (parentDir === currentDir) {
      return false;
    }

    currentDir = parentDir;
  }
}

if (process.env.CI || !hasGitDirectory(packageRoot)) {
  process.exit(0);
}

const npxExecutable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npxExecutable, ['lefthook', 'install'], {
  cwd: packageRoot,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
