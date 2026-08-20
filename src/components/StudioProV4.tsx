import { useEffect, useMemo, useRef, useState } from 'react';
import ProfessionalTimeline from './ProfessionalTimeline';
import { exportAutopilotMp4, exportCutMp4, exportImageMontageMp4, exportSmartZoomMp4, exportWithoutSilencesMp4 } from '../lib/ffmpeg';
import { transcribeVideoLocally, type TranscriptionLanguage } from '../lib/transcription';
import { generateBrollQueries, generateFruitPlan, generateSocialMetadata, getBrowserAiAvailability } from '../lib/browserAi';
import { fetchMediaBlob, searchCommonsMedia } from '../lib/broll';
import { overlayBrollOnVerticalVideo, type BrollAsset } from '../lib/brollRender';
import { buildSmartZoomPlan, createStudioTimeline, keptSegmentsFromSilences, populateTimeline, upsertTimelineItem } from '../lib/autopilot';
import { exportMobileVerticalMp4 } from '../lib/mobileRender';
import { detectSilencesInRange } from '../lib/studioSilence';
import type { SilenceRange } from '../lib/types';
import type { AutopilotStyle, BrollQuery, CommonsMedia, FruitAiPlan, SocialMetadata, StudioTimeline, TranscriptChunk, ZoomKeyframe } from '../lib/studioTypes';

type Output = { url: string; filename: string; blob: Blob; label: string };
const STYLES: AutopilotStyle[] = ['podcast', 'storytime', 'gaming', 'motivacional', 'cinematic', 'meme', 'satisfying'];
const QUICK_DURATIONS = [30, 60, 90, 150, 165];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function compactViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
}

function formatTime(value: number) {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60).toString().padStart(2, '0');
  return h ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function quickLabel(seconds: number) {
  if (seconds === 150) return '2:30';
  if (seconds === 165) return '2:45';
  return `${seconds}s`;
}

