import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import type { SilenceRange } from './types';

let singleton: FFmpeg | null = null;
let loadPromise: Promise<unknown> | null = null;
let activeProgress: ((ratio: number) => void) | null = null;

function getCoreBaseUrl() {
  if (typeof window === 'undefined') return '/ffmpeg';
  return `${window.location.origin}/ffmpeg`;
}

async function getFFmpeg(onProgress?: (ratio: number) => void): Promise<FFmpeg> {
  if (!singleton) {
    singleton = new FFmpeg();
    singleton.on('progress', ({ progress }) => {
      if (!activeProgress || !Number.isFinite(progress)) return;
      activeProgress(Math.max(0, Math.min(1, progress)));
    });
  }
  if (!singleton.loaded) {
    if (!loadPromise) {
      const baseURL = getCoreBaseUrl();
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

async function withMountedFile<T>(ffmpeg: FFmpeg, file: File, task: (inputPath: string) => Promise<T>): Promise<T> {
  const mountPoint = `/input-${crypto.randomUUID()}`;
  await ffmpeg.createDir(mountPoint);
  try {
    const mounted = await ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, mountPoint);
    if (!mounted) throw new Error('O navegador não conseguiu montar o arquivo de vídeo para processamento.');
    return await task(`${mountPoint}/${file.name}`);
  } finally {
    try { await ffmpeg.unmount(mountPoint); } catch { /* cleanup best effort */ }
    try { await ffmpeg.deleteDir(mountPoint); } catch { /* cleanup best effort */ }
  }
}

export async function exportVerticalMp4(
  file: File,
  start: number,
  end: number,
  onProgress: (ratio: number) => void
): Promise<Blob> {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Intervalo de exportação inválido.');
  const duration = end - start;
  if (duration > 600) throw new Error('Para manter a estabilidade no navegador, exporte trechos de até 10 minutos por vez. A fonte pode ter mais de 1 hora.');

  const ffmpeg = await getFFmpeg(onProgress);
  const outputName = `tikcut-${crypto.randomUUID()}.mp4`;
  try {
    return await withMountedFile(ffmpeg, file, async (inputPath) => {
      const exitCode = await ffmpeg.exec([
        '-hide_banner',
        '-ss', start.toFixed(3),
        '-i', inputPath,
        '-t', duration.toFixed(3),
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '160k',
        '-movflags', '+faststart',
        outputName,
      ]);
      if (exitCode !== 0) throw new Error(`FFmpeg encerrou com código ${exitCode}.`);
      const data = await ffmpeg.readFile(outputName);
      const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
      return new Blob([bytes.slice().buffer], { type: 'video/mp4' });
    });
  } finally {
    activeProgress = null;
    try { await ffmpeg.deleteFile(outputName); } catch { /* cleanup best effort */ }
  }
}

export async function detectSilencesWithFFmpeg(
  file: File,
  thresholdDb = -38,
  minDuration = 0.55
): Promise<SilenceRange[]> {
  const ffmpeg = await getFFmpeg();
  const messages: string[] = [];
  const listener = ({ message }: { message: string }) => {
    if (message.includes('silence_start:') || message.includes('silence_end:')) messages.push(message);
  };
  ffmpeg.on('log', listener);
  try {
    await withMountedFile(ffmpeg, file, async (inputPath) => {
      const exitCode = await ffmpeg.exec([
        '-hide_banner',
        '-nostats',
        '-i', inputPath,
        '-vn',
        '-af', `silencedetect=noise=${thresholdDb}dB:d=${minDuration}`,
        '-f', 'null',
        '-',
      ]);
      if (exitCode !== 0) throw new Error(`A análise de áudio encerrou com código ${exitCode}.`);
    });
  } finally {
    ffmpeg.off('log', listener);
  }

  const ranges: SilenceRange[] = [];
  let currentStart: number | null = null;
  for (const message of messages) {
    const startMatch = message.match(/silence_start:\s*([0-9.]+)/);
    if (startMatch) {
      currentStart = Number(startMatch[1]);
      continue;
    }
    const endMatch = message.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
    if (!endMatch) continue;
    const end = Number(endMatch[1]);
    const reportedDuration = Number(endMatch[2]);
    const start = currentStart ?? Math.max(0, end - reportedDuration);
    const duration = Math.max(0, end - start);
    if (Number.isFinite(start) && Number.isFinite(end) && duration >= minDuration) ranges.push({ start, end, duration });
    currentStart = null;
  }
  return ranges;
}
