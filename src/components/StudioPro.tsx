import { useEffect, useMemo, useRef, useState } from 'react';
import ProfessionalTimeline from './ProfessionalTimeline';
import { detectSilences } from '../lib/silence';
import { exportAutopilotMp4, exportImageMontageMp4, exportSmartZoomMp4, exportWithoutSilencesMp4 } from '../lib/ffmpeg';
import { transcribeVideoLocally, type TranscriptionLanguage } from '../lib/transcription';
import { generateBrollQueries, generateFruitPlan, generateSocialMetadata, getBrowserAiAvailability } from '../lib/browserAi';
import { fetchMediaBlob, searchCommonsMedia } from '../lib/broll';
import { buildSmartZoomPlan, createStudioTimeline, populateTimeline, upsertTimelineItem } from '../lib/autopilot';
import type { SilenceRange } from '../lib/types';
import type { AutopilotStyle, BrollQuery, CommonsMedia, FruitAiPlan, SocialMetadata, StudioTimeline, TranscriptChunk, ZoomKeyframe } from '../lib/studioTypes';

type RenderedOutput = {
  url: string;
  filename: string;
  blob: Blob;
  label: string;
};

const STYLES: AutopilotStyle[] = ['podcast', 'storytime', 'gaming', 'motivacional', 'cinematic', 'meme', 'satisfying'];

function formatTime(value: number) {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60).toString().padStart(2, '0');
  return hours ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

function formatBytes(value: number) {
  return value >= 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;
}

