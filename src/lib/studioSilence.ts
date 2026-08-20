import { extractAudioWav } from './ffmpeg';
import { detectSilences } from './silence';
import type { SilenceRange } from './types';

export async function detectSilencesInRange(
  file: File,
  start: number,
  end: number,
  onProgress: (ratio: number) => void = () => undefined,
  thresholdDb = -38,
  minDuration = 0.55,
): Promise<SilenceRange[]> {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Selecione um intervalo válido antes de detectar silêncios.');
  const duration = end - start;
  if (duration > 600) throw new Error('Analise no máximo 10 minutos por vez. Para vídeos longos, mova o IN/OUT e analise em partes.');

  const wav = await extractAudioWav(file, start, end, (ratio) => onProgress(Math.min(0.45, ratio * 0.45)));
  const localFile = new File([wav], `tikcut-range-${Date.now()}.wav`, { type: 'audio/wav' });
  const localRanges = await detectSilences(localFile, thresholdDb, minDuration, duration);
  onProgress(1);

  return localRanges.map((range) => ({
    start: start + range.start,
    end: start + range.end,
    duration: range.duration,
  }));
}
