import type { ClipSuggestion, PlannedCut, SilenceRange } from './types';

export type AutoCutOptions = {
  count: number;
  minSeconds: number;
  maxSeconds: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function recommendedCutCount(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 6;
  if (duration < 10 * 60) return 4;
  return clamp(Math.round(duration / (7 * 60)), 6, 24);
}

function nearestSilenceBoundary(
  target: number,
  silences: SilenceRange[],
  edge: 'start' | 'end',
  maxDistance = 10,
) {
  let best = target;
  let distance = maxDistance + 1;
  for (const silence of silences) {
    const candidate = edge === 'start' ? silence.end : silence.start;
    const delta = Math.abs(candidate - target);
    if (delta < distance && delta <= maxDistance) {
      best = candidate;
      distance = delta;
    }
  }
  return best;
}

function chooseSuggestionForWindow(
  suggestions: ClipSuggestion[],
  windowStart: number,
  windowEnd: number,
): ClipSuggestion | undefined {
  const inside = suggestions.filter((item) => {
    const center = (item.estimatedStart + item.estimatedEnd) / 2;
    return center >= windowStart && center <= windowEnd;
  });
  return inside.sort((a, b) => b.score - a.score)[0];
}

export function generateAutoCutPlan(
  duration: number,
  options: AutoCutOptions,
  silences: SilenceRange[] = [],
  suggestions: ClipSuggestion[] = [],
): PlannedCut[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const count = clamp(Math.round(options.count), 1, 30);
  const minSeconds = clamp(Math.round(options.minSeconds), 15, 600);
  const maxSeconds = clamp(Math.round(options.maxSeconds), minSeconds, 600);
  const span = Math.max(0, maxSeconds - minSeconds);
  const durationPattern = [0.15, 0.48, 0.82, 0.33, 1, 0.62, 0.24, 0.73];
  const slotSize = duration / count;
  const cuts: PlannedCut[] = [];

  for (let index = 0; index < count; index += 1) {
    const slotStart = index * slotSize;
    const slotEnd = Math.min(duration, (index + 1) * slotSize);
    const suggestion = chooseSuggestionForWindow(suggestions, slotStart, slotEnd);
    const requestedLength = Math.min(
      duration,
      minSeconds + span * durationPattern[index % durationPattern.length],
    );

    const suggestedCenter = suggestion
      ? (suggestion.estimatedStart + suggestion.estimatedEnd) / 2
      : slotStart + slotSize / 2;

    let start = clamp(suggestedCenter - requestedLength / 2, 0, Math.max(0, duration - requestedLength));
    let end = Math.min(duration, start + requestedLength);

    start = clamp(nearestSilenceBoundary(start, silences, 'start'), 0, Math.max(0, end - 5));
    end = clamp(nearestSilenceBoundary(end, silences, 'end'), start + 5, duration);

    const previous = cuts[cuts.length - 1];
    if (previous && start < previous.end + 2) {
      start = Math.min(duration - 5, previous.end + 2);
      end = Math.min(duration, Math.max(start + 5, start + requestedLength));
    }
    if (end <= start || start >= duration) continue;

    cuts.push({
      id: `auto-${index + 1}-${Math.round(start * 10)}`,
      title: suggestion?.title ?? `Corte automático ${index + 1}`,
      start,
      end,
      origin: suggestion ? 'transcript' : 'automatic',
      selected: true,
      score: suggestion?.score,
      reason: suggestion?.reason ?? 'Distribuído automaticamente ao longo do vídeo; bordas aproximadas a pausas quando disponíveis.',
    });
  }

  return cuts;
}

export function addManualPlannedCut(
  cuts: PlannedCut[],
  start: number,
  end: number,
): PlannedCut[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return cuts;
  const item: PlannedCut = {
    id: `manual-${crypto.randomUUID()}`,
    title: `Corte manual ${cuts.filter((cut) => cut.origin === 'manual').length + 1}`,
    start,
    end,
    origin: 'manual',
    selected: true,
    reason: 'Trecho escolhido manualmente.',
  };
  return [...cuts, item].sort((a, b) => a.start - b.start);
}
