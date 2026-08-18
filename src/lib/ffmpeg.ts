import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import type { SilenceRange } from './types';
import { keptSegmentsFromSilences } from './autopilot';
import type { ZoomKeyframe } from './studioTypes';

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

async function readBlob(ffmpeg: FFmpeg, outputName: string, type: string, minBytes = 512): Promise<Blob> {
  const data = await ffmpeg.readFile(outputName);
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
  if (bytes.byteLength < minBytes) throw new Error('O arquivo gerado ficou vazio ou inválido.');
  return new Blob([bytes.slice().buffer], { type });
}

async function readMp4(ffmpeg: FFmpeg, outputName: string): Promise<Blob> {
  return readBlob(ffmpeg, outputName, 'video/mp4', 1024);
}

async function execWithLogs(ffmpeg: FFmpeg, args: string[]): Promise<{ exitCode: number; tail: string }> {
  const messages: string[] = [];
  const listener = ({ message }: { message: string }) => {
    messages.push(message);
    if (messages.length > 40) messages.shift();
  };
  ffmpeg.on('log', listener);
  try {
    const exitCode = await ffmpeg.exec(args);
    return { exitCode, tail: messages.slice(-10).join(' | ') };
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

function escapeFilterExpression(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/,/g, '\\,').replace(/'/g, "\\'");
}

function zoomExpressions(plan: ZoomKeyframe[], fps = 30) {
  let zoom = '1';
  let focusX = '0.5';
  let focusY = '0.42';
  for (const item of [...plan].sort((a, b) => b.start - a.start)) {
    const startFrame = Math.max(0, Math.round(item.start * fps));
    const endFrame = Math.max(startFrame + 1, Math.round(item.end * fps));
    zoom = `if(between(on,${startFrame},${endFrame}),${Math.max(1, Math.min(1.35, item.zoom)).toFixed(3)},${zoom})`;
    focusX = `if(between(on,${startFrame},${endFrame}),${Math.max(0.1, Math.min(0.9, item.focusX)).toFixed(3)},${focusX})`;
    focusY = `if(between(on,${startFrame},${endFrame}),${Math.max(0.1, Math.min(0.9, item.focusY)).toFixed(3)},${focusY})`;
  }
  const x = `min(max(iw*(${focusX})-(iw/zoom/2),0),iw-iw/zoom)`;
  const y = `min(max(ih*(${focusY})-(ih/zoom/2),0),ih-ih/zoom)`;
  return { zoom: escapeFilterExpression(zoom), x: escapeFilterExpression(x), y: escapeFilterExpression(y) };
}

function verticalZoomFilter(plan: ZoomKeyframe[]) {
  const expr = zoomExpressions(plan);
  return `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='${expr.zoom}':x='${expr.x}':y='${expr.y}':d=1:s=1080x1920:fps=30,setsar=1`;
}

function projectPlanToKeptSegments(plan: ZoomKeyframe[], start: number, segments: Array<{ start: number; end: number }>): ZoomKeyframe[] {
  const project = (local: number) => {
    const absolute = start + local;
    let output = 0;
    for (const segment of segments) {
      if (absolute >= segment.end) output += segment.end - segment.start;
      else if (absolute > segment.start) return output + absolute - segment.start;
      else return output;
    }
    return output;
  };
  const total = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  return plan.flatMap((item) => {
    const mappedStart = project(item.start);
    const mappedEnd = project(item.end);
    if (mappedEnd - mappedStart < 0.12 || mappedStart >= total) return [];
    return [{ ...item, start: Math.max(0, mappedStart), end: Math.min(total, Math.max(mappedStart + 0.12, mappedEnd)) }];
  });
}

function concatFilters(segments: Array<{ start: number; end: number }>, includeAudio: boolean) {
  const filters: string[] = [];
  const inputs: string[] = [];
  segments.forEach((segment, index) => {
    filters.push(`[0:v:0]trim=start=${segment.start.toFixed(3)}:end=${segment.end.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`);
    inputs.push(`[v${index}]`);
    if (includeAudio) {
      filters.push(`[0:a:0]atrim=start=${segment.start.toFixed(3)}:end=${segment.end.toFixed(3)},asetpts=PTS-STARTPTS[a${index}]`);
      inputs.push(`[a${index}]`);
    }
  });
  filters.push(`${inputs.join('')}concat=n=${segments.length}:v=1:a=${includeAudio ? 1 : 0}[joinedv]${includeAudio ? '[joineda]' : ''}`);
  return filters;
}

async function runConcatRender(
  ffmpeg: FFmpeg,
  inputPath: string,
  outputName: string,
  segments: Array<{ start: number; end: number }>,
  options: { vertical: boolean; zoomPlan: ZoomKeyframe[]; includeAudio: boolean },
) {
  const filters = concatFilters(segments, options.includeAudio);
  const projected = projectPlanToKeptSegments(options.zoomPlan, segments[0]?.start ?? 0, segments);
  if (options.vertical || projected.length) {
    const visualFilter = options.vertical
      ? verticalZoomFilter(projected)
      : projected.length
        ? `zoompan=z='${zoomExpressions(projected).zoom}':x='${zoomExpressions(projected).x}':y='${zoomExpressions(projected).y}':d=1:fps=30,setsar=1`
        : 'null';
    filters.push(`[joinedv]${visualFilter}[finalv]`);
  } else {
    filters.push('[joinedv]null[finalv]');
  }
  if (options.includeAudio) filters.push('[joineda]anull[finala]');

  const args = [
    '-hide_banner', '-i', inputPath,
    '-filter_complex', filters.join(';'),
    '-map', '[finalv]',
    ...(options.includeAudio ? ['-map', '[finala]'] : []),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
    ...(options.includeAudio ? ['-c:a', 'aac', '-b:a', '144k'] : []),
    '-movflags', '+faststart', outputName,
  ];
  return execWithLogs(ffmpeg, args);
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
        '-hide_banner', '-ss', start.toFixed(3), '-i', inputPath, '-t', duration.toFixed(3),
        '-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', outputName,
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
        '-hide_banner', '-ss', start.toFixed(3), '-i', inputPath, '-t', duration.toFixed(3),
        '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outputName,
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
        '-hide_banner', '-ss', start.toFixed(3), '-i', inputPath, '-t', duration.toFixed(3),
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outputName,
      ]);
      if (result.exitCode !== 0) throw new Error(`FFmpeg encerrou com código ${result.exitCode}${result.tail ? `: ${result.tail}` : ''}`);
      return readMp4(ffmpeg, outputName);
    });
  } finally {
    activeProgress = null;
    try { await ffmpeg.deleteFile(outputName); } catch { /* cleanup best effort */ }
  }
}

