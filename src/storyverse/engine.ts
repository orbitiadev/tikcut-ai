import type { StoryEpisode, StoryScene, StorySeries } from './types';

const banks = {
  'mistério': {
    opener: ['uma pista impossível aparece', 'um detalhe antigo volta a fazer sentido', 'alguém percebe que estava sendo observado'],
    turn: ['a pista leva ao lugar errado de propósito', 'um personagem reconhece um símbolo', 'uma gravação muda tudo'],
    cliff: ['a porta abre sozinha', 'o telefone toca com uma voz conhecida', 'a câmera revela alguém que não deveria estar ali'],
  },
  'terror': {
    opener: ['algo muda quando ninguém está olhando', 'um som surge sempre no mesmo horário', 'um objeto reaparece depois de ser destruído'],
    turn: ['a presença começa a imitar uma voz humana', 'as luzes apagam e uma marca aparece', 'o personagem descobre que não está sozinho'],
    cliff: ['há respiração atrás da câmera', 'uma mensagem diz o nome do protagonista', 'o reflexo se move antes da pessoa'],
  },
  'fantasia': {
    opener: ['um artefato desperta', 'uma passagem escondida se abre', 'um poder aparece no pior momento'],
    turn: ['o preço do poder é revelado', 'um aliado esconde sua verdadeira origem', 'uma regra do mundo é quebrada'],
    cliff: ['o símbolo proibido começa a brilhar', 'um portal se abre onde não deveria', 'o inimigo chama o herói pelo nome verdadeiro'],
  },
  'drama': {
    opener: ['uma verdade guardada vem à tona', 'uma escolha antiga cobra seu preço', 'uma mensagem muda a relação entre os personagens'],
    turn: ['um pedido de desculpas chega tarde demais', 'uma promessa entra em conflito com a realidade', 'um segredo é contado pela pessoa errada'],
    cliff: ['alguém chega sem avisar', 'uma foto revela o que ninguém esperava', 'uma decisão precisa ser tomada agora'],
  },
  'aventura': {
    opener: ['o mapa revela uma rota nova', 'um obstáculo surge antes do objetivo', 'o grupo encontra um sinal de que alguém passou ali'],
    turn: ['o caminho seguro desaparece', 'o recurso mais importante é perdido', 'um rival oferece uma aliança temporária'],
    cliff: ['o chão começa a ceder', 'o destino aparece no horizonte', 'algo gigantesco bloqueia a saída'],
  },
  'infantil': {
    opener: ['um objeto mágico pede ajuda', 'um amigo encontra uma pista divertida', 'uma pequena missão começa por acidente'],
    turn: ['os amigos precisam trabalhar juntos', 'um erro vira uma nova ideia', 'um personagem aprende uma regra importante'],
    cliff: ['uma surpresa colorida aparece', 'um novo amigo chama do outro lado', 'a próxima pista começa a brilhar'],
  },
  'surreal': {
    opener: ['uma fruta começa a falar', 'um objeto comum ganha uma regra impossível', 'o cenário muda de material sem aviso'],
    turn: ['a lógica do mundo se inverte', 'uma transformação cria um novo problema', 'o personagem percebe que tudo funciona por repetição'],
    cliff: ['o último frame revela outra realidade', 'o objeto olha de volta para a câmera', 'o começo do vídeo reaparece de forma diferente'],
  },
} as const;

function pick<T>(items: readonly T[], seed: number): T {
  return items[Math.abs(seed) % items.length];
}

function hash(value: string) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  return Math.abs(result);
}

function cleanLines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function suggestNextPaths(series: StorySeries): string[] {
  const last = [...series.episodes].sort((a, b) => b.number - a.number)[0];
  const hero = series.characters[0]?.name || 'o protagonista';
  const openHook = series.hooks.find((hook) => hook.status === 'aberto')?.text;
  const main = series.bible.mainConflict || series.premise || 'o mistério central';
  const base = last?.cliffhanger || openHook || main;
  return [
    `${hero} investiga diretamente “${base}” e descobre uma pista que contradiz o que acreditava.`,
    `A continuação começa pelo ponto de vista de outro personagem e mostra o que aconteceu fora de cena.`,
    `Um detalhe pequeno do episódio anterior vira a chave principal e conecta com ${main}.`,
    `O episódio parece resolver o problema, mas a solução revela uma consequência maior.`,
    `A história avança rápido, fecha um gancho antigo e termina abrindo um novo mistério visual.`,
  ];
}

export function detectContinuityWarnings(series: StorySeries, script: string, cliffhanger = ''): string[] {
  const warnings: string[] = [];
  const normalized = `${script} ${cliffhanger}`.toLocaleLowerCase('pt-BR');
  const last = [...series.episodes].sort((a, b) => b.number - a.number)[0];
  if (last?.cliffhanger) {
    const keyTerms = last.cliffhanger.toLocaleLowerCase('pt-BR').split(/\W+/).filter((term) => term.length > 4);
    if (keyTerms.length && !keyTerms.some((term) => normalized.includes(term))) {
      warnings.push('Possível salto de continuidade: o cliffhanger do episódio anterior não parece ser retomado.');
    }
  }

  cleanLines(series.bible.forbiddenChanges).forEach((rule) => {
    const terms = rule.toLocaleLowerCase('pt-BR').split(/\W+/).filter((term) => term.length > 5);
    if (terms.length >= 2 && terms.filter((term) => normalized.includes(term)).length >= 2) {
      warnings.push(`Revisar regra bloqueada: “${rule}”.`);
    }
  });

  series.arcs.filter((arc) => arc.status === 'resolvido').forEach((arc) => {
    const title = arc.title.toLocaleLowerCase('pt-BR');
    if (title.length > 5 && normalized.includes(title)) warnings.push(`Arco “${arc.title}” já está marcado como resolvido.`);
  });

  series.hooks.filter((hook) => hook.status === 'resolvido').forEach((hook) => {
    const terms = hook.text.toLocaleLowerCase('pt-BR').split(/\W+/).filter((term) => term.length > 5);
    if (terms.length >= 2 && terms.filter((term) => normalized.includes(term)).length >= 2) {
      warnings.push(`Gancho já resolvido pode ter sido reaberto: “${hook.text}”.`);
    }
  });

  const names = series.characters.map((character) => character.name.trim()).filter(Boolean);
  if (names.length > 0 && !names.some((name) => normalized.includes(name.toLocaleLowerCase('pt-BR')))) {
    warnings.push('Nenhum personagem cadastrado aparece no texto; confira se isso é intencional.');
  }
  return [...new Set(warnings)];
}

