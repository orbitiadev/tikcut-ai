import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

let singleton: FFmpeg | null = null;

async function getFFmpeg(onProgress?: (ratio: number) => void): Promise<FFmpeg> {
  if (!singleton) {
    singleton = new FFmpeg();
    if (onProgress) singleton.on('progress', ({ progress }) => onProgress(progress));
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm';
    await singleton.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
    });
  }
  return singleton;
}

export async function exportVerticalMp4(
  file: File,
  start: number,
  end: number,
  onProgress: (ratio: number) => void
): Promise<Blob> {
  const ffmpeg = await getFFmpeg(onProgress);
  const inputName = `input-${Date.now()}.${file.name.split('.').pop() || 'mp4'}`;
  const outputName = `tikcut-${Date.now()}.mp4`;
  await ffmpeg.writeFile(inputName, await fetchFile(file));
  const duration = Math.max(0.1, end - start);
  await ffmpeg.exec([
    '-ss', start.toFixed(3),
    '-i', inputName,
    '-t', duration.toFixed(3),
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-movflags', '+faststart',
    outputName
  ]);
  const data = await ffmpeg.readFile(outputName);
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
  return new Blob([bytes.slice().buffer], { type: 'video/mp4' });
}
