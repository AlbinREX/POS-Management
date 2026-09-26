import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, open, readdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import postgresClient from 'pg';
import { provisionRuntime } from './provision-runtime.mjs';

function run(args, env = process.env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolveRun() : reject(new Error(`${args[0]} exited ${code}`)),
    );
  });
}
function runBinary(binary, args) {
  return new Promise((done, reject) => {
    const child = spawn(binary, args, { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? done() : reject(new Error('PostgreSQL lifecycle command failed')),
    );
  });
}
async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}
const port = await unusedPort();
// The OS may reserve port 3000 (e.g. Windows Hyper-V). Browser tests use an available loopback port.
let browserPort = await unusedPort();
while (browserPort === port || browserPort === 4000) browserPort = await unusedPort();
const browserOrigin = `http://localhost:${browserPort}`;
const suffix = randomBytes(6).toString('hex');
const clusterDir = resolve('.local', `test-pg-${suffix}`);
await mkdir('.local', { recursive: true });
const dbPassword = randomBytes(32).toString('hex');
const appPassword = randomBytes(32).toString('hex');
const ownerPassword = randomBytes(24).toString('base64url');
const migrationUrl = `postgresql://postgres:${dbPassword}@127.0.0.1:${port}/restaurant_test`;
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: `postgresql://restaurant_app:${appPassword}@127.0.0.1:${port}/restaurant_test`,
  MIGRATION_DATABASE_URL: migrationUrl,
  APP_DATABASE_PASSWORD: appPassword,
  JWT_SECRET: randomBytes(64).toString('hex'),
  APP_ORIGIN: browserOrigin,
  PORT: '4000',
  TRUST_PROXY: '0',
  // Menu image uploads for this run, kept beside the isolated cluster for debugging.
  MEDIA_ROOT: resolve('.local', `test-media-${suffix}`),
  SEED_ORGANIZATION_SLUG: 'verification',
  SEED_ORGANIZATION_NAME: 'Verification organization',
  SEED_BRANCH_CODE: 'main',
  SEED_BRANCH_NAME: 'Verification branch',
  SEED_OWNER_NAME: 'Verification owner',
  SEED_OWNER_EMAIL: 'owner@verification.test',
  SEED_OWNER_PASSWORD: ownerPassword,
});
const pgLog = (message) => appendFileSync(resolve('.local', 'postgres-test.log'), String(message));
const pg = new EmbeddedPostgres({
  databaseDir: clusterDir,
  port,
  user: 'postgres',
  password: dbPassword,
  authMethod: 'scram-sha-256',
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
  onLog: pgLog,
  onError: pgLog,
});
const windowsBinaries =
  process.platform === 'win32' ? await import('@embedded-postgres/windows-x64') : undefined;
