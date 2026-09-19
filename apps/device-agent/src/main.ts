/**
 * Device Agent entry point.
 *
 * Configuration comes from the environment and fails fast: an agent that starts without
 * a token or with a guessable one would be a loopback service anybody on the machine
 * could drive, so it refuses to start instead.
 */
import { createAgent } from './agent';

const port = Number(process.env.DEVICE_AGENT_PORT ?? 7717);
const token = process.env.DEVICE_AGENT_TOKEN ?? '';
const allowedOrigin = process.env.APP_ORIGIN ?? '';
const apiBaseUrl = process.env.DEVICE_AGENT_API_URL ?? allowedOrigin;

if (!token || token.length < 32)
  throw new Error('DEVICE_AGENT_TOKEN must be at least 32 random characters');
if (/CHANGE_ME|changeme|example/i.test(token))
  throw new Error('DEVICE_AGENT_TOKEN must not be a placeholder');
if (!allowedOrigin) throw new Error('APP_ORIGIN must name the POS origin this agent serves');
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('DEVICE_AGENT_PORT must be an unprivileged port');

const agent = createAgent({ port, token, allowedOrigin, apiBaseUrl });
void agent.listen().then(() => {
  // Loopback only: the address is stated on startup so an operator can see it is not
  // exposed to the restaurant network.
  console.log(`Riza device agent listening on http://127.0.0.1:${port} for ${allowedOrigin}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => void agent.close().then(() => process.exit(0)));
