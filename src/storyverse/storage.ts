import type { StorySeries, StoryverseState } from './types';

const KEY = 'tikcut:storyverse:v1';

const EMPTY: StoryverseState = { version: 1, selectedSeriesId: null, series: [] };

function normalizeSeries(series: StorySeries): StorySeries {
  return {
    ...series,
    bible: {
      worldRules: series.bible?.worldRules ?? '',
      visualRules: series.bible?.visualRules ?? '',
      mainConflict: series.bible?.mainConflict ?? '',
      lockedFacts: series.bible?.lockedFacts ?? '',
      forbiddenChanges: series.bible?.forbiddenChanges ?? '',
    },
    characters: Array.isArray(series.characters) ? series.characters : [],
    arcs: Array.isArray(series.arcs) ? series.arcs : [],
    hooks: Array.isArray(series.hooks) ? series.hooks : [],
    episodes: Array.isArray(series.episodes) ? series.episodes : [],
  };
}

export function loadStoryverse(): StoryverseState {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<StoryverseState>;
    const series = Array.isArray(parsed.series) ? parsed.series.map(normalizeSeries) : [];
    const selectedSeriesId = series.some((item) => item.id === parsed.selectedSeriesId)
      ? parsed.selectedSeriesId ?? null
      : series[0]?.id ?? null;
    return { version: 1, selectedSeriesId, series };
  } catch {
    return EMPTY;
  }
}

export function saveStoryverse(state: StoryverseState) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, JSON.stringify(state));
}

export function createSeries(title = 'Minha série'): StorySeries {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    premise: '',
    genre: 'mistério',
    tone: 'curto, visual e com suspense crescente',
    visualStyle: 'cinemático vertical, iluminação dramática, composição consistente',
    captionStyle: 'impact',
    createdAt: now,
    updatedAt: now,
    bible: {
      worldRules: '',
      visualRules: '',
      mainConflict: '',
      lockedFacts: '',
      forbiddenChanges: '',
    },
    characters: [],
    arcs: [],
    hooks: [],
    episodes: [],
  };
}

export function downloadText(filename: string, content: string, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
