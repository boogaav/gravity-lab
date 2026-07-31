/** Canvas screenshot / screen-record / share helpers (UI only — no physics involvement). */

import { SITE_ORIGIN } from '../state/api';

const SHARE_TEXT = 'Gravity Lab — a real N-body gravity sandbox. Drop planets, slingshot spacecraft, feed the star.';

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function sceneCanvas(): HTMLCanvasElement | null {
  return document.querySelector('canvas');
}

/**
 * Renderer bridge registered by the 3D scene. WebGL clears its drawing buffer
 * after each composite, so a plain `toDataURL` on the live canvas can come back
 * blank; this re-renders the frame and reads it back within the same task.
 */
type RenderCapture = (mime: string, quality: number, maxWidth?: number) => string | null;
let renderCapture: RenderCapture | null = null;

export function registerRenderCapture(fn: RenderCapture | null): void {
  renderCapture = fn;
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

function canvasBlob(type = 'image/png'): Promise<Blob | null> {
  const viaRenderer = renderCapture?.(type, 0.92);
  if (viaRenderer) return Promise.resolve(dataUrlToBlob(viaRenderer));
  return new Promise((resolve) => {
    const c = sceneCanvas();
    if (!c) return resolve(null);
    c.toBlob((b) => resolve(b), type);
  });
}

/** Small JPEG data URL of the current view, used as a published world's thumbnail. */
export function captureThumbnail(maxWidth = 640): string | null {
  return renderCapture?.('image/jpeg', 0.82, maxWidth) ?? null;
}

export async function takeScreenshot(): Promise<boolean> {
  const blob = await canvasBlob();
  if (!blob) return false;
  download(blob, `gravity-lab-${stamp()}.png`);
  return true;
}

// ---------------------------------------------------------------- recording

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];

export function isRecording(): boolean {
  return recorder !== null && recorder.state === 'recording';
}

export function startRecording(): boolean {
  const c = sceneCanvas();
  if (!c || recorder) return false;
  const stream = (c as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream?.(60);
  if (!stream) return false;
  const mime = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find(
    (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
  );
  if (!mime) return false;
  chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.onstop = () => {
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    download(new Blob(chunks, { type: mime }), `gravity-lab-${stamp()}.${ext}`);
    chunks = [];
    recorder = null;
  };
  recorder.start(250);
  return true;
}

export function stopRecording(): void {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}

// ---------------------------------------------------------------- share

export type ShareResult = 'shared' | 'copied' | 'failed';

export async function shareApp(opts?: { url?: string; title?: string; text?: string }): Promise<ShareResult> {
  const url = opts?.url ?? SITE_ORIGIN;
  const title = opts?.title ?? 'Gravity Lab';
  const text = opts?.text ?? SHARE_TEXT;
  // best case: native share sheet with a live snapshot attached
  try {
    if (navigator.share) {
      const blob = await canvasBlob();
      if (blob) {
        const file = new File([blob], 'gravity-lab.png', { type: 'image/png' });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ title, text, url, files: [file] });
          return 'shared';
        }
      }
      await navigator.share({ title, text, url });
      return 'shared';
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return 'shared'; // user closed the sheet
    // fall through to clipboard
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    // last resort: a selectable prompt works even where share/clipboard are blocked
    window.prompt('Copy this link to share:', url);
    return 'shared';
  }
}
