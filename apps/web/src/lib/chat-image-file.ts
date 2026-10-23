import { CHAT_IMAGE_MAX_BYTES, CHAT_IMAGE_MAX_SIDE, CHAT_IMAGE_TYPES, dataUrlBytes } from '@tw/shared';

/** An image waiting in the composer for the next message. */
export interface PendingImage {
  id: string;
  name: string;
  mediaType: string;
  /** A base64 data URL: it is stored with the message. */
  url: string;
}

/** The size an image is scaled to so its longest side is at most `max` (never enlarged). */
export function fitSize(width: number, height: number, max = CHAT_IMAGE_MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scaled: scale < 1 };
}

const read = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * A pasted or dropped image as the composer holds it: scaled down when its longest side passes
 * CHAT_IMAGE_MAX_SIDE (JPEG, over white, so a screenshot stays small), kept as it is otherwise.
 * Throws a message to show when it cannot be attached.
 */
export async function prepareImage(file: File): Promise<PendingImage> {
  if (!(CHAT_IMAGE_TYPES as readonly string[]).includes(file.type)) throw new Error('PNG·JPEG·GIF·WebP 이미지만 붙일 수 있습니다.');
  let url = await read(file);
  // A GIF is kept whole (scaling would flatten the animation); the others shrink when large.
  if (file.type !== 'image/gif') {
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (bitmap) {
      const size = fitSize(bitmap.width, bitmap.height);
      if (size.scaled || file.size > CHAT_IMAGE_MAX_BYTES) {
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext('2d');
        if (context) {
          context.fillStyle = 'white';
          context.fillRect(0, 0, size.width, size.height);
          context.drawImage(bitmap, 0, 0, size.width, size.height);
          const shrunk = canvas.toDataURL('image/jpeg', 0.85);
          if ((dataUrlBytes(shrunk) ?? Infinity) < (dataUrlBytes(url) ?? Infinity)) url = shrunk;
        }
      }
      bitmap.close();
    }
  }
  const bytes = dataUrlBytes(url) ?? Infinity;
  if (bytes > CHAT_IMAGE_MAX_BYTES) throw new Error(`이미지가 ${Math.round(CHAT_IMAGE_MAX_BYTES / 1024 / 1024)}MB를 넘어 붙일 수 없습니다.`);
  return { id: crypto.randomUUID(), name: file.name || '붙여넣은 이미지', mediaType: url.slice(5, url.indexOf(';')), url };
}

/** Image files in a clipboard or drop: images only, and for a paste only when no text came with them. */
export const imageFilesOf = (data: DataTransfer | null) => [...(data?.files ?? [])].filter((file) => file.type.startsWith('image/'));
