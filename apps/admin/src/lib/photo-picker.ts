/**
 * Choosing a menu photo from this PC.
 *
 * The chosen file is only a source: it is previewed in the browser and uploaded through
 * the normal menu media API when the product is saved. No local path ever reaches the
 * server or a stored record; a File carries only its bare name.
 *
 * "Browse photos on this device" prefers a native picker registered by the local Device
 * Agent, which can open the agent's configured photo folder directly. The browser alone
 * cannot open an arbitrary absolute folder, so until such a picker is registered, it falls
 * back to the browser's own native file dialog, which remembers the folder last used for
 * menu photos. "Choose photo normally" is the standard file input and works everywhere.
 */

export const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const PHOTO_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;
export const PHOTO_ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';
export const PHOTO_LIMIT_BYTES = 5 * 1024 * 1024;
/** One remembered folder for every menu photo dialog in the browser fallback. */
export const PHOTO_PICKER_ID = 'riza-menu-photos';

/**
 * A native picker provided by the local Device Agent. It takes no arguments: the folder it
 * opens and every file rule are the agent's own configuration, so the browser can never
 * name a path. It resolves to the one chosen file, or null when the operator cancels.
 */
export type NativePhotoPicker = () => Promise<File | null>;
let nativePicker: NativePhotoPicker | null = null;
export function registerNativePhotoPicker(picker: NativePhotoPicker | null) {
  nativePicker = picker;
}

interface FilePickerWindow {
  showOpenFilePicker?: (options: {
    id?: string;
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<{ getFile(): Promise<File> }[]>;
}

export type BrowseSource = 'agent' | 'browser' | null;
/** Which native picker "Browse photos on this device" will use here, if any. */
export function browseSource(target: unknown = globalThis): BrowseSource {
  if (nativePicker) return 'agent';
  const w = target as FilePickerWindow & { isSecureContext?: boolean };
  return typeof w.showOpenFilePicker === 'function' && w.isSecureContext !== false ? 'browser' : null;
}

/**
 * Open the native picker for one photo. Resolves to null when the operator cancels, which
 * is not an error: nothing about the saved photo changes.
 */
export async function browseDevicePhoto(target: unknown = globalThis): Promise<File | null> {
  if (nativePicker) return nativePicker();
  const w = target as FilePickerWindow;
  if (typeof w.showOpenFilePicker !== 'function') return null;
  try {
    const [handle] = await w.showOpenFilePicker({
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
    return handle ? await handle.getFile() : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

/**
 * A quick check before previewing, so an obvious mistake is caught at once. The server
 * still identifies the real format from the bytes; this never replaces that.
 * Returns the English message the API itself would give, translated where shown.
 */
export function photoProblem(file: { name: string; type: string; size: number }): string | null {
  const name = file.name.toLowerCase();
  const typed = (PHOTO_TYPES as readonly string[]).includes(file.type);
  const named = PHOTO_EXTENSIONS.some((extension) => name.endsWith(extension));
  if (!typed && !(file.type === '' && named)) return 'Choose a PNG, JPEG or WebP image';
  if (file.size === 0) return 'Choose a PNG, JPEG or WebP image';
  if (file.size > PHOTO_LIMIT_BYTES) return 'Images must be 5 MB or smaller';
  return null;
}

/** A data: URL for the local preview. The page's CSP allows data: images, not blob:. */
export function previewOf(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
