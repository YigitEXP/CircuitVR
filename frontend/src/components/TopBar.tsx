import { ReactNode, useEffect, useRef } from 'react';
import { CircuitBoard, FolderOpen, Play, ShieldCheck, Workflow, RefreshCw, FilePlus2, FolderUp, Wrench, Terminal } from 'lucide-react';
import { ToolStatus, WorkspaceInfo } from '../types';
import { UploadItem } from '../services/api';
import { collectFromInput } from '../utils/collectFiles';
import { LangToggle, useI18n } from '../i18n';

interface Props {
  info: WorkspaceInfo;
  top: string;
  tb: string;
  simTime: number;
  autoLint: boolean;
  tools: ToolStatus | null;
  busy: string | null;
  onTop: (v: string) => void;
  onTb: (v: string) => void;
  onSimTime: (v: number) => void;
  onAutoLint: (v: boolean) => void;
  onClose: () => void;
  onRefresh: () => void;
  onSimulate: () => void;
  onSchematic: () => void;
  onLint: () => void;
  onAddFiles: (items: UploadItem[]) => void;
  onShowTools: () => void;
  onShowDev: () => void;
}

/** Hover'da açılan koyu tooltip. */
function Tip({ text, children, align = 'left' }: { text: string; children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <span className="relative group inline-flex">
      {children}
      <span
        className={`pointer-events-none absolute top-full mt-2 z-50 w-64 px-3 py-2 rounded-lg glass-strong text-[11px] leading-snug text-slate-200
          opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150 ${align === 'right' ? 'right-0' : 'left-0'}`}
      >
        {text}
      </span>
    </span>
  );
}

