import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { networkInterfaces } from 'node:os';
import { createAgent } from '../../apps/device-agent/src/agent';

/**
 * The Device Agent's security posture, exercised against a running agent.
 *
 * These are the properties that matter most in this feature: the agent owns the
 * restaurant's hardware, so anything that could reach it from outside the machine, or
 * name its own destination, would be a serious hole.
 */
const TOKEN = 'a'.repeat(48);
const ORIGIN = 'http://localhost:3000';
const PORT = 7719;
const agent = createAgent({
  port: PORT,
  token: TOKEN,
  allowedOrigin: ORIGIN,
  apiBaseUrl: ORIGIN,
});
const auth = { Authorization: `Bearer ${TOKEN}` };
const call = (path: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${PORT}${path}`, {
    ...init,
    headers: { Origin: ORIGIN, ...(init.headers ?? {}) },
  });

beforeAll(async () => {
  await agent.listen();
});
afterAll(async () => {
  await agent.close();
});

describe('Device Agent is not reachable from the network', () => {
  it('binds loopback only, so nothing on the restaurant LAN can drive the hardware', async () => {
    const lan = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal);
    if (!lan) return; // No LAN interface in this environment to prove it against.
    let reachable = false;
    try {
      const response = await fetch(`http://${lan.address}:${PORT}/status`, {
        signal: AbortSignal.timeout(2000),
      });
      reachable = response.ok;
    } catch {
      reachable = false;
    }
    expect(reachable, `agent answered on ${lan.address}`).toBe(false);
  });
});

describe('Device Agent authentication', () => {
  it('refuses a request with no token', async () => {
    expect((await call('/status')).status).toBe(401);
  });
  it('refuses a wrong token', async () => {
    expect(
      (await call('/status', { headers: { Authorization: `Bearer ${'b'.repeat(48)}` } })).status,
    ).toBe(401);
  });
  it('accepts the configured token and advertises only real capabilities', async () => {
    const response = await call('/status', { headers: auth });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { agent: string; capabilities: string[] };
    expect(body.agent).toBe('riza-device-agent');
    // Only adapters that can genuinely drive hardware are advertised, so the operator
    // view never implies a capability the agent does not have.
    expect(body.capabilities).toEqual(['network-printer']);
  });
  it('refuses any origin but the POS', async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/status`, {
      headers: { Origin: 'http://evil.example', ...auth },
    });
    expect(response.status).toBe(403);
  });
});

describe('Device Agent command allowlist', () => {
  it.each(['/shell', '/exec', '/eval', '/../etc/passwd', '/print/../shell', '/status2', '/'])(
    'refuses %s',
    async (path) => {
      expect((await call(path, { headers: auth })).status).toBe(404);
    },
  );
});

describe('Device Agent never accepts a destination from its caller', () => {
  it('requires a device id and ignores any address in the body', async () => {
    // Every command names a saved device; the agent then asks the API for that device's
    // address. A host or port in the body has nowhere to go.
    const response = await call('/print', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        host: '8.8.8.8',
        tcpPort: 9100,
        port: 'COM9',
        path: 'C:/Windows/System32',
        document: {},
      }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toEqual({
      error: 'A device id is required',
    });
  });
  it('refuses a device id that is not a uuid', async () => {
    for (const deviceId of ['../../etc', 'COM3', '1; DROP TABLE', '']) {
      const response = await call('/test', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      expect(response.status, deviceId).toBe(400);
    }
  });
  it('refuses a malformed body rather than guessing at it', async () => {
    const response = await call('/print', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(response.status).toBe(400);
  });
});
