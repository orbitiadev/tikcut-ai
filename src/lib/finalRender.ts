import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';

export type CaptionStyle = 'impact' | 'clean' | 'storytime';

export type BurnCaption = {
  id: string;
  text: string;
  start: number;
  end: number;
};

export type FinalRenderOptions = {
  captions: BurnCaption[];
  captionStyle: CaptionStyle;
  music?: File | null;
  musicVolume: number;
  originalVolume: number;
};

let singleton: FFmpeg | null = null;
let loadPromise: Promise<unknown> | null = null;
let activeProgress: ((ratio: number) => void) | null = null;

function coreBaseUrl() {
  return typeof window === 'undefined' ? '/ffmpeg' : `${window.location.origin}/ffmpeg`;
}

async function getFFmpeg(onProgress?: (ratio: number) => void) {
  if (!singleton) {
    singleton = new FFmpeg();
    singleton.on('progress', ({ progress }) => {
      if (activeProgress && Number.isFinite(progress)) activeProgress(Math.max(0, Math.min(1, progress)));
    });
  }
  if (!singleton.loaded) {
    if (!loadPromise) {
      const base = coreBaseUrl();
      loadPromise = singleton.load({
        coreURL: `${base}/ffmpeg-core.js`,
        wasmURL: `${base}/ffmpeg-core.wasm`,
      }).finally(() => { loadPromise = null; });
    }
    await loadPromise;
  }
  activeProgress = onProgress ?? null;
  return singleton;
}

async function mountWorkerFile(ffmpeg: FFmpeg, file: File, prefix: string) {
  const dir = `/${prefix}-${crypto.randomUUID()}`;
  await ffmpeg.createDir(dir);
  const mounted = await ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, dir);
  if (!mounted) throw new Error(`Não foi possível montar ${file.name} para o render.`);
  return {
    path: `${dir}/${file.name}`,
    async cleanup() {
      try { await ffmpeg.unmount(dir); } catch { /* best effort */ }
      try { await ffmpeg.deleteDir(dir); } catch { /* best effort */ }
    },
  };
}

