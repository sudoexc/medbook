"use client";

import { DEV_TASK_THUMB_MAX_BYTES, fitWithin } from "@/lib/dev-tasks";

/**
 * A small JPEG of a screenshot, drawn in the browser before upload, so the
 * board shows a 30 KB preview per card instead of pulling a 3 MB phone
 * screenshot for each one. Null when the browser cannot draw the file
 * (HEIC in Chrome, a broken image) or the result is still too big; the
 * upload then goes without a preview and the card uses the original.
 */
export async function makeScreenshotThumb(file: File): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  try {
    const source = await decode(file);
    if (!source) return null;
    const { width, height } = fitWithin(source.width, source.height);
    if (width === 0 || height === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) return null;
    // Transparent PNG areas would turn black in a JPEG.
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, width, height);
    g.drawImage(source.image, 0, 0, width, height);
    source.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.8),
    );
    return blob && blob.size <= DEV_TASK_THUMB_MAX_BYTES ? blob : null;
  } catch {
    return null;
  }
}

type Decoded = {
  image: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

async function decode(file: File): Promise<Decoded | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      /* fall through to <img>, which Safari decodes more formats with */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return {
      image: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}
