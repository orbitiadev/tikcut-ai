import type { BurnCaption } from './finalRender';

export type FinalizerSeed = {
  id: string;
  file: File;
  captions?: BurnCaption[];
  sourceLabel: string;
};

export function blobAsFinalizerSeed(blob: Blob, filename: string, sourceLabel: string, captions?: BurnCaption[]): FinalizerSeed {
  const type = blob.type || 'video/mp4';
  return {
    id: crypto.randomUUID(),
    file: new File([blob], filename, { type, lastModified: Date.now() }),
    captions,
    sourceLabel,
  };
}
