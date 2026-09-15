import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'FastFood Riza · POS',
  description: 'FastFood Riza restaurant workspace',
  manifest: '/manifest.webmanifest',
  applicationName: 'FastFood Riza',
  icons: {
    icon: [
      { url: '/icons/waiter-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/waiter-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/waiter-192.png', sizes: '192x192', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Riza Waiter',
    statusBarStyle: 'black-translucent',
  },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Waiters hold the device one-handed during service; the shell must fill the
  // screen under the notch without the page itself scrolling horizontally.
  viewportFit: 'cover',
  themeColor: '#111214',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