function downloadText(filename: string, text: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function srtTime(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(milliseconds / 3_600_000);
  const m = Math.floor((milliseconds % 3_600_000) / 60_000);
  const s = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export default function StudioPro() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [status, setStatus] = useState('Studio Pro pronto. Importe um vídeo.');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState('');
  const [silences, setSilences] = useState<SilenceRange[]>([]);
  const [transcript, setTranscript] = useState('');
  const [chunks, setChunks] = useState<TranscriptChunk[]>([]);
  const [language, setLanguage] = useState<TranscriptionLanguage>('auto');
  const [metadata, setMetadata] = useState<SocialMetadata | null>(null);
  const [browserAi, setBrowserAi] = useState('verificando');
  const [style, setStyle] = useState<AutopilotStyle>('storytime');
  const [zoomPlan, setZoomPlan] = useState<ZoomKeyframe[]>([]);
  const [brollQueries, setBrollQueries] = useState<BrollQuery[]>([]);
  const [brollResults, setBrollResults] = useState<Record<string, CommonsMedia[]>>({});
  const [timeline, setTimeline] = useState<StudioTimeline>(() => createStudioTimeline(60));
  const [output, setOutput] = useState<RenderedOutput | null>(null);
  const [removeSilence, setRemoveSilence] = useState(true);
  const [vertical, setVertical] = useState(true);
  const [autoZoom, setAutoZoom] = useState(true);
  const [autoTranscribe, setAutoTranscribe] = useState(true);
  const [fruitPrompt, setFruitPrompt] = useState('Uma maçã transparente de cristal sendo cortada ao meio, macro cinematográfico, câmera lenta, iluminação de estúdio, vertical 9:16, satisfatório.');
  const [fruitPlan, setFruitPlan] = useState<FruitAiPlan | null>(null);

  const selectedDuration = Math.max(0, rangeEnd - rangeStart);
  const localChunks = useMemo(() => chunks
    .filter((chunk) => chunk.end > rangeStart && chunk.start < rangeEnd)
    .map((chunk) => ({ ...chunk, start: Math.max(0, chunk.start - rangeStart), end: Math.min(selectedDuration, chunk.end - rangeStart) })), [chunks, rangeStart, rangeEnd, selectedDuration]);

  useEffect(() => {
    void getBrowserAiAvailability().then(setBrowserAi);
  }, []);

  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (output?.url) URL.revokeObjectURL(output.url);
  }, [videoUrl, output]);

  function clearOutput() {
    setOutput((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  function showOutput(blob: Blob, filename: string, label: string) {
    clearOutput();
    const result = { url: URL.createObjectURL(blob), filename, blob, label };
    setOutput(result);
    setStatus(`${label} pronto · ${formatBytes(blob.size)}.`);
  }

  async function importVideo(next: File | null) {
    if (!next) return;
    if (!next.type.startsWith('video/')) return setStatus('Escolha um arquivo de vídeo válido.');
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    clearOutput();
    setFile(next);
    setVideoUrl(URL.createObjectURL(next));
    setDuration(0);
    setRangeStart(0);
    setRangeEnd(0);
    setTranscript('');
    setChunks([]);
    setSilences([]);
    setMetadata(null);
    setZoomPlan([]);
    setBrollQueries([]);
    setBrollResults({});
    setStatus(`Vídeo carregado (${formatBytes(next.size)}). Lendo metadados…`);
  }

  async function detectAllSilences() {
    if (!file) throw new Error('Importe um vídeo primeiro.');
    setStatus('Detectando pausas e silêncios reais no áudio…');
    const ranges = await detectSilences(file, -38, 0.55, duration);
    setSilences(ranges);
    setStatus(`${ranges.length} silêncios detectados. Agora eles podem ser removidos automaticamente.`);
    return ranges;
  }

  async function runTranscription() {
    if (!file || selectedDuration <= 0) return setStatus('Importe um vídeo e selecione um trecho.');
    setBusy('transcription');
    setProgress(0);
    try {
      const result = await transcribeVideoLocally(file, rangeStart, rangeEnd, language, setStatus, setProgress);
      setTranscript(result.text);
      setChunks(result.chunks);
      setTimeline(populateTimeline(createStudioTimeline(selectedDuration), zoomPlan, brollQueries, result.chunks.map((chunk) => ({ ...chunk, start: chunk.start - rangeStart, end: chunk.end - rangeStart }))));
      setStatus(`Transcrição automática concluída com ${result.model} em ${result.device.toUpperCase()}. ${result.chunks.length} blocos temporizados.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha na transcrição automática.');
    } finally {
      setBusy('');
      setProgress(0);
    }
  }

  async function removeAllSilences() {
    if (!file || selectedDuration <= 0) return setStatus('Importe um vídeo e selecione o trecho.');
    setBusy('silence-render');
    setProgress(0);
    try {
      const ranges = silences.length ? silences : await detectAllSilences();
      setStatus('Removendo automaticamente todos os silêncios do trecho…');
      const blob = await exportWithoutSilencesMp4(file, rangeStart, rangeEnd, ranges, setProgress, vertical);
      showOutput(blob, `tikcut-sem-silencios-${Date.now()}.mp4`, vertical ? 'Vídeo sem silêncios em 9:16' : 'Vídeo sem silêncios');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao remover silêncios.');
    } finally {
      setBusy('');
      setProgress(0);
    }
  }

  function createZoomPlan() {
    if (selectedDuration <= 0) return setStatus('Selecione um trecho primeiro.');
    const plan = buildSmartZoomPlan(rangeStart, rangeEnd, chunks, silences, style);
    setZoomPlan(plan);
    setTimeline(populateTimeline(createStudioTimeline(selectedDuration), plan, brollQueries, localChunks));
    setStatus(`${plan.length} movimentos de Auto Zoom planejados para o estilo ${style}.`);
    return plan;
  }

  async function renderSmartZoom() {
    if (!file || selectedDuration <= 0) return setStatus('Importe um vídeo e selecione um trecho.');
    setBusy('zoom-render');
    setProgress(0);
    try {
      const plan = zoomPlan.length ? zoomPlan : createZoomPlan() ?? [];
      const blob = await exportSmartZoomMp4(file, rangeStart, rangeEnd, plan, setProgress);
      showOutput(blob, `tikcut-autozoom-${Date.now()}.mp4`, 'Auto Zoom 9:16');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha no Auto Zoom.');
    } finally {
      setBusy('');
      setProgress(0);
    }
  }

  async function generateMetadata() {
    if (!transcript.trim()) return setStatus('Transcreva o vídeo ou cole uma transcrição antes de gerar metadados.');
    setBusy('metadata');
    try {
      setStatus('Gerando títulos, descrição, hooks e hashtags…');
      const result = await generateSocialMetadata(transcript);
      setMetadata(result);
      setStatus(result.provider === 'chrome-ai' ? 'Metadados gerados com IA local do Chrome (Gemini Nano).' : 'IA local do Chrome indisponível; metadados gerados pelo motor local de fallback.');
    } finally {
      setBusy('');
    }
  }

  async function planBroll() {
    if (!transcript.trim()) return setStatus('Transcreva ou cole o texto antes de sugerir B-roll.');
    setBusy('broll-plan');
    try {
      const queries = await generateBrollQueries(transcript, localChunks, selectedDuration);
      setBrollQueries(queries);
      setTimeline(populateTimeline(createStudioTimeline(selectedDuration), zoomPlan, queries, localChunks));
      setStatus(`${queries.length} pontos de B-roll sugeridos. Pesquise os arquivos licenciados abaixo.`);
    } finally {
      setBusy('');
    }
  }

  async function searchBroll(query: BrollQuery) {
    setBusy(`broll-${query.id}`);
    try {
      const media = await searchCommonsMedia(query.query, 6);
      setBrollResults((current) => ({ ...current, [query.id]: media }));
      setStatus(`${media.length} opções encontradas no Wikimedia Commons para “${query.query}”.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao pesquisar B-roll.');
    } finally {
      setBusy('');
    }
  }

  async function autoFillBroll() {
    const queries = brollQueries.length ? brollQueries : await generateBrollQueries(transcript, localChunks, selectedDuration);
    if (!queries.length) return setStatus('Não encontrei pontos suficientes para B-roll.');
    setBrollQueries(queries);
    setBusy('broll-auto');
    try {
      let next = timeline.duration === selectedDuration ? timeline : createStudioTimeline(selectedDuration);
      const resultMap: Record<string, CommonsMedia[]> = { ...brollResults };
      for (const query of queries.slice(0, 5)) {
        const media = await searchCommonsMedia(query.query, 1);
        resultMap[query.id] = media;
        const first = media[0];
        if (!first) continue;
        next = upsertTimelineItem(next, {
          id: crypto.randomUUID(), track: 'broll', label: first.title.slice(0, 32), start: query.start, end: query.end,
          sourceUrl: first.thumbUrl, sourcePage: first.pageUrl, license: first.license,
        });
      }
      setBrollResults(resultMap);
      setTimeline(next);
      setStatus('Auto B-roll preencheu a timeline com as primeiras opções licenciadas encontradas. Revise cada uma antes de publicar.');
    } finally {
      setBusy('');
    }
  }

  function addBrollToTimeline(query: BrollQuery, media: CommonsMedia) {
    setTimeline((current) => upsertTimelineItem(current, {
      id: crypto.randomUUID(), track: 'broll', label: media.title.slice(0, 36), start: query.start, end: query.end,
      sourceUrl: media.thumbUrl, sourcePage: media.pageUrl, license: media.license,
    }));
    setStatus(`B-roll “${media.title}” adicionado à timeline.`);
  }

  function rebuildTimeline() {
    setTimeline(populateTimeline(createStudioTimeline(selectedDuration || 1), zoomPlan, brollQueries, localChunks));
    setStatus('Timeline reconstruída para o trecho selecionado.');
  }

  function exportSubtitles() {
    if (!localChunks.length) return setStatus('Transcreva com timestamps antes de exportar SRT.');
    const srt = localChunks.map((chunk, index) => `${index + 1}\n${srtTime(chunk.start)} --> ${srtTime(chunk.end)}\n${chunk.text}\n`).join('\n');
    downloadText(`tikcut-legendas-${Date.now()}.srt`, srt, 'application/x-subrip;charset=utf-8');
    setStatus('Arquivo SRT criado.');
  }

  async function runAutopilot() {
    if (!file || selectedDuration <= 0) return setStatus('Importe um vídeo e selecione um trecho antes do Autopilot.');
    setBusy('autopilot');
    setProgress(0);
    try {
      let currentChunks = chunks;
      let currentTranscript = transcript;
      if (autoTranscribe && !currentTranscript.trim()) {
        const result = await transcribeVideoLocally(file, rangeStart, rangeEnd, language, setStatus, setProgress);
        currentChunks = result.chunks;
        currentTranscript = result.text;
        setChunks(result.chunks);
        setTranscript(result.text);
      }
      const currentSilences = removeSilence ? (silences.length ? silences : await detectAllSilences()) : silences;
      const plan = autoZoom ? buildSmartZoomPlan(rangeStart, rangeEnd, currentChunks, currentSilences, style) : [];
      const local = currentChunks.filter((chunk) => chunk.end > rangeStart && chunk.start < rangeEnd).map((chunk) => ({ ...chunk, start: Math.max(0, chunk.start - rangeStart), end: Math.min(selectedDuration, chunk.end - rangeStart) }));
      const queries = currentTranscript.trim() ? await generateBrollQueries(currentTranscript, local, selectedDuration) : [];
      const social = currentTranscript.trim() ? await generateSocialMetadata(currentTranscript) : null;
      setZoomPlan(plan);
      setBrollQueries(queries);
      if (social) setMetadata(social);
      setTimeline(populateTimeline(createStudioTimeline(selectedDuration), plan, queries, local));
      setStatus('Autopilot renderizando: corte + silêncios + 9:16 + Auto Zoom…');
      const blob = await exportAutopilotMp4(file, rangeStart, rangeEnd, currentSilences, plan, setProgress, { removeSilence, vertical, autoZoom });
      showOutput(blob, `tikcut-autopilot-${style}-${Date.now()}.mp4`, `Autopilot ${style}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha no Autopilot.');
    } finally {
      setBusy('');
      setProgress(0);
    }
  }

  async function planFruitAi() {
    setBusy('fruit-plan');
    try {
      setStatus('Criando storyboard Fruit AI…');
      const plan = await generateFruitPlan(fruitPrompt);
      setFruitPlan(plan);
      setStatus(`${plan.scenes.length} cenas criadas. O modo local monta o vídeo com mídia livre do Wikimedia Commons.`);
    } finally {
      setBusy('');
    }
  }

  async function renderFruitAi() {
    const plan = fruitPlan ?? await generateFruitPlan(fruitPrompt);
    setFruitPlan(plan);
    setBusy('fruit-render');
    setProgress(0);
    try {
      const images: Blob[] = [];
      for (let index = 0; index < plan.scenes.length; index += 1) {
        const scene = plan.scenes[index];
        setStatus(`Fruit AI: buscando mídia licenciada para cena ${index + 1}/${plan.scenes.length}…`);
        const result = await searchCommonsMedia(scene.searchQuery, 4);
        const media = result[0];
        if (!media) throw new Error(`Não encontrei uma imagem compatível para “${scene.searchQuery}”.`);
        images.push(await fetchMediaBlob(media.thumbUrl));
      }
      setStatus('Fruit AI: animando as cenas em 1080×1920…');
      const blob = await exportImageMontageMp4(images, plan.scenes.map((scene) => scene.duration), setProgress);
      showOutput(blob, `tikcut-fruit-ai-${Date.now()}.mp4`, 'Fruit AI local');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao criar o Fruit AI local.');
    } finally {
      setBusy('');
      setProgress(0);
    }
  }

  return (
    <div className="studio-pro-page app-shell">
      <header className="topbar studio-pro-topbar">
        <div><div className="eyebrow">TIKCUT ADVANCED EDIT LAB</div><h1>TikCut <span>AI</span> · STUDIO PRO</h1></div>
        <div className="top-actions"><span className="pill good">FFmpeg local</span><span className={`pill ${browserAi === 'available' ? 'good' : 'muted'}`}>Chrome AI: {browserAi}</span></div>
      </header>

      <main className="studio-pro-grid">
        <section className="pro-card source-card">
          <div className="section-title">1 · Fonte e intervalo</div>
          <label className="dropzone pro-dropzone"><input type="file" accept="video/*" onChange={(event) => void importVideo(event.target.files?.[0] ?? null)} /><strong>{file?.name || 'Importar vídeo para o Studio Pro'}</strong><span>O vídeo principal continua local no dispositivo.</span></label>
          {videoUrl ? <video ref={videoRef} src={videoUrl} controls playsInline onLoadedMetadata={(event) => {
            const d = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
            setDuration(d); setRangeStart(0); setRangeEnd(Math.min(d, 90)); setTimeline(createStudioTimeline(Math.min(d || 1, 90)));
            setStatus(`Fonte pronta: ${formatTime(d)}. Trecho inicial: até ${formatTime(Math.min(d, 90))}.`);
          }} /> : <div className="pro-video-empty">STUDIO PRO<br/><small>importe um vídeo</small></div>}
          <div className="pro-range">
            <label>IN (s)<input aria-label="Studio Pro IN" type="number" min="0" max={duration} step="0.1" value={Number(rangeStart.toFixed(1))} onChange={(event) => setRangeStart(Math.max(0, Math.min(Number(event.target.value), Math.max(0, rangeEnd - 0.1))))} /></label>
            <label>OUT (s)<input aria-label="Studio Pro OUT" type="number" min="0.1" max={duration} step="0.1" value={Number(rangeEnd.toFixed(1))} onChange={(event) => setRangeEnd(Math.max(rangeStart + 0.1, Math.min(Number(event.target.value), duration)))} /></label>
          </div>
          <div className="pro-stats"><span>Fonte <b>{formatTime(duration)}</b></span><span>Trecho <b>{formatTime(selectedDuration)}</b></span><span>Silêncios <b>{silences.length}</b></span></div>
          <button className="button secondary" disabled={!file || Boolean(busy)} onClick={() => void (async () => { setBusy('silence-detect'); try { await detectAllSilences(); } catch (error) { setStatus(error instanceof Error ? error.message : 'Falha na análise.'); } finally { setBusy(''); } })()}>{busy === 'silence-detect' ? 'Detectando…' : 'Detectar todos os silêncios'}</button>
        </section>

        <section className="pro-card ai-card">
          <div className="section-title">2 · Transcrição automática completa</div>
          <div className="pro-inline"><select aria-label="Idioma da transcrição" value={language} onChange={(event) => setLanguage(event.target.value as TranscriptionLanguage)}><option value="auto">Idioma automático</option><option value="portuguese">Português</option><option value="english">Inglês</option><option value="spanish">Espanhol</option></select><button className="button primary" disabled={!file || Boolean(busy)} onClick={() => void runTranscription()}>{busy === 'transcription' ? 'Transcrevendo…' : 'Transcrever com Whisper local'}</button></div>
          <textarea rows={8} value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="A transcrição automática aparece aqui. Você também pode editar manualmente." />
          <div className="pro-inline"><button disabled={!localChunks.length} onClick={exportSubtitles}>Baixar SRT</button><span>{localChunks.length} blocos com timestamps</span></div>
          <p className="helper">Na primeira utilização, o modelo Whisper é baixado e armazenado no cache do navegador. O áudio é transcrito no dispositivo.</p>
        </section>

        <section className="pro-card action-card">
          <div className="section-title">3 · Remoção automática de silêncios</div>
          <label className="check-row"><input type="checkbox" checked={vertical} onChange={(event) => setVertical(event.target.checked)} />Gerar saída vertical 9:16</label>
          <button className="button cut" disabled={!file || Boolean(busy)} onClick={() => void removeAllSilences()}>{busy === 'silence-render' ? 'Removendo…' : 'Remover TODOS os silêncios'}</button>
          <p className="helper">O motor cria os segmentos falados e concatena tudo em um novo MP4. O original não é alterado.</p>
        </section>

        <section className="pro-card action-card">
          <div className="section-title">4 · Auto Zoom inteligente</div>
          <select aria-label="Estilo do Auto Zoom" value={style} onChange={(event) => setStyle(event.target.value as AutopilotStyle)}>{STYLES.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <div className="pro-inline"><button onClick={createZoomPlan} disabled={!file}>Planejar Auto Zoom</button><button className="button export" disabled={!file || Boolean(busy)} onClick={() => void renderSmartZoom()}>{busy === 'zoom-render' ? 'Renderizando…' : 'Renderizar Auto Zoom 9:16'}</button></div>
          <div className="zoom-list">{zoomPlan.slice(0, 8).map((item) => <span key={item.id}>{item.start.toFixed(1)}–{item.end.toFixed(1)}s · {item.zoom.toFixed(2)}×</span>)}</div>
        </section>

        <section className="pro-card metadata-card">
          <div className="section-title">5 · Título, descrição, hashtags e hooks</div>
          <button className="button primary" disabled={!transcript.trim() || Boolean(busy)} onClick={() => void generateMetadata()}>{busy === 'metadata' ? 'Gerando…' : 'Gerar pacote social'}</button>
          {metadata && <div className="metadata-output"><span className="pill good">{metadata.provider === 'chrome-ai' ? 'IA local Chrome' : 'Fallback local'}</span><h3>Títulos</h3>{metadata.titles.map((title) => <p key={title}>{title}</p>)}<h3>Descrição</h3><p>{metadata.description}</p><h3>Hooks</h3>{metadata.hooks.map((hook) => <p key={hook}>{hook}</p>)}<h3>Hashtags</h3><p>{metadata.hashtags.join(' ')}</p><button onClick={() => navigator.clipboard?.writeText(`${metadata.titles[0]}\n\n${metadata.description}\n\n${metadata.hashtags.join(' ')}`)}>Copiar pacote</button></div>}
        </section>

        <section className="pro-card broll-card">
          <div className="section-title">6 · Auto B-roll licenciado</div>
          <div className="pro-inline"><button disabled={!transcript.trim() || Boolean(busy)} onClick={() => void planBroll()}>Sugerir pontos de B-roll</button><button className="button primary" disabled={!transcript.trim() || Boolean(busy)} onClick={() => void autoFillBroll()}>{busy === 'broll-auto' ? 'Buscando…' : 'Auto preencher timeline'}</button></div>
          <div className="broll-query-list">{brollQueries.map((query) => <article key={query.id}><div className="broll-query-head"><div><b>{query.query}</b><small>{query.start.toFixed(1)}–{query.end.toFixed(1)}s · {query.reason}</small></div><button disabled={Boolean(busy)} onClick={() => void searchBroll(query)}>Pesquisar Commons</button></div>{brollResults[query.id]?.length ? <div className="commons-grid">{brollResults[query.id].map((media) => <figure key={media.id}><img src={media.thumbUrl} alt={media.description || media.title} loading="lazy"/><figcaption><b>{media.title}</b><small>{media.license}{media.artist ? ` · ${media.artist}` : ''}</small><div><button onClick={() => addBrollToTimeline(query, media)}>+ Timeline</button><a href={media.pageUrl} target="_blank" rel="noreferrer">Fonte/licença</a></div></figcaption></figure>)}</div> : null}</article>)}</div>
        </section>

        <section className="pro-card autopilot-card">
          <div className="section-title">7 · AUTOPILOT completo</div>
          <div className="autopilot-options"><label><input type="checkbox" checked={autoTranscribe} onChange={(event) => setAutoTranscribe(event.target.checked)}/>Transcrever se necessário</label><label><input type="checkbox" checked={removeSilence} onChange={(event) => setRemoveSilence(event.target.checked)}/>Remover silêncios</label><label><input type="checkbox" checked={vertical} onChange={(event) => setVertical(event.target.checked)}/>9:16</label><label><input type="checkbox" checked={autoZoom} onChange={(event) => setAutoZoom(event.target.checked)}/>Auto Zoom</label></div>
          <select aria-label="Estilo do Autopilot" value={style} onChange={(event) => setStyle(event.target.value as AutopilotStyle)}>{STYLES.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <button className="button autopilot-run" disabled={!file || Boolean(busy)} onClick={() => void runAutopilot()}>{busy === 'autopilot' ? `Autopilot ${progress ? Math.round(progress * 100) : 0}%` : 'EXECUTAR AUTOPILOT'}</button>
          <p className="helper">O Autopilot monta a edição de forma reversível: transcrição, silêncios, zoom, B-roll sugerido, pacote social e render do vídeo. A timeline permanece editável.</p>
        </section>

        <section className="pro-card fruit-card">
          <div className="section-title">8 · Criar com IA · Fruit AI</div>
          <textarea rows={5} value={fruitPrompt} onChange={(event) => setFruitPrompt(event.target.value)} />
          <div className="pro-inline"><button disabled={Boolean(busy)} onClick={() => void planFruitAi()}>{busy === 'fruit-plan' ? 'Planejando…' : 'Gerar storyboard IA'}</button><button className="button primary" disabled={Boolean(busy)} onClick={() => void renderFruitAi()}>{busy === 'fruit-render' ? 'Criando vídeo…' : 'Criar vídeo Fruit AI local'}</button></div>
          {fruitPlan && <div className="fruit-scenes"><h3>{fruitPlan.title}</h3><p>{fruitPlan.hook}</p>{fruitPlan.scenes.map((scene, index) => <article key={scene.id}><b>Cena {index + 1} · {scene.duration}s</b><p>{scene.prompt}</p><small>Busca visual: {scene.searchQuery} · legenda: {scene.caption}</small></article>)}</div>}
          <p className="helper">Este modo local usa IA do navegador para o storyboard quando disponível e monta um vídeo animado com mídia licenciada. Geração visual sintética fotorrealista por diffusion/vídeo pode ser conectada depois a um provedor externo sem expor chaves.</p>
        </section>
      </main>

      <div className="timeline-wrap"><div className="timeline-tools"><button onClick={rebuildTimeline}>Reconstruir timeline do trecho</button></div><ProfessionalTimeline timeline={timeline} setTimeline={setTimeline} onSeek={(seconds) => { if (videoRef.current) videoRef.current.currentTime = rangeStart + seconds; }} /></div>

      <section className="pro-output card" aria-label="Saída Studio Pro">
        <div className="status" role="status"><span className="dot" />{status}</div>
        {busy && progress > 0 && <progress max="1" value={progress} />}
        {output ? <div className="pro-output-result"><div><b>{output.label}</b><span>{formatBytes(output.blob.size)}</span></div><video src={output.url} controls playsInline/><a className="download-ready" href={output.url} download={output.filename}>Baixar resultado</a></div> : <p className="helper">Os resultados renderizados aparecem aqui.</p>}
      </section>

      <footer><span>Studio Pro · processamento local-first + IA local quando disponível</span><span>v0.3.0</span></footer>
    </div>
  );
}
