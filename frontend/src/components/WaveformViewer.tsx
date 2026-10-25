import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Maximize2, ZoomIn, ZoomOut, ListPlus, X, Loader2 } from 'lucide-react';
import { WaveData, WaveSignal } from '../types';

const ROW_H = 30;
const RULER_H = 28;
const NAME_W = 280;

type Radix = 'hex' | 'bin' | 'dec';

interface Props {
  wave: WaveData | null;
  tbTop: string;
  busy: boolean;
  status: string;
  onRun: () => void;
}

const UNIT_PS: Record<string, number> = { fs: 0.001, ps: 1, ns: 1000, us: 1e6, ms: 1e9, s: 1e12 };

function psPerTick(timescale: string): number {
  const m = /(\d+)\s*(fs|ps|ns|us|ms|s)/.exec(timescale);
  return m ? Number(m[1]) * UNIT_PS[m[2]] : 1;
}

function formatTime(t: number, psTick: number): string {
  const ps = t * psTick;
  const a = Math.abs(ps);
  const trim = (v: number) => String(+v.toFixed(3));
  if (a === 0) return '0';
  if (a < 1e3) return `${trim(ps)} ps`;
  if (a < 1e6) return `${trim(ps / 1e3)} ns`;
  if (a < 1e9) return `${trim(ps / 1e6)} us`;
  return `${trim(ps / 1e9)} ms`;
}

