/**
 * Browser client for the local Device Agent.
 *
 * The agent runs on the same Windows PC as the POS and listens on 127.0.0.1 only, so
 * this is the one place the browser reaches outside its own origin. A loopback address
 * is a trustworthy origin, so an HTTPS page may call it; the page's CSP allows exactly
 * this one destination and nothing else.
 *
 * The agent is optional. On a machine where it is not installed, every call fails with a
 * plain message and the rest of the application keeps working: devices can still be
 * configured, orders still take payment, and kitchen tickets are still created. Only the
 * physical delivery of paper is unavailable.
 */
const PORT = process.env.NEXT_PUBLIC_DEVICE_AGENT_PORT ?? '7717';
const TOKEN = process.env.NEXT_PUBLIC_DEVICE_AGENT_TOKEN ?? '';

/** The fixed loopback endpoint. Never a host supplied by data or by a user. */
export const agentOrigin = () => `http://127.0.0.1:${PORT}`;

/** False when this machine has no agent configured, so the UI can say so plainly. */
export const agentConfigured = () => Boolean(TOKEN);

/** The commands the agent accepts. Mirrors the agent's own allowlist. */
export type AgentCommand = 'status' | 'discover' | 'test' | 'print' | 'nfc.read';

export async function agentRequest<T>(
  command: AgentCommand,
  body?: Record<string, unknown>,
): Promise<T> {
  if (!TOKEN)
    throw new Error('The device agent is not configured on this machine.');
  let response: Response;
  try {
    response = await fetch(`${agentOrigin()}/${command}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    // A refused connection is the normal "agent is not running" case.
    throw new Error('The device agent is not running on this computer.');
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? 'The device agent refused this request.');
  }
  return (await response.json()) as T;
}
