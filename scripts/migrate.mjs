import { spawnSync } from 'node:child_process';
import { provisionRuntime } from './provision-runtime.mjs';
const result = spawnSync(
  process.execPath,
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  { stdio: 'inherit', env: process.env },
);
if (result.status !== 0) process.exit(result.status ?? 1);
await provisionRuntime();
// Bootstrap is a separate explicit command, never part of every service restart.
