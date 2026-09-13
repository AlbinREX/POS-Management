import { spawnSync } from 'node:child_process';
const required = ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'];
if (required.some((name) => !process.env[name]))
  throw new Error('Docker bootstrap requires database owner configuration');
const url = `postgresql://${encodeURIComponent(process.env.POSTGRES_USER)}:${encodeURIComponent(process.env.POSTGRES_PASSWORD)}@db:5432/${encodeURIComponent(process.env.POSTGRES_DB)}`;
const result = spawnSync(process.execPath, ['packages/database/dist/seed.js'], {
  env: { ...process.env, MIGRATION_DATABASE_URL: url },
  stdio: 'inherit',
  windowsHide: true,
});
process.exitCode = result.status ?? 1;
