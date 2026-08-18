import type { BrollQuery, FruitAiPlan, SocialMetadata, TranscriptChunk } from './studioTypes';

type LanguageModelSession = {
  prompt: (input: string, options?: { signal?: AbortSignal }) => Promise<string>;
};

type LanguageModelApi = {
  availability: (options?: unknown) => Promise<'unavailable' | 'downloadable' | 'downloading' | 'available' | string>;
  create: (options?: unknown) => Promise<LanguageModelSession>;
};

const STOPWORDS = new Set([
  'a','o','as','os','um','uma','uns','umas','de','da','do','das','dos','em','no','na','nos','nas','e','ou','que','por','para','com','sem','como','mais','menos','muito','muita','muitos','muitas','eu','você','voce','ele','ela','eles','elas','isso','isto','esse','essa','este','esta','se','já','ja','não','nao','sim','ao','aos','à','às','sobre','entre','até','ate','ser','ter','foi','são','sao','é','e','the','and','for','with','from','this','that','you','your','are','was','were','have','has','had','but','not','into','about'
]);

function languageModelApi(): LanguageModelApi | null {
  const value = (globalThis as unknown as { LanguageModel?: LanguageModelApi }).LanguageModel;
  return value ?? null;
}

export async function getBrowserAiAvailability() {
  const api = languageModelApi();
  if (!api) return 'unavailable';
  const options = {
    expectedInputs: [{ type: 'text', languages: ['pt', 'en', 'es'] }],
    expectedOutputs: [{ type: 'text', languages: ['pt', 'en', 'es'] }],
  };
  try {
    return await api.availability(options);
  } catch {
    try { return await api.availability(); } catch { return 'unavailable'; }
  }
}

async function promptBrowserAi(prompt: string): Promise<string | null> {
  const api = languageModelApi();
  if (!api) return null;
  const availability = await getBrowserAiAvailability();
  if (availability === 'unavailable') return null;
  const options = {
    expectedInputs: [{ type: 'text', languages: ['pt', 'en', 'es'] }],
    expectedOutputs: [{ type: 'text', languages: ['pt', 'en', 'es'] }],
  };
  try {
    const session = await api.create(options);
    return await session.prompt(prompt);
  } catch {
    try {
      const session = await api.create();
      return await session.prompt(prompt);
    } catch {
      return null;
    }
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
  const raw = await promptBrowserAi(`Você é um estrategista de vídeos curtos. Analise a transcrição abaixo e responda SOMENTE JSON válido com esta estrutura: {"titles":[5 títulos curtos],"description":"descrição de até 350 caracteres","hashtags":[6 hashtags relevantes],"hooks":[4 hooks fortes]}. Não prometa viralização e não invente fatos. Idioma principal: português do Brasil. TRANSCRIÇÃO:\n${text.slice(0, 9000)}`);
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
  const raw = await promptBrowserAi(`Analise esta transcrição de vídeo curto e escolha até 6 momentos em que B-roll visual realmente ajuda. Responda SOMENTE JSON válido: {"items":[{"query":"termo visual pesquisável em Wikimedia Commons, em inglês quando ajudar","reason":"motivo curto","start":0,"end":3}]}. Os tempos devem ficar entre 0 e ${Math.max(1, duration).toFixed(1)} segundos. Não invente fatos. TRANSCRIÇÃO:\n${text.slice(0, 8500)}`);
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
  const raw = await promptBrowserAi(`Você é diretor de vídeos satisfying 9:16. A partir do pedido abaixo, crie um storyboard curto com 4 cenas que possa ser montado com imagens reais/licenciadas como fallback quando geração visual sintética não estiver disponível. Responda SOMENTE JSON válido: {"title":"...","hook":"...","scenes":[{"prompt":"descrição cinematográfica","searchQuery":"termo visual pesquisável","caption":"texto curto","duration":2.5}],"outro":"..."}. PEDIDO:\n${prompt.slice(0, 3000)}`);
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
