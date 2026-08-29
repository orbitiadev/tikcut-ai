import { useEffect, useMemo, useRef, useState } from 'react';
import AuthPanel from './AuthPanel';
import { exportCutMp4, exportVerticalMp4 } from '../lib/ffmpeg';
import { detectSilencesInRange } from '../lib/studioSilence';
import { scoreTranscript } from '../lib/cutScoring';
import { addManualPlannedCut, generateAutoCutPlan, recommendedCutCount } from '../lib/multiCut';
import { loadLocalProject, saveLocalProject, syncProject } from '../lib/projectStore';
import type { CaptionStyle, ClipSuggestion, CutMode, LocalProject, PlannedCut, SilenceRange } from '../lib/types';

const QUICK_DURATIONS = [15, 30, 45, 60, 90, 150, 165];
const AUTO_DURATIONS = [30, 45, 60, 90, 120, 180, 300];

const formatTime = (value: number) => {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60).toString().padStart(2, '0');
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds}`;
  return `${minutes}:${seconds}`;
};

const quickLabel = (seconds: number) => {
  if (seconds === 150) return '2:30';
  if (seconds === 165) return '2:45';
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60}min`;
  if (seconds > 60) return formatTime(seconds);
  return `${seconds}s`;
};

const formatBytes = (value: number) => {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

type BusyOperation = 'silence' | 'cut' | 'vertical' | 'batch' | null;
type OutputKind = 'cut' | 'vertical';
type RenderedOutput = {
  url: string;
  filename: string;
  size: number;
  kind: OutputKind;
  start: number;
  end: number;
};
type BatchOutput = { url: string; filename: string; size: number };

export default function EditorV3() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const batchOutputsRef = useRef<Record<string, BatchOutput>>({});
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>('impact');
  const [suggestions, setSuggestions] = useState<ClipSuggestion[]>([]);
  const [silences, setSilences] = useState<SilenceRange[]>([]);
  const [cutMode, setCutMode] = useState<CutMode>('automatic');
  const [cuts, setCuts] = useState<PlannedCut[]>([]);
  const [autoCount, setAutoCount] = useState(8);
  const [autoMin, setAutoMin] = useState(30);
  const [autoMax, setAutoMax] = useState(90);
  const [batchOutputs, setBatchOutputs] = useState<Record<string, BatchOutput>>({});
  const [renderingCutId, setRenderingCutId] = useState('');
  const [status, setStatus] = useState('Pronto');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState<BusyOperation>(null);
  const [previewingSelection, setPreviewingSelection] = useState(false);
  const [output, setOutput] = useState<RenderedOutput | null>(null);
  const [projectId] = useState(() => loadLocalProject()?.id ?? crypto.randomUUID());

  useEffect(() => {
    const saved = loadLocalProject();
    if (!saved) return;
    setTranscript(saved.transcript);
    setCaptionStyle(saved.captionStyle);
    setCutMode(saved.cutMode ?? 'automatic');
  }, []);

  useEffect(() => { batchOutputsRef.current = batchOutputs; }, [batchOutputs]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => { if (output?.url) URL.revokeObjectURL(output.url); }, [output]);
  useEffect(() => () => { Object.values(batchOutputsRef.current).forEach((item) => URL.revokeObjectURL(item.url)); }, []);

  const project: LocalProject = useMemo(() => ({
    id: projectId,
    name: file?.name ? file.name.replace(/\.[^.]+$/, '') : 'Projeto TikTok',
    createdAt: loadLocalProject()?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    trimStart,
    trimEnd,
    captionStyle,
    transcript,
    cutMode,
    cuts,
  }), [projectId, file, trimStart, trimEnd, captionStyle, transcript, cutMode, cuts]);

  useEffect(() => { saveLocalProject(project); }, [project]);

  const selectedDuration = Math.max(0, trimEnd - trimStart);
  const selectedCuts = cuts.filter((item) => item.selected);
  const currentCaption = transcript.trim() ? transcript.trim().split(/(?<=[.!?])\s+/)[0] : 'Sua legenda aparece aqui';
  const isLongSource = duration >= 3600;
  const isTwoHourSource = duration >= 7200;

  function clearOutput() {
    setOutput((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  function clearBatchOutputs() {
    Object.values(batchOutputsRef.current).forEach((item) => URL.revokeObjectURL(item.url));
    batchOutputsRef.current = {};
    setBatchOutputs({});
  }

  async function handleFile(next: File | null) {
    if (!next) return;
    if (!next.type.startsWith('video/')) {
      setStatus('Selecione um arquivo de vídeo válido.');
      return;
    }
    if (url) URL.revokeObjectURL(url);
    clearOutput();
    clearBatchOutputs();
    setFile(next);
    setUrl(URL.createObjectURL(next));
    setDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setSuggestions([]);
    setSilences([]);
    setCuts([]);
    setProgress(0);
    setPreviewingSelection(false);
    setStatus(`Vídeo carregado localmente (${formatBytes(next.size)}). Lendo duração…`);
  }

  function regenerateAutomaticPlan(
    sourceDuration = duration,
    ranked = suggestions,
    count = autoCount,
    minSeconds = autoMin,
    maxSeconds = autoMax,
  ) {
    if (sourceDuration <= 0) return;
    clearBatchOutputs();
    const plan = generateAutoCutPlan(sourceDuration, { count, minSeconds, maxSeconds }, [], ranked);
    setCuts(plan);
    setCutMode('automatic');
    setStatus(`${plan.length} cortes automáticos distribuídos ao longo de ${formatTime(sourceDuration)}. Você pode cortar todos ou escolher quais quer.`);
  }

  function analyzeTranscript() {
    if (!transcript.trim()) {
      setStatus('Cole ou importe uma transcrição antes de analisar os cortes.');
      return;
    }
    const ranked = scoreTranscript(transcript, duration);
    setSuggestions(ranked);
    if (cutMode === 'automatic' && duration > 0) {
      clearBatchOutputs();
      const plan = generateAutoCutPlan(duration, { count: autoCount, minSeconds: autoMin, maxSeconds: autoMax }, [], ranked);
      setCuts(plan);
      setStatus(`${ranked.length} sugestões ranqueadas e usadas para melhorar ${plan.length} cortes automáticos.`);
      return;
    }
    setStatus(`${ranked.length} sugestões ranqueadas. Tempos sem timecode são estimativas.`);
  }

  async function analyzeSilence() {
    if (!file) return setStatus('Importe um vídeo primeiro.');
    if (selectedDuration <= 0) return setStatus('Defina IN/OUT antes de detectar silêncios.');
    if (busy) return;
    setBusy('silence');
    setProgress(0);
    setStatus(`Analisando silêncios somente no trecho ${formatTime(trimStart)}–${formatTime(trimEnd)}…`);
    try {
      const ranges = await detectSilencesInRange(file, trimStart, trimEnd, setProgress, -38, 0.55);
      setSilences(ranges);
      setStatus(`${ranges.length} pausas detectadas dentro do corte selecionado. O Studio Pro pode removê-las automaticamente.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao analisar o áudio.');
    } finally {
      setBusy(null);
      setProgress(0);
    }
  }

  function applySuggestion(item: ClipSuggestion) {
    const start = Math.max(0, Math.min(duration || item.estimatedEnd, item.estimatedStart));
    const end = Math.max(start + 1, Math.min(duration || item.estimatedEnd, item.estimatedEnd));
    clearOutput();
    setSilences([]);
    setCutMode('manual');
    setTrimStart(start);
    setTrimEnd(end);
    if (videoRef.current) videoRef.current.currentTime = start;
    setStatus('Sugestão aplicada aos marcadores IN/OUT. Use “Prévia do corte” e depois “Cortar vídeo”.');
  }

  function markIn() {
    if (!videoRef.current || duration <= 0) return;
    const next = clamp(videoRef.current.currentTime, 0, Math.max(0, duration - 0.1));
    clearOutput();
    setSilences([]);
    setTrimStart(next);
    if (trimEnd <= next) setTrimEnd(Math.min(duration, next + 30));
    setStatus(`IN marcado em ${formatTime(next)}.`);
  }

  function markOut() {
    if (!videoRef.current || duration <= 0) return;
    const next = clamp(videoRef.current.currentTime, 0.1, duration);
    if (next <= trimStart) {
      setStatus('O ponto OUT precisa ficar depois do ponto IN.');
      return;
    }
    clearOutput();
    setSilences([]);
    setTrimEnd(next);
    setStatus(`OUT marcado em ${formatTime(next)}.`);
  }

  function setQuickDuration(seconds: number) {
    if (duration <= 0) return;
    clearOutput();
    setSilences([]);
    setTrimEnd(Math.min(duration, trimStart + seconds));
    setStatus(`Corte ajustado para até ${quickLabel(seconds)} a partir do IN.`);
  }

  async function previewSelection() {
    const video = videoRef.current;
    if (!video || selectedDuration <= 0) return setStatus('Defina um intervalo válido antes de visualizar.');
    video.currentTime = trimStart;
    setPreviewingSelection(true);
    setStatus(`Reproduzindo apenas o trecho ${formatTime(trimStart)}–${formatTime(trimEnd)}.`);
    try {
      await video.play();
    } catch {
      setPreviewingSelection(false);
      setStatus('O navegador bloqueou a reprodução automática. Clique no play do vídeo e tente novamente.');
    }
  }

  function handleVideoTimeUpdate() {
    const video = videoRef.current;
    if (!video || !previewingSelection) return;
    if (video.currentTime >= trimEnd - 0.04) {
      video.pause();
      video.currentTime = trimStart;
      setPreviewingSelection(false);
      setStatus('Prévia do corte concluída. Se estiver certo, clique em “Cortar vídeo”.');
    }
  }

  function updateStartSeconds(value: number) {
    if (!Number.isFinite(value) || duration <= 0) return;
    const next = clamp(value, 0, Math.max(0, duration - 0.1));
    clearOutput();
    setSilences([]);
    setTrimStart(next);
    if (trimEnd <= next) setTrimEnd(Math.min(duration, next + 30));
  }

  function updateEndSeconds(value: number) {
    if (!Number.isFinite(value) || duration <= 0) return;
    clearOutput();
    setSilences([]);
    setTrimEnd(clamp(value, trimStart + 0.1, duration));
  }

  function triggerDownload(result: RenderedOutput) {
    const a = document.createElement('a');
    a.href = result.url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function renderOutput(kind: OutputKind) {
    if (!file || selectedDuration <= 0) return setStatus('Defina um intervalo válido antes de cortar.');
    if (selectedDuration > 600) return setStatus('Selecione até 10 minutos por corte. A fonte pode ter 2 horas ou mais; faça vários cortes menores.');
    if (busy) return;
    clearOutput();
    setBusy(kind === 'cut' ? 'cut' : 'vertical');
    setProgress(0);
    setStatus(kind === 'cut'
      ? 'Cortando somente o trecho IN/OUT. Primeiro tentamos corte rápido sem recodificar; se o codec não permitir, fazemos conversão automática.'
      : 'Convertendo somente o trecho selecionado para 1080×1920. Esta opção é mais lenta que o corte simples.');

    try {
      const blob = kind === 'cut'
        ? await exportCutMp4(file, trimStart, trimEnd, setProgress)
        : await exportVerticalMp4(file, trimStart, trimEnd, setProgress);
      const result: RenderedOutput = {
        url: URL.createObjectURL(blob),
        filename: kind === 'cut' ? `tikcut-corte-${Date.now()}.mp4` : `tikcut-vertical-${Date.now()}.mp4`,
        size: blob.size,
        kind,
        start: trimStart,
        end: trimEnd,
      };
      setOutput(result);
      setStatus(kind === 'cut'
        ? `Corte pronto: ${formatTime(trimStart)}–${formatTime(trimEnd)} (${formatBytes(blob.size)}). Veja a prévia abaixo e clique em “Baixar corte pronto”.`
        : `Vídeo vertical pronto (${formatBytes(blob.size)}). Veja a prévia abaixo e baixe quando quiser.`);
      triggerDownload(result);
    } catch (error) {
      setStatus(error instanceof Error ? `Falha ao gerar o vídeo: ${error.message}` : 'Falha ao gerar o vídeo.');
    } finally {
      setBusy(null);
      setProgress(0);
    }
  }

  function addManualToQueue() {
    if (!file || selectedDuration <= 0) return setStatus('Defina IN/OUT antes de adicionar um corte manual.');
    if (selectedDuration > 600) return setStatus('Cada corte da fila pode ter até 10 minutos; a fonte pode ter várias horas.');
    clearBatchOutputs();
    setCuts((current) => addManualPlannedCut(current, trimStart, trimEnd));
    setCutMode('manual');
    setStatus(`Trecho ${formatTime(trimStart)}–${formatTime(trimEnd)} adicionado à fila manual.`);
  }

  function previewPlannedCut(item: PlannedCut) {
    clearOutput();
    setTrimStart(item.start);
    setTrimEnd(item.end);
    if (videoRef.current) videoRef.current.currentTime = item.start;
    setStatus(`${item.title}: ${formatTime(item.start)}–${formatTime(item.end)}.`);
  }

  function toggleCut(id: string) {
    setCuts((current) => current.map((item) => item.id === id ? { ...item, selected: !item.selected } : item));
  }

  function selectAllCuts(selected: boolean) {
    setCuts((current) => current.map((item) => ({ ...item, selected })));
  }

  function removeCut(id: string) {
    const ready = batchOutputsRef.current[id];
    if (ready) URL.revokeObjectURL(ready.url);
    setBatchOutputs((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setCuts((current) => current.filter((item) => item.id !== id));
  }

  function storeBatchOutput(item: PlannedCut, blob: Blob) {
    const old = batchOutputsRef.current[item.id];
    if (old) URL.revokeObjectURL(old.url);
    const base = (file?.name ?? 'video').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 42);
    const ready: BatchOutput = {
      url: URL.createObjectURL(blob),
      filename: `${base}-corte-${String(Math.max(1, cuts.findIndex((cut) => cut.id === item.id) + 1)).padStart(2, '0')}.mp4`,
      size: blob.size,
    };
    setBatchOutputs((current) => ({ ...current, [item.id]: ready }));
  }

  async function renderPlannedCut(item: PlannedCut, onProgress: (ratio: number) => void) {
    if (!file) throw new Error('Importe um vídeo primeiro.');
    const blob = await exportCutMp4(file, item.start, item.end, onProgress);
    storeBatchOutput(item, blob);
    return blob;
  }

  async function renderOnePlannedCut(item: PlannedCut) {
    if (!file || busy) return;
    setBusy('batch');
    setRenderingCutId(item.id);
    setProgress(0);
    setStatus(`Cortando ${item.title} sem processar a fonte inteira…`);
    try {
      const blob = await renderPlannedCut(item, setProgress);
      setStatus(`${item.title} pronto (${formatBytes(blob.size)}).`);
    } catch (error) {
      setStatus(error instanceof Error ? `Falha em ${item.title}: ${error.message}` : `Falha em ${item.title}.`);
    } finally {
      setBusy(null);
      setRenderingCutId('');
      setProgress(0);
    }
  }

  async function renderSelectedCuts() {
    if (!file || busy) return;
    const targets = cuts.filter((item) => item.selected);
    if (!targets.length) return setStatus('Selecione pelo menos um corte da fila.');
    setBusy('batch');
    setProgress(0);
    try {
      for (let index = 0; index < targets.length; index += 1) {
        const item = targets[index];
        setRenderingCutId(item.id);
        setStatus(`Cortando ${index + 1}/${targets.length}: ${item.title}.`);
        await renderPlannedCut(item, (ratio) => setProgress((index + ratio) / targets.length));
      }
      setStatus(`${targets.length} cortes prontos. Baixe cada arquivo na fila.`);
    } catch (error) {
      setStatus(error instanceof Error ? `Lote interrompido: ${error.message}` : 'Lote interrompido por uma falha de renderização.');
    } finally {
      setBusy(null);
      setRenderingCutId('');
      setProgress(0);
    }
  }

  function downloadBatchOutput(item: PlannedCut) {
    const ready = batchOutputs[item.id];
    if (!ready) return;
    const a = document.createElement('a');
    a.href = ready.url;
    a.download = ready.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function cloudSync() {
    try {
      const result = await syncProject(project);
      setStatus(result === 'synced' ? 'Projeto sincronizado com Supabase.' : 'Faça login para sincronizar; o projeto continua salvo localmente neste navegador.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao sincronizar.');
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div><div className="eyebrow">LONG-FORM → MULTI-CUT STUDIO</div><h1>TikCut <span>AI</span></h1></div>
        <div className="top-actions"><span className="pill good">Local-first</span><span className="pill muted">2h+ source</span><AuthPanel /></div>
      </header>

      <main className="workspace multicut-workspace">
        <aside className="sidebar card">
          <div className="section-title">1 · Importar vídeo</div>
          <label className="dropzone"><input type="file" accept="video/*" onChange={(event) => void handleFile(event.target.files?.[0] ?? null)} /><strong>{file ? file.name : 'Clique aqui para escolher um vídeo'}</strong><span>MP4, MOV, WebM e formatos suportados pelo navegador. Vídeos com 2h+ são lidos por trecho.</span></label>
          <div className="stat-grid"><div><span>Duração</span><b>{formatTime(duration)}</b></div><div><span>Corte selecionado</span><b>{formatTime(selectedDuration)}</b></div></div>
          {isLongSource && <p className="helper long-source-note">{isTwoHourSource ? 'Fonte de 2h+ detectada.' : 'Fonte de 1h+ detectada.'} O arquivo fica montado localmente e cada corte é processado separadamente.</p>}

          <div className="section-title spaced">Modo de cortes</div>
          <div className="cut-mode-switch"><button className={cutMode === 'automatic' ? 'active' : ''} onClick={() => setCutMode('automatic')}>Automático</button><button className={cutMode === 'manual' ? 'active' : ''} onClick={() => setCutMode('manual')}>Manual</button></div>
          {cutMode === 'automatic' && <div className="auto-cut-config">
            <label>Quantidade<input aria-label="Quantidade de cortes" type="number" min="1" max="30" value={autoCount} onChange={(event) => setAutoCount(clamp(Number(event.target.value) || 1, 1, 30))} /></label>
            <label>Mínimo<select aria-label="Duração mínima" value={autoMin} onChange={(event) => { const value = Number(event.target.value); setAutoMin(value); if (autoMax < value) setAutoMax(value); }}>{AUTO_DURATIONS.map((value) => <option key={value} value={value}>{quickLabel(value)}</option>)}</select></label>
            <label>Máximo<select aria-label="Duração máxima" value={autoMax} onChange={(event) => setAutoMax(Math.max(autoMin, Number(event.target.value)))}>{AUTO_DURATIONS.filter((value) => value >= autoMin).map((value) => <option key={value} value={value}>{quickLabel(value)}</option>)}</select></label>
            <button className="button primary auto-plan-button" disabled={!file || duration <= 0 || Boolean(busy)} onClick={() => regenerateAutomaticPlan()}>Gerar cortes automáticos</button>
          </div>}
          <p className="helper">No automático, a fila é criada assim que o vídeo abre. Você não precisa escolher os minutos; pode apenas revisar ou apertar “Cortar selecionados”.</p>

          <button className="button secondary" disabled={Boolean(busy)} onClick={analyzeSilence}>{busy === 'silence' ? `Analisando ${Math.round(progress * 100)}%` : 'Detectar pausas/silêncios'}</button>
          <button className="button secondary" disabled={Boolean(busy)} onClick={() => void cloudSync()}>Sincronizar projeto</button>

          <div className="section-title spaced">Legenda de prévia</div>
          <div className="segmented">{(['impact', 'clean', 'karaoke'] as CaptionStyle[]).map((style) => <button key={style} className={captionStyle === style ? 'active' : ''} onClick={() => setCaptionStyle(style)}>{style}</button>)}</div>
          <textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="Opcional: cole a transcrição. A fila automática funciona mesmo sem texto." rows={7} />
          <button className="button primary" onClick={analyzeTranscript}>Analisar melhores cortes</button>
          <p className="helper">A legenda aqui é prévia; use o FINALIZADOR para gravá-la no MP4 final.</p>
        </aside>

        <section className="stage card">
          <div className="stage-toolbar"><div><b>2 · Prévia e ajuste manual</b><span>Automático por padrão · IN/OUT opcional</span></div><div className="top-actions"><span className="pill muted">Original ou 9:16</span>{isTwoHourSource ? <span className="pill good">2h+ OK</span> : isLongSource && <span className="pill good">1h+ OK</span>}</div></div>
          <div className="phone-frame">
            {url ? <video ref={videoRef} src={url} controls playsInline preload="metadata" onTimeUpdate={handleVideoTimeUpdate} onLoadedMetadata={(event) => {
              const d = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
              const count = recommendedCutCount(d);
              setDuration(d); setAutoCount(count); setTrimStart(0); setTrimEnd(d > 0 ? Math.min(d, 60) : 0);
              const plan = generateAutoCutPlan(d, { count, minSeconds: autoMin, maxSeconds: autoMax });
              clearBatchOutputs(); setCuts(plan); setCutMode('automatic');
              setStatus(`Fonte pronta: ${formatTime(d)}. ${plan.length} cortes automáticos foram distribuídos pelo vídeo inteiro.`);
            }} /> : <div className="empty-preview"><div>2H+</div><p>Importe um vídeo e a fila será criada automaticamente</p></div>}
            <div className={`caption ${captionStyle}`}>{currentCaption.slice(0, 120)}</div><div className="safe-zone" aria-hidden="true" />
          </div>

          <div className="timeline-panel">
            <div className="timeline-labels"><span>IN {formatTime(trimStart)}</span><span>OUT {formatTime(trimEnd)}</span></div>
            <div className="marker-actions"><button disabled={!file} onClick={markIn}>Marcar IN no ponto atual</button><button disabled={!file} onClick={markOut}>Marcar OUT no ponto atual</button><button disabled={!file || selectedDuration <= 0} onClick={() => void previewSelection()}>{previewingSelection ? 'Reproduzindo trecho…' : 'Prévia do corte'}</button></div>
            <label>Início<input aria-label="Início" type="range" min="0" max={Math.max(1, duration)} step="0.1" value={Math.min(trimStart, Math.max(1, duration))} onChange={(event) => updateStartSeconds(Number(event.target.value))} /></label>
            <label>Fim<input aria-label="Fim" type="range" min="0" max={Math.max(1, duration)} step="0.1" value={Math.min(trimEnd, Math.max(1, duration))} onChange={(event) => updateEndSeconds(Number(event.target.value))} /></label>
            <div className="time-inputs"><label>IN (segundos)<input aria-label="IN segundos" type="number" min="0" max={Math.max(0, duration)} step="0.1" value={Number(trimStart.toFixed(1))} onChange={(event) => updateStartSeconds(Number(event.target.value))} /></label><label>OUT (segundos)<input aria-label="OUT segundos" type="number" min="0.1" max={Math.max(0.1, duration)} step="0.1" value={Number(trimEnd.toFixed(1))} onChange={(event) => updateEndSeconds(Number(event.target.value))} /></label></div>
            <div className="quick-duration" aria-label="Durações rápidas"><span>Duração rápida:</span>{QUICK_DURATIONS.map((seconds) => <button key={seconds} disabled={!file} onClick={() => setQuickDuration(seconds)}>{quickLabel(seconds)}</button>)}</div>
            {cutMode === 'manual' && <button className="button secondary" disabled={!file || selectedDuration <= 0 || Boolean(busy)} onClick={addManualToQueue}>Adicionar este trecho à fila</button>}
            {silences.length > 0 && <div className="silence-strip">{silences.slice(0, 12).map((silence, index) => <button key={index} onClick={() => { clearOutput(); setTrimStart(silence.start); setTrimEnd(silence.end); if (videoRef.current) videoRef.current.currentTime = silence.start; }}>Ver pausa {formatTime(silence.start)}–{formatTime(silence.end)}</button>)}</div>}
          </div>

          <div className="render-actions"><button className="button cut" disabled={!file || selectedDuration <= 0 || Boolean(busy)} onClick={() => void renderOutput('cut')}>{busy === 'cut' && progress > 0 ? `Cortando ${Math.round(progress * 100)}%` : busy === 'cut' ? 'Preparando corte…' : 'Cortar vídeo'}</button><button className="button export" disabled={!file || selectedDuration <= 0 || Boolean(busy)} onClick={() => void renderOutput('vertical')}>{busy === 'vertical' && progress > 0 ? `9:16 ${Math.round(progress * 100)}%` : busy === 'vertical' ? 'Preparando 9:16…' : 'Exportar MP4 9:16'}</button></div>
          <div className="status" role="status"><span className="dot" />{status}</div>
          {busy === 'batch' && <div className="batch-progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /><b>{Math.round(progress * 100)}%</b></div>}

          {output && <section className="output-card" aria-label="Resultado do corte"><div className="output-head"><div><b>{output.kind === 'cut' ? 'Corte pronto' : 'Vídeo 9:16 pronto'}</b><span>{formatTime(output.start)}–{formatTime(output.end)} · {formatBytes(output.size)}</span></div><span className="pill good">PRONTO</span></div><video className="result-video" src={output.url} controls playsInline /><a className="download-ready" href={output.url} download={output.filename}>Baixar {output.kind === 'cut' ? 'corte pronto' : 'vídeo 9:16'}</a><p className="helper">Confira o arquivo antes de publicar.</p></section>}
        </section>

        <aside className="inspector card cut-queue-panel">
          <div className="queue-heading"><div><div className="section-title">3 · Fila de cortes</div><p className="helper">A fila automática cobre diferentes pontos/minutos do vídeo. Marque apenas os cortes que quiser gerar.</p></div><span className="pill good">{selectedCuts.length}/{cuts.length}</span></div>
          <div className="queue-toolbar"><button onClick={() => selectAllCuts(true)}>Todos</button><button onClick={() => selectAllCuts(false)}>Nenhum</button></div>
          <button className="button primary batch-render-button" disabled={!file || !selectedCuts.length || Boolean(busy)} onClick={() => void renderSelectedCuts()}>{busy === 'batch' ? `Cortando fila ${Math.round(progress * 100)}%` : `Cortar ${selectedCuts.length} selecionados`}</button>
          <div className="cut-queue" data-testid="cut-queue">{cuts.length ? cuts.map((item, index) => {
            const ready = batchOutputs[item.id];
            const rendering = renderingCutId === item.id;
            return <article className={`cut-card ${item.selected ? 'selected' : ''}`} key={item.id} data-cut-origin={item.origin}>
              <div className="cut-card-head"><label><input type="checkbox" aria-label={`Selecionar ${item.title}`} checked={item.selected} onChange={() => toggleCut(item.id)} /><b>{index + 1}. {item.title}</b></label><span>{item.origin === 'manual' ? 'MANUAL' : item.origin === 'transcript' ? 'TEXTO' : 'AUTO'}</span></div>
              <div className="cut-time"><strong>{formatTime(item.start)} → {formatTime(item.end)}</strong><small>{formatTime(item.end - item.start)}{item.score ? ` · score ${item.score}` : ''}</small></div>
              <div className="cut-actions"><button onClick={() => previewPlannedCut(item)}>Prévia</button>{ready ? <button className="ready" onClick={() => downloadBatchOutput(item)}>Baixar · {formatBytes(ready.size)}</button> : <button disabled={Boolean(busy)} onClick={() => void renderOnePlannedCut(item)}>{rendering ? `Render ${Math.round(progress * 100)}%` : 'Cortar agora'}</button>}<button className="remove" disabled={rendering} onClick={() => removeCut(item.id)}>Remover</button></div>
            </article>;
          }) : <div className="empty-list">Importe um vídeo. A fila automática aparece assim que a duração é lida.</div>}</div>

          <div className="section-title spaced">AutoCut por texto</div>
          <p className="helper">Opcional: cole uma transcrição para ranquear trechos. No automático, esses sinais também ajudam a posicionar a fila.</p>
          <div className="suggestions">{suggestions.length ? suggestions.map((item) => <article className="suggestion" key={item.id}><div className="score">{item.score}<small>/100</small></div><div className="suggestion-body"><b>{item.title}</b><p>{item.excerpt.slice(0, 150)}{item.excerpt.length > 150 ? '…' : ''}</p><div className="mini-metrics"><span>Hook {item.hook}</span><span>Clareza {item.clarity}</span><span>Emoção {item.emotion}</span></div><small>{item.reason}</small><button onClick={() => applySuggestion(item)}>Aplicar IN/OUT sugerido</button></div></article>) : <div className="empty-list">A fila automática não exige transcrição. Cole texto apenas se quiser melhorar o ranking.</div>}</div>
        </aside>
      </main>

      <footer><span>Vídeos longos ficam montados no dispositivo; cada corte é lido e processado separadamente.</span><span>v0.7.0 · Multi-Cut Long Form</span></footer>
    </div>
  );
}
