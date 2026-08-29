import { useEffect, useMemo, useRef, useState } from 'react';
import AuthPanel from './components/AuthPanel';
import { exportVerticalMp4 } from './lib/ffmpeg';
import { detectSilences } from './lib/silence';
import { scoreTranscript } from './lib/cutScoring';
import { addManualPlannedCut, generateAutoCutPlan, recommendedCutCount } from './lib/multiCut';
import { loadLocalProject, saveLocalProject, syncProject } from './lib/projectStore';
import type { CaptionStyle, ClipSuggestion, CutMode, LocalProject, PlannedCut, SilenceRange } from './lib/types';

const formatTime = (value: number) => {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60).toString().padStart(2, '0');
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds}`;
  return `${minutes}:${seconds}`;
};

const formatBytes = (value: number) => {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
};

const durationOptions = [30, 45, 60, 90, 120, 180, 300];

type BusyOperation = 'silence' | 'export' | 'batch' | null;
type RenderedCut = { url: string; size: number; filename: string };

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const renderedRef = useRef<Record<string, RenderedCut>>({});
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
  const [rendered, setRendered] = useState<Record<string, RenderedCut>>({});
  const [renderingCutId, setRenderingCutId] = useState('');
  const [status, setStatus] = useState('Pronto');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState<BusyOperation>(null);
  const [projectId] = useState(() => loadLocalProject()?.id ?? crypto.randomUUID());

  useEffect(() => {
    const saved = loadLocalProject();
    if (!saved) return;
    setTranscript(saved.transcript);
    setCaptionStyle(saved.captionStyle);
    setCutMode(saved.cutMode ?? 'automatic');
  }, []);

  useEffect(() => { renderedRef.current = rendered; }, [rendered]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
    Object.values(renderedRef.current).forEach((item) => URL.revokeObjectURL(item.url));
  }, [url]);

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

  function clearRendered() {
    Object.values(renderedRef.current).forEach((item) => URL.revokeObjectURL(item.url));
    renderedRef.current = {};
    setRendered({});
  }

  async function handleFile(next: File | null) {
    if (!next) return;
    if (!next.type.startsWith('video/')) {
      setStatus('Selecione um arquivo de vídeo válido.');
      return;
    }
    if (url) URL.revokeObjectURL(url);
    clearRendered();
    setFile(next);
    setUrl(URL.createObjectURL(next));
    setDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setSuggestions([]);
    setSilences([]);
    setCuts([]);
    setProgress(0);
    setStatus(`Vídeo carregado localmente (${formatBytes(next.size)}). Lendo duração…`);
  }

  function regenerateAutomaticPlan(
    sourceDuration = duration,
    nextSilences = silences,
    nextSuggestions = suggestions,
    count = autoCount,
    minSeconds = autoMin,
    maxSeconds = autoMax,
  ) {
    if (sourceDuration <= 0) return;
    const plan = generateAutoCutPlan(sourceDuration, { count, minSeconds, maxSeconds }, nextSilences, nextSuggestions);
    clearRendered();
    setCuts(plan);
    setCutMode('automatic');
    setStatus(`${plan.length} cortes automáticos planejados ao longo de ${formatTime(sourceDuration)}. Você pode renderizar todos ou editar a fila.`);
  }

  function analyzeTranscript() {
    if (!transcript.trim()) {
      setStatus('Cole ou importe uma transcrição antes de analisar os cortes.');
      return;
    }
    const ranked = scoreTranscript(transcript, duration);
    setSuggestions(ranked);
    if (cutMode === 'automatic' && duration > 0) {
      const plan = generateAutoCutPlan(duration, { count: autoCount, minSeconds: autoMin, maxSeconds: autoMax }, silences, ranked);
      clearRendered();
      setCuts(plan);
      setStatus(`${ranked.length} trechos de texto ranqueados e usados para melhorar ${plan.length} cortes automáticos.`);
      return;
    }
    setStatus(`${ranked.length} sugestões ranqueadas. Tempos sem timecode são estimativas.`);
  }

  async function analyzeSilence() {
    if (!file) return setStatus('Importe um vídeo primeiro.');
    if (busy) return;
    setBusy('silence');
    setStatus(isLongSource ? 'Analisando áudio longo em streaming. O arquivo inteiro não é copiado para a memória…' : 'Analisando áudio localmente…');
    try {
      const ranges = await detectSilences(file, -38, 0.55, duration);
      setSilences(ranges);
      if (cutMode === 'automatic' && duration > 0) {
        const plan = generateAutoCutPlan(duration, { count: autoCount, minSeconds: autoMin, maxSeconds: autoMax }, ranges, suggestions);
        clearRendered();
        setCuts(plan);
        setStatus(`${ranges.length} pausas detectadas. Os ${plan.length} cortes foram recalculados para aproximar as bordas de pausas.`);
      } else {
        setStatus(`${ranges.length} pausas longas detectadas no áudio.`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao analisar o áudio.');
    } finally {
      setBusy(null);
    }
  }

  function previewCut(item: PlannedCut) {
    setTrimStart(item.start);
    setTrimEnd(item.end);
    if (videoRef.current) videoRef.current.currentTime = item.start;
    setStatus(`${item.title}: ${formatTime(item.start)} → ${formatTime(item.end)}.`);
  }

  function applySuggestion(item: ClipSuggestion) {
    const start = Math.max(0, Math.min(duration || item.estimatedEnd, item.estimatedStart));
    const end = Math.max(start + 1, Math.min(duration || item.estimatedEnd, item.estimatedEnd));
    setCutMode('manual');
    setTrimStart(start);
    setTrimEnd(end);
    if (videoRef.current) videoRef.current.currentTime = start;
    setStatus('Sugestão aplicada ao intervalo manual.');
  }

  function addManualCut() {
    if (!file || selectedDuration <= 0) return setStatus('Defina um intervalo válido antes de adicionar o corte.');
    if (selectedDuration > 600) return setStatus('Cada corte pode ter até 10 minutos. A fonte pode ter várias horas.');
    setCuts((current) => addManualPlannedCut(current, trimStart, trimEnd));
    setStatus(`Corte manual ${formatTime(trimStart)} → ${formatTime(trimEnd)} adicionado à fila.`);
  }

  function removeCut(id: string) {
    const ready = renderedRef.current[id];
    if (ready) URL.revokeObjectURL(ready.url);
    setRendered((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setCuts((current) => current.filter((item) => item.id !== id));
  }

  function toggleCut(id: string) {
    setCuts((current) => current.map((item) => item.id === id ? { ...item, selected: !item.selected } : item));
  }

  function selectAllCuts(selected: boolean) {
    setCuts((current) => current.map((item) => ({ ...item, selected })));
  }

  function storeRendered(item: PlannedCut, blob: Blob) {
    const existing = renderedRef.current[item.id];
    if (existing) URL.revokeObjectURL(existing.url);
    const base = (file?.name ?? 'video').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 48);
    const result: RenderedCut = {
      url: URL.createObjectURL(blob),
      size: blob.size,
      filename: `${base}-${item.title.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()}.mp4`,
    };
    setRendered((current) => ({ ...current, [item.id]: result }));
  }

  async function renderCut(item: PlannedCut, onProgress: (ratio: number) => void) {
    if (!file) throw new Error('Importe um vídeo primeiro.');
    const blob = await exportVerticalMp4(file, item.start, item.end, onProgress);
    storeRendered(item, blob);
    return blob;
  }

  async function renderOneCut(item: PlannedCut) {
    if (!file || busy) return;
    setBusy('batch');
    setRenderingCutId(item.id);
    setProgress(0);
    setStatus(`Renderizando ${item.title} sem processar o vídeo inteiro…`);
    try {
      const blob = await renderCut(item, setProgress);
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
        setStatus(`Cortando ${index + 1}/${targets.length}: ${item.title}. A fonte permanece montada localmente.`);
        await renderCut(item, (ratio) => setProgress((index + ratio) / targets.length));
      }
      setStatus(`${targets.length} cortes renderizados. Use “Baixar” em cada arquivo pronto.`);
    } catch (error) {
      setStatus(error instanceof Error ? `Lote interrompido: ${error.message}` : 'Lote interrompido por uma falha de renderização.');
    } finally {
      setBusy(null);
      setRenderingCutId('');
      setProgress(0);
    }
  }

  function downloadRendered(item: PlannedCut) {
    const ready = rendered[item.id];
    if (!ready) return;
    const a = document.createElement('a');
    a.href = ready.url;
    a.download = ready.filename;
    a.click();
  }

  async function exportClip() {
    if (!file || selectedDuration <= 0) return setStatus('Defina um intervalo válido antes de exportar.');
    if (selectedDuration > 600) return setStatus('Selecione até 10 minutos por corte. A fonte pode ter 2 horas ou mais.');
    if (busy) return;
    setBusy('export');
    setStatus(isLongSource ? 'Renderizando somente o intervalo escolhido da fonte longa…' : 'Carregando motor FFmpeg e renderizando no seu dispositivo…');
    setProgress(0);
    try {
      const blob = await exportVerticalMp4(file, trimStart, trimEnd, setProgress);
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `tikcut-${Date.now()}.mp4`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 5000);
      setStatus('MP4 9:16 exportado. O vídeo não foi enviado a um servidor.');
    } catch (error) {
      setStatus(error instanceof Error ? `Falha na exportação: ${error.message}` : 'Falha na exportação.');
    } finally {
      setBusy(null);
      setProgress(0);
    }
  }

  async function cloudSync() {
    try {
      const result = await syncProject(project);
      setStatus(result === 'synced' ? 'Projeto base sincronizado com Supabase.' : 'Supabase/Auth não configurado: projeto continua salvo localmente.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao sincronizar.');
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">LONG-FORM → MULTI-CUT STUDIO</div>
          <h1>TikCut <span>AI</span></h1>
        </div>
        <div className="top-actions"><span className="pill good">Local-first</span><span className="pill muted">2h+ source</span><AuthPanel /></div>
      </header>

      <main className="workspace multicut-workspace">
        <aside className="sidebar card">
          <div className="section-title">1 · Vídeo fonte</div>
          <label className="dropzone">
            <input type="file" accept="video/*" onChange={(e) => void handleFile(e.target.files?.[0] ?? null)} />
            <strong>{file ? file.name : 'Importar vídeo longo'}</strong>
            <span>MP4, MOV, WebM e formatos suportados pelo navegador. Fontes com 2h+ são processadas por trecho.</span>
          </label>
          <div className="stat-grid">
            <div><span>Duração fonte</span><b>{formatTime(duration)}</b></div>
            <div><span>Fila</span><b>{cuts.length} cortes</b></div>
          </div>
          {isLongSource && <p className="helper long-source-note">{isTwoHourSource ? 'Fonte de 2 horas ou mais detectada.' : 'Fonte longa detectada.'} O TikCut monta o arquivo sem copiar tudo para a memória e renderiza um corte por vez.</p>}

          <div className="section-title spaced">2 · Modo de corte</div>
          <div className="cut-mode-switch">
            <button className={cutMode === 'automatic' ? 'active' : ''} onClick={() => setCutMode('automatic')}>Automático</button>
            <button className={cutMode === 'manual' ? 'active' : ''} onClick={() => setCutMode('manual')}>Manual</button>
          </div>

          {cutMode === 'automatic' && <div className="auto-cut-config">
            <label>Quantidade<input aria-label="Quantidade de cortes" type="number" min="1" max="30" value={autoCount} onChange={(e) => setAutoCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} /></label>
            <label>Mínimo<select aria-label="Duração mínima" value={autoMin} onChange={(e) => { const value = Number(e.target.value); setAutoMin(value); if (autoMax < value) setAutoMax(value); }}>{durationOptions.map((value) => <option key={value} value={value}>{formatTime(value)}</option>)}</select></label>
            <label>Máximo<select aria-label="Duração máxima" value={autoMax} onChange={(e) => setAutoMax(Math.max(autoMin, Number(e.target.value)))}>{durationOptions.filter((value) => value >= autoMin).map((value) => <option key={value} value={value}>{formatTime(value)}</option>)}</select></label>
            <button className="button primary auto-plan-button" disabled={!file || duration <= 0 || Boolean(busy)} onClick={() => regenerateAutomaticPlan()}>Gerar cortes automáticos</button>
          </div>}

          <button className="button secondary" disabled={!file || Boolean(busy)} onClick={() => void analyzeSilence()}>{busy === 'silence' ? 'Analisando áudio…' : 'Detectar pausas/silêncios'}</button>
          <button className="button secondary" disabled={Boolean(busy)} onClick={() => void cloudSync()}>Sincronizar projeto</button>

          <div className="section-title spaced">Texto opcional</div>
          <p className="helper">A fila automática funciona sem transcrição. Se você colar uma transcrição, o ranking de texto ajuda a reposicionar alguns cortes.</p>
          <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Opcional: cole a transcrição do vídeo/podcast." rows={6} />
          <button className="button secondary" onClick={analyzeTranscript}>Analisar melhores cortes</button>
        </aside>

        <section className="stage card">
          <div className="stage-toolbar">
            <div><b>Preview do corte</b><span>9:16 · a fonte pode ter várias horas</span></div>
            <div className="top-actions"><span className="pill muted">1080 × 1920</span>{isTwoHourSource ? <span className="pill good">2h+ OK</span> : isLongSource ? <span className="pill good">1h+ OK</span> : null}</div>
          </div>
          <div className="phone-frame">
            {url ? (
              <video ref={videoRef} src={url} controls playsInline preload="metadata" onLoadedMetadata={(e) => {
                const d = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0;
                const count = recommendedCutCount(d);
                setDuration(d);
                setAutoCount(count);
                setTrimStart(0);
                setTrimEnd(d > 0 ? Math.min(d, 60) : 0);
                const plan = generateAutoCutPlan(d, { count, minSeconds: autoMin, maxSeconds: autoMax });
                setCuts(plan);
                setCutMode('automatic');
                setStatus(`Fonte pronta: ${formatTime(d)}. ${plan.length} cortes automáticos já foram distribuídos pelo vídeo; você não precisa escolher os minutos manualmente.`);
              }} />
            ) : <div className="empty-preview"><div>2H+</div><p>Importe um vídeo e a fila será criada automaticamente</p></div>}
            <div className={`caption ${captionStyle}`}>{currentCaption.slice(0, 120)}</div>
            <div className="safe-zone" aria-hidden="true" />
          </div>

          <div className="timeline-panel manual-range-panel">
            <div className="timeline-labels"><span>IN {formatTime(trimStart)}</span><span>OUT {formatTime(trimEnd)}</span><span>{formatTime(selectedDuration)}</span></div>
            <label>Início<input aria-label="Início" type="range" min="0" max={Math.max(1, duration)} step="0.1" value={Math.min(trimStart, Math.max(1, duration))} onChange={(e) => setTrimStart(Math.max(0, Math.min(Number(e.target.value), Math.max(0, trimEnd - 0.1))))} /></label>
            <label>Fim<input aria-label="Fim" type="range" min="0" max={Math.max(1, duration)} step="0.1" value={Math.min(trimEnd, Math.max(1, duration))} onChange={(e) => setTrimEnd(Math.min(Math.max(Number(e.target.value), trimStart + 0.1), Math.max(1, duration)))} /></label>
            {silences.length > 0 && <div className="silence-strip">{silences.slice(0, 12).map((s, i) => <button key={i} onClick={() => { setTrimStart(s.start); setTrimEnd(s.end); }}>Pausa {formatTime(s.start)}–{formatTime(s.end)}</button>)}</div>}
            <div className="manual-actions">
              <button className="button secondary" disabled={!file || selectedDuration <= 0 || Boolean(busy)} onClick={addManualCut}>Adicionar corte manual à fila</button>
              <button className="button export" disabled={!file || selectedDuration <= 0 || Boolean(busy)} onClick={() => void exportClip()}>{busy === 'export' && progress > 0 ? `Render ${Math.round(progress * 100)}%` : 'Exportar este intervalo'}</button>
            </div>
          </div>

          <div className="caption-style-row">
            <span>Prévia de legenda</span>
            <div className="segmented">
              {(['impact', 'clean', 'karaoke'] as CaptionStyle[]).map((style) => <button key={style} className={captionStyle === style ? 'active' : ''} onClick={() => setCaptionStyle(style)}>{style}</button>)}
            </div>
          </div>

          <div className="export-row multicut-status-row">
            <div className="status" role="status"><span className="dot" />{status}</div>
            {busy === 'batch' && <div className="batch-progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /><b>{Math.round(progress * 100)}%</b></div>}
          </div>
        </section>

        <aside className="inspector card cut-queue-panel">
          <div className="queue-heading">
            <div><div className="section-title">3 · Fila de cortes</div><p className="helper">Cortes de diferentes pontos do vídeo. Marque/desmarque antes do lote.</p></div>
            <span className="pill good">{selectedCuts.length}/{cuts.length}</span>
          </div>
          <div className="queue-toolbar">
            <button onClick={() => selectAllCuts(true)}>Todos</button>
            <button onClick={() => selectAllCuts(false)}>Nenhum</button>
          </div>
          <button className="button primary batch-render-button" disabled={!file || !selectedCuts.length || Boolean(busy)} onClick={() => void renderSelectedCuts()}>{busy === 'batch' ? `Cortando ${renderingCutId ? 'fila' : ''} ${Math.round(progress * 100)}%` : `Cortar ${selectedCuts.length} selecionados`}</button>

          <div className="cut-queue" data-testid="cut-queue">
            {cuts.length ? cuts.map((item, index) => {
              const ready = rendered[item.id];
              const rendering = renderingCutId === item.id;
              return <article className={`cut-card ${item.selected ? 'selected' : ''}`} key={item.id} data-cut-origin={item.origin}>
                <div className="cut-card-head">
                  <label><input type="checkbox" aria-label={`Selecionar ${item.title}`} checked={item.selected} onChange={() => toggleCut(item.id)} /><b>{index + 1}. {item.title}</b></label>
                  <span>{item.origin === 'manual' ? 'MANUAL' : item.origin === 'transcript' ? 'TEXTO' : 'AUTO'}</span>
                </div>
                <div className="cut-time"><strong>{formatTime(item.start)} → {formatTime(item.end)}</strong><small>{formatTime(item.end - item.start)}{item.score ? ` · score ${item.score}` : ''}</small></div>
                <p>{item.reason}</p>
                <div className="cut-actions">
                  <button onClick={() => previewCut(item)}>Prévia</button>
                  {ready ? <button className="ready" onClick={() => downloadRendered(item)}>Baixar · {formatBytes(ready.size)}</button> : <button disabled={Boolean(busy)} onClick={() => void renderOneCut(item)}>{rendering ? `Render ${Math.round(progress * 100)}%` : 'Cortar agora'}</button>}
                  <button className="remove" disabled={rendering} onClick={() => removeCut(item.id)}>Remover</button>
                </div>
              </article>;
            }) : <div className="empty-list">Importe um vídeo. Assim que a duração for lida, o TikCut cria a fila automaticamente.</div>}
          </div>

          {suggestions.length > 0 && <>
            <div className="section-title spaced">AutoCut Ranking</div>
            <div className="suggestion-mini-list">{suggestions.slice(0, 5).map((item) => <button key={item.id} onClick={() => applySuggestion(item)}><b>{item.score}</b><span>{item.title}</span><small>{formatTime(item.estimatedStart)}</small></button>)}</div>
          </>}
        </aside>
      </main>

      <footer><span>Arquivos longos ficam no dispositivo; cada corte é lido/renderizado separadamente.</span><span>v0.7 · Multi-Cut Long Form</span></footer>
    </div>
  );
}