async function execWithLogs(ffmpeg: FFmpeg, args: string[]) {
  const messages: string[] = [];
  const listener = ({ message }: { message: string }) => {
    messages.push(message);
    if (messages.length > 60) messages.shift();
  };
  ffmpeg.on('log', listener);
  try {
    const code = await ffmpeg.exec(args);
    return { code, tail: messages.slice(-14).join(' | ') };
  } finally {
    ffmpeg.off('log', listener);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeCaptions(captions: BurnCaption[], duration: number, maxBlocks = 60): BurnCaption[] {
  let normalized = captions
    .map((caption) => ({
      ...caption,
      text: caption.text.trim(),
      start: clamp(Number.isFinite(caption.start) ? caption.start : 0, 0, duration),
      end: clamp(Number.isFinite(caption.end) ? caption.end : 0, 0, duration),
    }))
    .filter((caption) => caption.text && caption.end - caption.start >= 0.08)
    .sort((a, b) => a.start - b.start);

  while (normalized.length > maxBlocks) {
    const merged: BurnCaption[] = [];
    for (let i = 0; i < normalized.length; i += 2) {
      const first = normalized[i];
      const second = normalized[i + 1];
      if (!second) { merged.push(first); continue; }
      merged.push({
        id: first.id,
        text: `${first.text} ${second.text}`.trim(),
        start: first.start,
        end: second.end,
      });
    }
    normalized = merged;
  }
  return normalized;
}

function splitLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 3) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  const consumed = lines.join(' ').split(' ').length;
  if (consumed < words.length && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.…]+$/, '')}…`;
  return lines;
}

async function captionPng(text: string, style: CaptionStyle): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('O navegador não conseguiu preparar a camada de legenda.');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const fontSize = style === 'impact' ? 86 : style === 'storytime' ? 74 : 68;
  ctx.font = `${style === 'impact' ? '900' : '800'} ${fontSize}px Arial, Helvetica, sans-serif`;
  const normalizedText = style === 'impact' ? text.toLocaleUpperCase('pt-BR') : text;
  const lines = splitLines(ctx, normalizedText, 900, 3);
  const lineHeight = Math.round(fontSize * 1.18);
  const blockHeight = Math.max(lineHeight, lines.length * lineHeight);
  const centerY = style === 'storytime' ? 1420 : 1500;

  if (style !== 'impact') {
    const panelWidth = Math.min(980, Math.max(420, ...lines.map((line) => ctx.measureText(line).width + 92)));
    ctx.fillStyle = style === 'storytime' ? 'rgba(0,0,0,0.72)' : 'rgba(0,0,0,0.58)';
    const x = (1080 - panelWidth) / 2;
    const y = centerY - blockHeight / 2 - 34;
    const h = blockHeight + 68;
    const radius = 34;
    ctx.beginPath();
    ctx.roundRect(x, y, panelWidth, h, radius);
    ctx.fill();
  }

  lines.forEach((line, index) => {
    const y = centerY - ((lines.length - 1) * lineHeight) / 2 + index * lineHeight;
    if (style === 'impact') {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.98)';
      ctx.lineWidth = 16;
      ctx.strokeText(line, 540, y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(line, 540, y);
    } else if (style === 'storytime') {
      ctx.fillStyle = '#ffd84d';
      ctx.fillText(line, 540, y);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillText(line, 540, y);
    }
  });

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Falha ao gerar a imagem da legenda.')), 'image/png');
  });
}

async function readMp4(ffmpeg: FFmpeg, outputName: string) {
  const data = await ffmpeg.readFile(outputName);
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
  if (bytes.byteLength < 1024) throw new Error('O vídeo final ficou vazio ou inválido.');
  return new Blob([bytes.slice().buffer], { type: 'video/mp4' });
}

function buildFilters(captions: BurnCaption[], musicIndex: number | null, duration: number, originalVolume: number, musicVolume: number, useBaseAudio: boolean) {
  const filters: string[] = ['[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[base0]'];
  let currentVideo = 'base0';
  captions.forEach((caption, index) => {
    const prepared = `cap${index}`;
    const mixed = `v${index}`;
    filters.push(`[${index + 1}:v]format=rgba[${prepared}]`);
    filters.push(`[${currentVideo}][${prepared}]overlay=0:0:enable='between(t,${caption.start.toFixed(3)},${caption.end.toFixed(3)})':eof_action=repeat:repeatlast=1:shortest=0[${mixed}]`);
    currentVideo = mixed;
  });

  let audioLabel: string | null = null;
  if (musicIndex !== null) {
    const fadeStart = Math.max(0, duration - 0.8);
    filters.push(`[${musicIndex}:a:0]atrim=0:${duration.toFixed(3)},asetpts=PTS-STARTPTS,volume=${clamp(musicVolume, 0, 1).toFixed(3)},afade=t=out:st=${fadeStart.toFixed(3)}:d=${Math.min(0.8, duration).toFixed(3)}[music]`);
    if (useBaseAudio) {
      filters.push(`[0:a:0]volume=${clamp(originalVolume, 0, 1.5).toFixed(3)}[orig]`);
      filters.push('[orig][music]amix=inputs=2:duration=first:dropout_transition=2[finala]');
      audioLabel = 'finala';
    } else {
      filters.push('[music]anull[finala]');
      audioLabel = 'finala';
    }
  } else if (useBaseAudio) {
    filters.push(`[0:a:0]volume=${clamp(originalVolume, 0, 1.5).toFixed(3)}[finala]`);
    audioLabel = 'finala';
  }

  return { filters, currentVideo, audioLabel };
}

export async function renderFinalTikTokMp4(
  baseVideo: File,
  duration: number,
  options: FinalRenderOptions,
  onProgress: (ratio: number) => void,
): Promise<Blob> {
  if (!baseVideo.type.startsWith('video/')) throw new Error('Escolha um vídeo válido para finalizar.');
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Não foi possível ler a duração do vídeo.');
  if (duration > 600) throw new Error('O Finalizador aceita vídeos de até 10 minutos por render. Para fontes maiores, gere os shorts no Editor/Studio Pro primeiro.');

  const captions = normalizeCaptions(options.captions, duration);
  const ffmpeg = await getFFmpeg(onProgress);
  const outputName = `tikcut-final-${crypto.randomUUID()}.mp4`;
  const imageNames: string[] = [];
  const baseMount = await mountWorkerFile(ffmpeg, baseVideo, 'final-base');
  const musicMount = options.music ? await mountWorkerFile(ffmpeg, options.music, 'final-music') : null;

  try {
    const argsInputs: string[] = ['-hide_banner', '-i', baseMount.path];
    for (const caption of captions) {
      const name = `caption-${crypto.randomUUID()}.png`;
      imageNames.push(name);
      const blob = await captionPng(caption.text, options.captionStyle);
      await ffmpeg.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
      argsInputs.push('-i', name);
    }

    const musicIndex = musicMount ? captions.length + 1 : null;
    if (musicMount) argsInputs.push('-stream_loop', '-1', '-i', musicMount.path);

    const attempt = async (useBaseAudio: boolean) => {
      const { filters, currentVideo, audioLabel } = buildFilters(captions, musicIndex, duration, options.originalVolume, options.musicVolume, useBaseAudio);
      const args = [
        ...argsInputs,
        '-filter_complex', filters.join(';'),
        '-map', `[${currentVideo}]`,
        ...(audioLabel ? ['-map', `[${audioLabel}]`] : []),
        '-t', duration.toFixed(3),
        '-r', '30',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22', '-pix_fmt', 'yuv420p',
        ...(audioLabel ? ['-c:a', 'aac', '-b:a', '160k'] : []),
        '-movflags', '+faststart', outputName,
      ];
      return execWithLogs(ffmpeg, args);
    };

    onProgress(0.05);
    let result = await attempt(true);
    if (result.code !== 0) {
      try { await ffmpeg.deleteFile(outputName); } catch { /* retry */ }
      result = await attempt(false);
    }
    if (result.code !== 0) throw new Error(`Não foi possível finalizar o vídeo${result.tail ? `: ${result.tail}` : ''}`);
    onProgress(1);
    return await readMp4(ffmpeg, outputName);
  } finally {
    activeProgress = null;
    for (const name of imageNames) try { await ffmpeg.deleteFile(name); } catch { /* cleanup */ }
    try { await ffmpeg.deleteFile(outputName); } catch { /* cleanup */ }
    await baseMount.cleanup();
    if (musicMount) await musicMount.cleanup();
  }
}