/** index of last change with time <= t, or -1 */
function lastAtOrBefore(ch: [number, string][], t: number): number {
  let lo = 0, hi = ch.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ch[mid][0] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function formatValue(bits: string, width: number, radix: Radix): string {
  if (/[xz]/.test(bits)) {
    if (radix === 'bin') return bits;
    return /^z+$/.test(bits) ? 'z' : 'x';
  }
  // VCD rule: left-extend with 0 when the MSB is 1, otherwise with the MSB itself
  const padded = bits.padStart(width, bits[0] === '1' ? '0' : bits[0] ?? '0');
  if (radix === 'bin') return padded;
  try {
    const n = BigInt('0b' + (padded || '0'));
    return radix === 'hex' ? n.toString(16).toUpperCase().padStart(Math.ceil(width / 4), '0') : n.toString(10);
  } catch {
    return bits;
  }
}

export default function WaveformViewer({ wave, tbTop, busy, status, onRun }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [view, setView] = useState<[number, number]>([0, 100]);
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [radix, setRadix] = useState<Radix>('hex');
  const [picker, setPicker] = useState(false);
  const [filter, setFilter] = useState('');
  const [width, setWidth] = useState(600);

  const wrapRef = useRef<HTMLDivElement>(null);
  const waveCv = useRef<HTMLCanvasElement>(null);
  const rulerCv = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; t0: number; t1: number; moved: boolean } | null>(null);

  const byName = useMemo(() => {
    const m = new Map<string, WaveSignal>();
    wave?.signals.forEach((s) => m.set(s.name, s));
    return m;
  }, [wave]);

  const psTick = useMemo(() => psPerTick(wave?.timescale ?? ''), [wave]);
  const endT = Math.max(wave?.end_time ?? 1, 1);

  // Default selection + fit when new data arrives
  useEffect(() => {
    if (!wave) { setSelected([]); return; }
    const depth = (s: WaveSignal) => s.scope.split('.').length;
    const min = Math.min(...wave.signals.map(depth));
    const seen = new Set<string>();
    const picks = wave.signals
      .filter((s) => depth(s) <= min + 1 && wave.changes[s.id])
      .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
      .slice(0, 32)
      .map((s) => s.name);
    setSelected(picks);
    setView([0, endT * 1.02]);
    setPinned(null);
  }, [wave, endT]);

  // Track canvas container width
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(200, el.clientWidth));
    return () => ro.disconnect();
  }, [wave]);

  const rows = selected.map((n) => byName.get(n)).filter(Boolean) as WaveSignal[];
  const rowsHeight = Math.max(rows.length, 1) * ROW_H;

  const clampView = useCallback((t0: number, t1: number): [number, number] => {
    const maxSpan = endT * 1.02;
    let span = Math.min(Math.max(t1 - t0, 4), maxSpan);
    let a = t0;
    if (a < 0) a = 0;
    if (a + span > maxSpan) a = maxSpan - span;
    return [Math.max(a, 0), Math.max(a, 0) + span];
  }, [endT]);

  const zoom = useCallback((factor: number, anchor?: number) => {
    setView(([t0, t1]) => {
      const a = anchor ?? (t0 + t1) / 2;
      const f = (a - t0) / (t1 - t0);
      const span = (t1 - t0) * factor;
      return clampView(a - span * f, a - span * f + span);
    });
  }, [clampView]);

  // Wheel zoom/pan (non-passive so we can prevent page scroll)
  useEffect(() => {
    const cv = waveCv.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      setView(([t0, t1]) => {
        const tm = t0 + ((e.clientX - rect.left) / rect.width) * (t1 - t0);
        if (e.shiftKey) {
          const dt = ((e.deltaY || e.deltaX) / rect.width) * (t1 - t0);
          return clampView(t0 + dt, t1 + dt);
        }
        const factor = e.deltaY < 0 ? 0.8 : 1.25;
        const span = (t1 - t0) * factor;
        const f = (tm - t0) / (t1 - t0);
        return clampView(tm - span * f, tm - span * f + span);
      });
    };
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => cv.removeEventListener('wheel', onWheel);
  }, [clampView, wave, rows.length]);

  const timeAt = (clientX: number): number => {
    const cv = waveCv.current!;
    const rect = cv.getBoundingClientRect();
    return view[0] + ((clientX - rect.left) / rect.width) * (view[1] - view[0]);
  };

  const cursorT = pinned ?? hover;
  const valueAtCursor = (s: WaveSignal): string => {
    const ch = wave?.changes[s.id] ?? [];
    const t = cursorT ?? endT;
    const i = lastAtOrBefore(ch, t);
    return i < 0 ? '—' : formatValue(ch[i][1], s.width, radix);
  };

  // ---- drawing ----
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const [t0, t1] = view;
    const span = t1 - t0;
    const X = (t: number) => ((t - t0) / span) * width;

    // Ruler
    const rc = rulerCv.current;
    if (rc) {
      rc.width = width * dpr; rc.height = RULER_H * dpr;
      rc.style.width = `${width}px`; rc.style.height = `${RULER_H}px`;
      const g = rc.getContext('2d')!;
      g.scale(dpr, dpr);
      g.fillStyle = '#0f172a'; g.fillRect(0, 0, width, RULER_H);
      g.fillStyle = '#94a3b8'; g.strokeStyle = '#334155'; g.font = '10px ui-monospace, monospace';
      const raw = span / Math.max(width / 110, 1);
      const pow = Math.pow(10, Math.floor(Math.log10(raw)));
      const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
      for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
        const x = X(t);
        g.beginPath(); g.moveTo(x, RULER_H - 8); g.lineTo(x, RULER_H); g.stroke();
        g.fillText(formatTime(t, psTick), x + 3, 12);
      }
      if (cursorT !== null) {
        const x = X(cursorT);
        g.fillStyle = pinned !== null ? '#facc15' : '#e2e8f0';
        g.fillRect(x - 0.5, 0, 1, RULER_H);
      }
    }

    // Waves
    const cv = waveCv.current;
    if (!cv || !wave) return;
    cv.width = width * dpr; cv.height = rowsHeight * dpr;
    cv.style.width = `${width}px`; cv.style.height = `${rowsHeight}px`;
    const g = cv.getContext('2d')!;
    g.scale(dpr, dpr);
    g.fillStyle = '#020617'; g.fillRect(0, 0, width, rowsHeight);

    // grid
    const raw = span / Math.max(width / 110, 1);
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
    g.strokeStyle = '#0f1b33'; g.lineWidth = 1;
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
      g.beginPath(); g.moveTo(Math.round(X(t)) + 0.5, 0); g.lineTo(Math.round(X(t)) + 0.5, rowsHeight); g.stroke();
    }

    g.font = '11px ui-monospace, monospace';
    g.textBaseline = 'middle';
    rows.forEach((s, ri) => {
      const ch = wave.changes[s.id] ?? [];
      const yTop = ri * ROW_H + 6, yBot = ri * ROW_H + ROW_H - 6, yMid = (yTop + yBot) / 2;
      g.strokeStyle = '#0f1b33';
      g.beginPath(); g.moveTo(0, (ri + 1) * ROW_H - 0.5); g.lineTo(width, (ri + 1) * ROW_H - 0.5); g.stroke();
      if (!ch.length) return;

      const isBit = s.width === 1;
      let k = Math.max(lastAtOrBefore(ch, t0), 0);
      let prevY: number | null = null;
      for (; k < ch.length; k++) {
        const [ts, val] = ch[k];
        if (ts > t1) break;
        const te = k + 1 < ch.length ? ch[k + 1][0] : Math.max(endT, t1);
        const x1 = Math.max(X(ts), 0), x2 = Math.min(X(te), width);
        if (x2 < 0) continue;

        if (isBit) {
          const bad = val === 'x' || val === 'z';
          const y = val === '1' ? yTop : val === '0' ? yBot : yMid;
          g.strokeStyle = bad ? '#ef4444' : '#22c55e'; g.lineWidth = 1.6;
          g.beginPath();
          if (prevY !== null && prevY !== y) { g.moveTo(x1, prevY); g.lineTo(x1, y); }
          g.moveTo(x1, y); g.lineTo(x2, y);
          g.stroke();
          if (bad) { g.fillStyle = 'rgba(239,68,68,0.15)'; g.fillRect(x1, yTop, x2 - x1, yBot - yTop); }
          prevY = y;
        } else {
          const allX = /^x+$/.test(val), hasBad = /[xz]/.test(val);
          const col = allX ? '#ef4444' : hasBad ? '#f59e0b' : '#3b82f6';
          g.strokeStyle = col; g.fillStyle = allX ? 'rgba(239,68,68,0.12)' : 'rgba(59,130,246,0.12)'; g.lineWidth = 1.2;
          const w = x2 - x1;
          if (w < 2) { g.beginPath(); g.moveTo(x1, yTop); g.lineTo(x1, yBot); g.stroke(); continue; }
          const c = Math.min(4, w / 2);
          g.beginPath();
          g.moveTo(x1 + c, yTop); g.lineTo(x2 - c, yTop); g.lineTo(x2, yMid); g.lineTo(x2 - c, yBot);
          g.lineTo(x1 + c, yBot); g.lineTo(x1, yMid); g.closePath();
          g.fill(); g.stroke();
          if (w > 26) {
            const txt = formatValue(val, s.width, radix);
            const maxChars = Math.floor((w - 2 * c - 4) / 6.6);
            g.fillStyle = '#e2e8f0';
            g.fillText(txt.length > maxChars ? txt.slice(0, Math.max(maxChars - 1, 1)) + '…' : txt, x1 + c + 3, yMid + 0.5);
          }
        }
      }
    });

    const drawCursor = (t: number | null, color: string, dashed: boolean) => {
      if (t === null) return;
      const x = Math.round(X(t)) + 0.5;
      g.strokeStyle = color; g.lineWidth = 1; g.setLineDash(dashed ? [4, 3] : []);
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, rowsHeight); g.stroke(); g.setLineDash([]);
    };
    drawCursor(hover, '#94a3b8', true);
    drawCursor(pinned, '#facc15', false);
  }, [wave, rows, view, width, radix, hover, pinned, cursorT, psTick, endT, rowsHeight]);

  const toggleSignal = (name: string) =>
    setSelected((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]));

  const pickerList = useMemo(() => {
    if (!wave) return [];
    const f = filter.toLowerCase();
    return wave.signals.filter((s) => !f || s.name.toLowerCase().includes(f)).slice(0, 400);
  }, [wave, filter]);

  const btn = 'px-2 py-1 rounded bg-surface hover:bg-slate-700 border border-slate-700 text-xs flex items-center gap-1 disabled:opacity-40';

  return (
    <div className="h-full flex flex-col bg-darker">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-slate-700 bg-dark relative">
        <button className="px-3 py-1 rounded bg-green-600 hover:bg-green-500 text-white text-sm flex items-center gap-1 disabled:opacity-40"
          disabled={busy || !tbTop} onClick={onRun}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Simülasyonu Çalıştır
        </button>
        <span className="text-xs text-gray-400">{tbTop ? `tb: ${tbTop}` : 'Testbench seçilmedi'}</span>
        <div className="ml-auto flex items-center gap-2">
          <button className={btn} onClick={() => setView([0, endT * 1.02])} disabled={!wave} title="Sığdır"><Maximize2 className="w-3.5 h-3.5" />Fit</button>
          <button className={btn} onClick={() => zoom(0.5)} disabled={!wave} title="Yakınlaştır"><ZoomIn className="w-3.5 h-3.5" /></button>
          <button className={btn} onClick={() => zoom(2)} disabled={!wave} title="Uzaklaştır"><ZoomOut className="w-3.5 h-3.5" /></button>
          <select value={radix} onChange={(e) => setRadix(e.target.value as Radix)}
            className="px-2 py-1 rounded bg-surface border border-slate-700 text-xs">
            <option value="hex">HEX</option><option value="bin">BIN</option><option value="dec">DEC</option>
          </select>
          <button className={btn} onClick={() => setPicker(!picker)} disabled={!wave}><ListPlus className="w-3.5 h-3.5" />Sinyaller</button>
        </div>

        {picker && wave && (
          <div className="absolute right-3 top-full z-20 w-96 max-h-96 flex flex-col rounded border border-slate-600 bg-dark shadow-xl">
            <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Sinyal ara…"
              className="m-2 px-2 py-1 rounded bg-darker border border-slate-700 text-sm" />
            <div className="overflow-y-auto text-xs font-mono">
              {pickerList.map((s) => (
                <label key={s.name} className="flex items-center gap-2 px-3 py-1 hover:bg-slate-800 cursor-pointer">
                  <input type="checkbox" checked={selected.includes(s.name)} onChange={() => toggleSignal(s.name)} />
                  <span className="truncate">{s.name}</span>
                  <span className="ml-auto text-slate-500">{s.width > 1 ? `[${s.width - 1}:0]` : ''}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {!wave ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-2">
          <p>Henüz waveform yok.</p>
          <p className="text-xs">{status || 'Simülasyonu çalıştırın; testbench\'te $dumpfile yazmanız gerekmez.'}</p>
        </div>
      ) : (
        <>
          <div className="flex border-b border-slate-700 flex-shrink-0">
            <div style={{ width: NAME_W }} className="px-3 flex items-center text-[11px] uppercase text-gray-500 bg-dark flex-shrink-0"
              >
              İmleç: {cursorT !== null ? formatTime(cursorT, psTick) : '—'} {pinned !== null && '📌'}
            </div>
            <div className="flex-1 overflow-hidden"><canvas ref={rulerCv} /></div>
          </div>
          <div className="flex-1 overflow-y-auto flex min-h-0">
            <div style={{ width: NAME_W }} className="flex-shrink-0 bg-dark border-r border-slate-700">
              {rows.map((s) => (
                <div key={s.name} style={{ height: ROW_H }}
                  className="group flex items-center gap-2 px-3 border-b border-slate-800 text-xs font-mono">
                  <span className="truncate" title={s.name}>{s.short}</span>
                  <span className="ml-auto text-primary truncate max-w-[110px]">{valueAtCursor(s)}</span>
                  <button className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400" onClick={() => toggleSignal(s.name)}>
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {rows.length === 0 && <div className="p-3 text-xs text-gray-500">"Sinyaller" ile ekleyin</div>}
            </div>
            <div ref={wrapRef} className="flex-1 min-w-0 overflow-hidden">
              <canvas
                ref={waveCv}
                className="cursor-crosshair block"
                onMouseMove={(e) => {
                  const d = drag.current;
                  if (d) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const dt = ((e.clientX - d.x) / rect.width) * (d.t1 - d.t0);
                    if (Math.abs(e.clientX - d.x) > 3) d.moved = true;
                    setView(clampView(d.t0 - dt, d.t1 - dt));
                  } else {
                    setHover(timeAt(e.clientX));
                  }
                }}
                onMouseDown={(e) => { drag.current = { x: e.clientX, t0: view[0], t1: view[1], moved: false }; }}
                onMouseUp={(e) => {
                  if (drag.current && !drag.current.moved) setPinned((p) => (p === null ? timeAt(e.clientX) : null));
                  drag.current = null;
                }}
                onMouseLeave={() => { drag.current = null; setHover(null); }}
                onDoubleClick={() => setView([0, endT * 1.02])}
              />
            </div>
          </div>
          <div className="px-3 py-1 text-[11px] text-gray-500 border-t border-slate-700 bg-dark">
            {wave.timescale && `timescale ${wave.timescale} · `}süre {formatTime(wave.end_time, psTick)} · {wave.signals.length} sinyal
            {wave.truncated && <span className="text-yellow-400"> · Bazı sinyaller kısaltıldı</span>}
            {' · '}tekerlek: zoom · Shift+tekerlek/sürükle: kaydır · tık: imleci sabitle · çift tık: sığdır
          </div>
        </>
      )}
    </div>
  );
}
