import { useEffect, useMemo, useRef, useState } from 'react';
import AuthPanel from './components/AuthPanel';
import { exportVerticalMp4 } from './lib/ffmpeg';
import { detectSilences } from './lib/silence';
import { scoreTranscript } from './lib/cutScoring';
import { loadLocalProject, saveLocalProject, syncProject } from './lib/projectStore';
import type { CaptionStyle, ClipSuggestion, LocalProject, SilenceRange } from './lib/types';

const formatTime = (value: number) => {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

export default function App() {
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
  const [projectId] = useState(() => loadLocalProject()?.id ?? crypto.randomUUID());

  useEffect(() => {
    const saved = loadLocalProject();
    if (!saved) return;
    setTranscript(saved.transcript);
    setCaptionStyle(saved.captionStyle);
    setTrimStart(saved.trimStart);
    setTrimEnd(saved.trimEnd);
  }, []);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

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

  async function handleFile(next: File | null) {
    if (!next) return;
    if (!next.type.startsWith('video/')) {
      setStatus('Selecione um arquivo de vídeo válido.');
      return;
    }
    if (url) URL.revokeObjectURL(url);
    setFile(next);
    setUrl(URL.createObjectURL(next));
    setSuggestions([]);
    setSilences([]);
    setProgress(0);
    setStatus('Vídeo carregado localmente.');
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
    setStatus('Analisando áudio localmente…');
    try {
      const ranges = await detectSilences(file);
      setSilences(ranges);
      setStatus(`${ranges.length} pausas longas detectadas no áudio.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao analisar o áudio.');
    }
  }

  function applySuggestion(item: ClipSuggestion) {
    const start = Math.max(0, Math.min(duration || item.estimatedEnd, item.estimatedStart));
    const end = Math.max(start + 1, Math.min(duration || item.estimatedEnd, item.estimatedEnd));
    setTrimStart(start);
    setTrimEnd(end);
    if (videoRef.current) videoRef.current.currentTime = start;
    setStatus('Sugestão aplicada ao intervalo de corte.');
  }

  async function exportClip() {
    if (!file || selectedDuration <= 0) return setStatus('Defina um intervalo válido antes de exportar.');
    setStatus('Carregando motor FFmpeg e renderizando no seu dispositivo…');
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
    }
  }

  async function cloudSync() {
    try {
      const result = await syncProject(project);
      setStatus(result === 'synced' ? 'Projeto sincronizado com Supabase.' : 'Supabase/Auth não configurado: projeto continua salvo localmente.');
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
          <div className="section-title">Projeto</div>
          <label className="dropzone">
            <input type="file" accept="video/*" onChange={(e) => void handleFile(e.target.files?.[0] ?? null)} />
            <strong>{file ? file.name : 'Importar podcast ou vídeo'}</strong>
            <span>MP4, MOV, WebM e formatos suportados pelo navegador</span>
          </label>
          <div className="stat-grid">
            <div><span>Duração</span><b>{formatTime(duration)}</b></div>
            <div><span>Corte</span><b>{formatTime(selectedDuration)}</b></div>
          </div>
          <button className="button secondary" onClick={analyzeSilence}>Detectar silêncios</button>
          <button className="button secondary" onClick={() => void cloudSync()}>Sincronizar projeto</button>

          <div className="section-title spaced">Legenda</div>
          <div className="segmented">
            {(['impact', 'clean', 'karaoke'] as CaptionStyle[]).map((style) => (
              <button key={style} className={captionStyle === style ? 'active' : ''} onClick={() => setCaptionStyle(style)}>{style}</button>
            ))}
          </div>
          <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Cole a transcrição do podcast. O AutoCut usa o texto para ranquear os trechos." rows={9} />
          <button className="button primary" onClick={analyzeTranscript}>Analisar melhores cortes</button>
        </aside>

        <section className="stage card">
          <div className="stage-toolbar">
            <div><b>Preview TikTok</b><span>9:16 · área segura</span></div>
            <span className="pill muted">1080 × 1920</span>
          </div>
          <div className="phone-frame">
            {url ? (
              <video ref={videoRef} src={url} controls playsInline onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration || 0;
                setDuration(d);
                setTrimEnd((current) => current > 0 ? Math.min(current, d) : d);
              }} />
            ) : <div className="empty-preview"><div>9:16</div><p>Importe um vídeo para começar</p></div>}
            <div className={`caption ${captionStyle}`}>{currentCaption.slice(0, 120)}</div>
            <div className="safe-zone" aria-hidden="true" />
          </div>

          <div className="timeline-panel">
            <div className="timeline-labels"><span>IN {formatTime(trimStart)}</span><span>OUT {formatTime(trimEnd)}</span></div>
            <label>Início<input type="range" min="0" max={Math.max(1, duration)} step="0.1" value={Math.min(trimStart, Math.max(1, duration))} onChange={(e) => setTrimStart(Math.min(Number(e.target.value), trimEnd - 0.1))} /></label>
            <label>Fim<input type="range" min="0" max={Math.max(1, duration)} step="0.1" value={Math.min(trimEnd, Math.max(1, duration))} onChange={(e) => setTrimEnd(Math.max(Number(e.target.value), trimStart + 0.1))} /></label>
            {silences.length > 0 && <div className="silence-strip">{silences.slice(0, 8).map((s, i) => <button key={i} onClick={() => { setTrimStart(s.start); setTrimEnd(s.end); }}>Pausa {formatTime(s.start)}–{formatTime(s.end)}</button>)}</div>}
          </div>

          <div className="export-row">
            <div className="status"><span className="dot" />{status}</div>
            <button className="button export" disabled={!file || selectedDuration <= 0} onClick={() => void exportClip()}>{progress > 0 && progress < 1 ? `Render ${Math.round(progress * 100)}%` : 'Exportar MP4 9:16'}</button>
          </div>
        </section>

        <aside className="inspector card">
          <div className="section-title">AutoCut Ranking</div>
          <p className="helper">Pontuação heurística local baseada no texto. Não inventa “viralidade”; mostra apenas sinais mensuráveis do trecho.</p>
          <div className="suggestions">
            {suggestions.length ? suggestions.map((item) => (
              <article className="suggestion" key={item.id}>
                <div className="score">{item.score}<small>/100</small></div>
                <div className="suggestion-body">
                  <b>{item.title}</b>
                  <p>{item.excerpt.slice(0, 150)}{item.excerpt.length > 150 ? '…' : ''}</p>
                  <div className="mini-metrics"><span>Hook {item.hook}</span><span>Clareza {item.clarity}</span><span>Emoção {item.emotion}</span></div>
                  <small>{item.reason}</small>
                  <button onClick={() => applySuggestion(item)}>Aplicar corte estimado</button>
                </div>
              </article>
            )) : <div className="empty-list">Cole uma transcrição e clique em “Analisar melhores cortes”.</div>}
          </div>
        </aside>
      </main>

      <footer><span>Processamento de vídeo e análise de silêncio ficam no dispositivo.</span><span>v0.1.0 · uso pessoal</span></footer>
    </div>
  );
}
