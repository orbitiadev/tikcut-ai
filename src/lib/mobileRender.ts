import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';

let singleton: FFmpeg | null = null;
let loadPromise: Promise<unknown> | null = null;
let activeProgress: ((ratio: number) => void) | null = null;

function coreBaseUrl() {
  if (typeof window === 'undefined') return '/ffmpeg';
  return `${window.location.origin}/ffmpeg`;
}

async function getFFmpeg(onProgress?: (ratio: number) => void) {
  if (!singleton) {
    singleton = new FFmpeg();
    singleton.on('progress', ({ progress }) => {
      if (!activeProgress || !Number.isFinite(progress)) return;
      activeProgress(Math.max(0, Math.min(1, progress)));
    });
  }
  if (!singleton.loaded) {
    if (!loadPromise) {
      const baseURL = coreBaseUrl();
      loadPromise = singleton.load({
        coreURL: `${baseURL}/ffmpeg-core.js`,
        wasmURL: `${baseURL}/ffmpeg-core.wasm`,
      }).finally(() => { loadPromise = null; });
    }
    await loadPromise;
  }
  activeProgress = onProgress ?? null;
  return singleton;
}

async function mounted<T>(ffmpeg: FFmpeg, file: File, task: (inputPath: string) => Promise<T>) {
  const mountPoint = `/mobile-input-${crypto.randomUUID()}`;
  await ffmpeg.createDir(mountPoint);
  try {
    const ok = await ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, mountPoint);
    if (!ok) throw new Error('O navegador não conseguiu montar o vídeo no modo compatível.');
    return await task(`${mountPoint}/${file.name}`);
  } finally {
    try { await ffmpeg.unmount(mountPoint); } catch { /* best effort */ }
    try { await ffmpeg.deleteDir(mountPoint); } catch { /* best effort */ }
  }
}

export async function exportMobileVerticalMp4(
  file: File,
  start: number,
  end: number,
  onProgress: (ratio: number) => void,
): Promise<Blob> {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Intervalo móvel inválido.');
  const duration = end - start;
  if (duration > 165.05) throw new Error('No modo compatível móvel, selecione no máximo 2:45 por render.');

  const ffmpeg = await getFFmpeg(onProgress);
  const output = `tikcut-mobile-${crypto.randomUUID()}.mp4`;
  try {
    return await mounted(ffmpeg, file, async (inputPath) => {
      const exitCode = await ffmpeg.exec([
        '-hide_banner', '-ss', start.toFixed(3), '-i', inputPath, '-t', duration.toFixed(3),
        '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '27', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '112k', '-movflags', '+faststart', output,
      ]);
      if (exitCode !== 0) throw new Error(`O render móvel encerrou com código ${exitCode}.`);
      const data = await ffmpeg.readFile(output);
      const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
      if (bytes.byteLength < 1024) throw new Error('O render móvel gerou um arquivo vazio.');
      onProgress(1);
      return new Blob([bytes.slice().buffer], { type: 'video/mp4' });
    });
  } finally {
    activeProgress = null;
    try { await ffmpeg.deleteFile(output); } catch { /* best effort */ }
  }
}
