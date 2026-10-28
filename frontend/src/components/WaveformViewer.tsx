import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Maximize2, ZoomIn, ZoomOut, ListPlus, X, Loader2, Activity, Ruler } from 'lucide-react';
import { WaveData, WaveSignal } from '../types';
import { useI18n } from '../i18n';

const ROW_H = 34;
const RULER_H = 28;
const NAME_W = 280;

type Radix = 'hex' | 'bin' | 'dec' | 'signed';

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

function toSignedNumber(bits: string, width: number): number | null {
  if (/[xz]/i.test(bits) || width <= 0) return null;
  const padded = bits.padStart(width, bits[0] === '1' ? '0' : bits[0] ?? '0');
  try {
    const u = BigInt('0b' + (padded || '0'));
    const signBit = 1n << BigInt(Math.max(0, width - 1));
    const fullRange = 1n << BigInt(width);
    const s = (u & signBit) !== 0n ? u - fullRange : u;
    return Number(s);
  } catch {
    return null;
  }
}

function formatValue(bits: string, width: number, radix: Radix): string {
  if (/[xz]/i.test(bits)) {
    if (radix === 'bin') return bits;
    return /^z+$/i.test(bits) ? 'z' : 'x';
  }
  const padded = bits.padStart(width, bits[0] === '1' ? '0' : bits[0] ?? '0');
  if (radix === 'bin') return padded;
  try {
    const n = BigInt('0b' + (padded || '0'));
    if (radix === 'hex') return n.toString(16).toUpperCase().padStart(Math.ceil(width / 4), '0');
    if (radix === 'signed' && width > 1) {
      const signBit = 1n << BigInt(width - 1);
      const s = (n & signBit) !== 0n ? n - (1n << BigInt(width)) : n;
      return s.toString(10);
    }
    return n.toString(10);
  } catch {
    return bits;
  }
}

