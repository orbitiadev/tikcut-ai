import { useEffect, useMemo, useRef, useState } from 'react';
import AuthPanel from './AuthPanel';
import { exportCutMp4, exportVerticalMp4 } from '../lib/ffmpeg';
import { detectSilences } from '../lib/silence';
import { scoreTranscript } from '../lib/cutScoring';
import { loadLocalProject, saveLocalProject, syncProject } from '../lib/projectStore';
import type { CaptionStyle, ClipSuggestion, LocalProject, SilenceRange } from '../lib/types';

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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

type BusyOperation = 'silence' | 'cut' | 'vertical' | null;
type OutputKind = 'cut' | 'vertical';
type RenderedOutput = {
  url: string;
  filename: string;
  size: number;
  kind: OutputKind;
  start: number;
  end: number;
};

export default function EditorV2() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>('impact');
  const [suggestions, setSuggestions] = useState<ClipSuggestion[]>([]);
  const [silences, setSilences] = useState<SilenceRange[]>([]);
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
  }, []);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => { if (output?.url) URL.revokeObjectURL(output.url); }, [output]);

  const project: LocalProject = useMemo(() => ({
    id: projectId,
    name: file?.name ? file.name.replace(/\.[^.]+$/, '') : 'Projeto TikTok',
    createdAt: loadLocalProject()?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    trimStart,
    trimEnd,
    captionStyle,
    transcript
  }), [projectId, file, trimStart, trimEnd, captionStyle, transcript]);

  useEffect(() => { saveLocalProject(project); }, [project]);

  const selectedDuration = Math.max(0, trimEnd - trimStart);
  const currentCaption = transcript.trim() ? transcript.trim().split(/(?<=[.!?])\s+/)[0] : 'Sua legenda aparece aqui';
  const isLongSource = duration >= 3600;

  function clearOutput() {
    setOutput((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  async function handleFile(next: File | null) {
    if (!next) return;
    if (!next.type.startsWith('video/')) {
      setStatus('Selecione um arquivo de vídeo válido.');
      return;
    }
    if (url) URL.revokeObjectURL(url);
    clearOutput();
    setFile(next);
    setUrl(URL.createObjectURL(next));
    setDuration(0);
    setTrimStart(0);
    setTrimEnd(0);
    setSuggestions([]);
    setSilences([]);
    setProgress(0);
    setPreviewingSelection(false);
    setStatus(`Vídeo carregado localmente (${formatBytes(next.size)}). Lendo duração…`);
  }

  function analyzeTranscript() {
    if (!transcript.trim()) {
      setStatus('Cole ou importe uma transcrição antes de analisar os cortes.');
      return;
    }
    const ranked = scoreTranscript(transcript, duration);
    setSuggestions(ranked);
    setStatus(`${ranked.length} sugestões ranqueadas. Tempos sem timecode são estimativas.`);
  }

  async function analyzeSilence() {
    if (!file) return setStatus('Importe um vídeo primeiro.');
    if (busy) return;
    setBusy('silence');
    setStatus(isLongSource ? 'Analisando áudio longo. Isso pode levar alguns minutos…' : 'Analisando áudio localmente…');
    try {
      const ranges = await detectSilences(file, -38, 0.55, duration);
      setSilences(ranges);
      setStatus(`${ranges.length} pausas longas detectadas. O TikCut marca as pausas para revisão; ainda não remove todas automaticamente.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao analisar o áudio.');
    } finally {
      setBusy(null);
    }
  }

  function applySuggestion(item: ClipSuggestion) {
    const start = Math.max(0, Math.min(duration || item.estimatedEnd, item.estimatedStart));
    const end = Math.max(start + 1, Math.min(duration || item.estimatedEnd, item.estimatedEnd));
    clearOutput();
    setTrimStart(start);
    setTrimEnd(end);
    if (videoRef.current) videoRef.current.currentTime = start;
    setStatus('Sugestão aplicada aos marcadores IN/OUT. Use “Prévia do corte” e depois “Cortar vídeo”.');
  }

  function markIn() {
    if (!videoRef.current || duration <= 0) return;
    const next = clamp(videoRef.current.currentTime, 0, Math.max(0, duration - 0.1));
    clearOutput();
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
    setTrimEnd(next);
    setStatus(`OUT marcado em ${formatTime(next)}.`);
  }

  function setQuickDuration(seconds: number) {
    if (duration <= 0) return;
    clearOutput();
    setTrimEnd(Math.min(duration, trimStart + seconds));
    setStatus(`Corte ajustado para até ${seconds}s a partir do IN.`);
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
    clearOutput();
    setTrimStart(clamp(value, 0, Math.max(0, trimEnd - 0.1)));
  }

  function updateEndSeconds(value: number) {
    if (!Number.isFinite(value) || duration <= 0) return;
    clearOutput();
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
    if (selectedDuration > 600) return setStatus('Selecione até 10 minutos por corte. Para vídeo de 1h+, faça vários cortes menores.');
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
        <div>
          <div className="eyebrow">PRIVATE TIKTOK STUDIO</div>
          <h1>TikCut <span>AI</span></h1>
        </div>
        <div className="top-actions"><span className="pill good">Local-first</span><AuthPanel /></div>
      </header>

      <main className="workspace">
        <aside className="sidebar card">
          <div className="section-title">1 · Importar vídeo</div>
          <label className="dropzone">
            <input type="file" accept="video/*" onChange={(e) => void handleFile(e.target.files?.[0] ?? null)} />
            <strong>{file ? file.name : 'Clique aqui para escolher um vídeo'}</strong>
            <span>MP4, MOV, WebM e formatos suportados pelo navegador. O arquivo fica no seu dispositivo.</span>
          </label>
          <div className="stat-grid">
            <div><span>Duração</span><b>{formatTime(duration)}</b></div>
            <div><span>Corte selecionado</span><b>{formatTime(selectedDuration)}</b></div>
          </div>
          {isLongSource && <p className="helper">Fonte de 1h+ detectada. Não renderize a hora inteira: escolha trechos curtos e gere vários cortes.</p>}
          <button className="button secondary" disabled={Boolean(busy)} onClick={analyzeSilence}>{busy === 'silence' ? 'Analisando áudio…' : 'Detectar pausas/silêncios'}</button>
          <button className="button secondary" disabled={Boolean(busy)} onClick={() => void cloudSync()}>Sincronizar projeto</button>

          <div className="section-title spaced">Legenda de prévia</div>
          <div className="segmented">
            {(['impact', 'clean', 'karaoke'] as CaptionStyle[]).map((style) => (
              <button key={style} className={captionStyle === style ? 'active' : ''} onClick={() => setCaptionStyle(style)}>{style}</button>
            ))}
          </div>
          <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Cole a transcrição do vídeo. O AutoCut usa o texto para sugerir trechos." rows={9} />
          <button className="button primary" onClick={analyzeTranscript}>Analisar melhores cortes</button>
          <p className="helper">A legenda mostrada aqui é uma prévia visual. Ela ainda não é gravada dentro do MP4 exportado.</p>
        </aside>

        <section className="stage card">
          <div className="stage-toolbar">
            <div><b>2 · Marcar e cortar</b><span>IN/OUT · prévia · corte real</span></div>
            <div className="top-actions"><span className="pill muted">Original ou 9:16</span>{isLongSource && <span className="pill good">1h+ OK</span>}</div>
          </div>
          <div className="phone-frame">
            {url ? (
              <video
                ref={videoRef}
                src={url}
                controls
                playsInline
                onTimeUpdate={handleVideoTimeUpdate}
                onLoadedMetadata={(e) => {
                  const d = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0;
                  setDuration(d);
                  setTrimStart(0);
                  setTrimEnd(d > 0 ? Math.min(d, 60) : 0);
                  setStatus(d >= 3600 ? `Fonte longa pronta: ${formatTime(d)}. O corte inicial está em 0:00–1:00.` : `Vídeo pronto: ${formatTime(d)}. Ajuste IN/OUT e clique em “Cortar vídeo”.`);
                }}
              />
            ) : <div className="empty-preview"><div>9:16</div><p>Importe um vídeo para começar</p></div>}
            <div className={`caption ${captionStyle}`}>{currentCaption.slice(0, 120)}</div>
            <div className="safe-zone" aria-hidden="true" />
          </div>

          <div className="timeline-panel">
            <div className="timeline-labels"><span>IN {formatTime(trimStart)}</span><span>OUT {formatTime(trimEnd)}</span></div>
            <div className="marker-actions">
              <button disabled={!file} onClick={markIn}>Marcar IN no ponto atual</button>
              <button disabled={!file} onClick={markOut}>Marcar OUT no ponto atual</button>
              <button disabled={!file || selectedDuration <= 0} onClick={() => void previewSelection()}>{previewingSelection ? 'Reproduzindo trecho…' : 'Prévia do corte'}</button>
            </div>
            <label>Início<input aria-label="Início" type="range" min="0" max={Math.max(1, duration)} step="0.1" value={Math.min(trimStart, Math.max(1, duration))} onChange={(e) => updateStartSeconds(Number(e.target.value))} /></label>
            <label>Fim<input aria-label="Fim" type="range" min="0" max={Math.max(1, duration)} step="0.1" value={Math.min(trimEnd, Math.max(1, duration))} onChange={(e) => updateEndSeconds(Number(e.target.value))} /></label>
            <div className="time-inputs">
              <label>IN (segundos)<input aria-label="IN segundos" type="number" min="0" max={Math.max(0, duration)} step="0.1" value={Number(trimStart.toFixed(1))} onChange={(e) => updateStartSeconds(Number(e.target.value))} /></label>
              <label>OUT (segundos)<input aria-label="OUT segundos" type="number" min="0.1" max={Math.max(0.1, duration)} step="0.1" value={Number(trimEnd.toFixed(1))} onChange={(e) => updateEndSeconds(Number(e.target.value))} /></label>
            </div>
            <div className="quick-duration" aria-label="Durações rápidas">
              <span>Duração rápida:</span>
              {[15, 30, 45, 60, 90].map((seconds) => <button key={seconds} disabled={!file} onClick={() => setQuickDuration(seconds)}>{seconds}s</button>)}
            </div>
            {silences.length > 0 && <div className="silence-strip">{silences.slice(0, 12).map((s, i) => <button key={i} onClick={() => { clearOutput(); setTrimStart(s.start); setTrimEnd(s.end); if (videoRef.current) videoRef.current.currentTime = s.start; }}>Ver pausa {formatTime(s.start)}–{formatTime(s.end)}</button>)}</div>}
          </div>

          <div className="render-actions">
            <button className="button cut" disabled={!file || selectedDuration <= 0 || Boolean(busy)} onClick={() => void renderOutput('cut')}>
              {busy === 'cut' && progress > 0 ? `Cortando ${Math.round(progress * 100)}%` : busy === 'cut' ? 'Preparando corte…' : 'Cortar vídeo'}
            </button>
            <button className="button export" disabled={!file || selectedDuration <= 0 || Boolean(busy)} onClick={() => void renderOutput('vertical')}>
              {busy === 'vertical' && progress > 0 ? `9:16 ${Math.round(progress * 100)}%` : busy === 'vertical' ? 'Preparando 9:16…' : 'Exportar MP4 9:16'}
            </button>
          </div>

          <div className="status" role="status"><span className="dot" />{status}</div>

          {output && (
            <section className="output-card" aria-label="Resultado do corte">
              <div className="output-head">
                <div><b>{output.kind === 'cut' ? 'Corte pronto' : 'Vídeo 9:16 pronto'}</b><span>{formatTime(output.start)}–{formatTime(output.end)} · {formatBytes(output.size)}</span></div>
                <span className="pill good">PRONTO</span>
              </div>
              <video className="result-video" src={output.url} controls playsInline />
              <a className="download-ready" href={output.url} download={output.filename}>Baixar {output.kind === 'cut' ? 'corte pronto' : 'vídeo 9:16'}</a>
              <p className="helper">Se o download automático não abrir, use o botão acima. Confira o arquivo antes de publicar.</p>
            </section>
          )}
        </section>

        <aside className="inspector card">
          <div className="section-title">3 · AutoCut por texto</div>
          <p className="helper">Hoje o AutoCut usa a transcrição que você cola. Ele ranqueia trechos e posiciona IN/OUT; depois você confirma em “Cortar vídeo”.</p>
          <div className="suggestions">
            {suggestions.length ? suggestions.map((item) => (
              <article className="suggestion" key={item.id}>
                <div className="score">{item.score}<small>/100</small></div>
                <div className="suggestion-body">
                  <b>{item.title}</b>
                  <p>{item.excerpt.slice(0, 150)}{item.excerpt.length > 150 ? '…' : ''}</p>
                  <div className="mini-metrics"><span>Hook {item.hook}</span><span>Clareza {item.clarity}</span><span>Emoção {item.emotion}</span></div>
                  <small>{item.reason}</small>
                  <button onClick={() => applySuggestion(item)}>Aplicar IN/OUT sugerido</button>
                </div>
              </article>
            )) : <div className="empty-list">Cole uma transcrição e clique em “Analisar melhores cortes”.</div>}
          </div>
        </aside>
      </main>

      <footer><span>Corte, exportação e análise de silêncio são processados no dispositivo.</span><span>v0.2.0 · uso pessoal</span></footer>
    </div>
  );
}
