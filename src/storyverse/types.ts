export type StoryGenre = 'mistério' | 'terror' | 'fantasia' | 'drama' | 'aventura' | 'infantil' | 'surreal';
export type ArcStatus = 'aberto' | 'resolvido';
export type HookStatus = 'aberto' | 'resolvido';

export type StoryCharacter = {
  id: string;
  name: string;
  role: string;
  appearance: string;
  personality: string;
  relationships: string;
  voiceName: string;
  continuityNotes: string;
};

export type StoryArc = {
  id: string;
  title: string;
  status: ArcStatus;
  notes: string;
};

export type StoryHook = {
  id: string;
  text: string;
  status: HookStatus;
  createdEpisode: number;
};

export type StoryScene = {
  id: string;
  order: number;
  beat: string;
  visualPrompt: string;
  dialogue: string;
};

export type StoryEpisode = {
  id: string;
  number: number;
  title: string;
  duration: number;
  previously: string;
  summary: string;
  script: string;
  cliffhanger: string;
  scenes: StoryScene[];
  continuityFacts: string[];
  contradictions: string[];
  createdAt: string;
};

export type StoryBible = {
  worldRules: string;
  visualRules: string;
  mainConflict: string;
  lockedFacts: string;
  forbiddenChanges: string;
};

export type StorySeries = {
  id: string;
  title: string;
  premise: string;
  genre: StoryGenre;
  tone: string;
  visualStyle: string;
  captionStyle: string;
  createdAt: string;
  updatedAt: string;
  bible: StoryBible;
  characters: StoryCharacter[];
  arcs: StoryArc[];
  hooks: StoryHook[];
  episodes: StoryEpisode[];
};

export type StoryverseState = {
  version: 1;
  selectedSeriesId: string | null;
  series: StorySeries[];
};
