import { ReactNode, useEffect, useRef } from 'react';
import { CircuitBoard, FolderOpen, Play, ShieldCheck, Workflow, RefreshCw, FilePlus2, FolderUp, Wrench, Terminal, Search } from 'lucide-react';
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
  onOpenPalette?: () => void;
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
  const canSim = true; // Seamless cloud fallback active
  const canSchem = true;

  const toolGuidance = (name: string) => {
    const isFound = !!t?.[name]?.found;
    if (isFound) {
      return `${name.toUpperCase()}: Yerel EDA aracı hazır (${t?.[name]?.path})`;
    }
    return `${name.toUpperCase()}: Yerel PATH'te bulunamadı. Vercel Bulut üzerinden simüle ediliyor/sentezleniyor. Yerel çalıştırma için setup.bat veya ./setup.sh betiğini çalıştırın.`;
  };

  const simTip = p.tb
    ? canSim && (isCloud || !t?.iverilog?.found)
      ? 'Bulut Fallback Devrede: Tarayıcı içi / Vercel motoru ile simüle et (F5)'
      : 'Simülasyonu çalıştır (F5)'
    : 'Önce bir testbench seçin';

  const schemTip = p.top
    ? canSchem && (isCloud || !t?.yosys?.found)
      ? 'Bulut Fallback Devrede: Yosys netlist şematiğini üret (F6)'
      : 'Şematik üret (F6)'
    : 'Önce bir top modül seçin';

  const lintTip = isCloud || !t?.verilator?.found
    ? 'Bulut Fallback Devrede: Statik AST & Verilator ön denetimi çalıştır (F7)'
    : 'Lint çalıştır (F7)';

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
        <Tip text={simTip}>
          <button className="tool-btn bg-green-600 hover:bg-green-500 text-white"
            disabled={!p.tb || !!p.busy} onClick={p.onSimulate}>
            <Play className="w-3.5 h-3.5" /> {tr.simulate}
          </button>
        </Tip>
        <Tip text={schemTip}>
          <button className="tool-btn bg-primary hover:bg-blue-500 text-white"
            disabled={!p.top || !!p.busy} onClick={p.onSchematic}>
            <Workflow className="w-3.5 h-3.5" /> {tr.schematic}
          </button>
        </Tip>
        <Tip text={lintTip}>
          <button className="tool-btn bg-surface hover:bg-slate-700 border border-slate-600"
            disabled={!!p.busy} onClick={p.onLint}>
            <ShieldCheck className="w-3.5 h-3.5" /> {tr.lint}
          </button>
        </Tip>
      </div>

      <div className="ml-auto flex items-center gap-3 text-xs">
        {p.busy && <span className="text-yellow-300 animate-pulse">{tr.running}: {p.busy}…</span>}
        {p.onOpenPalette && (
          <Tip text="Hızlı Komut Paleti & Dosya Arama (Ctrl+K)" align="right">
            <button
              onClick={p.onOpenPalette}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-darker/90 border border-slate-700 hover:border-indigo-500/60 text-slate-300 hover:text-white transition"
            >
              <Search className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden xl:inline text-[11px]">Komutlar</span>
              <span className="text-[10px] font-mono px-1 rounded bg-slate-800 text-slate-400">Ctrl+K</span>
            </button>
          </Tip>
        )}
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
        {t && ['yosys', 'iverilog', 'verilator'].map((n) => {
          const isNative = !!t[n]?.found;
          return (
            <Tip key={n} align="right" text={toolGuidance(n)}>
              <button onClick={p.onShowTools} className="flex items-center gap-1.5 text-slate-300 hover:text-white">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isNative
                      ? 'bg-green-400 shadow-[0_0_8px_#4ade80]'
                      : 'bg-amber-400 shadow-[0_0_8px_#f59e0b]'
                  }`}
                />
                <span>{n}</span>
                <span className="text-[9px] font-mono opacity-60">
                  {isNative ? '(Local)' : '(Cloud)'}
                </span>
              </button>
            </Tip>
          );
        })}
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
