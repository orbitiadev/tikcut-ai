export type CaptionStyle = 'impact' | 'clean' | 'karaoke';

export type ClipSuggestion = {
  id: string;
  title: string;
  excerpt: string;
  score: number;
  hook: number;
  clarity: number;
  emotion: number;
  estimatedStart: number;
  estimatedEnd: number;
  reason: string;
};

export type SilenceRange = { start: number; end: number; duration: number };

export type CutMode = 'automatic' | 'manual';
export type CutOrigin = 'automatic' | 'transcript' | 'manual';

export type PlannedCut = {
  id: string;
  title: string;
  start: number;
  end: number;
  origin: CutOrigin;
  selected: boolean;
  score?: number;
  reason?: string;
};

export type LocalProject = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  trimStart: number;
  trimEnd: number;
  captionStyle: CaptionStyle;
  transcript: string;
  cutMode?: CutMode;
  cuts?: PlannedCut[];
};
