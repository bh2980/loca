import type { UIMessage } from 'ai';
import { CHAT_IMAGES_MAX, IMAGE_UNSUPPORTED_NOTE, imageProblem, parseDataUrl } from '@tw/shared';

/** The images a message carries (file parts holding a data URL; they are stored with the message). */
export const imagesOf = (message: UIMessage | undefined) => (message?.parts ?? []).filter((part): part is Extract<UIMessage['parts'][number], { type: 'file' }> => part.type === 'file');

/** The new user message's images must be allowed images of a sane size; the first problem, or null. */
export function incomingImageProblem(message: UIMessage | undefined): string | null {
  if (message?.role !== 'user') return null;
  const images = imagesOf(message);
  if (images.length > CHAT_IMAGES_MAX) return `한 메시지에는 이미지를 ${CHAT_IMAGES_MAX}장까지 보낼 수 있습니다.`;
  for (const image of images) {
    const problem = imageProblem(image);
    if (problem) return problem;
  }
  return null;
}

/** An image as an ACP prompt block takes it. */
export function acpImages(message: UIMessage | undefined) {
  return imagesOf(message).flatMap((image) => {
    const parsed = parseDataUrl(image.url);
    return parsed ? [{ data: parsed.data, mimeType: parsed.mediaType }] : [];
  });
}

/** The record with every image replaced by a note, for a model that takes none (the text still goes). */
export function withoutImages(messages: UIMessage[]): UIMessage[] {
  if (!messages.some((message) => imagesOf(message).length)) return messages;
  return messages.map((message) => {
    const count = imagesOf(message).length;
    if (!count) return message;
    return { ...message, parts: [...message.parts.filter((part) => part.type !== 'file'), { type: 'text' as const, text: `(이미지 ${count}장은 ${IMAGE_UNSUPPORTED_NOTE}: 보내지 않았습니다)` }] };
  });
}
