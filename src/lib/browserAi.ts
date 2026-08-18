import type { BrollQuery, FruitAiPlan, SocialMetadata, TranscriptChunk } from './studioTypes';

type LanguageModelSession = {
  prompt: (input: string, options?: { signal?: AbortSignal }) => Promise<string>;
};

type LanguageModelApi = {
  availability: (options?: unknown) => Promise<'unavailable' | 'downloadable' | 'downloading' | 'available' | string>;
  create: (options?: unknown) => Promise<LanguageModelSession>;
};

type ChromePromptLanguage = 'en' | 'es';

const STOPWORDS = new Set([
  'a','o','as','os','um','uma','uns','umas','de','da','do','das','dos','em','no','na','nos','nas','e','ou','que','por','para','com','sem','como','mais','menos','muito','muita','muitos','muitas','eu','você','voce','ele','ela','eles','elas','isso','isto','esse','essa','este','esta','se','já','ja','não','nao','sim','ao','aos','à','às','sobre','entre','até','ate','ser','ter','foi','são','sao','é','e','the','and','for','with','from','this','that','you','your','are','was','were','have','has','had','but','not','into','about'
]);

function languageModelApi(): LanguageModelApi | null {
  const value = (globalThis as unknown as { LanguageModel?: LanguageModelApi }).LanguageModel;
  return value ?? null;
}

function detectChromePromptLanguage(text: string): ChromePromptLanguage | 'unsupported' {
  const lower = ` ${text.toLowerCase()} `;
  const portugueseSignals = [' você ', ' voce ', ' não ', ' nao ', ' que ', ' para ', ' uma ', ' esse ', ' essa ', ' isso ', ' agora ', ' vídeo ', ' video ', ' também ', ' tambem ', ' então ', ' entao '];
  const spanishSignals = [' que ', ' para ', ' una ', ' este ', ' esta ', ' ahora ', ' vídeo ', ' video ', ' también ', ' tambien ', ' entonces ', ' puedes ', ' porque '];
  const portugueseScore = portugueseSignals.reduce((score, token) => score + (lower.includes(token) ? 1 : 0), /[ãõç]/i.test(text) ? 3 : 0);
  const spanishScore = spanishSignals.reduce((score, token) => score + (lower.includes(token) ? 1 : 0), /[ñ¿¡]/i.test(text) ? 3 : 0);
  if (portugueseScore >= 3 && portugueseScore > spanishScore) return 'unsupported';
  if (spanishScore >= 3) return 'es';
  return 'en';
}

function promptOptions(language: ChromePromptLanguage) {
  return {
    expectedInputs: [{ type: 'text', languages: [language] }],
    expectedOutputs: [{ type: 'text', languages: [language] }],
  };
}

export async function getBrowserAiAvailability() {
  const api = languageModelApi();
  if (!api) return 'unavailable';
  try {
    return await api.availability(promptOptions('en'));
  } catch {
    return 'unavailable';
  }
}

async function promptBrowserAi(prompt: string, sourceText: string): Promise<string | null> {
  const api = languageModelApi();
  if (!api) return null;
  const language = detectChromePromptLanguage(sourceText);
  // Chrome's current Prompt API language set does not include pt-BR. Do not
  // pretend Gemini Nano handled Portuguese: use the deterministic local path.
  if (language === 'unsupported') return null;
  const options = promptOptions(language);
  try {
    const availability = await api.availability(options);
    if (availability === 'unavailable') return null;
    const session = await api.create(options);
    return await session.prompt(prompt);
  } catch {
    return null;
  }
}

function extractJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  const clean = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(clean) as T; } catch { /* fall through */ }
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(clean.slice(start, end + 1)) as T; } catch { return null; }
}

export function extractKeywords(text: string, limit = 12): string[] {
  const words = text
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, limit).map(([word]) => word);
}

function sentenceCandidates(text: string) {
  return text.split(/(?<=[.!?])\s+|\n+/).map((value) => value.trim()).filter(Boolean);
}

