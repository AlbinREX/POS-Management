import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageUrlSchema } from '@restaurant/validation';
import {
  browseDevicePhoto,
  browseSource,
  PHOTO_ACCEPT,
  PHOTO_PICKER_ID,
  photoProblem,
  registerNativePhotoPicker,
} from '../../apps/admin/src/lib/photo-picker';

const photo = (name: string, type: string, size = 1024) =>
  new File([new Uint8Array(size)], name, { type });
afterEach(() => registerNativePhotoPicker(null));

describe('choosing a menu photo on this PC', () => {
  it('accepts PNG, JPEG and WebP up to 5 MB and says why anything else is refused', () => {
    for (const [name, type] of [
      ['burger.png', 'image/png'],
      ['burger.jpg', 'image/jpeg'],
      ['burger.jpeg', 'image/jpeg'],
      ['burger.webp', 'image/webp'],
      // Some Windows setups report no type; the extension is then enough to preview.
      ['Riza Burger.JPG', ''],
    ])
      expect(photoProblem(photo(name, type)), name).toBeNull();
    expect(photoProblem(photo('menu.gif', 'image/gif'))).toBe('Choose a PNG, JPEG or WebP image');
    expect(photoProblem(photo('menu.svg', 'image/svg+xml'))).toBe('Choose a PNG, JPEG or WebP image');
    expect(photoProblem(photo('notes.txt', ''))).toBe('Choose a PNG, JPEG or WebP image');
    expect(photoProblem(photo('empty.png', 'image/png', 0))).toBe('Choose a PNG, JPEG or WebP image');
    expect(photoProblem(photo('huge.png', 'image/png', 5 * 1024 * 1024 + 1))).toBe('Images must be 5 MB or smaller');
    expect(photoProblem(photo('edge.png', 'image/png', 5 * 1024 * 1024))).toBeNull();
    expect(PHOTO_ACCEPT).toBe('image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp');
  });

  it('opens the native dialog for one PNG, JPEG or WebP, remembering the menu photo folder', async () => {
    const chosen = photo('Riza Burger.png', 'image/png');
    const showOpenFilePicker = vi.fn(async () => [{ getFile: async () => chosen }]);
    const target = { showOpenFilePicker, isSecureContext: true };
    expect(browseSource(target)).toBe('browser');
    await expect(browseDevicePhoto(target)).resolves.toBe(chosen);
    expect(showOpenFilePicker).toHaveBeenCalledWith({
      id: PHOTO_PICKER_ID,
      multiple: false,
      excludeAcceptAllOption: true,
      types: [
        {
          description: 'PNG, JPEG, WebP',
          accept: { 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'] },
        },
      ],
    });
    // No option names a folder or path: the browser cannot, and this code never tries.
    expect(JSON.stringify(showOpenFilePicker.mock.calls)).not.toMatch(/[A-Z]:\\|Users|public/);
  });

  it('treats a cancelled dialog as no choice rather than an error', async () => {
    const target = {
      isSecureContext: true,
      showOpenFilePicker: async () => {
        throw new DOMException('The user aborted a request.', 'AbortError');
      },
    };
    await expect(browseDevicePhoto(target)).resolves.toBeNull();
    const broken = { isSecureContext: true, showOpenFilePicker: async () => { throw new DOMException('denied', 'SecurityError'); } };
    await expect(browseDevicePhoto(broken)).rejects.toThrow('denied');
  });

  it('prefers the Device Agent picker, which is given no path, and falls back without one', async () => {
    const chosen = photo('Fanta.png', 'image/png');
    const agent = vi.fn(async () => chosen);
    const browser = vi.fn();
    registerNativePhotoPicker(agent);
    const target = { showOpenFilePicker: browser, isSecureContext: true };
    expect(browseSource(target)).toBe('agent');
    await expect(browseDevicePhoto(target)).resolves.toBe(chosen);
    // The agent opens its own configured folder; the page supplies nothing to it.
    expect(agent).toHaveBeenCalledWith();
    expect(browser).not.toHaveBeenCalled();
    registerNativePhotoPicker(null);
    expect(browseSource(target)).toBe('browser');
    // Without a secure context or the API, browsing is unavailable and the normal chooser remains.
    expect(browseSource({ showOpenFilePicker: browser, isSecureContext: false })).toBeNull();
    expect(browseSource({})).toBeNull();
    await expect(browseDevicePhoto({})).resolves.toBeNull();
  });
});

describe('a stored photo is never a path on this PC', () => {
  it('refuses Windows and other local filesystem paths', () => {
    for (const local of [
      'C:\\Users\\rexhe\\Documents\\Codex\\Pos Managment FastFood\\apps\\admin\\public\\food\\Fanta.png',
      '/C:/Users/rexhe/Pictures/burger.png',
      'c:/food/burger.png',
      'file:///C:/Users/rexhe/burger.png',
      '\\\\server\\share\\burger.png',
      '/Users/rexhe/burger.png',
      '/home/pos/burger.png',
      '/food\\burger.png',
      // Other spellings of the same local file: Git Bash, WSL, percent-escaped and a
      // tab the URL parser would strip.
      '/c/Users/rexhe/Documents/Codex/Pos Managment FastFood/apps/admin/public/food/Fanta.png',
      '/mnt/c/Users/rexhe/b.png',
      '/C:%5CUsers%5Crexhe%5CPictures%5Cb.png',
      '/C%3A/Users/rexhe/b.png',
      '/%5C%5Cserver%5Cshare%5Cb.png',
      '/C:Users/x.png',
      '/\tC:/Users/x.png',
      '/food/../api/secret.png',
      '/food/sub/dir.png',
      '/images/burger.png',
    ])
      expect(imageUrlSchema.safeParse(local).success, local).toBe(false);
  });
  it('keeps uploaded, bundled and http(s) images', () => {
    for (const ok of [
      '/api/media/menu/8b6f2f4e-9e7b-4c6a-9d1e-2f3a4b5c6d7e.webp',
      '/food/riza-burger.webp',
      '/food/Riza Burger Menu 2.png',
      'https://images.restaurant.lan/burger.webp',
    ])
      expect(imageUrlSchema.safeParse(ok).success, ok).toBe(true);
  });
});
