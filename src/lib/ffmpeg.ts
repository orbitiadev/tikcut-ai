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

async function readMp4(ffmpeg: FFmpeg, outputName: string): Promise<Blob> {
  const data = await ffmpeg.readFile(outputName);
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
  if (bytes.byteLength < 1024) throw new Error('O arquivo gerado ficou vazio ou inválido.');
  return new Blob([bytes.slice().buffer], { type: 'video/mp4' });
}

async function execWithLogs(ffmpeg: FFmpeg, args: string[]): Promise<{ exitCode: number; tail: string }> {
  const messages: string[] = [];
  const listener = ({ message }: { message: string }) => {
    messages.push(message);
    if (messages.length > 30) messages.shift();
  };
  ffmpeg.on('log', listener);
  try {
    const exitCode = await ffmpeg.exec(args);
    return { exitCode, tail: messages.slice(-8).join(' | ') };
  } finally {
    ffmpeg.off('log', listener);
  }
}

function validateInterval(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Intervalo de corte inválido.');
  const duration = end - start;
  if (duration > 600) throw new Error('Para manter a estabilidade no navegador, gere trechos de até 10 minutos por vez. A fonte pode ter mais de 1 hora.');
  return duration;
}

export async function exportCutMp4(
  file: File,
  start: number,
  end: number,
  onProgress: (ratio: number) => void
): Promise<Blob> {
  const duration = validateInterval(start, end);
  const ffmpeg = await getFFmpeg(onProgress);
  const outputName = `tikcut-cut-${crypto.randomUUID()}.mp4`;

  try {
    return await withMountedFile(ffmpeg, file, async (inputPath) => {
      onProgress(0.05);
      const fast = await execWithLogs(ffmpeg, [
        '-hide_banner',
        '-ss', start.toFixed(3),
        '-i', inputPath,
        '-t', duration.toFixed(3),
        '-map', '0:v:0?',
        '-map', '0:a:0?',
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        '-movflags', '+faststart',
        outputName,
      ]);

      if (fast.exitCode === 0) {
        try {
          const blob = await readMp4(ffmpeg, outputName);
          onProgress(1);
          return blob;
        } catch {
          try { await ffmpeg.deleteFile(outputName); } catch { /* retry below */ }
        }
      } else {
        try { await ffmpeg.deleteFile(outputName); } catch { /* retry below */ }
      }

      onProgress(0.12);
      const fallback = await execWithLogs(ffmpeg, [
        '-hide_banner',
        '-ss', start.toFixed(3),
        '-i', inputPath,
        '-t', duration.toFixed(3),
        '-map', '0:v:0?',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '22',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        outputName,
      ]);

      if (fallback.exitCode !== 0) {
        const detail = fallback.tail || fast.tail;
        throw new Error(`Não foi possível gerar o corte. FFmpeg encerrou com código ${fallback.exitCode}${detail ? `: ${detail}` : ''}`);
      }

      const blob = await readMp4(ffmpeg, outputName);
      onProgress(1);
      return blob;
    });
  } finally {
    activeProgress = null;
    try { await ffmpeg.deleteFile(outputName); } catch { /* cleanup best effort */ }
  }
}

export async function exportVerticalMp4(
  file: File,
  start: number,
  end: number,
  onProgress: (ratio: number) => void
): Promise<Blob> {
  const duration = validateInterval(start, end);
  const ffmpeg = await getFFmpeg(onProgress);
  const outputName = `tikcut-vertical-${crypto.randomUUID()}.mp4`;
  try {
    return await withMountedFile(ffmpeg, file, async (inputPath) => {
      const result = await execWithLogs(ffmpeg, [
        '-hide_banner',
        '-ss', start.toFixed(3),
        '-i', inputPath,
        '-t', duration.toFixed(3),
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '160k',
        '-movflags', '+faststart',
        outputName,
      ]);
      if (result.exitCode !== 0) throw new Error(`FFmpeg encerrou com código ${result.exitCode}${result.tail ? `: ${result.tail}` : ''}`);
      return readMp4(ffmpeg, outputName);
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