function fallbackMetadata(text: string): SocialMetadata {
  const sentences = sentenceCandidates(text);
  const first = sentences[0] || 'Você precisa ver este vídeo';
  const keywords = extractKeywords(text, 8);
  const compact = first.replace(/[.!?]+$/, '').slice(0, 70);
  const titles = [
    compact,
    `${keywords[0] ? keywords[0][0].toUpperCase() + keywords[0].slice(1) : 'Isso'} vai te surpreender`,
    `O detalhe que quase ninguém percebeu`,
    `Veja isso antes de continuar rolando`,
    `O que acontece depois é inesperado`,
  ].filter((value, index, array) => value.length > 4 && array.indexOf(value) === index).slice(0, 5);
  const hashtags = [...new Set(['#tiktok', '#reels', '#shorts', ...keywords.slice(0, 5).map((word) => `#${word.replace(/-/g, '')}`)])];
  return {
    provider: 'local-heuristic',
    titles,
    description: `${first.slice(0, 180)}${first.length > 180 ? '…' : ''}\n\nAssista até o final e escolha o seu momento favorito.`,
    hashtags,
    hooks: [
      `Você não vai acreditar no que acontece a seguir.`,
      `Presta atenção neste detalhe.`,
      `Isso muda completamente a forma de ver ${keywords[0] || 'esse assunto'}.`,
    ],
  };
}

export async function generateSocialMetadata(text: string): Promise<SocialMetadata> {
  const fallback = fallbackMetadata(text);
  if (!text.trim()) return fallback;
  const raw = await promptBrowserAi(`Analyze the short-video transcript below. Reply ONLY with valid JSON: {"titles":[5 short titles],"description":"up to 350 characters","hashtags":[6 relevant hashtags],"hooks":[4 strong hooks]}. Use the same language as the transcript. Never promise virality and never invent facts. TRANSCRIPT:\n${text.slice(0, 9000)}`, text);
  const parsed = extractJson<{ titles?: unknown; description?: unknown; hashtags?: unknown; hooks?: unknown }>(raw);
  if (!parsed) return fallback;
  const titles = Array.isArray(parsed.titles) ? parsed.titles.filter((v): v is string => typeof v === 'string').slice(0, 5) : fallback.titles;
  const hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags.filter((v): v is string => typeof v === 'string').map((v) => v.startsWith('#') ? v : `#${v.replace(/\s+/g, '')}`).slice(0, 8) : fallback.hashtags;
  const hooks = Array.isArray(parsed.hooks) ? parsed.hooks.filter((v): v is string => typeof v === 'string').slice(0, 5) : fallback.hooks;
  return {
    provider: 'chrome-ai',
    titles: titles.length ? titles : fallback.titles,
    description: typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim() : fallback.description,
    hashtags: hashtags.length ? hashtags : fallback.hashtags,
    hooks: hooks.length ? hooks : fallback.hooks,
  };
}

function fallbackBroll(text: string, chunks: TranscriptChunk[], duration: number): BrollQuery[] {
  const keywords = extractKeywords(text, 6);
  const safeDuration = Math.max(3, duration || 30);
  return keywords.map((query, index) => {
    const start = Math.min(Math.max(0, safeDuration - 2), (safeDuration / Math.max(1, keywords.length)) * index);
    const nearby = chunks.find((chunk) => chunk.start <= start && chunk.end >= start);
    return {
      id: crypto.randomUUID(),
      query,
      reason: nearby?.text ? `Complementa: ${nearby.text.slice(0, 90)}` : `Palavra-chave frequente na transcrição: ${query}`,
      start,
      end: Math.min(safeDuration, start + 3.5),
    };
  });
}

