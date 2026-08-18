import type { SilenceRange } from './types';

export type TranscriptChunk = {
  text: string;
  start: number;
  end: number;
};

export type SocialMetadata = {
  provider: 'chrome-ai' | 'local-heuristic';
  titles: string[];
  description: string;
  hashtags: string[];
  hooks: string[];
};

export type BrollQuery = {
  id: string;
  query: string;
  reason: string;
  start: number;
  end: number;
};

export type CommonsMedia = {
  id: string;
  title: string;
  pageUrl: string;
  thumbUrl: string;
  originalUrl: string;
  description: string;
  artist: string;
  license: string;
  licenseUrl: string;
};

export type ZoomKeyframe = {
  id: string;
  start: number;
  end: number;
  zoom: number;
  focusX: number;
  focusY: number;
  reason: string;
};

export type TimelineTrackKind = 'video' | 'broll' | 'text' | 'audio' | 'zoom';

export type TimelineItem = {
  id: string;
  track: TimelineTrackKind;
  label: string;
  start: number;
  end: number;
  sourceUrl?: string;
  sourcePage?: string;
  license?: string;
  text?: string;
  zoom?: number;
};

export type TimelineTrack = {
  id: TimelineTrackKind;
  label: string;
  locked: boolean;
  muted?: boolean;
  items: TimelineItem[];
};

export type StudioTimeline = {
  duration: number;
  zoomPxPerSecond: number;
  playhead: number;
  tracks: TimelineTrack[];
};

export type AutopilotStyle = 'podcast' | 'storytime' | 'gaming' | 'motivacional' | 'cinematic' | 'meme' | 'satisfying';

export type AutopilotPlan = {
  start: number;
  end: number;
  style: AutopilotStyle;
  removeSilence: boolean;
  vertical: boolean;
  autoZoom: boolean;
  silences: SilenceRange[];
  transcript: TranscriptChunk[];
  zoomPlan: ZoomKeyframe[];
  brollQueries: BrollQuery[];
  metadata: SocialMetadata;
};

export type FruitAiPlan = {
  title: string;
  hook: string;
  scenes: Array<{
    id: string;
    prompt: string;
    searchQuery: string;
    caption: string;
    duration: number;
  }>;
  outro: string;
};