export default function WaveformViewer({ wave, tbTop, busy, status, onRun }: Props) {
  const { lang } = useI18n();
  const isTr = lang === 'tr';
  const [selected, setSelected] = useState<string[]>([]);
  const [view, setView] = useState<[number, number]>([0, 100]);
  const [hover, setHover] = useState<number | null>(null);
  const [markerA, setMarkerA] = useState<number | null>(null);
  const [markerB, setMarkerB] = useState<number | null>(null);
  const [radix, setRadix] = useState<Radix>('hex');
  const [analogMode, setAnalogMode] = useState<boolean>(false);
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
    setMarkerA(null);
    setMarkerB(null);
  }, [wave, endT]);

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
    const span = Math.min(Math.max(t1 - t0, 4), maxSpan);
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

  const cursorT = markerA ?? hover;
  const valueAtCursor = (s: WaveSignal): string => {
    const ch = wave?.changes[s.id] ?? [];
    const t = cursorT ?? endT;
    const i = lastAtOrBefore(ch, t);
    return i < 0 ? '—' : formatValue(ch[i][1], s.width, radix);
  };

  const deltaInfo = useMemo(() => {
    if (markerA === null || markerB === null) return null;
    const dtTicks = Math.abs(markerB - markerA);
    const dtStr = formatTime(dtTicks, psTick);
    const dtPs = dtTicks * psTick;
    const freqMhz = dtPs > 0 ? (1e6 / dtPs).toFixed(2) : null;
    return { dtStr, freqMhz };
  }, [markerA, markerB, psTick]);

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
      if (markerA !== null && markerB !== null) {
        const xa = X(markerA), xb = X(markerB);
        g.fillStyle = 'rgba(250, 204, 21, 0.14)';
        g.fillRect(Math.min(xa, xb), 0, Math.abs(xb - xa), RULER_H);
      }
      if (markerA !== null) {
        const x = X(markerA);
        g.fillStyle = '#facc15';
        g.fillRect(x - 1, 0, 2, RULER_H);
        g.fillText('A', x + 3, RULER_H - 3);
      }
      if (markerB !== null) {
        const x = X(markerB);
        g.fillStyle = '#f97316';
        g.fillRect(x - 1, 0, 2, RULER_H);
        g.fillText('B', x + 3, RULER_H - 3);
      }
      if (hover !== null) {
        const x = X(hover);
        g.fillStyle = '#e2e8f0';
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
      const yTop = ri * ROW_H + 5, yBot = ri * ROW_H + ROW_H - 5, yMid = (yTop + yBot) / 2;
      g.strokeStyle = '#0f1b33';
      g.beginPath(); g.moveTo(0, (ri + 1) * ROW_H - 0.5); g.lineTo(width, (ri + 1) * ROW_H - 0.5); g.stroke();
      if (!ch.length) return;

      const isBit = s.width === 1;
      let k = Math.max(lastAtOrBefore(ch, t0), 0);

      // Analog rendering for multi-bit signals when analogMode is enabled
      if (!isBit && analogMode) {
        const nums = ch.map(([, v]) => toSignedNumber(v, s.width)).filter((v): v is number => v !== null);
        const minV = nums.length ? Math.min(...nums, 0) : -1;
        const maxV = nums.length ? Math.max(...nums, 1) : 1;
        const vSpan = Math.max(1, maxV - minV);
        const toAY = (v: number) => yBot - ((v - minV) / vSpan) * (yBot - yTop);

        g.strokeStyle = '#10b981';
        g.lineWidth = 1.6;
        g.beginPath();
        let started = false;
        let lastY = yMid;
        for (let idx = k; idx < ch.length; idx++) {
          const [ts, val] = ch[idx];
          if (ts > t1) break;
          const te = idx + 1 < ch.length ? ch[idx + 1][0] : Math.max(endT, t1);
          const x1 = Math.max(X(ts), 0), x2 = Math.min(X(te), width);
          const num = toSignedNumber(val, s.width);
          const py = num !== null ? toAY(num) : yMid;
          if (!started) {
            g.moveTo(x1, py);
            started = true;
          } else {
            g.lineTo(x1, lastY);
            g.lineTo(x1, py);
          }
          g.lineTo(x2, py);
          lastY = py;
        }
        g.stroke();
        return;
      }

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
          const allX = /^x+$/i.test(val), hasBad = /[xz]/i.test(val);
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
      g.strokeStyle = color; g.lineWidth = 1.2; g.setLineDash(dashed ? [4, 3] : []);
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, rowsHeight); g.stroke(); g.setLineDash([]);
    };
    drawCursor(hover, '#94a3b8', true);
    drawCursor(markerA, '#facc15', false);
    drawCursor(markerB, '#f97316', false);
  }, [wave, rows, view, width, radix, analogMode, hover, markerA, markerB, psTick, endT, rowsHeight]);

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
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {isTr ? 'Simülasyonu Çalıştır' : 'Run Simulation'}
        </button>
        <span className="text-xs text-gray-400">{tbTop ? `tb: ${tbTop}` : (isTr ? 'Testbench seçilmedi' : 'No testbench selected')}</span>

        {deltaInfo && (
          <div className="px-2.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-mono flex items-center gap-1.5">
            <Ruler className="w-3.5 h-3.5" />
            <span>Δt (A↔B) = {deltaInfo.dtStr}</span>
            {deltaInfo.freqMhz && <span className="text-amber-400/80">({deltaInfo.freqMhz} MHz)</span>}
            <button
              type="button"
              onClick={() => { setMarkerA(null); setMarkerB(null); }}
              className="ml-1 hover:text-white"
              title={isTr ? 'İmleçleri temizle' : 'Clear markers'}
            >
              ✕
            </button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAnalogMode((v) => !v)}
            disabled={!wave}
            className={`px-2 py-1 rounded border text-xs flex items-center gap-1 transition ${
              analogMode
                ? 'bg-emerald-600/25 border-emerald-400 text-emerald-200'
                : 'bg-surface hover:bg-slate-700 border-slate-700 text-slate-300'
            }`}
            title={isTr ? 'Çok-bitli veri hatlarını Analog (EKG/EEG Rampa) eğrisi olarak çiz' : 'Render multi-bit buses as Analog step waves'}
          >
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            {isTr ? 'Analog Mod' : 'Analog'}
          </button>
          <button className={btn} onClick={() => setView([0, endT * 1.02])} disabled={!wave} title="Fit"><Maximize2 className="w-3.5 h-3.5" />Fit</button>
          <button className={btn} onClick={() => zoom(0.5)} disabled={!wave} title="Zoom In"><ZoomIn className="w-3.5 h-3.5" /></button>
          <button className={btn} onClick={() => zoom(2)} disabled={!wave} title="Zoom Out"><ZoomOut className="w-3.5 h-3.5" /></button>
          <select value={radix} onChange={(e) => setRadix(e.target.value as Radix)}
            className="px-2 py-1 rounded bg-surface border border-slate-700 text-xs font-mono">
            <option value="hex">HEX</option>
            <option value="signed">SIGNED</option>
            <option value="dec">UINT</option>
            <option value="bin">BIN</option>
          </select>
          <button className={btn} onClick={() => setPicker(!picker)} disabled={!wave}>
            <ListPlus className="w-3.5 h-3.5" />{isTr ? 'Sinyaller' : 'Signals'}
          </button>
        </div>

        {picker && wave && (
          <div className="absolute right-3 top-full z-20 w-96 max-h-96 flex flex-col rounded border border-slate-600 bg-dark shadow-xl">
            <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={isTr ? 'Sinyal ara…' : 'Search signal…'}
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
          <p>{isTr ? 'Henüz waveform yok.' : 'No waveform loaded yet.'}</p>
          <p className="text-xs">{status || (isTr ? 'Simülasyonu çalıştırın; testbench\'te $dumpfile yazmanız gerekmez.' : 'Click Run Simulation; $dumpfile is injected automatically.')}</p>
        </div>
      ) : (
        <>
          <div className="flex border-b border-slate-700 flex-shrink-0">
            <div style={{ width: NAME_W }} className="px-3 flex items-center gap-2 text-[11px] font-mono text-gray-400 bg-dark flex-shrink-0">
              <span>A: {markerA !== null ? formatTime(markerA, psTick) : (cursorT !== null ? formatTime(cursorT, psTick) : '—')}</span>
              {markerB !== null && <span className="text-orange-400">B: {formatTime(markerB, psTick)}</span>}
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
              {rows.length === 0 && <div className="p-3 text-xs text-gray-500">{isTr ? '"Sinyaller" ile ekleyin' : 'Add via "Signals"'}</div>}
            </div>
            <div ref={wrapRef} className="flex-1 min-w-0 overflow-hidden">
              <canvas
                ref={waveCv}
                className="cursor-crosshair block"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMarkerB(timeAt(e.clientX));
                }}
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
                onMouseDown={(e) => {
                  if (e.button === 0) {
                    drag.current = { x: e.clientX, t0: view[0], t1: view[1], moved: false };
                  }
                }}
                onMouseUp={(e) => {
                  if (drag.current && !drag.current.moved) {
                    const t = timeAt(e.clientX);
                    if (e.shiftKey) {
                      setMarkerB(t);
                    } else {
                      setMarkerA((p) => (p === null ? t : t));
                    }
                  }
                  drag.current = null;
                }}
                onMouseLeave={() => { drag.current = null; setHover(null); }}
                onDoubleClick={() => setView([0, endT * 1.02])}
              />
            </div>
          </div>
          <div className="px-3 py-1 text-[11px] text-gray-500 border-t border-slate-700 bg-dark">
            {wave.timescale && `timescale ${wave.timescale} · `}
            {isTr ? 'süre' : 'duration'} {formatTime(wave.end_time, psTick)} · {wave.signals.length} {isTr ? 'sinyal' : 'signals'}
            {wave.truncated && <span className="text-yellow-400"> · {isTr ? 'Bazı sinyaller kısaltıldı' : 'Truncated'}</span>}
            {' · '}
            {isTr
              ? 'Sol Tık: İmleç A · Shift+Tık / Sağ Tık: İmleç B (Δt ölçümü) · Analog Mod: EKG/EEG eğrisi'
              : 'Left Click: Marker A · Shift+Click / Right Click: Marker B (Δt) · Analog Mode: step wave'}
          </div>
        </>
      )}
    </div>
  );
}