export default function TopBar(p: Props) {
  const { t: tr } = useI18n();
  const dirInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    dirInput.current?.setAttribute('webkitdirectory', '');
  }, []);

  const rtlMods = Object.values(p.info.modules).filter((m) => m.group === 'rtl').map((m) => m.name);
  const tbMods = Object.values(p.info.modules).filter((m) => m.group === 'tb').map((m) => m.name);
  const sel = 'px-2 py-1 rounded-md bg-darker/80 border border-slate-700 text-xs max-w-[150px] hover:border-slate-500 focus:border-primary outline-none';

  const t = p.tools;
  const isCloud = p.info.root.startsWith('demo://') || p.info.root.startsWith('cloud://');
  const ok = (n: string) => isCloud || !!t?.[n]?.found;
  const canSim = ok('iverilog') && ok('vvp');
  const canSchem = ok('yosys');
  const canLint = ok('verilator') || ok('iverilog');
  const NO = (what: string) => `Bu araç PATH'te bulunamadı. Lütfen OSS CAD Suite kurun. (${what})`;

  const reason = (can: boolean, missingText: string, needs: string, extra?: string) =>
    !t ? 'Araçlar kontrol ediliyor…' : !can ? NO(missingText) : needs ? needs : extra ?? '';

  const picked = (files: FileList | null) => {
    if (!files) return;
    p.onAddFiles(collectFromInput(files).items);
  };

  return (
    <header className="h-12 flex-shrink-0 flex items-center gap-3 px-3 glass border-b relative z-30">
      <div className="p-1.5 rounded-lg bg-primary/15 border border-primary/30">
        <CircuitBoard className="w-4 h-4 text-primary" />
      </div>
      <button onClick={p.onClose} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-slate-700/60" title={p.info.root}>
        <FolderOpen className="w-4 h-4 text-slate-400" />
        <span className="text-sm font-semibold">{p.info.name}</span>
      </button>

      <div className="h-5 w-px bg-slate-700" />
      <label className="flex items-center gap-1 text-xs text-slate-400">
        Top
        <select className={sel} value={p.top} onChange={(e) => p.onTop(e.target.value)}>
          {p.top === '' && <option value="">—</option>}
          {rtlMods.map((m) => <option key={m}>{m}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-slate-400">
        TB
        <select className={sel} value={p.tb} onChange={(e) => p.onTb(e.target.value)}>
          {p.tb === '' && <option value="">—</option>}
          {tbMods.map((m) => <option key={m}>{m}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-slate-400" title="Testbench $finish çağırmazsa bu süre sonunda durdurulur">
        {tr.maxTime}
        <input type="number" min={1} value={p.simTime}
          onChange={(e) => p.onSimTime(Math.max(1, Number(e.target.value) || 1))} className={`${sel} w-20 font-mono`} />
        ns
      </label>

      <div className="h-5 w-px bg-slate-700" />
      <div className="flex items-center gap-2">
        <Tip text={reason(canSim, 'Simülasyon için iverilog + vvp gerekir', p.tb ? '' : 'Önce bir testbench seçin', 'Simülasyonu çalıştır (F5)')}>
          <button className="tool-btn bg-green-600 hover:bg-green-500 text-white"
            disabled={!canSim || !p.tb || !!p.busy} onClick={p.onSimulate}>
            <Play className="w-3.5 h-3.5" /> {tr.simulate}
          </button>
        </Tip>
        <Tip text={reason(canSchem, 'Şematik için Yosys gerekir', p.top ? '' : 'Önce bir top modül seçin', 'Şematik üret (F6)')}>
          <button className="tool-btn bg-primary hover:bg-blue-500 text-white"
            disabled={!canSchem || !p.top || !!p.busy} onClick={p.onSchematic}>
            <Workflow className="w-3.5 h-3.5" /> {tr.schematic}
          </button>
        </Tip>
        <Tip text={reason(canLint, 'Lint için Verilator veya iverilog gerekir', '', 'Lint çalıştır (F7)')}>
          <button className="tool-btn bg-surface hover:bg-slate-700 border border-slate-600"
            disabled={!canLint || !!p.busy} onClick={p.onLint}>
            <ShieldCheck className="w-3.5 h-3.5" /> {tr.lint}
          </button>
        </Tip>
      </div>

      <div className="ml-auto flex items-center gap-3 text-xs">
        {p.busy && <span className="text-yellow-300 animate-pulse">{tr.running}: {p.busy}…</span>}
        <label className="flex items-center gap-1 text-slate-400" title="Kaydedince / dosya değişince lint otomatik çalışır">
          <input type="checkbox" checked={p.autoLint} onChange={(e) => p.onAutoLint(e.target.checked)} /> {tr.autoLint}
        </label>
        <Tip text="Projeye dosya ekle (.sv/.v/.vhd)" align="right">
          <button onClick={() => fileInput.current?.click()} className="text-slate-400 hover:text-white"><FilePlus2 className="w-4 h-4" /></button>
        </Tip>
        <Tip text="Projeye klasör ekle" align="right">
          <button onClick={() => dirInput.current?.click()} className="text-slate-400 hover:text-white"><FolderUp className="w-4 h-4" /></button>
        </Tip>
        <Tip text="Klasörü yeniden tara" align="right">
          <button onClick={p.onRefresh} className="text-slate-400 hover:text-white"><RefreshCw className="w-4 h-4" /></button>
        </Tip>
        <div className="h-5 w-px bg-slate-700" />
        {t && ['yosys', 'iverilog', 'verilator'].map((n) => (
          <Tip key={n} align="right" text={t[n]?.found ? `${n}: ${t[n].path}` : NO(t[n]?.purpose ?? n)}>
            <button onClick={p.onShowTools} className="flex items-center gap-1.5 text-slate-300 hover:text-white">
              <span className={`w-2 h-2 rounded-full ${t[n]?.found ? 'bg-green-400 shadow-[0_0_8px_#4ade80]' : 'bg-red-500 shadow-[0_0_8px_#ef4444]'}`} />
              {n}
            </button>
          </Tip>
        ))}
        <Tip text="Araç kurulum yardımcısı" align="right">
          <button onClick={p.onShowTools} className="text-slate-400 hover:text-white"><Wrench className="w-4 h-4" /></button>
        </Tip>
        <Tip text="Geliştirici & Sistem Mimarisi (Yiğit Can Aktürk)" align="right">
          <button onClick={p.onShowDev} className="text-slate-400 hover:text-indigo-300"><Terminal className="w-4 h-4" /></button>
        </Tip>
        <LangToggle />
      </div>

      <input ref={fileInput} type="file" multiple accept=".sv,.v,.svh,.vh,.vhd,.vhdl" className="hidden"
        onChange={(e) => { picked(e.target.files); e.target.value = ''; }} />
      <input ref={dirInput} type="file" multiple className="hidden"
        onChange={(e) => { picked(e.target.files); e.target.value = ''; }} />
    </header>
  );
}
