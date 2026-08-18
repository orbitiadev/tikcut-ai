import { FFmpeg } from '@ffmpeg/ffmpeg';
import type { SilenceRange } from './types';
import { keptSegmentsFromSilences } from './autopilot';

export type BrollAsset = {
  blob: Blob;
  start: number;
  end: number;
  label: string;
  sourcePage?: string;
  license?: string;
};

let compositor: FFmpeg | null = null;
let loadPromise: Promise<unknown> | null = null;
let activeProgress: ((ratio: number) => void) | null = null;

function coreBaseUrl() {
  return typeof window === 'undefined' ? '/ffmpeg' : `${window.location.origin}/ffmpeg`;
}

async function getCompositor(onProgress?: (ratio: number) => void) {
  if (!compositor) {
    compositor = new FFmpeg();
    compositor.on('progress', ({ progress }) => {
      if (activeProgress && Number.isFinite(progress)) activeProgress(Math.max(0, Math.min(1, progress)));
    });
  }
  if (!compositor.loaded) {
    if (!loadPromise) {
      const base = coreBaseUrl();
      loadPromise = compositor.load({ coreURL: `${base}/ffmpeg-core.js`, wasmURL: `${base}/ffmpeg-core.wasm` }).finally(() => { loadPromise = null; });
    }
    await loadPromise;
  }
  activeProgress = onProgress ?? null;
  return compositor;
}

function imageExtension(blob: Blob) {
  if (blob.type.includes('png')) return 'png';
  if (blob.type.includes('webp')) return 'webp';
  return 'jpg';
}

function outputDuration(sourceStart: number, sourceEnd: number, silences: SilenceRange[], removeSilence: boolean) {
  if (!removeSilence) return Math.max(0.1, sourceEnd - sourceStart);
  return keptSegmentsFromSilences(sourceStart, sourceEnd, silences).reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0);
}

function mapLocalTime(localSeconds: number, sourceStart: number, sourceEnd: number, silences: SilenceRange[], removeSilence: boolean) {
  const absolute = Math.max(sourceStart, Math.min(sourceEnd, sourceStart + Math.max(0, localSeconds)));
  if (!removeSilence) return absolute - sourceStart;
  const segments = keptSegmentsFromSilences(sourceStart, sourceEnd, silences);
  let elapsed = 0;
  for (const segment of segments) {
    if (absolute >= segment.end) {
      elapsed += segment.end - segment.start;
      continue;
    }
    if (absolute <= segment.start) return elapsed;
    return elapsed + absolute - segment.start;
  }
  return elapsed;
}

function projectAssets(assets: BrollAsset[], sourceStart: number, sourceEnd: number, silences: SilenceRange[], removeSilence: boolean) {
  const total = outputDuration(sourceStart, sourceEnd, silences, removeSilence);
  return assets.flatMap((asset) => {
    const start = mapLocalTime(asset.start, sourceStart, sourceEnd, silences, removeSilence);
    const end = mapLocalTime(asset.end, sourceStart, sourceEnd, silences, removeSilence);
    if (end - start < 0.15 || start >= total) return [];
    return [{ ...asset, start: Math.max(0, start), end: Math.min(total, Math.max(start + 0.15, end)) }];
  });
}

function compactAssets(assets: BrollAsset[]) {
  const deduped: BrollAsset[] = [];
  const seen = new Set<string>();
  for (const asset of [...assets].sort((a, b) => a.start - b.start || b.end - a.end)) {
    const key = `${asset.sourcePage || ''}|${asset.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const overlaps = deduped.some((existing) => asset.start < existing.end - 0.12 && asset.end > existing.start + 0.12);
    if (overlaps) continue;
    deduped.push(asset);
    if (deduped.length >= 4) break;
  }
  return deduped;
}

async function execWithLogs(ffmpeg: FFmpeg, args: string[]) {
  const lines: string[] = [];
  const listener = ({ message }: { message: string }) => { lines.push(message); if (lines.length > 50) lines.shift(); };
  ffmpeg.on('log', listener);
  try {
    const code = await ffmpeg.exec(args);
    return { code, tail: lines.slice(-12).join(' | ') };
  } finally {
    ffmpeg.off('log', listener);
  }
}

export async function overlayBrollOnVerticalVideo(
  baseVideo: Blob,
  assets: BrollAsset[],
  sourceStart: number,
  sourceEnd: number,
  silences: SilenceRange[],
  removeSilence: boolean,
  onProgress: (ratio: number) => void,
): Promise<Blob> {
  const total = outputDuration(sourceStart, sourceEnd, silences, removeSilence);
  const projected = compactAssets(projectAssets(assets, sourceStart, sourceEnd, silences, removeSilence));
  if (!projected.length) return baseVideo;

  const ffmpeg = await getCompositor(onProgress);
  const baseName = `autopilot-base-${crypto.randomUUID()}.mp4`;
  const outputName = `autopilot-broll-${crypto.randomUUID()}.mp4`;
  const imageNames: string[] = [];
  try {
    await ffmpeg.writeFile(baseName, new Uint8Array(await baseVideo.arrayBuffer()));
    const args: string[] = ['-hide_banner', '-i', baseName];
    for (const asset of projected) {
      const name = `broll-${crypto.randomUUID()}.${imageExtension(asset.blob)}`;
      imageNames.push(name);
      await ffmpeg.writeFile(name, new Uint8Array(await asset.blob.arrayBuffer()));
      // Static B-roll only needs one source frame per second. Overlay framesync holds
      // the last image frame while the 30-fps base video continues, avoiding hundreds
      // of redundant 1080x1920 image scale operations in WebAssembly.
      args.push('-loop', '1', '-framerate', '1', '-t', Math.max(0.2, total).toFixed(3), '-i', name);
    }

    const filters: string[] = ['[0:v]setpts=PTS-STARTPTS[base0]'];
    let current = 'base0';
    projected.forEach((asset, index) => {
      const inputIndex = index + 1;
      const prepared = `br${index}`;
      const output = `mix${index}`;
      filters.push(`[${inputIndex}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p,setpts=PTS-STARTPTS[${prepared}]`);
      filters.push(`[${current}][${prepared}]overlay=0:0:enable='between(t,${asset.start.toFixed(3)},${asset.end.toFixed(3)})':eof_action=repeat:shortest=0[${output}]`);
      current = output;
    });

    args.push(
      '-filter_complex', filters.join(';'),
      '-map', `[${current}]`, '-map', '0:a:0?',
      '-t', Math.max(0.1, total).toFixed(3),
      '-r', '30',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'copy', '-movflags', '+faststart', outputName,
    );

    const result = await execWithLogs(ffmpeg, args);
    if (result.code !== 0) throw new Error(`Falha ao incorporar B-roll no vídeo${result.tail ? `: ${result.tail}` : ''}`);
    const data = await ffmpeg.readFile(outputName);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
    if (bytes.byteLength < 1024) throw new Error('O render de B-roll gerou um arquivo inválido.');
    onProgress(1);
    return new Blob([bytes.slice().buffer], { type: 'video/mp4' });
  } finally {
    activeProgress = null;
    for (const name of imageNames) try { await ffmpeg.deleteFile(name); } catch { /* cleanup */ }
    try { await ffmpeg.deleteFile(baseName); } catch { /* cleanup */ }
    try { await ffmpeg.deleteFile(outputName); } catch { /* cleanup */ }
  }
}
