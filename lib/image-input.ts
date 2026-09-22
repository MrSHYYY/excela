// Base64 adds ~33%; this leaves room below Vercel's request body limit.
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export type ImageInput = { mimeType: string; data: string };
