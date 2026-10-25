import { DragEvent, useEffect, useRef, useState } from 'react';
import {
  CircuitBoard, FolderOpen, FolderPlus, Clock, UploadCloud, FileUp, FolderUp, Loader2, Wrench, MonitorUp, Terminal, ExternalLink,
} from 'lucide-react';
import { errMsg, ws, UploadItem } from '../services/api';
import { ToolStatus, WorkspaceInfo } from '../types';
import { collectFromDrop, collectFromInput } from '../utils/collectFiles';
import { LangToggle, useI18n } from '../i18n';
import { GITHUB_URL, LINKEDIN_URL } from './DeveloperModal';
import DirPicker from './DirPicker';

interface Props {
  tools: ToolStatus | null;
  error: string;
  busy: boolean;
  onOpen: (path: string) => void;
  onCreate: (path: string) => void;
  onLoaded: (info: WorkspaceInfo) => void;
  onShowTools: () => void;
  onShowDev: () => void;
}

export default function WelcomeScreen({ tools, error, busy, onOpen, onCreate, onLoaded, onShowTools, onShowDev }: Props) {
  const { lang, t: tr } = useI18n();
  const [path, setPath] = useState(localStorage.getItem('cvr.lastPath') ?? '');
  const [recent, setRecent] = useState<string[]>([]);
  const [localErr, setLocalErr] = useState('');
  const [picker, setPicker] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ws.recent().then(setRecent).catch(() => undefined);
    // webkitdirectory TS tipinde yok; özniteliği elle ekliyoruz
    dirInput.current?.setAttribute('webkitdirectory', '');
    dirInput.current?.setAttribute('directory', '');
  }, []);

  const upload = async (items: UploadItem[], name: string) => {
    setLocalErr('');
    if (items.length === 0) { setLocalErr(tr.noHdlFound); return; }
    setUploading(true);
    try {
      onLoaded(await ws.upload(items, name || 'yuklenen-proje'));
    } catch (e) {
      setLocalErr(errMsg(e));
    } finally {
      setUploading(false);
    }
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const { items, name } = await collectFromDrop(e.dataTransfer);
    upload(items, name);
  };

  const nativeBrowse = async () => {
    setLocalErr('');
    try {
      const p = await ws.browse();
      if (p) setPath(p);
    } catch (e) {
      setLocalErr(errMsg(e));
      setPicker(true);
    }
  };

  const missing = tools ? Object.values(tools).filter((t) => !t.found).length : 0;

  return (
    <div className="h-full overflow-auto flex items-center justify-center p-6">
      <div className="w-full max-w-3xl space-y-5">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-primary/30 to-accent/20 border border-primary/30 shadow-glow">
            <CircuitBoard className="w-9 h-9 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">CircuitVR</h1>
            <p className="text-sm text-slate-400">{tr.subtitle}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <LangToggle />
            <button
              onClick={onShowTools}
              className={`tool-btn border ${missing ? 'border-red-500/40 text-red-300 bg-red-500/10' : 'border-green-500/40 text-green-300 bg-green-500/10'}`}
            >
              <Wrench className="w-3.5 h-3.5" /> {missing ? tr.toolsMissing(missing) : tr.toolsReady}
            </button>
          </div>
        </div>

        {/* Sürükle-bırak alanı */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`card border-2 border-dashed text-center space-y-4 py-10 ${
            dragging ? 'border-primary bg-primary/10 shadow-glow' : 'border-slate-600'
          }`}
        >
          {uploading ? (
            <div className="flex flex-col items-center gap-2 text-slate-300">
              <Loader2 className="w-8 h-8 animate-spin text-primary" /> {tr.uploading}
            </div>
          ) : (
            <>
              <UploadCloud className={`w-10 h-10 mx-auto ${dragging ? 'text-primary' : 'text-slate-500'}`} />
              <div>
                <p className="font-medium">{tr.dropTitle}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {tr.dropSub}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                <button className="btn-secondary text-sm flex items-center gap-2" onClick={() => dirInput.current?.click()}>
                  <FolderUp className="w-4 h-4" /> {tr.uploadFolder}
                </button>
                <button className="btn-secondary text-sm flex items-center gap-2" onClick={() => fileInput.current?.click()}>
                  <FileUp className="w-4 h-4" /> {tr.uploadFile}
                </button>
              </div>
            </>
          )}
          <input ref={fileInput} type="file" multiple accept=".sv,.v,.svh,.vh,.vhd,.vhdl" className="hidden"
            onChange={(e) => { if (e.target.files) { const r = collectFromInput(e.target.files); upload(r.items, r.name); } e.target.value = ''; }} />
          <input ref={dirInput} type="file" multiple className="hidden"
            onChange={(e) => { if (e.target.files) { const r = collectFromInput(e.target.files); upload(r.items, r.name); } e.target.value = ''; }} />
        </div>

        {/* Yerinde klasör aç */}
        <div className="card space-y-3">
          <h2 className="font-semibold flex items-center gap-2"><FolderOpen className="w-4 h-4 text-primary" /> {tr.openLocalTitle}</h2>
          <p className="text-xs text-slate-500">{tr.openLocalSub}</p>
          <div className="flex gap-2">
            <input
              className="input-field flex-1 font-mono text-sm"
              placeholder="C:\Projeler\TrafficLight"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && path && onOpen(path.trim())}
            />
            <button className="btn-secondary flex items-center gap-2 text-sm" onClick={() => setPicker(true)}>
              <FolderOpen className="w-4 h-4" /> {tr.browse}
            </button>
            <button className="btn-secondary px-3" title="Windows folder dialog" onClick={nativeBrowse}>
              <MonitorUp className="w-4 h-4" />
            </button>
            <button className="btn-primary text-sm" disabled={!path || busy} onClick={() => onOpen(path.trim())}>{tr.open}</button>
          </div>
          <button
            className="text-xs text-primary hover:underline flex items-center gap-1 disabled:opacity-50"
            disabled={!path || busy}
            onClick={() => onCreate(path.trim())}
          >
            <FolderPlus className="w-3.5 h-3.5" /> {tr.createScaffold}
          </button>
          {(error || localErr) && <p className="text-sm text-red-400 whitespace-pre-wrap">{error || localErr}</p>}
        </div>

        {/* Hazır Çoklu-HDL Örnekleri (SystemVerilog / Verilog / VHDL) */}
        <div className="card space-y-2">
          <h2 className="font-semibold flex items-center gap-2 text-sm text-slate-300">
            <CircuitBoard className="w-4 h-4 text-indigo-400" /> {tr.demoProjects}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <button onClick={() => onOpen('demo://traffic_light_sv')}
              className="text-left px-3 py-2 rounded-lg bg-darker/80 hover:bg-primary/15 border border-slate-700 hover:border-primary/40 text-xs">
              <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono text-[10px] mr-1.5">SV</span>
              <span className="font-semibold text-slate-200">Traffic Light FSM</span>
            </button>
            <button onClick={() => onOpen('demo://counter_verilog')}
              className="text-left px-3 py-2 rounded-lg bg-darker/80 hover:bg-primary/15 border border-slate-700 hover:border-primary/40 text-xs">
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px] mr-1.5">Verilog</span>
              <span className="font-semibold text-slate-200">4-Bit Counter</span>
            </button>
            <button onClick={() => onOpen('demo://vhdl_alu_demo')}
              className="text-left px-3 py-2 rounded-lg bg-darker/80 hover:bg-primary/15 border border-slate-700 hover:border-primary/40 text-xs">
              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px] mr-1.5">VHDL</span>
              <span className="font-semibold text-slate-200">8-Bit ALU Control</span>
            </button>
          </div>
        </div>

        {recent.length > 0 && (
          <div className="card space-y-2">
            <h2 className="font-semibold flex items-center gap-2"><Clock className="w-4 h-4 text-slate-400" /> {tr.recentProjects}</h2>
            {recent.map((r) => (
              <button key={r} onClick={() => onOpen(r)}
                className="block w-full text-left px-3 py-2 rounded-lg bg-darker/70 hover:bg-primary/15 border border-transparent hover:border-primary/30 font-mono text-xs truncate">
                {r}
              </button>
            ))}
          </div>
        )}

        {/* Sade, reklamsız mühendislik imzası (Subtle Developer Attribution) */}
        <div className="pt-1 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-slate-500 font-mono">
          <button
            onClick={onShowDev}
            className="inline-flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition"
          >
            <Terminal className="w-3.5 h-3.5 text-indigo-400" />
            <span>Yiğit Can Aktürk</span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-500">
              {lang === 'tr' ? 'Edge AI / FPGA & Full-Stack Mimari Notları (DevLog)' : 'Edge AI / FPGA & Full-Stack Architect Notes (DevLog)'}
            </span>
          </button>
          <div className="flex items-center gap-3">
            <button onClick={onShowDev} className="hover:text-indigo-300 transition">
              {lang === 'tr' ? 'Hakkımda' : 'About'}
            </button>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-slate-300 transition">
              GitHub <ExternalLink className="w-2.5 h-2.5" />
            </a>
            <a href={LINKEDIN_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-sky-400 transition">
              LinkedIn <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        </div>
      </div>

      {picker && (
        <DirPicker start={path || undefined} onClose={() => setPicker(false)}
          onSelect={(p) => { setPath(p); setPicker(false); }} />
      )}
    </div>
  );
}
