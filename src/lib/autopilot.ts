import type { SilenceRange } from './types';
import type { AutopilotStyle, BrollQuery, StudioTimeline, TimelineItem, TranscriptChunk, ZoomKeyframe } from './studioTypes';

const STYLE_ZOOM: Record<AutopilotStyle, number> = {
  podcast: 1.08,
  storytime: 1.12,
  gaming: 1.16,
  motivacional: 1.11,
  cinematic: 1.07,
  meme: 1.18,
  satisfying: 1.09,
};

const EMPHASIS = /\b(nunca|jamais|segredo|importante|atenção|atencao|agora|olha|veja|incrível|incrivel|surpreendente|erro|problema|melhor|pior|final|descobri|descoberta|why|secret|never|look|important|mistake|best|worst)\b/i;

export function buildSmartZoomPlan(
  start: number,
  end: number,
  chunks: TranscriptChunk[],
  silences: SilenceRange[],
  style: AutopilotStyle,
): ZoomKeyframe[] {
  const duration = Math.max(0, end - start);
  if (duration <= 0) return [];
  const maxZoom = STYLE_ZOOM[style];
  const keyframes: ZoomKeyframe[] = [];

  const relevantChunks = chunks.filter((chunk) => chunk.end > start && chunk.start < end);
  for (const chunk of relevantChunks) {
    const localStart = Math.max(0, chunk.start - start);
    const localEnd = Math.min(duration, chunk.end - start);
    if (localEnd - localStart < 0.25) continue;
    const emphasized = EMPHASIS.test(chunk.text) || /[!?]/.test(chunk.text);
    if (!emphasized && keyframes.length > 0 && localStart - keyframes[keyframes.length - 1].end < 4) continue;
    keyframes.push({
      id: crypto.randomUUID(),
      start: localStart,
      end: Math.min(duration, Math.max(localStart + 1.1, Math.min(localEnd, localStart + (emphasized ? 2.2 : 1.5)))),
      zoom: emphasized ? maxZoom : Math.max(1.04, maxZoom - 0.04),
      focusX: 0.5,
      focusY: style === 'gaming' ? 0.46 : 0.42,
      reason: emphasized ? `Ênfase detectada: ${chunk.text.slice(0, 70)}` : 'Mudança visual para manter ritmo.',
    });
  }

  if (!keyframes.length) {
    const spacing = style === 'gaming' || style === 'meme' ? 3.5 : 5.5;
    for (let t = 1.5; t < duration; t += spacing) {
      const absolute = start + t;
      const isSilent = silences.some((range) => absolute >= range.start && absolute <= range.end);
      if (isSilent) continue;
      keyframes.push({
        id: crypto.randomUUID(), start: t, end: Math.min(duration, t + 1.5), zoom: maxZoom,
        focusX: 0.5, focusY: 0.42, reason: 'Zoom rítmico automático fora de pausas.',
      });
    }
  }

  return keyframes.slice(0, 30);
}

export function keptSegmentsFromSilences(start: number, end: number, silences: SilenceRange[], padding = 0.08) {
  const relevant = silences
    .map((range) => ({ start: Math.max(start, range.start - padding), end: Math.min(end, range.end + padding) }))
    .filter((range) => range.end > start && range.start < end && range.end > range.start)
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const range of relevant) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }

  const kept: Array<{ start: number; end: number }> = [];
  let cursor = start;
  for (const range of merged) {
    if (range.start - cursor >= 0.12) kept.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (end - cursor >= 0.12) kept.push({ start: cursor, end });
  return kept.length ? kept : [{ start, end }];
}

export function createStudioTimeline(duration: number): StudioTimeline {
  return {
    duration: Math.max(1, duration),
    zoomPxPerSecond: 18,
    playhead: 0,
    tracks: [
      { id: 'video', label: 'VÍDEO', locked: true, items: [{ id: crypto.randomUUID(), track: 'video', label: 'Vídeo principal', start: 0, end: Math.max(1, duration) }] },
      { id: 'broll', label: 'B-ROLL', locked: false, items: [] },
      { id: 'text', label: 'TEXTO', locked: false, items: [] },
      { id: 'audio', label: 'ÁUDIO', locked: false, muted: false, items: [{ id: crypto.randomUUID(), track: 'audio', label: 'Áudio original', start: 0, end: Math.max(1, duration) }] },
      { id: 'zoom', label: 'ZOOM/FX', locked: false, items: [] },
    ],
  };
}

export function populateTimeline(
  timeline: StudioTimeline,
  zoomPlan: ZoomKeyframe[],
  broll: BrollQuery[],
  chunks: TranscriptChunk[],
): StudioTimeline {
  const tracks = timeline.tracks.map((track) => ({ ...track, items: [...track.items] }));
  const zoomTrack = tracks.find((track) => track.id === 'zoom');
  const brollTrack = tracks.find((track) => track.id === 'broll');
  const textTrack = tracks.find((track) => track.id === 'text');
  if (zoomTrack) zoomTrack.items = zoomPlan.map((item) => ({ id: item.id, track: 'zoom', label: `${item.zoom.toFixed(2)}×`, start: item.start, end: item.end, zoom: item.zoom }));
  if (brollTrack) brollTrack.items = broll.map((item) => ({ id: item.id, track: 'broll', label: item.query, start: item.start, end: item.end }));
  if (textTrack) textTrack.items = chunks.slice(0, 80).map((item) => ({ id: crypto.randomUUID(), track: 'text', label: item.text.slice(0, 26), text: item.text, start: Math.max(0, item.start), end: Math.max(item.start + 0.25, item.end) }));
  return { ...timeline, tracks };
}

export function upsertTimelineItem(timeline: StudioTimeline, item: TimelineItem): StudioTimeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => track.id === item.track
      ? { ...track, items: [...track.items.filter((existing) => existing.id !== item.id), item].sort((a, b) => a.start - b.start) }
      : track),
  };
}

export function removeTimelineItem(timeline: StudioTimeline, itemId: string): StudioTimeline {
  return { ...timeline, tracks: timeline.tracks.map((track) => ({ ...track, items: track.items.filter((item) => item.id !== itemId) })) };
}

export function moveTimelineItem(timeline: StudioTimeline, itemId: string, delta: number): StudioTimeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      items: track.items.map((item) => {
        if (item.id !== itemId || track.locked) return item;
        const length = Math.max(0.1, item.end - item.start);
        const start = Math.max(0, Math.min(timeline.duration - length, item.start + delta));
        return { ...item, start, end: start + length };
      }),
    })),
  };
}
