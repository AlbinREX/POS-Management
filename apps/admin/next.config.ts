import type { NextConfig } from 'next';
// One fixed loopback port for the Device Agent on the restaurant PC.
const agentPort = process.env.NEXT_PUBLIC_DEVICE_AGENT_PORT ?? '7717';
const agentOrigin = `http://127.0.0.1:${agentPort}`;
const config: NextConfig = {
  transpilePackages: ['@restaurant/ui'],
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'" +
              (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '') +
              "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' " +
              // The local Device Agent, and nothing else. It listens on loopback only,
              // which browsers treat as a trustworthy origin, so an HTTPS page may call
              // it without weakening the policy for any other destination.
              agentOrigin +
              "; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },
};
export default config;