function buildScenePrompt(series: StorySeries, beat: string) {
  const cast = series.characters.slice(0, 4).map((character) => `${character.name}: ${character.appearance}`).join(' | ');
  const rules = [series.visualStyle, series.bible.visualRules, cast].filter(Boolean).join(' | ');
  return `${rules || 'vertical cinematic short'} | cena: ${beat} | manter personagens e cenário consistentes | 9:16`;
}

export function generateLocalEpisode(series: StorySeries, duration: number, chosenPath?: string, surprise = false): StoryEpisode {
  const nextNumber = Math.max(0, ...series.episodes.map((episode) => episode.number)) + 1;
  const previous = [...series.episodes].sort((a, b) => b.number - a.number)[0];
  const bank = banks[series.genre] ?? banks['mistério'];
  const seed = hash(`${series.id}:${nextNumber}:${chosenPath || ''}`);
  const hero = series.characters[0]?.name || 'o protagonista';
  const partner = series.characters[1]?.name || 'um aliado';
  const openHook = series.hooks.find((hook) => hook.status === 'aberto')?.text;
  const path = chosenPath || suggestNextPaths(series)[seed % 5];
  const premise = series.premise || 'um acontecimento estranho muda a rotina';
  const opener = pick(bank.opener, seed);
  const turn = pick(bank.turn, seed + 1);
  const cliff = pick(bank.cliff, seed + 2);
  const sceneCount = duration <= 20 ? 3 : duration <= 40 ? 5 : 6;
  const beats = [
    `${hero} retoma a história exatamente após ${previous?.cliffhanger || openHook || premise}. ${opener}.`,
    `${hero} tenta entender o que aconteceu enquanto ${partner} reage de forma diferente do esperado.`,
    `A pista principal aponta para ${series.bible.mainConflict || premise}.`,
    `${turn}. A escolha do personagem aumenta o risco.`,
    `O episódio entrega uma resposta parcial e conecta com ${path}.`,
    `${hero} acredita que entendeu tudo, mas ${cliff}.`,
  ].slice(0, sceneCount);

  if (surprise && sceneCount >= 4) beats[2] = `Uma quebra inesperada muda a direção da história: ${turn}, mas sem violar as regras do universo.`;

  const scenes: StoryScene[] = beats.map((beat, index) => ({
    id: crypto.randomUUID(),
    order: index + 1,
    beat,
    visualPrompt: buildScenePrompt(series, beat),
    dialogue: index === 0
      ? `“Tem alguma coisa errada aqui.”`
      : index === sceneCount - 1
        ? `“Espera… isso não estava aí antes.”`
        : '',
  }));

  const script = scenes.map((scene, index) => `Cena ${index + 1}: ${scene.beat}${scene.dialogue ? `\n${scene.dialogue}` : ''}`).join('\n\n');
  const cliffhanger = `${hero} percebe que ${cliff}.`;
  const titleSeed = (openHook || series.bible.mainConflict || premise).split(/[.!?]/)[0].trim();
  const title = `EP ${String(nextNumber).padStart(2, '0')} · ${titleSeed.slice(0, 42) || series.title}`;
  const previously = previous ? `No episódio anterior: ${previous.summary || previous.cliffhanger}` : '';
  const summary = `${hero} segue ${path.toLocaleLowerCase('pt-BR')} O episódio avança ${series.bible.mainConflict || premise} e termina com um novo risco.`;
  const continuityFacts = [
    ...cleanLines(series.bible.lockedFacts),
    ...series.characters.map((character) => `${character.name}: ${character.continuityNotes || character.appearance}`).filter((item) => item.split(':')[1]?.trim()),
  ].slice(0, 12);
  const contradictions = detectContinuityWarnings(series, script, cliffhanger);

  return {
    id: crypto.randomUUID(),
    number: nextNumber,
    title,
    duration,
    previously,
    summary,
    script,
    cliffhanger,
    scenes,
    continuityFacts,
    contradictions,
    createdAt: new Date().toISOString(),
  };
}

export function seasonAsText(series: StorySeries) {
  const sorted = [...series.episodes].sort((a, b) => a.number - b.number);
  const header = [
    `SÉRIE: ${series.title}`,
    `GÊNERO: ${series.genre}`,
    `PREMISSA: ${series.premise}`,
    `CONFLITO CENTRAL: ${series.bible.mainConflict}`,
    '',
  ].join('\n');
  return header + sorted.map((episode) => [
    `===== EP ${String(episode.number).padStart(2, '0')} — ${episode.title} =====`,
    episode.previously,
    episode.summary,
    '',
    episode.script,
    '',
    `CLIFFHANGER: ${episode.cliffhanger}`,
    '',
  ].filter(Boolean).join('\n')).join('\n\n');
}
