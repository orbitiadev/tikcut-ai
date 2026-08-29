import { useEffect, useMemo, useRef, useState } from 'react';
import { exportCutMp4, exportVerticalMp4 } from '../lib/ffmpeg';
import { addManualPlannedCut, generateAutoCutPlan, recommendedCutCount } from '../lib/multiCut';
import type { PlannedCut } from '../lib/types';
import {
  clearFocusedOutputs,
  clearFocusedProject,
  DEFAULT_FOCUSED_SETTINGS,
  deleteFocusedOutput,
  getFocusedStorageEstimate,
  listFocusedOutputs,
  loadFocusedProject,
  loadFocusedSettings,
  saveFocusedOutput,
  saveFocusedProject,
  saveFocusedSettings,
  type FocusedFormat,
  type FocusedOutputRecord,
  type FocusedSettings,
} from '../lib/focusedStore';

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 150, 165, 180, 300];

type GeneratedCut = {
  url: string;
  filename: string;
  size: number;
  saved: boolean;
  start: number;
  end: number;
  kind: FocusedFormat;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function formatTime(value: number) {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60).toString().padStart(2, '0');
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`;
  return `${minutes}:${seconds}`;
}

function formatDuration(seconds: number) {
  if (seconds === 150) return '2:30';
  if (seconds === 165) return '2:45';
  if (seconds < 60) return `${seconds}s`;
  return formatTime(seconds);
}

function formatBytes(value: number) {
  if (!value) return '0 MB';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(value > 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function safePrefix(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'tikcut';
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export default function FocusedCutApp() {
  const initialProject = useRef(loadFocusedProject());
  const videoRef = useRef<HTMLVideoElement>(null);
  const generatedRef = useRef<Record<string, GeneratedCut>>({});
  const [view, setView] = useState<'cut' | 'history'>('cut');
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [settings, setSettings] = useState<FocusedSettings>(() => initialProject.current?.settings ?? loadFocusedSettings());
  const [cuts, setCuts] = useState<PlannedCut[]>([]);
  const [manualStart, setManualStart] = useState(0);
  const [manualEnd, setManualEnd] = useState(60);
  const [previewEnd, setPreviewEnd] = useState<number | null>(null);
  const [generated, setGenerated] = useState<Record<string, GeneratedCut>>({});
  const [history, setHistory] = useState<FocusedOutputRecord[]>([]);
  const [storage, setStorage] = useState({ used: 0, quota: 0 });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Importe um vídeo para começar.');
  const [projectId, setProjectId] = useState(() => initialProject.current?.id ?? crypto.randomUUID());
  const createdAtRef = useRef(initialProject.current?.createdAt ?? new Date().toISOString());

  useEffect(() => { generatedRef.current = generated; }, [generated]);
  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);
  useEffect(() => () => {
    Object.values(generatedRef.current).forEach((item) => URL.revokeObjectURL(item.url));
  }, []);

  async function refreshHistory() {
    const [items, estimate] = await Promise.all([listFocusedOutputs(), getFocusedStorageEstimate()]);
    setHistory(items);
    setStorage(estimate);
  }

  useEffect(() => { void refreshHistory(); }, []);
  useEffect(() => { saveFocusedSettings(settings); }, [settings]);

  useEffect(() => {
    if (!file || duration <= 0) return;
    saveFocusedProject({
      id: projectId,
      sourceName: file.name,
      sourceSize: file.size,
      sourceLastModified: file.lastModified,
      sourceDuration: duration,
      cuts,
      settings,
      createdAt: createdAtRef.current,
      updatedAt: new Date().toISOString(),
    });
  }, [projectId, file, duration, cuts, settings]);

  const selectedCuts = useMemo(() => cuts.filter((item) => item.selected), [cuts]);
  const generatedCount = Object.keys(generated).length;
  const longSource = duration >= 7200;

  function replaceSettings(patch: Partial<FocusedSettings>) {
    setSettings((current) => {
      const next = { ...current, ...patch };
      if (next.maxSeconds < next.minSeconds) next.maxSeconds = next.minSeconds;
      return next;
    });
  }

  function clearGenerated() {
    Object.values(generatedRef.current).forEach((item) => URL.revokeObjectURL(item.url));
    generatedRef.current = {};
    setGenerated({});
  }

  function buildAutomaticPlan(sourceDuration = duration, nextSettings = settings) {
    if (sourceDuration <= 0) return [];
    return generateAutoCutPlan(sourceDuration, {
      count: nextSettings.count,
      minSeconds: nextSettings.minSeconds,
      maxSeconds: nextSettings.maxSeconds,
    });
  }

  function regenerate() {
    if (!duration) return setStatus('Importe um vídeo primeiro.');
    clearGenerated();
    const plan = buildAutomaticPlan();
    setCuts(plan);
    replaceSettings({ mode: 'automatic' });
    setStatus(`${plan.length} cortes distribuídos automaticamente ao longo de ${formatTime(duration)}.`);
  }

  function handleFile(next: File | null) {
    if (!next) return;
    if (!next.type.startsWith('video/')) return setStatus('Selecione um arquivo de vídeo válido.');
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    clearGenerated();
    setFile(next);
    setSourceUrl(URL.createObjectURL(next));
    setDuration(0);
    setPreviewEnd(null);
    setStatus(`Abrindo ${next.name} (${formatBytes(next.size)})…`);
  }

  function onLoadedMetadata() {
    const media = videoRef.current;
    if (!media || !file || !Number.isFinite(media.duration) || media.duration <= 0) {
      setStatus('Não foi possível ler a duração deste vídeo.');
      return;
    }
    const nextDuration = media.duration;
    setDuration(nextDuration);
    setManualStart(0);
    setManualEnd(Math.min(nextDuration, settings.maxSeconds));

    const saved = loadFocusedProject();
    const sameSource = saved
      && saved.sourceName === file.name
      && Math.abs(saved.sourceDuration - nextDuration) < 2
      && saved.cuts.length > 0;

    if (sameSource) {
      setProjectId(saved.id);
      createdAtRef.current = saved.createdAt;
      setSettings(saved.settings);
      setCuts(saved.cuts);
      setStatus(`Projeto restaurado: ${saved.cuts.length} cortes salvos para este vídeo.`);
      return;
    }

    const suggested = recommendedCutCount(nextDuration);
    const nextSettings = settings.count === DEFAULT_FOCUSED_SETTINGS.count
      ? { ...settings, count: suggested }
      : settings;
    if (nextSettings.count !== settings.count) setSettings(nextSettings);
    const plan = nextSettings.mode === 'automatic' ? buildAutomaticPlan(nextDuration, nextSettings) : [];
    setCuts(plan);
    setStatus(`${formatTime(nextDuration)} carregado. ${plan.length ? `${plan.length} cortes automáticos já foram planejados.` : 'Use o modo manual para montar a fila.'}`);
  }

  function previewCut(item: PlannedCut) {
    const media = videoRef.current;
    if (!media) return;
    media.currentTime = item.start;
    setPreviewEnd(item.end);
    void media.play().catch(() => setStatus('Toque em Play no vídeo para visualizar o trecho.'));
    setStatus(`Prévia: ${item.title} · ${formatTime(item.start)}–${formatTime(item.end)}.`);
  }

  function handleTimeUpdate() {
    const media = videoRef.current;
    if (!media || previewEnd === null) return;
    if (media.currentTime >= previewEnd - 0.05) {
      media.pause();
      setPreviewEnd(null);
    }
  }

  function markManual(edge: 'start' | 'end') {
    const media = videoRef.current;
    if (!media || !duration) return;
    const value = clamp(media.currentTime, 0, duration);
    if (edge === 'start') {
      setManualStart(value);
      if (manualEnd <= value) setManualEnd(Math.min(duration, value + settings.maxSeconds));
    } else if (value > manualStart) {
      setManualEnd(value);
    }
  }

  function addManual() {
    if (!duration) return setStatus('Importe um vídeo primeiro.');
    const start = clamp(manualStart, 0, duration);
    const end = clamp(manualEnd, start + 0.1, duration);
    if (end - start > 600) return setStatus('Cada corte pode ter no máximo 10 minutos.');
    clearGenerated();
    setCuts((current) => addManualPlannedCut(current, start, end));
    replaceSettings({ mode: 'manual' });
    setStatus(`Corte manual ${formatTime(start)}–${formatTime(end)} adicionado à fila.`);
  }

  function updateCut(id: string, patch: Partial<PlannedCut>) {
    setCuts((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function removeCut(id: string) {
    setCuts((current) => current.filter((item) => item.id !== id));
    setGenerated((current) => {
      const target = current[id];
      if (target) URL.revokeObjectURL(target.url);
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function selectAll(selected: boolean) {
    setCuts((current) => current.map((item) => ({ ...item, selected })));
  }

  function downloadGenerated(item: GeneratedCut) {
    const anchor = document.createElement('a');
    anchor.href = item.url;
    anchor.download = item.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function renderCuts(items: PlannedCut[]) {
    if (!file) return setStatus('Importe o vídeo antes de gerar os cortes.');
    if (!items.length) return setStatus('Selecione pelo menos um corte.');
    if (busy) return;
    setBusy(true);
    setProgress(0);
    let completed = 0;
    let failed = 0;
    let notPersisted = 0;

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      try {
        setStatus(`Gerando ${index + 1}/${items.length}: ${item.title}…`);
        const blob = settings.format === 'vertical'
          ? await exportVerticalMp4(file, item.start, item.end, (ratio) => setProgress((index + ratio) / items.length))
          : await exportCutMp4(file, item.start, item.end, (ratio) => setProgress((index + ratio) / items.length));
        const filename = `${safePrefix(settings.prefix)}-corte-${String(index + 1).padStart(2, '0')}-${Math.round(item.start)}s.mp4`;
        const url = URL.createObjectURL(blob);
        const previous = generatedRef.current[item.id];
        if (previous) URL.revokeObjectURL(previous.url);
        const record = {
          id: crypto.randomUUID(),
          filename,
          sourceName: file.name,
          start: item.start,
          end: item.end,
          kind: settings.format,
          size: blob.size,
          createdAt: new Date().toISOString(),
        };
        const saved = await saveFocusedOutput(record, blob, settings.saveGenerated);
        if (settings.saveGenerated && !saved.blobSaved) notPersisted += 1;
        const generatedItem: GeneratedCut = { url, filename, size: blob.size, saved: saved.blobSaved, start: item.start, end: item.end, kind: settings.format };
        setGenerated((current) => ({ ...current, [item.id]: generatedItem }));
        completed += 1;
      } catch (error) {
        failed += 1;
        console.error('TikCut render failed', item, error);
      }
      setProgress((index + 1) / items.length);
    }

    await refreshHistory();
    setBusy(false);
    setProgress(0);
    const storageNote = notPersisted ? ` ${notPersisted} arquivo(s) ficaram só nesta sessão por limite de armazenamento; baixe-os antes de fechar.` : '';
    setStatus(`${completed} corte(s) prontos${failed ? `, ${failed} falharam` : ''}.${storageNote}`);
  }

  async function downloadHistoryItem(item: FocusedOutputRecord) {
    if (!item.blob) return setStatus('Este corte tem histórico salvo, mas o MP4 não coube no armazenamento do navegador. Gere novamente a partir do projeto.');
    triggerBlobDownload(item.blob, item.filename);
    setStatus(`${item.filename} enviado para download.`);
  }

  async function removeHistoryItem(id: string) {
    await deleteFocusedOutput(id);
    await refreshHistory();
  }

  async function wipeHistory() {
    if (!window.confirm('Apagar todo o histórico local de cortes?')) return;
    await clearFocusedOutputs();
    await refreshHistory();
    setStatus('Histórico local apagado.');
  }

  function resetProject() {
    if (!window.confirm('Limpar a fila e o projeto salvo? Os MP4 do histórico não serão apagados.')) return;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    clearGenerated();
    clearFocusedProject();
    setFile(null);
    setSourceUrl('');
    setDuration(0);
    setCuts([]);
    setManualStart(0);
    setManualEnd(60);
    setProjectId(crypto.randomUUID());
    createdAtRef.current = new Date().toISOString();
    initialProject.current = null;
    setStatus('Projeto limpo. Importe outro vídeo.');
  }

  const savedProject = !file ? loadFocusedProject() : null;
  const storageText = storage.quota
    ? `${formatBytes(storage.used)} usados de aproximadamente ${formatBytes(storage.quota)}`
    : 'Armazenamento do navegador';

  return (
    <main className="focus-app">
      <header className="focus-header">
        <div>
          <div className="focus-kicker">TIKCUT · MOBILE AUTO CUT</div>
          <h1>TikCut <span>Auto Cut</span></h1>
          <p>Vídeo longo → vários cortes → revisar → baixar. Sem módulos que você não usa.</p>
        </div>
        <div className="focus-save-badge">● SALVAMENTO AUTOMÁTICO</div>
      </header>

      <nav className="focus-tabs" aria-label="TikCut">
        <button className={view === 'cut' ? 'active' : ''} onClick={() => setView('cut')}>Cortar</button>
        <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>Histórico <span>{history.length}</span></button>
      </nav>

      {view === 'cut' && (
        <div className="focus-layout">
          {savedProject && (
            <section className="focus-card focus-resume">
              <div>
                <strong>Projeto salvo encontrado</strong>
                <p>{savedProject.sourceName} · {formatTime(savedProject.sourceDuration)} · {savedProject.cuts.length} cortes.</p>
              </div>
              <span>Reimporte o mesmo vídeo e a fila será restaurada automaticamente.</span>
            </section>
          )}

          <section className="focus-card">
            <div className="focus-section-title"><span>1</span><div><h2>Escolher vídeo</h2><p>O arquivo fica no seu aparelho; fontes com mais de 2 horas são aceitas.</p></div></div>
            <label className="focus-file-button">
              <input type="file" accept="video/*" onChange={(event) => handleFile(event.target.files?.[0] ?? null)} />
              {file ? 'Trocar vídeo' : 'Importar vídeo'}
            </label>
            {file && <div className="focus-source-meta"><strong>{file.name}</strong><span>{formatBytes(file.size)} {duration ? `· ${formatTime(duration)}` : ''} {longSource ? '· 2H+ OK' : ''}</span></div>}
            {sourceUrl && <video ref={videoRef} src={sourceUrl} controls playsInline preload="metadata" onLoadedMetadata={onLoadedMetadata} onTimeUpdate={handleTimeUpdate} />}
          </section>

          <section className="focus-card">
            <div className="focus-section-title"><span>2</span><div><h2>Como cortar</h2><p>Automático escolhe diferentes minutos. Manual deixa você escolher.</p></div></div>
            <div className="focus-mode-switch">
              <button className={settings.mode === 'automatic' ? 'active' : ''} onClick={() => replaceSettings({ mode: 'automatic' })}>Automático</button>
              <button className={settings.mode === 'manual' ? 'active' : ''} onClick={() => replaceSettings({ mode: 'manual' })}>Manual</button>
            </div>

            {settings.mode === 'automatic' ? (
              <div className="focus-controls-grid">
                <label>Quantidade de cortes<input aria-label="Quantidade de cortes" type="number" min="1" max="30" value={settings.count} onChange={(event) => replaceSettings({ count: clamp(Number(event.target.value) || 1, 1, 30) })} /></label>
                <label>Duração mínima<select aria-label="Duração mínima" value={settings.minSeconds} onChange={(event) => replaceSettings({ minSeconds: Number(event.target.value) })}>{DURATION_OPTIONS.map((value) => <option key={value} value={value}>{formatDuration(value)}</option>)}</select></label>
                <label>Duração máxima<select aria-label="Duração máxima" value={settings.maxSeconds} onChange={(event) => replaceSettings({ maxSeconds: Number(event.target.value) })}>{DURATION_OPTIONS.filter((value) => value >= settings.minSeconds).map((value) => <option key={value} value={value}>{formatDuration(value)}</option>)}</select></label>
                <button className="focus-primary" disabled={!duration || busy} onClick={regenerate}>Gerar nova seleção automática</button>
              </div>
            ) : (
              <div className="focus-manual">
                <div className="focus-controls-grid">
                  <label>IN (segundos)<input aria-label="IN segundos" type="number" min="0" max={duration || undefined} step="0.1" value={manualStart} onChange={(event) => setManualStart(Number(event.target.value) || 0)} /></label>
                  <label>OUT (segundos)<input aria-label="OUT segundos" type="number" min="0" max={duration || undefined} step="0.1" value={manualEnd} onChange={(event) => setManualEnd(Number(event.target.value) || 0)} /></label>
                </div>
                <div className="focus-inline-actions"><button disabled={!duration} onClick={() => markManual('start')}>Marcar IN no ponto atual</button><button disabled={!duration} onClick={() => markManual('end')}>Marcar OUT no ponto atual</button><button className="focus-primary" disabled={!duration} onClick={addManual}>Adicionar à fila</button></div>
              </div>
            )}
          </section>

          <section className="focus-card">
            <div className="focus-section-title"><span>3</span><div><h2>Fila de cortes</h2><p>Revise, selecione o que quer e gere em sequência.</p></div></div>
            <div className="focus-queue-toolbar"><strong>{selectedCuts.length} de {cuts.length} selecionados</strong><div><button disabled={!cuts.length} onClick={() => selectAll(true)}>Todos</button><button disabled={!cuts.length} onClick={() => selectAll(false)}>Nenhum</button></div></div>
            {!cuts.length && <div className="focus-empty">A fila aparece aqui depois de importar o vídeo ou adicionar um corte manual.</div>}
            <div className="focus-queue">
              {cuts.map((item, index) => {
                const result = generated[item.id];
                return (
                  <article className="focus-cut" key={item.id}>
                    <div className="focus-cut-main">
                      <label className="focus-check"><input type="checkbox" checked={item.selected} onChange={(event) => updateCut(item.id, { selected: event.target.checked })} /><span>{String(index + 1).padStart(2, '0')}</span></label>
                      <div><strong>{item.title}</strong><p>{formatTime(item.start)} → {formatTime(item.end)} · {formatDuration(Math.round(item.end - item.start))}</p></div>
                    </div>
                    <div className="focus-cut-actions"><button disabled={!file} onClick={() => previewCut(item)}>Prévia</button><button onClick={() => removeCut(item.id)}>Remover</button>{result && <button className="focus-success" onClick={() => downloadGenerated(result)}>Baixar {formatBytes(result.size)}</button>}</div>
                    {result && <div className="focus-result-note">{result.saved ? '✓ MP4 salvo no histórico local' : '⚠ MP4 disponível nesta sessão; baixe antes de fechar'}</div>}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="focus-card focus-export">
            <div className="focus-section-title"><span>4</span><div><h2>Gerar cortes</h2><p>Processamento sequencial para reduzir travamentos no celular.</p></div></div>
            <div className="focus-controls-grid">
              <label>Formato<select aria-label="Formato de saída" value={settings.format} onChange={(event) => replaceSettings({ format: event.target.value as FocusedFormat })}><option value="original">Original · corte rápido</option><option value="vertical">TikTok/Reels/Shorts · 9:16</option></select></label>
              <label>Nome dos arquivos<input aria-label="Prefixo dos arquivos" value={settings.prefix} onChange={(event) => replaceSettings({ prefix: event.target.value })} /></label>
              <label className="focus-toggle"><input type="checkbox" checked={settings.saveGenerated} onChange={(event) => replaceSettings({ saveGenerated: event.target.checked })} /><span>Salvar MP4 gerado no aparelho quando houver espaço</span></label>
            </div>
            <button className="focus-generate" disabled={!file || !selectedCuts.length || busy} onClick={() => void renderCuts(selectedCuts)}>{busy ? `Gerando… ${Math.round(progress * 100)}%` : `GERAR ${selectedCuts.length || ''} CORTE${selectedCuts.length === 1 ? '' : 'S'}`}</button>
            {busy && <div className="focus-progress"><span style={{ width: `${Math.max(2, progress * 100)}%` }} /></div>}
            {generatedCount > 0 && <div className="focus-ready">{generatedCount} corte(s) pronto(s) nesta sessão. Use os botões “Baixar” na fila.</div>}
          </section>

          <section className="focus-card focus-status" aria-live="polite"><strong>Status</strong><p>{status}</p></section>

          <details className="focus-card focus-guide"><summary>Como usar</summary><ol><li>Importe o vídeo, inclusive arquivos com mais de 2 horas.</li><li>No Automático, escolha quantidade e duração e deixe o TikCut distribuir os trechos.</li><li>Na fila, veja a prévia e desmarque o que não quiser.</li><li>Escolha corte rápido ou 9:16 e toque em Gerar.</li><li>Os projetos são salvos automaticamente. MP4s de até 90 MB podem ficar no Histórico se o navegador tiver espaço.</li></ol></details>

          {(file || cuts.length) && <button className="focus-danger-link" onClick={resetProject}>Limpar projeto atual</button>}
        </div>
      )}

      {view === 'history' && (
        <div className="focus-layout">
          <section className="focus-card">
            <div className="focus-section-title"><span>H</span><div><h2>Histórico salvo</h2><p>{storageText}. O navegador decide a cota disponível no aparelho.</p></div></div>
            {!history.length && <div className="focus-empty">Nenhum corte gerado ainda.</div>}
            <div className="focus-history-list">
              {history.map((item) => (
                <article key={item.id} className="focus-history-item">
                  <div><strong>{item.filename}</strong><p>{item.sourceName} · {formatTime(item.start)}–{formatTime(item.end)} · {formatBytes(item.size)}</p><small>{new Date(item.createdAt).toLocaleString('pt-BR')} · {item.blob ? 'MP4 salvo' : 'somente histórico'}</small></div>
                  <div><button disabled={!item.blob} className={item.blob ? 'focus-success' : ''} onClick={() => void downloadHistoryItem(item)}>Baixar</button><button onClick={() => void removeHistoryItem(item.id)}>Excluir</button></div>
                </article>
              ))}
            </div>
            {history.length > 0 && <button className="focus-danger-link" onClick={() => void wipeHistory()}>Apagar todo o histórico</button>}
          </section>
          <section className="focus-card focus-status"><strong>Status</strong><p>{status}</p></section>
        </div>
      )}
    </main>
  );
}
