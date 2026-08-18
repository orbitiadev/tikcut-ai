import { detectSilencesWithFFmpeg } from './ffmpeg';
import type { SilenceRange } from './types';

const LONG_MEDIA_SECONDS = 20 * 60;
const LARGE_FILE_BYTES = 64 * 1024 * 1024;

async function detectWithWebAudio(file: File, thresholdDb: number, minDuration: number): Promise<SilenceRange[]> {
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) throw new Error('Web Audio API não disponível neste navegador.');
  const context = new AudioContextCtor();
  try {
    const audio = await context.decodeAudioData(await file.arrayBuffer());
    const sampleRate = audio.sampleRate;
    const data = audio.getChannelData(0);
    const windowSeconds = 0.2;
    const windowSize = Math.max(1, Math.floor(sampleRate * windowSeconds));
    const threshold = Math.pow(10, thresholdDb / 20);
    const ranges: SilenceRange[] = [];
    let silenceStart: number | null = null;

    for (let offset = 0; offset < data.length; offset += windowSize) {
      const end = Math.min(data.length, offset + windowSize);
      let sum = 0;
      for (let i = offset; i < end; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / Math.max(1, end - offset));
      const t = offset / sampleRate;
      if (rms < threshold) {
        if (silenceStart === null) silenceStart = t;
      } else if (silenceStart !== null) {
        const duration = t - silenceStart;
        if (duration >= minDuration) ranges.push({ start: silenceStart, end: t, duration });
        silenceStart = null;
      }
    }
    if (silenceStart !== null) {
      const end = data.length / sampleRate;
      const duration = end - silenceStart;
      if (duration >= minDuration) ranges.push({ start: silenceStart, end, duration });
    }
    return ranges;
  } finally {
    await context.close();
  }
}

export async function detectSilences(
  file: File,
  thresholdDb = -38,
  minDuration = 0.55,
  mediaDurationSeconds = 0
): Promise<SilenceRange[]> {
  const shouldStream = mediaDurationSeconds >= LONG_MEDIA_SECONDS || file.size >= LARGE_FILE_BYTES;
  if (shouldStream) return detectSilencesWithFFmpeg(file, thresholdDb, minDuration);

  try {
    return await detectWithWebAudio(file, thresholdDb, minDuration);
  } catch (webAudioError) {
    try {
      return await detectSilencesWithFFmpeg(file, thresholdDb, minDuration);
    } catch (ffmpegError) {
      const primary = webAudioError instanceof Error ? webAudioError.message : 'falha no Web Audio';
      const fallback = ffmpegError instanceof Error ? ffmpegError.message : 'falha no FFmpeg';
      throw new Error(`Não foi possível analisar o áudio. Web Audio: ${primary}. FFmpeg: ${fallback}.`);
    }
  }
}
