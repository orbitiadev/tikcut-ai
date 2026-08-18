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

export type LocalProject = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  trimStart: number;
  trimEnd: number;
  captionStyle: CaptionStyle;
  transcript: string;
};
