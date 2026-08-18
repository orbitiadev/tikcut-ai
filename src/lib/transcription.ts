import { extractAudioWav } from './ffmpeg';
import type { TranscriptChunk } from './studioTypes';

export type TranscriptionLanguage = 'auto' | 'portuguese' | 'english' | 'spanish';

export type LocalTranscriptionResult = {
  text: string;
  chunks: TranscriptChunk[];
  model: string;
  device: 'webgpu' | 'wasm';
};

type PipelineLike = (input: string | URL | Float32Array, options?: Record<string, unknown>) => Promise<{
  text?: string;
  chunks?: Array<{ text?: string; timestamp?: [number | null, number | null] }>;
}>;

let cachedPipeline: PipelineLike | null = null;
let cachedDevice: 'webgpu' | 'wasm' = 'wasm';
let loadingPromise: Promise<PipelineLike> | null = null;

function hasWebGpu() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

async function loadWhisper(onStatus?: (status: string) => void): Promise<PipelineLike> {
  if (cachedPipeline) return cachedPipeline;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { pipeline } = await import('@huggingface/transformers');
    const model = 'Xenova/whisper-tiny';
    const progressCallback = (progress: unknown) => {
      if (!onStatus || !progress || typeof progress !== 'object') return;
      const item = progress as { status?: string; file?: string; progress?: number };
      if (typeof item.progress === 'number') onStatus(`Baixando/carregando Whisper: ${Math.round(item.progress)}%${item.file ? ` · ${item.file}` : ''}`);
      else if (item.status) onStatus(`Whisper: ${item.status}${item.file ? ` · ${item.file}` : ''}`);
    };

    if (hasWebGpu()) {
      try {
        onStatus?.('Carregando Whisper local com aceleração WebGPU…');
        const result = await pipeline('automatic-speech-recognition', model, {
          device: 'webgpu',
          progress_callback: progressCallback,
        });
        cachedDevice = 'webgpu';
        cachedPipeline = result as unknown as PipelineLike;
        return cachedPipeline;
      } catch {
        onStatus?.('WebGPU não ficou disponível para o Whisper. Usando WASM local…');
      }
    }

    const result = await pipeline('automatic-speech-recognition', model, {
      progress_callback: progressCallback,
    });
    cachedDevice = 'wasm';
    cachedPipeline = result as unknown as PipelineLike;
    return cachedPipeline;
  })().finally(() => { loadingPromise = null; });

  return loadingPromise;
}

export async function transcribeVideoLocally(
  file: File,
  start: number,
  end: number,
  language: TranscriptionLanguage,
  onStatus?: (status: string) => void,
  onProgress?: (ratio: number) => void,
): Promise<LocalTranscriptionResult> {
  if (!file) throw new Error('Importe um vídeo antes de transcrever.');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Selecione um intervalo válido para transcrição.');
  if (end - start > 600) throw new Error('Transcreva até 10 minutos por vez. Em vídeos longos, use trechos consecutivos.');

  onStatus?.('Extraindo áudio mono 16 kHz do trecho selecionado…');
  const wav = await extractAudioWav(file, start, end, onProgress ?? (() => undefined));
  const audioUrl = URL.createObjectURL(wav);
  try {
    const transcriber = await loadWhisper(onStatus);
    onStatus?.(`Transcrevendo localmente com Whisper (${cachedDevice.toUpperCase()})…`);
    const options: Record<string, unknown> = {
      task: 'transcribe',
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    };
    if (language !== 'auto') options.language = language;
    const result = await transcriber(audioUrl, options);
    const text = (result.text ?? '').trim();
    const chunks = (result.chunks ?? []).flatMap((chunk) => {
      const [rawStart, rawEnd] = chunk.timestamp ?? [null, null];
      if (typeof rawStart !== 'number') return [];
      const chunkStart = start + rawStart;
      const chunkEnd = start + (typeof rawEnd === 'number' ? rawEnd : rawStart + 2);
      return [{ text: (chunk.text ?? '').trim(), start: chunkStart, end: Math.min(end, Math.max(chunkStart + 0.05, chunkEnd)) } satisfies TranscriptChunk];
    }).filter((chunk) => chunk.text);
    if (!text && !chunks.length) throw new Error('O Whisper terminou sem encontrar fala reconhecível neste trecho.');
    return { text, chunks, model: 'Xenova/whisper-tiny', device: cachedDevice };
  } finally {
    URL.revokeObjectURL(audioUrl);
  }
}