export async function generateBrollQueries(text: string, chunks: TranscriptChunk[], duration: number): Promise<BrollQuery[]> {
  const fallback = fallbackBroll(text, chunks, duration);
  if (!text.trim()) return fallback;
  const raw = await promptBrowserAi(`Analyze this short-video transcript and choose up to 6 moments where visual B-roll materially helps. Reply ONLY with valid JSON: {"items":[{"query":"visual search term for Wikimedia Commons, preferably English when useful","reason":"short reason","start":0,"end":3}]}. Keep times between 0 and ${Math.max(1, duration).toFixed(1)} seconds. Never invent facts. TRANSCRIPT:\n${text.slice(0, 8500)}`, text);
  const parsed = extractJson<{ items?: Array<{ query?: unknown; reason?: unknown; start?: unknown; end?: unknown }> }>(raw);
  if (!parsed?.items?.length) return fallback;
  const result = parsed.items.flatMap((item) => {
    if (typeof item.query !== 'string' || !item.query.trim()) return [];
    const start = typeof item.start === 'number' && Number.isFinite(item.start) ? Math.max(0, Math.min(duration, item.start)) : 0;
    const endCandidate = typeof item.end === 'number' && Number.isFinite(item.end) ? item.end : start + 3.5;
    const end = Math.max(start + 0.5, Math.min(Math.max(duration, start + 0.5), endCandidate));
    return [{ id: crypto.randomUUID(), query: item.query.trim(), reason: typeof item.reason === 'string' ? item.reason : 'Sugestão visual da IA local.', start, end }];
  }).slice(0, 6);
  return result.length ? result : fallback;
}

function fruitNameFromPrompt(prompt: string) {
  const names = ['maçã','maca','apple','melancia','watermelon','morango','strawberry','banana','laranja','orange','kiwi','uva','grape','abacaxi','pineapple','pera','pear','manga','mango'];
  const lower = prompt.toLowerCase();
  return names.find((name) => lower.includes(name)) ?? 'fruit';
}

function fallbackFruitPlan(prompt: string): FruitAiPlan {
  const fruit = fruitNameFromPrompt(prompt);
  return {
    title: `Fruit AI · ${fruit}`,
    hook: `Parece impossível, mas espera até o corte final…`,
    scenes: [
      { id: crypto.randomUUID(), prompt: `${prompt}. Macro close-up antes do corte.`, searchQuery: `${fruit} macro`, caption: 'Olha os detalhes…', duration: 2.5 },
      { id: crypto.randomUUID(), prompt: `${prompt}. Faca se aproximando, tensão visual.`, searchQuery: `${fruit} sliced`, caption: 'Agora vem a melhor parte.', duration: 2.5 },
      { id: crypto.randomUUID(), prompt: `${prompt}. Corte satisfatório em câmera lenta.`, searchQuery: `${fruit} cut close up`, caption: 'Satisfatório demais.', duration: 3 },
      { id: crypto.randomUUID(), prompt: `${prompt}. Metades da fruta reveladas, brilho e textura.`, searchQuery: `${fruit} half`, caption: 'Você assistiria de novo?', duration: 2.5 },
    ],
    outro: 'Qual fruta vem depois?',
  };
}

export async function generateFruitPlan(prompt: string): Promise<FruitAiPlan> {
  const fallback = fallbackFruitPlan(prompt);
  if (!prompt.trim()) return fallback;
  const raw = await promptBrowserAi(`Create a short 9:16 satisfying-video storyboard from the request below. The plan must also work with licensed real images as a fallback when synthetic visual generation is unavailable. Reply ONLY with valid JSON: {"title":"...","hook":"...","scenes":[{"prompt":"cinematic description","searchQuery":"visual search term","caption":"short text","duration":2.5}],"outro":"..."}. Use the same language as the request. REQUEST:\n${prompt.slice(0, 3000)}`, prompt);
  const parsed = extractJson<FruitAiPlan>(raw);
  if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length < 2) return fallback;
  return {
    title: typeof parsed.title === 'string' ? parsed.title : fallback.title,
    hook: typeof parsed.hook === 'string' ? parsed.hook : fallback.hook,
    scenes: parsed.scenes.slice(0, 6).map((scene) => ({
      id: crypto.randomUUID(),
      prompt: typeof scene.prompt === 'string' ? scene.prompt : prompt,
      searchQuery: typeof scene.searchQuery === 'string' ? scene.searchQuery : fruitNameFromPrompt(prompt),
      caption: typeof scene.caption === 'string' ? scene.caption : '',
      duration: typeof scene.duration === 'number' && Number.isFinite(scene.duration) ? Math.max(1.5, Math.min(6, scene.duration)) : 2.5,
    })),
    outro: typeof parsed.outro === 'string' ? parsed.outro : fallback.outro,
  };
}
