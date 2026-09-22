import type { Metadata, Viewport } from 'next';
import './globals.css';
import { DEFAULT_LOCALE, LocaleProvider } from '../lib/i18n';
export const metadata: Metadata = {
  title: 'FastFood Riza · POS',
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
  // Albanian is the served default; LocaleProvider updates this attribute as soon as a
  // stored or query-selected language resolves on the client, so assistive technology
  // and browser translation follow whatever the operator actually chose.
  return (
    <html lang={DEFAULT_LOCALE}>
      <body>
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  );
}
