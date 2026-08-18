import { useMemo, useRef, useState } from 'react';
import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from 'react';
import type { StudioTimeline, TimelineItem, TimelineTrackKind } from '../lib/studioTypes';
import { removeTimelineItem, upsertTimelineItem } from '../lib/autopilot';

type Props = {
  timeline: StudioTimeline;
  setTimeline: Dispatch<SetStateAction<StudioTimeline>>;
  onSeek?: (seconds: number) => void;
};

const TRACK_ICONS: Record<TimelineTrackKind, string> = {
  video: '🎬',
  broll: '🖼️',
  text: 'T',
  audio: '♫',
  zoom: '⌖',
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default function ProfessionalTimeline({ timeline, setTimeline, onSeek }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; startX: number; originalStart: number; originalEnd: number } | null>(null);
  const width = Math.max(900, timeline.duration * timeline.zoomPxPerSecond);
  const selected = useMemo(() => timeline.tracks.flatMap((track) => track.items).find((item) => item.id === selectedId) ?? null, [timeline, selectedId]);

  function patchItem(itemId: string, patch: Partial<TimelineItem>) {
    setTimeline((current) => ({
      ...current,
      tracks: current.tracks.map((track) => ({
        ...track,
        items: track.items.map((item) => item.id === itemId ? { ...item, ...patch } : item),
      })),
    }));
  }

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>, item: TimelineItem, locked: boolean) {
    setSelectedId(item.id);
    if (locked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id: item.id, startX: event.clientX, originalStart: item.start, originalEnd: item.end });
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!drag) return;
    const delta = (event.clientX - drag.startX) / timeline.zoomPxPerSecond;
    const length = drag.originalEnd - drag.originalStart;
    const nextStart = clamp(drag.originalStart + delta, 0, Math.max(0, timeline.duration - length));
    patchItem(drag.id, { start: nextStart, end: nextStart + length });
  }

  function endDrag() {
    setDrag(null);
  }

  function addText() {
    const start = clamp(timeline.playhead, 0, Math.max(0, timeline.duration - 2));
    const item: TimelineItem = {
      id: crypto.randomUUID(), track: 'text', label: 'Novo texto', text: 'Novo texto', start, end: Math.min(timeline.duration, start + 3),
    };
    setTimeline((current) => upsertTimelineItem(current, item));
    setSelectedId(item.id);
  }

  function seekFromRuler(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const local = event.clientX - rect.left;
    const seconds = clamp(local / timeline.zoomPxPerSecond, 0, timeline.duration);
    setTimeline((current) => ({ ...current, playhead: seconds }));
    onSeek?.(seconds);
  }

  function resizeSelected(edge: 'start' | 'end', delta: number) {
    if (!selected) return;
    if (edge === 'start') patchItem(selected.id, { start: clamp(selected.start + delta, 0, selected.end - 0.1) });
    else patchItem(selected.id, { end: clamp(selected.end + delta, selected.start + 0.1, timeline.duration) });
  }

  return (
    <section className="pro-timeline card" aria-label="Timeline profissional multicamada">
      <div className="pro-timeline-head">
        <div>
          <div className="eyebrow">TIMELINE PRO</div>
          <h2>Timeline multicamada</h2>
        </div>
        <div className="timeline-head-actions">
          <button onClick={addText}>+ Texto</button>
          <label>Zoom
            <input aria-label="Zoom da timeline" type="range" min="8" max="60" step="1" value={timeline.zoomPxPerSecond} onChange={(event) => setTimeline((current) => ({ ...current, zoomPxPerSecond: Number(event.target.value) }))} />
          </label>
        </div>
      </div>

      <div className="timeline-selection-bar">
        <span>Playhead <b>{timeline.playhead.toFixed(2)}s</b></span>
        {selected ? (
          <>
            <span>Selecionado: <b>{selected.label}</b></span>
            <button onClick={() => resizeSelected('start', -0.25)}>IN -0,25</button>
            <button onClick={() => resizeSelected('start', 0.25)}>IN +0,25</button>
            <button onClick={() => resizeSelected('end', -0.25)}>OUT -0,25</button>
            <button onClick={() => resizeSelected('end', 0.25)}>OUT +0,25</button>
            {!['video', 'audio'].includes(selected.track) && <button className="danger-mini" onClick={() => { setTimeline((current) => removeTimelineItem(current, selected.id)); setSelectedId(null); }}>Excluir</button>}
          </>
        ) : <span>Clique em um bloco para editar · arraste blocos desbloqueados para mover.</span>}
      </div>

      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-ruler-row">
          <div className="timeline-track-label">TEMPO</div>
          <div className="timeline-ruler" style={{ width }} onPointerDown={seekFromRuler}>
            {Array.from({ length: Math.ceil(timeline.duration / 5) + 1 }, (_, index) => index * 5).map((second) => (
              <span key={second} style={{ left: second * timeline.zoomPxPerSecond }}>{second}s</span>
            ))}
            <i className="timeline-playhead" style={{ left: timeline.playhead * timeline.zoomPxPerSecond }} />
          </div>
        </div>

        {timeline.tracks.map((track) => (
          <div className="timeline-track-row" key={track.id}>
            <div className="timeline-track-label"><span>{TRACK_ICONS[track.id]}</span><b>{track.label}</b><small>{track.locked ? '🔒' : ''}</small></div>
            <div className={`timeline-lane lane-${track.id}`} style={{ width }} onDoubleClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const seconds = clamp((event.clientX - rect.left) / timeline.zoomPxPerSecond, 0, timeline.duration);
              setTimeline((current) => ({ ...current, playhead: seconds }));
              onSeek?.(seconds);
            }}>
              <i className="timeline-playhead lane-playhead" style={{ left: timeline.playhead * timeline.zoomPxPerSecond }} />
              {track.items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`timeline-item item-${track.id} ${selectedId === item.id ? 'selected' : ''}`}
                  title={`${item.label} · ${item.start.toFixed(2)}–${item.end.toFixed(2)}s`}
                  style={{ left: item.start * timeline.zoomPxPerSecond, width: Math.max(14, (item.end - item.start) * timeline.zoomPxPerSecond) }}
                  onPointerDown={(event) => beginDrag(event, item, track.locked)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
