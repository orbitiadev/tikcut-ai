import { useEffect, useMemo, useRef, useState } from 'react';
import { transcribeVideoLocally, type TranscriptionLanguage } from '../lib/transcription';
import { normalizeCaptions, renderFinalTikTokMp4, type BurnCaption, type CaptionStyle } from '../lib/finalRender';

function formatTime(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const m = Math.floor(safe / 60);
  const s = (safe % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}

function srtTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const ms = total % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function fromSrtTime(value: string) {
  const match = value.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4].padEnd(3, '0').slice(0, 3)) / 1000;
}

function parseSrt(text: string): BurnCaption[] {
  return text.replace(/\r/g, '').trim().split(/\n\n+/).flatMap((block) => {
    const lines = block.split('\n').filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) return [];
    const [startRaw, endRaw] = lines[timingIndex].split('-->').map((part) => part.trim());
    const caption = lines.slice(timingIndex + 1).join(' ').trim();
    if (!caption) return [];
    return [{ id: crypto.randomUUID(), text: caption, start: fromSrtTime(startRaw), end: fromSrtTime(endRaw) }];
  });
}

function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export default function Finalizer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [captions, setCaptions] = useState<BurnCaption[]>([]);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>('impact');
  const [language, setLanguage] = useState<TranscriptionLanguage>('auto');
  const [music, setMusic] = useState<File | null>(null);
  const [musicVolume, setMusicVolume] = useState(0.18);
  const [originalVolume, setOriginalVolume] = useState(1);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Importe um vídeo curto para finalizar.');
  const [output, setOutput] = useState<{ url: string; blob: Blob; filename: string } | null>(null);

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { if (output?.url) URL.revokeObjectURL(output.url); }, [output?.url]);

  const normalizedCaptions = useMemo(() => duration > 0 ? normalizeCaptions(captions, duration) : captions, [captions, duration]);
  const activeCaption = useMemo(() => normalizedCaptions.find((caption) => currentTime >= caption.start && currentTime <= caption.end) ?? null, [normalizedCaptions, currentTime]);

  function clearOutput() {
    setOutput((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  function importVideo(next: File | null) {
    if (!next) return;
    if (!next.type.startsWith('video/')) return setStatus('Escolha um arquivo de vídeo válido.');
    clearOutput();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setFile(next);
    setVideoUrl(URL.createObjectURL(next));
    setDuration(0);
    setCurrentTime(0);
    setCaptions([]);
    setStatus('Vídeo carregado. Lendo duração…');
  }

  function patchCaption(id: string, patch: Partial<BurnCaption>) {
    clearOutput();
    setCaptions((current) => current.map((caption) => caption.id === id ? { ...caption, ...patch } : caption));
  }

  function addCaption() {
    if (!duration) return setStatus('Importe um vídeo antes de adicionar legenda.');
    const start = Math.min(Math.max(0, videoRef.current?.currentTime ?? currentTime), Math.max(0, duration - 0.2));
    const next: BurnCaption = { id: crypto.randomUUID(), text: 'Nova legenda', start, end: Math.min(duration, start + 2.5) };
    setCaptions((current) => [...current, next].sort((a, b) => a.start - b.start));
    setStatus(`Legenda manual criada em ${formatTime(start)}.`);
  }

  async function autoTranscribe() {
    if (!file || duration <= 0) return setStatus('Importe um vídeo primeiro.');
    if (duration > 600) return setStatus('O Finalizador transcreve até 10 minutos. Recorte a fonte longa no Editor/Studio Pro primeiro.');
    if (busy) return;
    setBusy('transcription');
    setProgress(0);
    clearOutput();
    try {
      const result = await transcribeVideoLocally(file, 0, duration, language, setStatus, setProgress);
      const next = result.chunks.map((chunk) => ({ id: crypto.randomUUID(), text: chunk.text, start: chunk.start, end: chunk.end }));
      setCaptions(next);
      setStatus(`Legendas automáticas prontas: ${next.length} blocos temporizados com Whisper local (${result.device.toUpperCase()}).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'A transcrição falhou.');
    } finally {
      setBusy('');
      setProgress(0);
    }
  }

  async function importSrt(next: File | null) {
    if (!next) return;
    try {
      const parsed = parseSrt(await next.text());
      if (!parsed.length) throw new Error('Nenhuma legenda válida foi encontrada no SRT.');
      setCaptions(parsed);
      clearOutput();
      setStatus(`${parsed.length} blocos importados do SRT.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Não foi possível ler o SRT.');
    }
  }

  function exportSrt() {
    if (!normalizedCaptions.length) return setStatus('Adicione ou gere legendas antes de exportar SRT.');
    const text = normalizedCaptions.map((caption, index) => `${index + 1}\n${srtTime(caption.start)} --> ${srtTime(caption.end)}\n${caption.text}\n`).join('\n');
    downloadText(`tikcut-final-${Date.now()}.srt`, text, 'application/x-subrip;charset=utf-8');
    setStatus('SRT exportado.');
  }

  async function renderFinal() {
    if (!file || duration <= 0) return setStatus('Importe um vídeo antes de renderizar.');
    if (duration > 600) return setStatus('O Finalizador renderiza até 10 minutos por vez.');
    if (busy) return;
    setBusy('render');
    setProgress(0);
    clearOutput();
    setStatus('Renderizando 1080×1920 com legendas gravadas no vídeo…');
    try {
      const blob = await renderFinalTikTokMp4(file, duration, {
        captions: normalizedCaptions,
        captionStyle,
        music,
        musicVolume,
        originalVolume,
      }, setProgress);
      const filename = `tikcut-final-tiktok-${Date.now()}.mp4`;
      setOutput({ url: URL.createObjectURL(blob), blob, filename });
      setStatus(`Vídeo final pronto · ${(blob.size / 1_048_576).toFixed(1)} MB · legendas realmente incorporadas ao MP4.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'A finalização falhou.');
    } finally {
      setBusy('');
      setProgress(0);
    }
  }

  return (
    <main className="finalizer-page app-shell">
      <header className="topbar finalizer-topbar">
        <div>
          <div className="eyebrow">TIKCUT AI · FINAL RENDER</div>
          <h1>FINALIZADOR <span>v0.4</span></h1>
          <p>Legendas queimadas + música + áudio original + MP4 1080×1920.</p>
        </div>
        <span className="pill good">Local-first</span>
      </header>

      <section className="finalizer-grid">
        <div className="card finalizer-preview-card">
          <div className="eyebrow">1 · VÍDEO</div>
          <label className="finalizer-drop">
            <input aria-label="Importar vídeo no Finalizador" type="file" accept="video/*" onChange={(event) => importVideo(event.target.files?.[0] ?? null)} />
            <b>{file ? file.name : 'Clique para importar o vídeo curto'}</b>
            <span>O render final aceita até 10 minutos por vez.</span>
          </label>
          {videoUrl && (
            <div className="finalizer-video-wrap">
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                playsInline
                onLoadedMetadata={(event) => {
                  const value = event.currentTarget.duration;
                  setDuration(value);
                  setStatus(value > 600 ? `Duração ${formatTime(value)}. Recorte para até 10 minutos antes do render final.` : `Vídeo pronto · ${formatTime(value)}.`);
                }}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
              />
              {activeCaption && <div className={`burn-caption-preview caption-${captionStyle}`}>{captionStyle === 'impact' ? activeCaption.text.toLocaleUpperCase('pt-BR') : activeCaption.text}</div>}
            </div>
          )}
          <div className="finalizer-status" role="status">{status}</div>
          {busy && <div className="finalizer-progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /><b>{Math.round(progress * 100)}%</b></div>}
        </div>

        <div className="card finalizer-controls">
          <div className="eyebrow">2 · LEGENDAS</div>
          <div className="finalizer-actions">
            <select aria-label="Idioma das legendas" value={language} onChange={(event) => setLanguage(event.target.value as TranscriptionLanguage)}>
              <option value="auto">Idioma automático</option>
              <option value="portuguese">Português</option>
              <option value="english">Inglês</option>
              <option value="spanish">Espanhol</option>
            </select>
            <button disabled={!file || !!busy} onClick={() => void autoTranscribe()}>Gerar legendas com Whisper</button>
            <button disabled={!duration || !!busy} onClick={addCaption}>+ Legenda manual</button>
          </div>
          <div className="finalizer-actions">
            <label className="mini-file">Importar SRT<input aria-label="Importar arquivo SRT" type="file" accept=".srt,application/x-subrip,text/plain" onChange={(event) => void importSrt(event.target.files?.[0] ?? null)} /></label>
            <button disabled={!normalizedCaptions.length} onClick={exportSrt}>Exportar SRT</button>
          </div>
          <fieldset className="caption-style-fieldset">
            <legend>Estilo que será gravado no MP4</legend>
            {(['impact', 'clean', 'storytime'] as CaptionStyle[]).map((item) => (
              <label key={item}><input type="radio" name="captionStyle" value={item} checked={captionStyle === item} onChange={() => { setCaptionStyle(item); clearOutput(); }} /> {item}</label>
            ))}
          </fieldset>
        </div>

        <div className="card finalizer-controls">
          <div className="eyebrow">3 · ÁUDIO</div>
          <label className="mini-file wide">{music ? `Música: ${music.name}` : 'Adicionar música opcional'}
            <input aria-label="Adicionar música ao vídeo final" type="file" accept="audio/*" onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              if (next && !next.type.startsWith('audio/')) return setStatus('Escolha um arquivo de áudio válido.');
              setMusic(next); clearOutput();
            }} />
          </label>
          <label>Volume da música · {Math.round(musicVolume * 100)}%
            <input aria-label="Volume da música" type="range" min="0" max="1" step="0.01" value={musicVolume} onChange={(event) => { setMusicVolume(Number(event.target.value)); clearOutput(); }} />
          </label>
          <label>Volume do áudio original · {Math.round(originalVolume * 100)}%
            <input aria-label="Volume do áudio original" type="range" min="0" max="1.5" step="0.01" value={originalVolume} onChange={(event) => { setOriginalVolume(Number(event.target.value)); clearOutput(); }} />
          </label>
        </div>

        <div className="card finalizer-controls finalizer-render-card">
          <div className="eyebrow">4 · FINALIZAR</div>
          <p>Saída fixa para TikTok/Reels/Shorts: <b>1080×1920 · H.264 · AAC · 30 fps</b>.</p>
          <button className="primary-action" data-testid="render-final-video" disabled={!file || !duration || duration > 600 || !!busy} onClick={() => void renderFinal()}>Renderizar vídeo final</button>
          {output && (
            <div className="finalizer-output" data-testid="final-output">
              <video src={output.url} controls playsInline />
              <a className="primary-action" href={output.url} download={output.filename}>Baixar MP4 final</a>
            </div>
          )}
        </div>
      </section>

      <section className="card caption-editor" aria-label="Editor de legendas">
        <div className="caption-editor-head">
          <div><div className="eyebrow">LEGENDA EDITÁVEL</div><h2>{normalizedCaptions.length} blocos</h2></div>
          <span>A prévia acompanha o playhead do vídeo.</span>
        </div>
        {!captions.length ? <p className="muted">Gere com Whisper, importe um SRT ou crie uma legenda manual.</p> : (
          <div className="caption-rows">
            {captions.map((caption, index) => (
              <div className="caption-row" key={caption.id}>
                <b>#{index + 1}</b>
                <label>IN<input aria-label={`Legenda ${index + 1} início`} type="number" min="0" step="0.05" value={caption.start} onChange={(event) => patchCaption(caption.id, { start: Number(event.target.value) })} /></label>
                <label>OUT<input aria-label={`Legenda ${index + 1} fim`} type="number" min="0" step="0.05" value={caption.end} onChange={(event) => patchCaption(caption.id, { end: Number(event.target.value) })} /></label>
                <textarea aria-label={`Legenda ${index + 1} texto`} value={caption.text} onChange={(event) => patchCaption(caption.id, { text: event.target.value })} />
                <button className="danger-mini" onClick={() => { setCaptions((current) => current.filter((item) => item.id !== caption.id)); clearOutput(); }}>Excluir</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