function formatBytes(value: number) {
  return value >= 1_048_576 ? `${(value / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;
}

function srtTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const ms = total % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export default function StudioProV4() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [status, setStatus] = useState('Studio Pro v0.5 pronto. Importe um vídeo.');
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
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
  const [output, setOutput] = useState<Output | null>(null);
  const [mobileSafeMode, setMobileSafeMode] = useState(() => compactViewport());
  const [removeSilence, setRemoveSilence] = useState(() => !compactViewport());
  const [vertical, setVertical] = useState(true);
  const [autoZoom, setAutoZoom] = useState(() => !compactViewport());
  const [autoTranscribe, setAutoTranscribe] = useState(() => !compactViewport());
  const [bakeBroll, setBakeBroll] = useState(() => !compactViewport());
  const [fruitPrompt, setFruitPrompt] = useState('Uma maçã transparente de cristal sendo cortada ao meio, macro cinematográfico, câmera lenta, iluminação de estúdio, vertical 9:16, satisfatório.');
  const [fruitPlan, setFruitPlan] = useState<FruitAiPlan | null>(null);

  const selectedDuration = Math.max(0, rangeEnd - rangeStart);
  const localChunks = useMemo(() => chunks
    .filter((chunk) => chunk.end > rangeStart && chunk.start < rangeEnd)
    .map((chunk) => ({ ...chunk, start: Math.max(0, chunk.start - rangeStart), end: Math.min(selectedDuration, chunk.end - rangeStart) })), [chunks, rangeStart, rangeEnd, selectedDuration]);

  useEffect(() => { void getBrowserAiAvailability().then(setBrowserAi); }, []);
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { if (output?.url) URL.revokeObjectURL(output.url); }, [output?.url]);
  useEffect(() => {
    if (!mobileSafeMode) return;
    setAutoTranscribe(false);
    setAutoZoom(false);
    setBakeBroll(false);
  }, [mobileSafeMode]);

  function clearOutput() {
    setOutput((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  function showOutput(blob: Blob, filename: string, label: string) {
    setOutput((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return { url: URL.createObjectURL(blob), filename, blob, label };
    });
    setStatus(`${label} pronto · ${formatBytes(blob.size)}.`);
  }

  function ensureRange(action: string) {
    if (!file || selectedDuration <= 0) {
      setStatus(`Importe um vídeo e selecione um trecho antes de ${action}.`);
      return false;
    }
    if (mobileSafeMode && selectedDuration > 165.05) {
      setStatus('Modo compatível móvel: selecione no máximo 2:45 por processamento. Use os presets 2:30/2:45 ou ajuste IN/OUT.');
      return false;
    }
    return true;
  }

  function changeStart(raw: number) {
    if (!Number.isFinite(raw) || duration <= 0) return;
    const next = clamp(raw, 0, Math.max(0, duration - 0.1));
    clearOutput();
    setSilences([]);
    setRangeStart(next);
    if (rangeEnd <= next) setRangeEnd(Math.min(duration, next + (mobileSafeMode ? 30 : 90)));
  }

  function changeEnd(raw: number) {
    if (!Number.isFinite(raw) || duration <= 0) return;
    clearOutput();
    setSilences([]);
    setRangeEnd(clamp(raw, rangeStart + 0.1, duration));
  }

  function setQuickDuration(seconds: number) {
    if (!duration) return;
    clearOutput();
    setSilences([]);
    setRangeEnd(Math.min(duration, rangeStart + seconds));
    setStatus(`Trecho ajustado para ${quickLabel(seconds)} a partir do IN.`);
  }

  function importVideo(next: File | null) {
    if (!next) return;
    if (!next.type.startsWith('video/')) return setStatus('Escolha um arquivo de vídeo válido.');
    clearOutput();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
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

  async function withBusy(name: string, task: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    setProgress(0);
    try {
      await task();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'A operação falhou.');
    } finally {
      setBusy('');
      setProgress(0);
    }
  }

  async function getSilences() {
    if (!ensureRange('detectar silêncios')) return [];
    setStatus(`Analisando somente o trecho ${formatTime(rangeStart)}–${formatTime(rangeEnd)}; o restante do vídeo não será varrido.`);
    const ranges = await detectSilencesInRange(file!, rangeStart, rangeEnd, setProgress);
    setSilences(ranges);
    setStatus(`${ranges.length} silêncios detectados dentro do trecho selecionado.`);
    return ranges;
  }

  async function testMotor() {
    if (!ensureRange('testar o motor')) return;
    await withBusy('engine-test', async () => {
      const end = Math.min(rangeEnd, rangeStart + 2);
      setStatus('Teste do motor: gerando um corte de até 2 segundos…');
      const blob = await exportCutMp4(file!, rangeStart, end, setProgress);
      showOutput(blob, `tikcut-teste-motor-${Date.now()}.mp4`, 'Motor local OK');
    });
  }

  async function transcribe() {
    if (!ensureRange('transcrever')) return;
    await withBusy('transcription', async () => {
      if (mobileSafeMode) setStatus('Modo móvel: Whisper pode consumir bastante memória. Processando somente o trecho selecionado…');
      const result = await transcribeVideoLocally(file!, rangeStart, rangeEnd, language, setStatus, setProgress);
      setTranscript(result.text);
      setChunks(result.chunks);
      const local = result.chunks.map((chunk) => ({ ...chunk, start: chunk.start - rangeStart, end: chunk.end - rangeStart }));
      setTimeline(populateTimeline(createStudioTimeline(selectedDuration), zoomPlan, brollQueries, local));
      setStatus(`Transcrição concluída com ${result.model} em ${result.device.toUpperCase()}. ${result.chunks.length} blocos temporizados.`);
    });
  }

  async function renderMobileVertical(source: Blob, sourceDuration: number, baseName: string, label: string, progressStart = 0) {
    const stage = new File([source], `${baseName}.mp4`, { type: 'video/mp4' });
    const blob = await exportMobileVerticalMp4(stage, 0, sourceDuration, (ratio) => setProgress(progressStart + ratio * (1 - progressStart)));
    showOutput(blob, `${baseName}-${Date.now()}.mp4`, label);
  }

  async function removeAll() {
    if (!ensureRange('remover silêncios')) return;
    await withBusy('silence-render', async () => {
      const ranges = silences.length ? silences : await getSilences();
      setStatus('Removendo silêncios somente do trecho selecionado…');
      if (mobileSafeMode) {
        const core = await exportWithoutSilencesMp4(file!, rangeStart, rangeEnd, ranges, (ratio) => setProgress(ratio * 0.6), false);
        const keptDuration = keptSegmentsFromSilences(rangeStart, rangeEnd, ranges).reduce((sum, segment) => sum + segment.end - segment.start, 0);
        if (vertical) await renderMobileVertical(core, keptDuration, 'tikcut-sem-silencios-mobile', 'Sem silêncios · móvel 720×1280', 0.6);
        else showOutput(core, `tikcut-sem-silencios-${Date.now()}.mp4`, 'Vídeo sem silêncios');
        return;
      }
      showOutput(await exportWithoutSilencesMp4(file!, rangeStart, rangeEnd, ranges, setProgress, vertical), `tikcut-sem-silencios-${Date.now()}.mp4`, vertical ? 'Vídeo sem silêncios em 9:16' : 'Vídeo sem silêncios');
    });
  }

  function planZoom() {
    if (!ensureRange('planejar Auto Zoom')) return [] as ZoomKeyframe[];
    const plan = buildSmartZoomPlan(rangeStart, rangeEnd, chunks, silences, style);
    setZoomPlan(plan);
    setTimeline(populateTimeline(createStudioTimeline(selectedDuration), plan, brollQueries, localChunks));
    setStatus(`${plan.length} movimentos de Auto Zoom planejados para o estilo ${style}.`);
    return plan;
  }

  async function renderZoom() {
    if (!ensureRange('renderizar Auto Zoom')) return;
    if (mobileSafeMode) return setStatus('No modo compatível móvel o planejamento de Auto Zoom funciona, mas o render pesado fica desligado. Desative “Modo compatível móvel” para renderizar Auto Zoom 1080×1920.');
    await withBusy('zoom-render', async () => {
      const plan = zoomPlan.length ? zoomPlan : planZoom();
      showOutput(await exportSmartZoomMp4(file!, rangeStart, rangeEnd, plan, setProgress), `tikcut-autozoom-${Date.now()}.mp4`, 'Auto Zoom 9:16');
    });
  }

  async function makeMetadata() {
    if (!transcript.trim()) return setStatus('Transcreva o vídeo ou cole uma transcrição antes de gerar metadados.');
    await withBusy('metadata', async () => {
      setStatus('Gerando títulos, descrição, hooks e hashtags…');
      const result = await generateSocialMetadata(transcript);
      setMetadata(result);
      setStatus(result.provider === 'chrome-ai' ? 'Metadados gerados com IA local do Chrome.' : 'IA local do Chrome indisponível; metadados gerados pelo motor local de fallback.');
    });
  }

  async function makeBrollPlan() {
    if (!transcript.trim()) return setStatus('Transcreva ou cole o texto antes de sugerir B-roll.');
    await withBusy('broll-plan', async () => {
      const queries = await generateBrollQueries(transcript, localChunks, selectedDuration);
      setBrollQueries(queries);
      setTimeline(populateTimeline(createStudioTimeline(selectedDuration || 1), zoomPlan, queries, localChunks));
      setStatus(`${queries.length} pontos de B-roll sugeridos. Pesquise os arquivos licenciados abaixo.`);
    });
  }

  async function searchBroll(query: BrollQuery) {
    await withBusy(`broll-${query.id}`, async () => {
      const media = await searchCommonsMedia(query.query, 6);
      setBrollResults((current) => ({ ...current, [query.id]: media }));
      setStatus(`${media.length} opções encontradas no Wikimedia Commons para “${query.query}”.`);
    });
  }

  async function autoFillBroll() {
    if (!transcript.trim()) return setStatus('Transcreva ou cole o texto antes de preencher B-roll.');
    await withBusy('broll-auto', async () => {
      const queries = brollQueries.length ? brollQueries : await generateBrollQueries(transcript, localChunks, selectedDuration);
      setBrollQueries(queries);
      let next = populateTimeline(createStudioTimeline(selectedDuration || 1), zoomPlan, [], localChunks);
      const resultMap: Record<string, CommonsMedia[]> = { ...brollResults };
      let added = 0;
      for (const query of queries.slice(0, mobileSafeMode ? 3 : 5)) {
        try {
          const media = await searchCommonsMedia(query.query, 1);
          resultMap[query.id] = media;
          const first = media[0];
          if (!first) continue;
          next = upsertTimelineItem(next, { id: crypto.randomUUID(), track: 'broll', label: first.title.slice(0, 32), start: query.start, end: query.end, sourceUrl: first.thumbUrl, sourcePage: first.pageUrl, license: first.license });
          added += 1;
        } catch {
          // Falha de uma fonte externa não deve derrubar o Studio Pro inteiro.
        }
      }
      setBrollResults(resultMap);
      setTimeline(next);
      setStatus(`Auto B-roll concluiu: ${added} item(ns) adicionados à timeline. Fontes indisponíveis foram ignoradas.`);
    });
  }

  function addBroll(query: BrollQuery, media: CommonsMedia) {
    setTimeline((current) => upsertTimelineItem(current, { id: crypto.randomUUID(), track: 'broll', label: media.title.slice(0, 36), start: query.start, end: query.end, sourceUrl: media.thumbUrl, sourcePage: media.pageUrl, license: media.license }));
    setStatus(`B-roll “${media.title}” adicionado à timeline.`);
  }

  async function collectBrollAssets(queries: BrollQuery[], plan: ZoomKeyframe[], local: TranscriptChunk[]) {
    const assets: BrollAsset[] = [];
    const resultMap: Record<string, CommonsMedia[]> = { ...brollResults };
    let next = populateTimeline(createStudioTimeline(selectedDuration || 1), plan, [], local);
    for (const query of queries.slice(0, 4)) {
      try {
        const media = resultMap[query.id]?.[0] ? resultMap[query.id] : await searchCommonsMedia(query.query, 2);
        resultMap[query.id] = media;
        const first = media[0];
        if (!first) continue;
        const blob = await fetchMediaBlob(first.thumbUrl);
        assets.push({ blob, start: query.start, end: query.end, label: first.title, sourcePage: first.pageUrl, license: first.license });
        next = upsertTimelineItem(next, { id: crypto.randomUUID(), track: 'broll', label: first.title.slice(0, 32), start: query.start, end: query.end, sourceUrl: first.thumbUrl, sourcePage: first.pageUrl, license: first.license });
      } catch {
        // Uma fonte externa quebrada não cancela o Autopilot.
      }
    }
    setBrollResults(resultMap);
    setTimeline(next);
    return assets;
  }

  function rebuildTimeline() {
    setTimeline(populateTimeline(createStudioTimeline(selectedDuration || 1), zoomPlan, brollQueries, localChunks));
    setStatus('Timeline reconstruída para o trecho selecionado.');
  }

  function exportSrt() {
    if (!localChunks.length) return setStatus('Transcreva com timestamps antes de exportar SRT.');
    const srt = localChunks.map((chunk, index) => `${index + 1}\n${srtTime(chunk.start)} --> ${srtTime(chunk.end)}\n${chunk.text}\n`).join('\n');
    downloadText(`tikcut-legendas-${Date.now()}.srt`, srt, 'application/x-subrip;charset=utf-8');
    setStatus('Arquivo SRT criado.');
  }

  async function mobileAutopilot(currentSilences: SilenceRange[], currentTranscript: string, currentChunks: TranscriptChunk[]) {
    let core: Blob;
    let outputDuration = selectedDuration;
    if (removeSilence) {
      core = await exportWithoutSilencesMp4(file!, rangeStart, rangeEnd, currentSilences, (ratio) => setProgress(ratio * 0.58), false);
      outputDuration = keptSegmentsFromSilences(rangeStart, rangeEnd, currentSilences).reduce((sum, segment) => sum + segment.end - segment.start, 0);
    } else {
      core = await exportCutMp4(file!, rangeStart, rangeEnd, (ratio) => setProgress(ratio * 0.58));
    }
    const local = currentChunks.filter((chunk) => chunk.end > rangeStart && chunk.start < rangeEnd).map((chunk) => ({ ...chunk, start: Math.max(0, chunk.start - rangeStart), end: Math.min(selectedDuration, chunk.end - rangeStart) }));
    setTimeline(populateTimeline(createStudioTimeline(selectedDuration), [], [], local));
    if (currentTranscript.trim()) setMetadata(await generateSocialMetadata(currentTranscript));
    if (vertical) await renderMobileVertical(core, outputDuration, `tikcut-autopilot-mobile-${style}`, `Autopilot móvel ${style} · 720×1280`, 0.58);
    else showOutput(core, `tikcut-autopilot-mobile-${style}-${Date.now()}.mp4`, `Autopilot móvel ${style}`);
  }

  async function autopilot() {
    if (!ensureRange('executar o Autopilot')) return;
    await withBusy('autopilot', async () => {
      let currentChunks = chunks;
      let currentTranscript = transcript;
      if (autoTranscribe && !currentTranscript.trim()) {
        const result = await transcribeVideoLocally(file!, rangeStart, rangeEnd, language, setStatus, setProgress);
        currentChunks = result.chunks;
        currentTranscript = result.text;
        setChunks(result.chunks);
        setTranscript(result.text);
      }
      const currentSilences = removeSilence ? (silences.length ? silences : await getSilences()) : silences;
      if (mobileSafeMode) {
        setStatus('Autopilot móvel: corte + silêncio opcional + saída leve. Auto Zoom e B-roll pesado ficam fora deste render para preservar memória.');
        await mobileAutopilot(currentSilences, currentTranscript, currentChunks);
        return;
      }

      const plan = autoZoom ? buildSmartZoomPlan(rangeStart, rangeEnd, currentChunks, currentSilences, style) : [];
      const local = currentChunks.filter((chunk) => chunk.end > rangeStart && chunk.start < rangeEnd).map((chunk) => ({ ...chunk, start: Math.max(0, chunk.start - rangeStart), end: Math.min(selectedDuration, chunk.end - rangeStart) }));
      const queries = currentTranscript.trim() ? await generateBrollQueries(currentTranscript, local, selectedDuration) : [];
      const social = currentTranscript.trim() ? await generateSocialMetadata(currentTranscript) : null;
      setZoomPlan(plan);
      setBrollQueries(queries);
      if (social) setMetadata(social);
      setTimeline(populateTimeline(createStudioTimeline(selectedDuration), plan, queries, local));

      let assets: BrollAsset[] = [];
      if (bakeBroll && vertical && queries.length) {
        setStatus('Autopilot buscando B-roll licenciado e preparando a timeline…');
        assets = await collectBrollAssets(queries, plan, local);
      }
      setStatus('Autopilot renderizando corte + silêncios + formato + Auto Zoom…');
      const core = await exportAutopilotMp4(file!, rangeStart, rangeEnd, currentSilences, plan, (ratio) => setProgress(ratio * 0.72), { removeSilence, vertical, autoZoom });
      if (bakeBroll && vertical && assets.length) {
        setStatus(`Autopilot incorporando ${assets.length} B-roll${assets.length === 1 ? '' : 's'} no MP4 final…`);
        const final = await overlayBrollOnVerticalVideo(core, assets, rangeStart, rangeEnd, currentSilences, removeSilence, (ratio) => setProgress(0.72 + ratio * 0.28));
        showOutput(final, `tikcut-autopilot-${style}-broll-${Date.now()}.mp4`, `Autopilot ${style} + B-roll`);
      } else {
        showOutput(core, `tikcut-autopilot-${style}-${Date.now()}.mp4`, `Autopilot ${style}`);
      }
    });
  }

  async function planFruit() {
    await withBusy('fruit-plan', async () => {
      setStatus('Criando storyboard Fruit AI…');
      const plan = await generateFruitPlan(fruitPrompt);
      setFruitPlan(plan);
      setStatus(`${plan.scenes.length} cenas criadas. O storyboard pode ser editado antes do render.`);
    });
  }

  async function renderFruit() {
    if (mobileSafeMode) return setStatus('No modo compatível móvel, gere o storyboard Fruit AI e finalize o render pesado no desktop ou desative o modo compatível.');
    await withBusy('fruit-render', async () => {
      const plan = fruitPlan ?? await generateFruitPlan(fruitPrompt);
      setFruitPlan(plan);
      const images: Blob[] = [];
      for (let index = 0; index < plan.scenes.length; index += 1) {
        const scene = plan.scenes[index];
        setStatus(`Fruit AI: buscando mídia licenciada para cena ${index + 1}/${plan.scenes.length}…`);
        const media = (await searchCommonsMedia(scene.searchQuery, 4))[0];
        if (!media) throw new Error(`Não encontrei imagem para “${scene.searchQuery}”.`);
        images.push(await fetchMediaBlob(media.thumbUrl));
      }
      setStatus('Fruit AI: animando cenas em 1080×1920…');
      showOutput(await exportImageMontageMp4(images, plan.scenes.map((scene) => scene.duration), setProgress), `tikcut-fruit-ai-${Date.now()}.mp4`, 'Fruit AI local');
    });
  }

  return (
    <div className="studio-pro-page app-shell">
      <header className="topbar studio-pro-topbar">
        <div><div className="eyebrow">TIKCUT ADVANCED EDIT LAB</div><h1>TikCut <span>AI</span> · STUDIO PRO</h1></div>
        <div className="top-actions"><span className="pill good">FFmpeg local</span><span className={`pill ${mobileSafeMode ? 'good' : 'muted'}`}>{mobileSafeMode ? 'Modo móvel ON' : 'Modo desktop'}</span><span className={`pill ${browserAi === 'available' ? 'good' : 'muted'}`}>Chrome AI: {browserAi}</span></div>
      </header>

      <section className="card" aria-label="Compatibilidade Studio Pro">
        <div className="section-title">0 · Compatibilidade e diagnóstico</div>
        <label className="check-row"><input aria-label="Modo compatível móvel" type="checkbox" checked={mobileSafeMode} onChange={(event) => setMobileSafeMode(event.target.checked)} />Modo compatível móvel</label>
        <p className="helper">No celular: máximo recomendado de 2:45 por processamento, saída vertical leve 720×1280 e Autopilot sem B-roll/Auto Zoom pesado. O vídeo final pode ser levado ao FINALIZADOR para 1080×1920.</p>
        <button disabled={!file || Boolean(busy)} onClick={() => void testMotor()}>{busy === 'engine-test' ? 'Testando motor…' : 'Testar motor com corte de 2s'}</button>
      </section>

      <main className="studio-pro-grid">
        <section className="pro-card source-card">
          <div className="section-title">1 · Fonte e intervalo</div>
          <label className="dropzone pro-dropzone"><input type="file" accept="video/*" onChange={(event) => importVideo(event.target.files?.[0] ?? null)} /><strong>{file?.name || 'Importar vídeo para o Studio Pro'}</strong><span>O arquivo principal continua local no dispositivo.</span></label>
          {videoUrl ? <video ref={videoRef} src={videoUrl} controls playsInline onLoadedMetadata={(event) => {
            const d = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
            const initial = Math.min(d, mobileSafeMode ? 30 : 90);
            setDuration(d); setRangeStart(0); setRangeEnd(initial); setTimeline(createStudioTimeline(initial || 1));
            setStatus(`Fonte pronta: ${formatTime(d)}. Trecho inicial: ${formatTime(initial)}.${d >= 3600 ? ' Fonte 1h+ detectada.' : ''}`);
          }} /> : <div className="pro-video-empty">STUDIO PRO<br/><small>importe um vídeo</small></div>}
          <div className="pro-range"><label>IN (s)<input aria-label="Studio Pro IN" type="number" min="0" max={duration} step=".1" value={Number(rangeStart.toFixed(1))} onChange={(event) => changeStart(Number(event.target.value))} /></label><label>OUT (s)<input aria-label="Studio Pro OUT" type="number" min=".1" max={duration} step=".1" value={Number(rangeEnd.toFixed(1))} onChange={(event) => changeEnd(Number(event.target.value))} /></label></div>
          <div className="quick-duration" aria-label="Durações rápidas Studio Pro"><span>Duração:</span>{QUICK_DURATIONS.map((seconds) => <button key={seconds} disabled={!file} onClick={() => setQuickDuration(seconds)}>{quickLabel(seconds)}</button>)}</div>
          <div className="pro-stats"><span>Fonte <b>{formatTime(duration)}</b></span><span>Trecho <b>{formatTime(selectedDuration)}</b></span><span>Silêncios <b>{silences.length}</b></span></div>
          <button className="button secondary" disabled={!file || Boolean(busy)} onClick={() => void withBusy('silence-detect', async () => { await getSilences(); })}>{busy === 'silence-detect' ? 'Detectando…' : 'Detectar todos os silêncios'}</button>
          <p className="helper">Agora a detecção analisa somente o trecho IN/OUT, não a hora inteira.</p>
        </section>

        <section className="pro-card ai-card">
          <div className="section-title">2 · Transcrição automática completa</div>
          <div className="pro-inline"><select aria-label="Idioma da transcrição" value={language} onChange={(event) => setLanguage(event.target.value as TranscriptionLanguage)}><option value="auto">Idioma automático</option><option value="portuguese">Português</option><option value="english">Inglês</option><option value="spanish">Espanhol</option></select><button className="button primary" disabled={!file || Boolean(busy)} onClick={() => void transcribe()}>{busy === 'transcription' ? 'Transcrevendo…' : 'Transcrever com Whisper local'}</button></div>
          <textarea rows={8} value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="A transcrição automática aparece aqui. Você também pode colar/editar manualmente." />
          <div className="pro-inline"><button disabled={!localChunks.length} onClick={exportSrt}>Baixar SRT</button><span>{localChunks.length} blocos com timestamps</span></div>
          <p className="helper">Em celular, prefira trechos curtos para Whisper. O modelo é baixado/cacheado localmente.</p>
        </section>

        <section className="pro-card action-card"><div className="section-title">3 · Remoção automática de silêncios</div><label className="check-row"><input aria-label="Gerar saída vertical 9:16" type="checkbox" checked={vertical} onChange={(event) => setVertical(event.target.checked)} />Gerar saída vertical 9:16</label><button className="button cut" disabled={!file || Boolean(busy)} onClick={() => void removeAll()}>{busy === 'silence-render' ? 'Removendo…' : 'Remover TODOS os silêncios'}</button><p className="helper">No modo móvel, a saída vertical usa 720×1280 para reduzir RAM; no desktop mantém o render completo.</p></section>

        <section className="pro-card action-card"><div className="section-title">4 · Auto Zoom inteligente</div><select aria-label="Estilo do Auto Zoom" value={style} onChange={(event) => setStyle(event.target.value as AutopilotStyle)}>{STYLES.map((item) => <option key={item} value={item}>{item}</option>)}</select><div className="pro-inline"><button onClick={planZoom} disabled={!file}>Planejar Auto Zoom</button><button className="button export" disabled={!file || Boolean(busy) || mobileSafeMode} onClick={() => void renderZoom()}>{busy === 'zoom-render' ? 'Renderizando…' : 'Renderizar Auto Zoom 9:16'}</button></div><div className="zoom-list">{zoomPlan.slice(0, 8).map((item) => <span key={item.id}>{item.start.toFixed(1)}–{item.end.toFixed(1)}s · {item.zoom.toFixed(2)}×</span>)}</div></section>

        <section className="pro-card metadata-card"><div className="section-title">5 · Título, descrição, hashtags e hooks</div><button className="button primary" disabled={!transcript.trim() || Boolean(busy)} onClick={() => void makeMetadata()}>{busy === 'metadata' ? 'Gerando…' : 'Gerar pacote social'}</button>{metadata && <div className="metadata-output"><span className="pill good">{metadata.provider === 'chrome-ai' ? 'IA local Chrome' : 'Fallback local'}</span><h3>Títulos</h3>{metadata.titles.map((title) => <p key={title}>{title}</p>)}<h3>Descrição</h3><p>{metadata.description}</p><h3>Hooks</h3>{metadata.hooks.map((hook) => <p key={hook}>{hook}</p>)}<h3>Hashtags</h3><p>{metadata.hashtags.join(' ')}</p><button onClick={() => void navigator.clipboard?.writeText(`${metadata.titles[0]}\n\n${metadata.description}\n\n${metadata.hashtags.join(' ')}`)}>Copiar pacote</button></div>}</section>

        <section className="pro-card broll-card"><div className="section-title">6 · Auto B-roll licenciado</div><div className="pro-inline"><button disabled={!transcript.trim() || Boolean(busy)} onClick={() => void makeBrollPlan()}>Sugerir pontos de B-roll</button><button className="button primary" disabled={!transcript.trim() || Boolean(busy)} onClick={() => void autoFillBroll()}>{busy === 'broll-auto' ? 'Buscando…' : 'Auto preencher timeline'}</button></div><div className="broll-query-list">{brollQueries.map((query) => <article key={query.id}><div className="broll-query-head"><div><b>{query.query}</b><small>{query.start.toFixed(1)}–{query.end.toFixed(1)}s · {query.reason}</small></div><button disabled={Boolean(busy)} onClick={() => void searchBroll(query)}>Pesquisar Commons</button></div>{brollResults[query.id]?.length ? <div className="commons-grid">{brollResults[query.id].map((media) => <figure key={media.id}><img src={media.thumbUrl} alt={media.description || media.title} loading="lazy" /><figcaption><b>{media.title}</b><small>{media.license}{media.artist ? ` · ${media.artist}` : ''}</small><div><button onClick={() => addBroll(query, media)}>+ Timeline</button><a href={media.pageUrl} target="_blank" rel="noreferrer">Fonte/licença</a></div></figcaption></figure>)}</div> : null}</article>)}</div></section>

        <section className="pro-card autopilot-card"><div className="section-title">7 · AUTOPILOT completo</div><div className="autopilot-options"><label><input aria-label="Transcrever se necessário" type="checkbox" checked={autoTranscribe} onChange={(event) => setAutoTranscribe(event.target.checked)} />Transcrever se necessário</label><label><input aria-label="Remover silêncios" type="checkbox" checked={removeSilence} onChange={(event) => setRemoveSilence(event.target.checked)} />Remover silêncios</label><label><input aria-label="9:16" type="checkbox" checked={vertical} onChange={(event) => setVertical(event.target.checked)} />9:16</label><label><input aria-label="Auto Zoom" type="checkbox" checked={autoZoom} disabled={mobileSafeMode} onChange={(event) => setAutoZoom(event.target.checked)} />Auto Zoom</label><label><input aria-label="Incorporar B-roll" type="checkbox" checked={bakeBroll} disabled={mobileSafeMode || !vertical} onChange={(event) => setBakeBroll(event.target.checked)} />Incorporar B-roll no MP4</label></div><select aria-label="Estilo do Autopilot" value={style} onChange={(event) => setStyle(event.target.value as AutopilotStyle)}>{STYLES.map((item) => <option key={item} value={item}>{item}</option>)}</select><button className="button autopilot-run" disabled={!file || Boolean(busy)} onClick={() => void autopilot()}>{busy === 'autopilot' ? `Autopilot ${progress ? Math.round(progress * 100) : 0}%` : 'EXECUTAR AUTOPILOT'}</button><p className="helper">Desktop: pipeline completo. Móvel compatível: corte + silêncio opcional + saída 720×1280 para evitar travamentos de memória.</p></section>

        <section className="pro-card fruit-card"><div className="section-title">8 · Criar com IA · Fruit AI</div><textarea rows={5} value={fruitPrompt} onChange={(event) => setFruitPrompt(event.target.value)} /><div className="pro-inline"><button disabled={Boolean(busy)} onClick={() => void planFruit()}>{busy === 'fruit-plan' ? 'Planejando…' : 'Gerar storyboard IA'}</button><button className="button primary" disabled={Boolean(busy) || mobileSafeMode} onClick={() => void renderFruit()}>{busy === 'fruit-render' ? 'Criando vídeo…' : 'Criar vídeo Fruit AI local'}</button></div>{fruitPlan && <div className="fruit-scenes"><h3>{fruitPlan.title}</h3><p>{fruitPlan.hook}</p>{fruitPlan.scenes.map((scene, index) => <article key={scene.id}><b>Cena {index + 1} · {scene.duration}s</b><p>{scene.prompt}</p><small>Busca visual: {scene.searchQuery} · legenda: {scene.caption}</small></article>)}</div>}<p className="helper">No celular, o storyboard continua funcionando; o render de imagens fica reservado ao modo completo para preservar memória.</p></section>
      </main>

      <div className="timeline-wrap"><div className="timeline-tools"><button onClick={rebuildTimeline}>Reconstruir timeline do trecho</button></div><ProfessionalTimeline timeline={timeline} setTimeline={setTimeline} onSeek={(seconds) => { if (videoRef.current) videoRef.current.currentTime = rangeStart + seconds; }} /></div>
      <section className="pro-output card" aria-label="Saída Studio Pro"><div className="status" role="status"><span className="dot" />{status}</div>{busy && progress > 0 && <progress max="1" value={progress} />}{output ? <div className="pro-output-result"><div><b>{output.label}</b><span>{formatBytes(output.blob.size)}</span></div><video src={output.url} controls playsInline /><a className="download-ready" href={output.url} download={output.filename}>Baixar resultado</a></div> : <p className="helper">Os resultados renderizados aparecem aqui.</p>}</section>
      <footer><span>Studio Pro · processamento local-first com modo compatível móvel</span><span>v0.5.0</span></footer>
    </div>
  );
}