let app;
let next;
let nextLog;
let started = false;
try {
  await pg.initialise();
  // pg_ctl uses a restricted Windows token; direct postgres.exe refuses elevated accounts.
  if (windowsBinaries)
    await runBinary(windowsBinaries.pg_ctl, [
      '-D',
      clusterDir,
      '-l',
      resolve('.local', `pg-${suffix}.log`),
      '-o',
      `-p ${port} -h 127.0.0.1`,
      '-w',
      'start',
    ]);
  else await pg.start();
  started = true;
  const bootstrap = new postgresClient.Client({
    connectionString: `postgresql://postgres:${dbPassword}@127.0.0.1:${port}/postgres`,
  });
  await bootstrap.connect();
  try {
    await bootstrap.query('CREATE DATABASE restaurant_test');
  } finally {
    await bootstrap.end();
  }
  console.log('PASS: real PostgreSQL 17 started on loopback');
  await run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
  await run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
  await provisionRuntime();
  await run(['packages/database/dist/seed.js']);
  await run(['node_modules/tsx/dist/cli.mjs', 'packages/database/src/seed.ts']);
  const { createApp } = await import('../apps/api/dist/bootstrap.js');
  app = await createApp();
  const { runIntegration } = await import('../tests/integration/foundation.mjs');
  await runIntegration(app);
  await app.close();
  app = await createApp();
  const { runMenuIntegration } = await import('../tests/integration/menu.mjs');
  await runMenuIntegration(app);
  await app.close();
  app = await createApp();
  const { runMenuOffersIntegration } = await import('../tests/integration/menu-offers.mjs');
  await runMenuOffersIntegration(app);
  await app.close();
  app = await createApp();
  const { runLayoutIntegration } = await import('../tests/integration/layout.mjs');
  await runLayoutIntegration(app);
  await app.close();
  app = await createApp();
  const { runOrderIntegration } = await import('../tests/integration/orders.mjs');
  await runOrderIntegration(app);
  await app.close();
  app = await createApp();
  const { runKitchenIntegration } = await import('../tests/integration/kitchen.mjs');
  await runKitchenIntegration(app);
  await app.close();
  app = await createApp();
  const { runPaymentIntegration } = await import('../tests/integration/payments.mjs');
  await runPaymentIntegration(app);
  await app.close();
  app = await createApp();
  const { runInventoryIntegration } = await import('../tests/integration/inventory.mjs');
  await runInventoryIntegration(app);
  await app.close();
  app = await createApp();
  const { runPurchasingIntegration } = await import('../tests/integration/purchasing.mjs');
  await runPurchasingIntegration(app);
  await app.close();
  app = await createApp();
  const { runCompaniesIntegration } = await import('../tests/integration/companies.mjs');
  await runCompaniesIntegration(app);
  await app.close();
  app = await createApp();
  const { runWaiterIntegration } = await import('../tests/integration/waiter.mjs');
  await runWaiterIntegration(app);
  await app.close();
  app = await createApp();
  const { runReportingIntegration } = await import('../tests/integration/reporting.mjs');
  await runReportingIntegration(app);
  await app.close();
  app = await createApp();
  const { runSyncIntegration } = await import('../tests/integration/sync.mjs');
  await runSyncIntegration(app);
  await app.close();
  app = await createApp();
  const { runOpsIntegration } = await import('../tests/integration/ops.mjs');
  await runOpsIntegration(app);
  await app.close();
  app = await createApp();
  const { runFiscalIntegration } = await import('../tests/integration/fiscal.mjs');
  await runFiscalIntegration(app);
  if (process.argv.includes('--browser')) {
    // Fresh limiter state for independent browser acceptance tests.
    await app.close();
    app = await createApp();
    await app.listen(4000, '127.0.0.1');
    nextLog = await open(resolve('.local', 'next-test.log'), 'w');
    next = spawn(
      process.execPath,
      [
        'node_modules/next/dist/bin/next',
        'start',
        'apps/admin',
        '-p',
        String(browserPort),
        '-H',
        '127.0.0.1',
      ],
      {
        env: { ...process.env, NODE_ENV: 'production' },
        stdio: ['ignore', nextLog.fd, nextLog.fd],
        windowsHide: true,
      },
    );
    let ready = false;
    for (let i = 0; i < 40; i++) {
      if (next.exitCode !== null)
        throw new Error('Next.js exited before readiness; see .local/next-test.log');
      try {
        if ((await fetch(browserOrigin)).ok) {
          ready = true;
          break;
        }
      } catch {
        /* Wait until the local app listens. */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error('Next.js readiness timeout');
    // Independent workflows share a loopback IP in tests. Reset only the test API
    // between files/devices, preserving production limits and the shared database.
    const browserArgs = process.argv.slice(process.argv.indexOf('--browser') + 1);
    const browserRuns = browserArgs.length
      ? [browserArgs]
      : (await readdir('tests/e2e'))
          .filter((name) => name.endsWith('.spec.ts'))
          .sort()
          .map((name) => ['tests/e2e/' + name]);
    const browserFailures = [];
    for (const project of ['desktop', 'mobile']) {
      for (const browserRun of browserRuns) {
        await app.close();
        app = await createApp();
        await app.listen(4000, '127.0.0.1');
        try {
          await run([
            'node_modules/@playwright/test/cli.js',
            'test',
            ...browserRun,
            '--project=' + project,
          ]);
        } catch (error) {
          // Finish independent workflows to report all bilingual regressions in one
          // run. Any failure still fails the gate; no success report is written.
          browserFailures.push(`${project}: ${browserRun.join(' ')}`);
          console.error(error.message);
        }
      }
    }
    if (browserFailures.length)
      throw new Error(`Browser workflows failed: ${browserFailures.join(', ')}`);
  }
  await writeFile(
    resolve('.local', 'last-verification.json'),
    JSON.stringify(
      {
        completedAt: new Date().toISOString(),
        postgres: '17.10',
        migrations: 'passed twice',
        seed: 'passed twice',
        integration: 'passed',
        browser: process.argv.includes('--browser') ? 'passed' : 'not run',
        docker: 'not run by this harness',
      },
      null,
      2,
    ),
  );
} finally {
  if (next && next.exitCode === null) {
    next.kill();
    await new Promise((r) => next.once('exit', r));
  }
  await nextLog?.close();
  await app?.close();
  if (started) {
    if (windowsBinaries)
      await runBinary(windowsBinaries.pg_ctl, ['-D', clusterDir, '-m', 'fast', '-w', 'stop']);
    else await pg.stop();
  }
  // Keep isolated cluster for debugging. Never delete or reuse an operator database.
}