export async function extractAudioWav(
  file: File,
  start: number,
  end: number,
  onProgress: (ratio: number) => void,
): Promise<Blob> {
  const duration = validateInterval(start, end);
  const ffmpeg = await getFFmpeg(onProgress);
  const outputName = `tikcut-audio-${crypto.randomUUID()}.wav`;
  try {
    return await withMountedFile(ffmpeg, file, async (inputPath) => {
      const result = await execWithLogs(ffmpeg, [
        '-hide_banner', '-ss', start.toFixed(3), '-i', inputPath, '-t', duration.toFixed(3),
        '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outputName,
      ]);
      if (result.exitCode !== 0) throw new Error(`Não foi possível extrair o áudio para transcrição${result.tail ? `: ${result.tail}` : ''}`);
      onProgress(1);
      return readBlob(ffmpeg, outputName, 'audio/wav', 256);
    });
  } finally {
    activeProgress = null;
    try { await ffmpeg.deleteFile(outputName); } catch { /* cleanup best effort */ }
  }
}

export async function exportWithoutSilencesMp4(
  file: File,
  start: number,
  end: number,
  silences: SilenceRange[],
  onProgress: (ratio: number) => void,
  vertical = false,
): Promise<Blob> {
  validateInterval(start, end);
  const segments = keptSegmentsFromSilences(start, end, silences);
  const ffmpeg = await getFFmpeg(onProgress);
  const outputName = `tikcut-nosilence-${crypto.randomUUID()}.mp4`;
  try {
    return await withMountedFile(ffmpeg, file, async (inputPath) => {
      onProgress(0.05);
      let result = await runConcatRender(ffmpeg, inputPath, outputName, segments, { vertical, zoomPlan: [], includeAudio: true });
      if (result.exitCode !== 0) {
        try { await ffmpeg.deleteFile(outputName); } catch { /* retry */ }
        result = await runConcatRender(ffmpeg, inputPath, outputName, segments, { vertical, zoomPlan: [], includeAudio: false });
      }
      if (result.exitCode !== 0) throw new Error(`Não foi possível remover os silêncios${result.tail ? `: ${result.tail}` : ''}`);
      onProgress(1);
      return readMp4(ffmpeg, outputName);
    });
  } finally {
    activeProgress = null;
    try { await ffmpeg.deleteFile(outputName); } catch { /* cleanup */ }
  }
}

