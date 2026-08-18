import type { ClipSuggestion } from './types';

const HOOK_TERMS = ['ninguém', 'segredo', 'erro', 'verdade', 'nunca', 'sempre', 'como', 'por que', 'porque', 'pior', 'melhor', 'aprendi', 'descobri', 'atenção', 'olha', 'isso'];
const EMOTION_TERMS = ['incrível', 'absurdo', 'chocante', 'medo', 'feliz', 'triste', 'raiva', 'surpresa', 'amei', 'odiei', 'mudou', 'perdi', 'ganhei'];

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function splitSegments(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 35);
}

export function scoreTranscript(text: string, videoDuration: number): ClipSuggestion[] {
  const segments = splitSegments(text);
  const totalChars = Math.max(1, segments.reduce((n, s) => n + s.length, 0));
  let charsBefore = 0;

  return segments.map((segment, index) => {
    const lower = segment.toLocaleLowerCase('pt-BR');
    const words = lower.split(/\s+/).filter(Boolean);
    const hookHits = HOOK_TERMS.filter((t) => lower.includes(t)).length;
    const emotionHits = EMOTION_TERMS.filter((t) => lower.includes(t)).length;
    const questionBoost = segment.includes('?') ? 13 : 0;
    const exclamationBoost = segment.includes('!') ? 8 : 0;
    const lengthFit = Math.max(0, 100 - Math.abs(words.length - 28) * 2.1);
    const hook = clamp(44 + hookHits * 13 + questionBoost);
    const emotion = clamp(38 + emotionHits * 15 + exclamationBoost);
    const clarity = clamp(55 + (/[.!?]$/.test(segment) ? 15 : 0) + Math.min(20, words.length / 2));
    const score = clamp(hook * 0.42 + clarity * 0.34 + emotion * 0.24 + lengthFit * 0.12);
    const startRatio = charsBefore / totalChars;
    charsBefore += segment.length;
    const endRatio = charsBefore / totalChars;
    const estimatedStart = videoDuration > 0 ? startRatio * videoDuration : index * 12;
    const estimatedEnd = videoDuration > 0 ? Math.max(estimatedStart + 5, endRatio * videoDuration) : estimatedStart + Math.max(8, words.length / 2.4);

    const reasonParts = [];
    if (hookHits || questionBoost) reasonParts.push('abertura com sinais de hook');
    if (emotionHits || exclamationBoost) reasonParts.push('linguagem emocional');
    if (clarity >= 75) reasonParts.push('trecho relativamente autocontido');
    if (!reasonParts.length) reasonParts.push('boa densidade de informação');

    return {
      id: `${index}-${score}`,
      title: `Corte sugerido ${index + 1}`,
      excerpt: segment,
      score,
      hook,
      clarity,
      emotion,
      estimatedStart,
      estimatedEnd,
      reason: `${reasonParts.join(', ')}. Os tempos são estimados pela posição do texto, não por alinhamento palavra-áudio.`
    };
  }).sort((a, b) => b.score - a.score).slice(0, 12);
}
