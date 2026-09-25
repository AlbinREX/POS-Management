import { DEFAULT_LOCALE, isLocale } from '../../lib/i18n/locale';
import { MESSAGES } from '../../lib/i18n/messages';

// Preserve the installation URL, scope, icons and identity; only display text
// follows the selected language. This response contains no authenticated data.
export function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get('lang');
  const locale = isLocale(requested) ? requested : DEFAULT_LOCALE;
  return Response.json(
    {
      name: MESSAGES['pwa.name'][locale],
      short_name: MESSAGES['pwa.shortName'][locale],
      description: MESSAGES['pwa.description'][locale],
      start_url: '/waiter',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      theme_color: '#111214',
      background_color: '#111214',
      lang: locale,
      categories: ['business', 'food'],
      icons: [
        { src: '/icons/waiter-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/waiter-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        {
          src: '/icons/waiter-maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json' } },
  );
}
