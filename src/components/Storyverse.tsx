import { useEffect, useMemo, useState } from 'react';
import { detectContinuityWarnings, generateLocalEpisode, seasonAsText, suggestNextPaths } from '../storyverse/engine';
import { createSeries, downloadText, loadStoryverse, saveStoryverse } from '../storyverse/storage';
import type { StoryCharacter, StoryEpisode, StoryGenre, StorySeries, StoryverseState } from '../storyverse/types';

type StoryTab = 'series' | 'bible' | 'characters' | 'episodes' | 'storyboard';

const genres: StoryGenre[] = ['mistério', 'terror', 'fantasia', 'drama', 'aventura', 'infantil', 'surreal'];

function slug(value: string) {
  return value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'storyverse';
}

function makeCharacter(): StoryCharacter {
  return {
    id: crypto.randomUUID(),
    name: 'Novo personagem',
    role: 'protagonista',
    appearance: '',
    personality: '',
    relationships: '',
    voiceName: '',
    continuityNotes: '',
  };
}

function replaceSeries(state: StoryverseState, next: StorySeries) {
  return {
    ...state,
    selectedSeriesId: next.id,
    series: state.series.map((item) => item.id === next.id ? { ...next, updatedAt: new Date().toISOString() } : item),
  };
}

function speak(text: string, voiceName?: string) {
  if (!('speechSynthesis' in window) || !text.trim()) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 1200));
  utterance.lang = 'pt-BR';
  const voice = window.speechSynthesis.getVoices().find((item) => item.name === voiceName);
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
  return true;
}