export async function exportSmartZoomMp4(
  file: File,
  start: number,
  end: number,
  zoomPlan: ZoomKeyframe[],
  onProgress: (ratio: number) => void,
): Promise<Blob> {
  const duration = validateInterval(start, end);
  const ffmpeg = await getFFmpeg(onProgress);
  const outputName = `tikcut-autozoom-${crypto.randomUUID()}.mp4`;
  const localPlan = zoomPlan.map((item) => ({ ...item, start: Math.max(0, item.start), end: Math.min(duration, item.end) }));
  try {
    return await withMountedFile(ffmpeg, file, async (inputPath) => {
      const result = await execWithLogs(ffmpeg, [
        '-hide_banner', '-ss', start.toFixed(3), '-i', inputPath, '-t', duration.toFixed(3),
        '-vf', verticalZoomFilter(localPlan),
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac', '-b:a', '144k', '-movflags', '+faststart', outputName,
      ]);
      if (result.exitCode !== 0) throw new Error(`Não foi possível aplicar Auto Zoom${result.tail ? `: ${result.tail}` : ''}`);
      onProgress(1);
      return readMp4(ffmpeg, outputName);
    });
  } finally {
    activeProgress = null;
    try { await ffmpeg.deleteFile(outputName); } catch { /* cleanup */ }
  }
}

export async function exportAutopilotMp4(
  file: File,
  start: number,
  end: number,
  silences: SilenceRange[],
  zoomPlan: ZoomKeyframe[],
  onProgress: (ratio: number) => void,
  options: { removeSilence: boolean; vertical: boolean; autoZoom: boolean },
): Promise<Blob> {
  validateInterval(start, end);
  const segments = options.removeSilence ? keptSegmentsFromSilences(start, end, silences) : [{ start, end }];
  const ffmpeg = await getFFmpeg(onProgress);
  const outputName = `tikcut-autopilot-${crypto.randomUUID()}.mp4`;
  try {
    return await withMountedFile(ffmpeg, file, async (inputPath) => {
      const plan = options.autoZoom ? zoomPlan : [];
      onProgress(0.04);
      let result = await runConcatRender(ffmpeg, inputPath, outputName, segments, { vertical: options.vertical, zoomPlan: plan, includeAudio: true });
      if (result.exitCode !== 0) {
        try { await ffmpeg.deleteFile(outputName); } catch { /* retry */ }
        result = await runConcatRender(ffmpeg, inputPath, outputName, segments, { vertical: options.vertical, zoomPlan: plan, includeAudio: false });
      }
      if (result.exitCode !== 0) throw new Error(`Autopilot não conseguiu finalizar o vídeo${result.tail ? `: ${result.tail}` : ''}`);
      onProgress(1);
      return readMp4(ffmpeg, outputName);
    });
  } finally {
    activeProgress = null;
    try { await ffmpeg.deleteFile(outputName); } catch { /* cleanup */ }
  }
}

export async function exportImageMontageMp4(
  images: Blob[],
  sceneDurations: number[],
  onProgress: (ratio: number) => void,
): Promise<Blob> {
  if (!images.length) throw new Error('Adicione pelo menos uma imagem para criar o vídeo.');
  if (images.length !== sceneDurations.length) throw new Error('A quantidade de cenas e durações não corresponde.');
  const total = sceneDurations.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0 || total > 120) throw new Error('O vídeo de imagens deve ter entre 1 e 120 segundos.');
  const ffmpeg = await getFFmpeg(onProgress);
  const outputName = `tikcut-fruit-${crypto.randomUUID()}.mp4`;
  const inputNames: string[] = [];
  try {
    const args: string[] = ['-hide_banner'];
    for (let index = 0; index < images.length; index += 1) {
      const blob = images[index];
      const extension = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      const name = `fruit-${crypto.randomUUID()}.${extension}`;
      inputNames.push(name);
      await ffmpeg.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
      args.push('-loop', '1', '-framerate', '30', '-t', Math.max(1, sceneDurations[index]).toFixed(3), '-i', name);
    }
    const filters: string[] = [];
    for (let index = 0; index < images.length; index += 1) {
      const frames = Math.max(30, Math.round(Math.max(1, sceneDurations[index]) * 30));
      filters.push(`[${index}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0012,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,trim=duration=${(frames / 30).toFixed(3)},setpts=PTS-STARTPTS[v${index}]`);
    }
    filters.push(`${images.map((_, index) => `[v${index}]`).join('')}concat=n=${images.length}:v=1:a=0[outv]`);
    args.push('-filter_complex', filters.join(';'), '-map', '[outv]', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputName);
    const result = await execWithLogs(ffmpeg, args);
    if (result.exitCode !== 0) throw new Error(`Não foi possível montar o vídeo Fruit AI${result.tail ? `: ${result.tail}` : ''}`);
    onProgress(1);
    return readMp4(ffmpeg, outputName);
  } finally {
    activeProgress = null;
    for (const name of inputNames) try { await ffmpeg.deleteFile(name); } catch { /* cleanup */ }
    try { await ffmpeg.deleteFile(outputName); } catch { /* cleanup */ }
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
        '-hide_banner', '-nostats', '-i', inputPath, '-vn', '-af', `silencedetect=noise=${thresholdDb}dB:d=${minDuration}`, '-f', 'null', '-',
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
