// Turning a card drawing into something a fan can post: a PNG handed to the
// share sheet when the browser can share files, otherwise downloaded.

import { CARD_FONTS, CARD_HEIGHT, CARD_WIDTH } from "./cards";

/**
 * index.html loads the font stylesheet without blocking (media="print" until
 * it arrives). Until then there is no @font-face to load, and fonts.load()
 * resolves immediately with nothing, so wait for the stylesheet first.
 */
function fontStylesheetReady(): Promise<void> {
  const link = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="fonts.googleapis.com"]');
  if (!link || link.sheet) return Promise.resolve();
  return new Promise((resolve) => {
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => resolve(), { once: true });
  });
}

/** Waits (at most a few seconds) for the card fonts, so text is drawn and measured with the real faces. */
export async function loadCardFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 4000));
  const fonts = fontStylesheetReady().then(() => Promise.all(CARD_FONTS.map((f) => document.fonts.load(f))));
  await Promise.race([fonts.then(() => undefined), timeout]).catch(() => undefined);
}

/** Draws onto an existing canvas (sized to 1200x630), after fonts load. */
export async function paintCard(canvas: HTMLCanvasElement, draw: (ctx: CanvasRenderingContext2D) => void): Promise<void> {
  await loadCardFonts();
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  draw(ctx);
}

export async function renderCardBlob(draw: (ctx: CanvasRenderingContext2D) => void): Promise<Blob> {
  const canvas = document.createElement("canvas");
  await paintCard(canvas, draw);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image"))), "image/png");
  });
}

/**
 * Shares the image through the share sheet when files can be shared, else
 * downloads it. Resolves false when the fan dismissed the share sheet.
 */
export async function shareOrDownloadImage(blob: Blob, filename: string, title: string): Promise<boolean> {
  const file = new File([blob], filename, { type: "image/png" });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return true;
    } catch {
      return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