function downloadCover(series: StorySeries, episode?: StoryEpisode) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  let hash = 0;
  for (const char of series.title) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1920);
  gradient.addColorStop(0, `hsl(${hash} 75% 16%)`);
  gradient.addColorStop(1, `hsl(${(hash + 55) % 360} 85% 7%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1920);
  ctx.strokeStyle = 'rgba(255,255,255,.2)';
  ctx.lineWidth = 4;
  ctx.strokeRect(80, 80, 920, 1760);
  ctx.fillStyle = 'white';
  ctx.font = '900 88px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText(series.title.slice(0, 20), 110, 340);
  ctx.font = '700 46px system-ui';
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.fillText(series.genre.toUpperCase(), 110, 420);
  ctx.fillStyle = 'white';
  ctx.font = '900 66px system-ui';
  const ep = episode ? `EP ${String(episode.number).padStart(2, '0')}` : 'STORYVERSE';
  ctx.fillText(ep, 110, 1480);
  ctx.font = '700 42px system-ui';
  const title = episode?.title.replace(/^EP\s*\d+\s*·?\s*/i, '') || series.premise || 'Nova história';
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  words.forEach((word) => {
    const candidate = `${line} ${word}`.trim();
    if (ctx.measureText(candidate).width > 840 && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  });
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((item, index) => ctx.fillText(item, 110, 1570 + index * 58));
  const anchor = document.createElement('a');
  anchor.href = canvas.toDataURL('image/png');
  anchor.download = `${slug(series.title)}-${episode ? `ep-${episode.number}` : 'capa'}.png`;
  anchor.click();
}

export default function Storyverse() {
  const [state, setState] = useState<StoryverseState>(() => loadStoryverse());
  const [tab, setTab] = useState<StoryTab>('series');
  const [duration, setDuration] = useState(30);
  const [selectedPath, setSelectedPath] = useState('');
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [notice, setNotice] = useState('STORYVERSE salva automaticamente neste navegador.');

  useEffect(() => { saveStoryverse(state); }, [state]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const refresh = () => setVoices(window.speechSynthesis.getVoices());
    refresh();
    window.speechSynthesis.addEventListener('voiceschanged', refresh);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refresh);
  }, []);

  const series = state.series.find((item) => item.id === state.selectedSeriesId) ?? null;
  const sortedEpisodes = useMemo(() => [...(series?.episodes ?? [])].sort((a, b) => b.number - a.number), [series]);
  const selectedEpisode = sortedEpisodes.find((episode) => episode.id === selectedEpisodeId) ?? sortedEpisodes[0] ?? null;
  const paths = useMemo(() => series ? suggestNextPaths(series) : [], [series]);

  function addSeries() {
    const next = createSeries(`Série ${state.series.length + 1}`);
    setState((current) => ({ ...current, selectedSeriesId: next.id, series: [...current.series, next] }));
    setTab('bible');
    setNotice('Nova série criada. Preencha a bíblia para travar a continuidade.');
  }

  function updateSeries(patch: Partial<StorySeries>) {
    if (!series) return;
    setState((current) => replaceSeries(current, { ...series, ...patch }));
  }

  function removeSeries() {
    if (!series || !window.confirm(`Excluir a série “${series.title}” deste navegador?`)) return;
    setState((current) => {
      const next = current.series.filter((item) => item.id !== series.id);
      return { ...current, series: next, selectedSeriesId: next[0]?.id ?? null };
    });
    setSelectedEpisodeId(null);
  }

  function addCharacter() {
    if (!series) return;
    updateSeries({ characters: [...series.characters, makeCharacter()] });
  }

  function updateCharacter(id: string, patch: Partial<StoryCharacter>) {
    if (!series) return;
    updateSeries({ characters: series.characters.map((item) => item.id === id ? { ...item, ...patch } : item) });
  }

  function generateEpisode(surprise = false) {
    if (!series) return;
    if (!series.premise.trim()) {
      setNotice('Adicione uma premissa antes de gerar a continuação.');
      setTab('bible');
      return;
    }
    const episode = generateLocalEpisode(series, duration, selectedPath || undefined, surprise);
    const next: StorySeries = {
      ...series,
      episodes: [...series.episodes, episode],
      hooks: [...series.hooks, { id: crypto.randomUUID(), text: episode.cliffhanger, status: 'aberto', createdEpisode: episode.number }],
    };
    setState((current) => replaceSeries(current, next));
    setSelectedEpisodeId(episode.id);
    setSelectedPath('');
    setTab('storyboard');
    setNotice(episode.contradictions.length ? `Episódio criado com ${episode.contradictions.length} aviso(s) de continuidade para revisar.` : 'Continuação criada e verificada pelo motor local de continuidade.');
  }

  function updateEpisode(id: string, patch: Partial<StoryEpisode>) {
    if (!series) return;
    const episodes = series.episodes.map((episode) => {
      if (episode.id !== id) return episode;
      const merged = { ...episode, ...patch };
      return { ...merged, contradictions: detectContinuityWarnings(series, merged.script, merged.cliffhanger) };
    });
    updateSeries({ episodes });
  }

  function exportSeason(format: 'txt' | 'json') {
    if (!series) return;
    if (format === 'json') downloadText(`${slug(series.title)}.json`, JSON.stringify(series, null, 2), 'application/json;charset=utf-8');
    else downloadText(`${slug(series.title)}-temporada.txt`, seasonAsText(series));
  }

  if (!series) {
    return (
      <section className="storyverse-empty card">
        <div className="storyverse-logo">STORYVERSE</div>
        <h2>Histórias com continuação, sem perder a memória da série.</h2>
        <p>Crie a bíblia, personagens, arcos e episódios. O motor local mantém contexto, gera storyboard e salva tudo neste navegador.</p>
        <button className="button primary" onClick={addSeries}>Criar minha primeira série</button>
      </section>
    );
  }

  return (
    <div className="storyverse-shell">
      <aside className="storyverse-rail card">
        <div className="section-title">Minhas séries</div>
        <button className="button primary compact" onClick={addSeries}>+ Nova série</button>
        <div className="series-list">
          {state.series.map((item) => (
            <button key={item.id} className={item.id === series.id ? 'active' : ''} onClick={() => setState((current) => ({ ...current, selectedSeriesId: item.id }))}>
              <b>{item.title}</b><span>{item.episodes.length} episódios · {item.genre}</span>
            </button>
          ))}
        </div>
        <div className="story-stats">
          <div><span>Episódios</span><b>{series.episodes.length}</b></div>
          <div><span>Ganchos abertos</span><b>{series.hooks.filter((hook) => hook.status === 'aberto').length}</b></div>
          <div><span>Personagens</span><b>{series.characters.length}</b></div>
          <div><span>Arcos abertos</span><b>{series.arcs.filter((arc) => arc.status === 'aberto').length}</b></div>
        </div>
        <button className="button secondary" onClick={() => exportSeason('txt')}>Exportar temporada TXT</button>
        <button className="button secondary" onClick={() => exportSeason('json')}>Backup JSON</button>
        <button className="danger-link" onClick={removeSeries}>Excluir série</button>
      </aside>

      <section className="storyverse-main card">
        <div className="storyverse-head">
          <div><div className="eyebrow">CONTINUITY ENGINE</div><h2>{series.title}</h2></div>
          <span className="pill good">Autosave local</span>
        </div>
        <nav className="story-tabs">
          {([['series','Série'],['bible','Universo'],['characters','Personagens'],['episodes','Episódios'],['storyboard','Storyboard']] as [StoryTab,string][]).map(([key,label]) => (
            <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
          ))}
        </nav>

        {tab === 'series' && <div className="story-grid two">
          <label>Título<input value={series.title} onChange={(e) => updateSeries({ title: e.target.value })} /></label>
          <label>Gênero<select value={series.genre} onChange={(e) => updateSeries({ genre: e.target.value as StoryGenre })}>{genres.map((genre) => <option key={genre}>{genre}</option>)}</select></label>
          <label className="wide">Premissa<textarea rows={4} value={series.premise} onChange={(e) => updateSeries({ premise: e.target.value })} placeholder="Ex.: Uma garota recebe vídeos do futuro mostrando o que acontecerá 24 horas depois." /></label>
          <label>Tom<input value={series.tone} onChange={(e) => updateSeries({ tone: e.target.value })} /></label>
          <label>Estilo visual<input value={series.visualStyle} onChange={(e) => updateSeries({ visualStyle: e.target.value })} /></label>
          <label>Estilo de legenda<select value={series.captionStyle} onChange={(e) => updateSeries({ captionStyle: e.target.value })}><option value="impact">Impact</option><option value="clean">Clean</option><option value="karaoke">Karaoke</option></select></label>
          <div className="wide cover-actions"><button className="button secondary" onClick={() => downloadCover(series, selectedEpisode ?? undefined)}>Gerar capa consistente PNG</button></div>
        </div>}

        {tab === 'bible' && <div className="story-grid two">
          <label className="wide">Conflito principal<textarea rows={3} value={series.bible.mainConflict} onChange={(e) => updateSeries({ bible: { ...series.bible, mainConflict: e.target.value } })} /></label>
          <label>Regras do universo<textarea rows={7} value={series.bible.worldRules} onChange={(e) => updateSeries({ bible: { ...series.bible, worldRules: e.target.value } })} placeholder="Uma regra por linha" /></label>
          <label>Regras visuais<textarea rows={7} value={series.bible.visualRules} onChange={(e) => updateSeries({ bible: { ...series.bible, visualRules: e.target.value } })} placeholder="Cenário, cores, roupas, câmera..." /></label>
          <label>Fatos travados<textarea rows={7} value={series.bible.lockedFacts} onChange={(e) => updateSeries({ bible: { ...series.bible, lockedFacts: e.target.value } })} placeholder="Luna tem 19 anos\nA chave é vermelha" /></label>
          <label>Mudanças proibidas<textarea rows={7} value={series.bible.forbiddenChanges} onChange={(e) => updateSeries({ bible: { ...series.bible, forbiddenChanges: e.target.value } })} placeholder="Luna não muda de cabelo\nA casa nunca muda de endereço" /></label>
          <div className="wide arc-hook-grid">
            <div><div className="section-title">Arcos</div>{series.arcs.map((arc) => <div className="inline-record" key={arc.id}><input value={arc.title} onChange={(e) => updateSeries({ arcs: series.arcs.map((item) => item.id === arc.id ? { ...item, title: e.target.value } : item) })} /><select value={arc.status} onChange={(e) => updateSeries({ arcs: series.arcs.map((item) => item.id === arc.id ? { ...item, status: e.target.value as 'aberto'|'resolvido' } : item) })}><option>aberto</option><option>resolvido</option></select></div>)}<button className="mini-add" onClick={() => updateSeries({ arcs: [...series.arcs, { id: crypto.randomUUID(), title: 'Novo arco', status: 'aberto', notes: '' }] })}>+ arco</button></div>
            <div><div className="section-title">Ganchos</div>{series.hooks.map((hook) => <div className="inline-record" key={hook.id}><input value={hook.text} onChange={(e) => updateSeries({ hooks: series.hooks.map((item) => item.id === hook.id ? { ...item, text: e.target.value } : item) })} /><select value={hook.status} onChange={(e) => updateSeries({ hooks: series.hooks.map((item) => item.id === hook.id ? { ...item, status: e.target.value as 'aberto'|'resolvido' } : item) })}><option>aberto</option><option>resolvido</option></select></div>)}<button className="mini-add" onClick={() => updateSeries({ hooks: [...series.hooks, { id: crypto.randomUUID(), text: 'Novo mistério', status: 'aberto', createdEpisode: series.episodes.length + 1 }] })}>+ gancho</button></div>
          </div>
        </div>}

        {tab === 'characters' && <div className="characters-panel">
          <div className="panel-row"><div><div className="section-title">Elenco fixo</div><p className="helper">Aparência e notas entram automaticamente nos prompts de todas as cenas.</p></div><button className="button primary small" onClick={addCharacter}>+ Personagem</button></div>
          <div className="character-cards">
            {series.characters.map((character) => <article className="character-card" key={character.id}>
              <input className="character-name" value={character.name} onChange={(e) => updateCharacter(character.id, { name: e.target.value })} />
              <label>Papel<input value={character.role} onChange={(e) => updateCharacter(character.id, { role: e.target.value })} /></label>
              <label>Aparência<textarea rows={3} value={character.appearance} onChange={(e) => updateCharacter(character.id, { appearance: e.target.value })} /></label>
              <label>Personalidade<textarea rows={2} value={character.personality} onChange={(e) => updateCharacter(character.id, { personality: e.target.value })} /></label>
              <label>Relações<input value={character.relationships} onChange={(e) => updateCharacter(character.id, { relationships: e.target.value })} /></label>
              <label>Continuidade<textarea rows={2} value={character.continuityNotes} onChange={(e) => updateCharacter(character.id, { continuityNotes: e.target.value })} placeholder="Detalhes que nunca podem mudar" /></label>
              <label>Voz do navegador<select value={character.voiceName} onChange={(e) => updateCharacter(character.id, { voiceName: e.target.value })}><option value="">Padrão do dispositivo</option>{voices.map((voice) => <option key={voice.voiceURI} value={voice.name}>{voice.name} · {voice.lang}</option>)}</select></label>
              <div className="character-actions"><button onClick={() => setNotice(speak(`${character.name}. ${character.personality || 'Esta é a voz de teste do personagem.'}`, character.voiceName) ? 'Prévia de voz reproduzida pelo dispositivo.' : 'Seu navegador não oferece Speech Synthesis.')}>Ouvir voz</button><button onClick={() => updateSeries({ characters: series.characters.filter((item) => item.id !== character.id) })}>Remover</button></div>
            </article>)}
          </div>
        </div>}

        {tab === 'episodes' && <div className="episodes-panel">
          <div className="generator-box">
            <div><div className="section-title">Gerar continuação</div><p className="helper">O motor usa bíblia, personagens, ganchos e o cliffhanger anterior. Não depende de API externa.</p></div>
            <label>Duração<select value={duration} onChange={(e) => setDuration(Number(e.target.value))}><option value={15}>15s</option><option value={30}>30s</option><option value={45}>45s</option><option value={60}>60s</option></select></label>
            <label>Caminho<select value={selectedPath} onChange={(e) => setSelectedPath(e.target.value)}><option value="">Escolher automaticamente</option>{paths.map((path) => <option key={path} value={path}>{path}</option>)}</select></label>
            <div className="generator-actions"><button className="button primary" onClick={() => generateEpisode(false)}>Continuar história</button><button className="button secondary" onClick={() => generateEpisode(true)}>Modo surpresa</button></div>
          </div>
          <div className="episode-list">
            {sortedEpisodes.map((episode) => <button className={selectedEpisode?.id === episode.id ? 'active' : ''} key={episode.id} onClick={() => { setSelectedEpisodeId(episode.id); setTab('storyboard'); }}><span>EP {String(episode.number).padStart(2,'0')}</span><b>{episode.title}</b><small>{episode.duration}s · {episode.contradictions.length ? `${episode.contradictions.length} aviso(s)` : 'continuidade ok'}</small></button>)}
            {!sortedEpisodes.length && <div className="empty-list">Crie o primeiro episódio usando o gerador acima.</div>}
          </div>
        </div>}

        {tab === 'storyboard' && selectedEpisode && <div className="storyboard-panel">
          <div className="episode-editor-head"><div><div className="eyebrow">EP {String(selectedEpisode.number).padStart(2,'0')}</div><input value={selectedEpisode.title} onChange={(e) => updateEpisode(selectedEpisode.id, { title: e.target.value })} /></div><div><button onClick={() => downloadCover(series, selectedEpisode)}>Capa PNG</button><button onClick={() => setNotice(speak(selectedEpisode.script, series.characters[0]?.voiceName) ? 'Narração de prévia iniciada.' : 'Speech Synthesis indisponível.')}>Ouvir roteiro</button></div></div>
          {selectedEpisode.previously && <div className="previously"><b>No episódio anterior</b><textarea rows={2} value={selectedEpisode.previously} onChange={(e) => updateEpisode(selectedEpisode.id, { previously: e.target.value })} /></div>}
          <label>Resumo<textarea rows={3} value={selectedEpisode.summary} onChange={(e) => updateEpisode(selectedEpisode.id, { summary: e.target.value })} /></label>
          <label>Roteiro<textarea rows={10} value={selectedEpisode.script} onChange={(e) => updateEpisode(selectedEpisode.id, { script: e.target.value })} /></label>
          <label>Cliffhanger<textarea rows={2} value={selectedEpisode.cliffhanger} onChange={(e) => updateEpisode(selectedEpisode.id, { cliffhanger: e.target.value })} /></label>
          {selectedEpisode.contradictions.length > 0 && <div className="continuity-warnings"><b>Revisão de continuidade</b>{selectedEpisode.contradictions.map((warning) => <span key={warning}>⚠ {warning}</span>)}</div>}
          <div className="section-title spaced">Storyboard + prompts consistentes</div>
          <div className="scene-cards">{selectedEpisode.scenes.map((scene) => <article className="scene-card" key={scene.id}><span>CENA {scene.order}</span><textarea rows={3} value={scene.beat} onChange={(e) => updateEpisode(selectedEpisode.id, { scenes: selectedEpisode.scenes.map((item) => item.id === scene.id ? { ...item, beat: e.target.value } : item) })} /><label>Prompt visual<textarea rows={4} value={scene.visualPrompt} onChange={(e) => updateEpisode(selectedEpisode.id, { scenes: selectedEpisode.scenes.map((item) => item.id === scene.id ? { ...item, visualPrompt: e.target.value } : item) })} /></label><label>Fala<textarea rows={2} value={scene.dialogue} onChange={(e) => updateEpisode(selectedEpisode.id, { scenes: selectedEpisode.scenes.map((item) => item.id === scene.id ? { ...item, dialogue: e.target.value } : item) })} /></label></article>)}</div>
        </div>}

        <div className="story-notice"><span className="dot" />{notice}</div>
      </section>

      <aside className="storyverse-inspector card">
        <div className="section-title">Linha do tempo</div>
        <div className="timeline-story">{[...series.episodes].sort((a,b) => a.number - b.number).map((episode) => <button key={episode.id} onClick={() => { setSelectedEpisodeId(episode.id); setTab('storyboard'); }}><span>{String(episode.number).padStart(2,'0')}</span><div><b>{episode.title}</b><small>{episode.summary.slice(0,110)}</small></div></button>)}</div>
        <div className="section-title spaced">Próximos caminhos</div>
        <div className="path-list">{paths.map((path) => <button key={path} className={selectedPath === path ? 'active' : ''} onClick={() => { setSelectedPath(path); setTab('episodes'); }}>{path}</button>)}</div>
        <div className="section-title spaced">Memória da série</div>
        <div className="memory-list"><span>{series.bible.lockedFacts.split(/\r?\n/).filter(Boolean).length} fatos travados</span><span>{series.hooks.filter((hook) => hook.status === 'aberto').length} ganchos pendentes</span><span>{series.arcs.filter((arc) => arc.status === 'aberto').length} arcos ativos</span></div>
      </aside>
    </div>
  );
}
