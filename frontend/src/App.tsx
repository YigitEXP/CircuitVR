import { useCallback, useEffect, useRef, useState } from 'react';
import { Code2, Workflow, Activity, BarChart3, BrainCircuit } from 'lucide-react';
import TopBar from './components/TopBar';
import Explorer from './components/Explorer';
import CodeEditor from './components/CodeEditor';
import CircuitViewer from './components/CircuitViewer';
import WaveformViewer from './components/WaveformViewer';
import AnalysisView from './components/AnalysisView';
import EdgeAiView from './components/EdgeAiView';
import BottomPanel from './components/BottomPanel';
import WelcomeScreen from './components/WelcomeScreen';
import { errMsg, ws, UploadItem } from './services/api';
import ToolsDialog from './components/ToolsDialog';
import DeveloperModal from './components/DeveloperModal';
import OnboardingModal, { ONBOARDING_STORAGE_KEY } from './components/OnboardingModal';
import CommandPalette from './components/CommandPalette';
import { useI18n } from './i18n';
import { APP_BUILD_TIME, APP_VERSION } from './version';
import {
  Diagnostic, LintResult, LogLine, SchematicGraph, SimResult, SynthStats, ToolStatus, WaveData, WorkspaceInfo,
} from './types';

type View = 'code' | 'schematic' | 'wave' | 'analysis' | 'edgeai';

interface OpenFile { path: string; content: string; saved: string; }

const VIEWS: { id: View; label: string; icon: typeof Code2 }[] = [
  { id: 'code', label: 'Kod', icon: Code2 },
  { id: 'schematic', label: 'Şematik', icon: Workflow },
  { id: 'wave', label: 'Waveform', icon: Activity },
  { id: 'analysis', label: 'Analiz', icon: BarChart3 },
  { id: 'edgeai', label: 'Edge AI Lab', icon: BrainCircuit },
];

function App() {
  const { t: tr } = useI18n();
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [top, setTop] = useState('');
  const [tb, setTb] = useState('');
  const [view, setView] = useState<View>('code');
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [welcomeErr, setWelcomeErr] = useState('');
  const [opening, setOpening] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [showDev, setShowDev] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showTour, setShowTour] = useState<boolean>(
    () => localStorage.getItem(ONBOARDING_STORAGE_KEY) !== '1'
  );

  const [file, setFile] = useState<OpenFile | null>(null);
  const [goto, setGoto] = useState({ line: 0, nonce: 0 });

  const [graph, setGraph] = useState<SchematicGraph | null>(null);
  const [schematicErr, setSchematicErr] = useState('');
  const [stale, setStale] = useState(false);
  const [flatten, setFlatten] = useState(false);

  const [lint, setLint] = useState<LintResult | null>(null);
  const [stats, setStats] = useState<SynthStats | null>(null);
  const [sim, setSim] = useState<SimResult | null>(null);
  const [wave, setWave] = useState<WaveData | null>(null);
  const [simTime, setSimTime] = useState(10000);
  const [autoLint, setAutoLint] = useState(true);

  const [busy, setBusy] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);

  const infoRef = useRef<WorkspaceInfo | null>(null);
  const fileRef = useRef<OpenFile | null>(null);
  infoRef.current = info;
  fileRef.current = file;

  const log = useCallback((level: LogLine['level'], text: string) => {
    setLogs((l) => [...l.slice(-300), { t: new Date().toLocaleTimeString(), level, text }]);
  }, []);

  const dirty = !!file && file.content !== file.saved;

  /* ---------- workspace ---------- */
  const readInto = useCallback(async (root: string, path: string, line?: number) => {
    const content = await ws.readFile(root, path);
    setFile({ path, content, saved: content });
    if (line) setGoto((g) => ({ line, nonce: g.nonce + 1 }));
  }, []);

  const applyInfo = useCallback(async (i: WorkspaceInfo, reset: boolean) => {
    setInfo(i);
    localStorage.setItem('cvr.lastPath', i.root);
    if (reset) {
      setTop(i.default_top ?? '');
      setTb(i.default_tb ?? '');
      setGraph(null); setLint(null); setStats(null); setSim(null); setWave(null);
      setSchematicErr(''); setStale(false); setFile(null); setView('code'); setLogs([]);
      const first = i.files.find((f) => f.group === 'rtl' && !f.is_header) ?? i.files.find((f) => !f.is_header);
      if (first) await readInto(i.root, first.path).catch(() => undefined);
      i.warnings.forEach((w) => log('info', `⚠ ${w}`));
    } else {
      setTop((t) => (i.modules[t] ? t : i.default_top ?? ''));
      setTb((t) => (i.modules[t] ? t : i.default_tb ?? ''));
    }
  }, [log, readInto]);

  const openWorkspace = useCallback(async (path: string, create = false) => {
    setOpening(true);
    setWelcomeErr('');
    try {
      const i = await (create ? ws.create(path) : ws.open(path));
      await applyInfo(i, true);
      log('ok', `Proje açıldı: ${i.root}`);
    } catch (e) {
      setWelcomeErr(errMsg(e));
    } finally {
      setOpening(false);
    }
  }, [applyInfo, log]);

  useEffect(() => {
    ws.tools().then(setTools).catch((e) => setWelcomeErr(errMsg(e)));
    const refreshTools = () => ws.tools().then(setTools).catch(() => undefined);
    window.addEventListener('focus', refreshTools);
    const last = localStorage.getItem('cvr.lastPath');
    if (last) openWorkspace(last);
    return () => window.removeEventListener('focus', refreshTools);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeWorkspace = () => {
    if (dirty && !window.confirm('Kaydedilmemiş değişiklikler var. Yine de kapatılsın mı?')) return;
    setInfo(null);
    localStorage.removeItem('cvr.lastPath');
  };

  const rescan = useCallback(async () => {
    const cur = infoRef.current;
    if (!cur) return null;
    const i = await ws.open(cur.root);
    await applyInfo(i, false);
    return i;
  }, [applyInfo]);

  /* ---------- actions ---------- */
  const runLint = useCallback(async () => {
    const cur = infoRef.current;
    if (!cur) return;
    setBusy('lint');
    try {
      const r = await ws.lint(cur.root, top || undefined);
      setLint(r);
      if (r.success) log(r.errors ? 'error' : 'ok', `Lint (${r.tool}): ${r.errors} hata, ${r.warnings} uyarı`);
      else log('error', r.error ?? 'Lint başarısız');
    } catch (e) {
      log('error', errMsg(e));
    } finally {
      setBusy(null);
    }
  }, [top, log]);

  const runSchematic = useCallback(async () => {
    const cur = infoRef.current;
    if (!cur || !top) return;
    setBusy('şematik');
    setSchematicErr('');
    setView('schematic');
    try {
      const g = await ws.schematic(cur.root, top, flatten);
      setGraph(g);
      setStale(false);
      log('ok', `Şematik üretildi: ${g.stats.cells} hücre, ${g.stats.nets} net`);
    } catch (e) {
      setSchematicErr(errMsg(e));
      log('error', `Şematik: ${errMsg(e)}`);
    } finally {
      setBusy(null);
    }
  }, [top, flatten, log]);

  const runSim = useCallback(async () => {
    const cur = infoRef.current;
    if (!cur || !tb) return;
    setBusy('simülasyon');
    try {
      const r = await ws.simulate(cur.root, tb, simTime);
      setSim(r);
      if (!r.success) {
        log('error', r.error ?? 'Simülasyon başarısız');
        return;
      }
      log('ok', `Simülasyon tamam (${(r.duration ?? 0).toFixed(1)} sn)`);
      if (r.vcd) {
        setWave(await ws.wave(cur.root, r.vcd));
        setView('wave');
      } else {
        log('info', 'VCD üretilmedi');
      }
    } catch (e) {
      log('error', errMsg(e));
    } finally {
      setBusy(null);
    }
  }, [tb, simTime, log]);

  const runSynth = useCallback(async () => {
    const cur = infoRef.current;
    if (!cur || !top) return;
    setBusy('synth');
    try {
      const r = await ws.synth(cur.root, top);
      setStats(r);
      log(r.success ? 'ok' : 'error', r.success ? `Sentez: ${r.luts} LUT, ${r.ffs} FF` : (r.error ?? 'Sentez başarısız'));
    } catch (e) {
      log('error', errMsg(e));
    } finally {
      setBusy(null);
    }
  }, [top, log]);

  const openFile = useCallback(async (path: string, line?: number) => {
    const cur = infoRef.current;
    if (!cur) return;
    const f = fileRef.current;
    if (f && f.path !== path && f.content !== f.saved && !window.confirm('Kaydedilmemiş değişiklikler kaybolacak. Devam?')) return;
    try {
      if (f && f.path === path) {
        if (line) setGoto((g) => ({ line, nonce: g.nonce + 1 }));
      } else {
        await readInto(cur.root, path, line);
      }
      setView('code');
    } catch (e) {
      log('error', errMsg(e));
    }
  }, [readInto, log]);

  const saveFile = useCallback(async () => {
    const cur = infoRef.current;
    const f = fileRef.current;
    if (!cur || !f) return;
    try {
      await ws.saveFile(cur.root, f.path, f.content);
      setFile({ ...f, saved: f.content });
      log('ok', `Kaydedildi: ${f.path}`);
      await rescan();
      setStale(true);
      if (autoLint) runLint();
    } catch (e) {
      log('error', errMsg(e));
    }
  }, [rescan, autoLint, runLint, log]);

  /* ---------- external change watcher ---------- */
  useEffect(() => {
    if (!info) return;
    const id = window.setInterval(async () => {
      const cur = infoRef.current;
      if (!cur) return;
      try {
        const fp = await ws.fingerprint(cur.root);
        if (fp === cur.fingerprint) return;
        await rescan();
        setStale(true);
        log('info', 'Proje dosyaları değişti, yeniden tarandı');
        const f = fileRef.current;
        if (f && f.content === f.saved) {
          const content = await ws.readFile(cur.root, f.path).catch(() => null);
          if (content !== null && content !== f.content) setFile({ path: f.path, content, saved: content });
        }
        if (autoLint) runLint();
      } catch {
        /* backend temporarily unreachable */
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [info?.root, rescan, autoLint, runLint, log]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- shortcuts ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowPalette((s) => !s);
        return;
      }
      if (busy) return;
      if (e.key === 'F5') { e.preventDefault(); runSim(); }
      else if (e.key === 'F6') { e.preventDefault(); runSchematic(); }
      else if (e.key === 'F7') { e.preventDefault(); runLint(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, runSim, runSchematic, runLint]);

  const problems: Diagnostic[] = [
    ...(lint?.diagnostics ?? []).map((d) => ({ ...d, source: 'lint' })),
    ...(sim?.diagnostics ?? []).map((d) => ({ ...d, source: 'sim' })),
  ];
  const gotoDiag = (d: Diagnostic) => openFile(d.file, d.line);

  const addFiles = useCallback(async (items: UploadItem[]) => {
    const cur = infoRef.current;
    if (!cur) return;
    if (items.length === 0) { log('error', 'Seçimde .sv/.v dosyası bulunamadı'); return; }
    try {
      const i = await ws.upload(items, cur.name, cur.root);
      await applyInfo(i, false);
      setStale(true);
      log('ok', `${items.length} dosya projeye eklendi`);
    } catch (e) {
      log('error', errMsg(e));
    }
  }, [applyInfo, log]);

  const versionBadge = (
    <button
      onClick={() => setShowDev(true)}
      className="fixed bottom-1 right-2 z-40 text-[10px] font-mono text-slate-400 hover:text-slate-200 bg-dark/85 border border-slate-800/80 hover:border-slate-600 px-2 py-0.5 rounded transition"
      title="Geliştirici & Sistem Mimarisi (Yiğit Can Aktürk)"
    >
      {APP_VERSION} · {APP_BUILD_TIME} · <span className="text-indigo-400">@YigitEXP</span>
    </button>
  );

  const toolsDialog = showTools && (
    <ToolsDialog
      tools={tools}
      onTools={setTools}
      onClose={() => setShowTools(false)}
      onStartTour={() => setShowTour(true)}
    />
  );
  const devDialog = showDev && <DeveloperModal onClose={() => setShowDev(false)} />;
  const tourDialog = showTour && (
    <OnboardingModal
      onClose={() => setShowTour(false)}
      onOpenDemo={(demoPath) => openWorkspace(demoPath)}
      onOpenTools={() => setShowTools(true)}
    />
  );
  const paletteDialog = showPalette && (
    <CommandPalette
      info={info}
      onClose={() => setShowPalette(false)}
      onSelectView={(v) => setView(v)}
      onOpenFile={(p) => openFile(p)}
      onSimulate={runSim}
      onSchematic={runSchematic}
      onLint={runLint}
      onSynth={runSynth}
      onStartTour={() => setShowTour(true)}
      onShowTools={() => setShowTools(true)}
    />
  );

  if (!info) {
    return (
      <div className="h-screen bg-darker">
        {versionBadge}
        {toolsDialog}
        {devDialog}
        {tourDialog}
        {paletteDialog}
        <WelcomeScreen
          tools={tools}
          error={welcomeErr}
          busy={opening}
          onOpen={(p) => openWorkspace(p)}
          onCreate={(p) => openWorkspace(p, true)}
          onLoaded={(i) => { applyInfo(i, true); log('ok', `Proje yüklendi: ${i.name}`); }}
          onShowTools={() => setShowTools(true)}
          onShowDev={() => setShowDev(true)}
        />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-darker text-slate-100">
      {versionBadge}
      {toolsDialog}
      {devDialog}
      {tourDialog}
      {paletteDialog}
      <TopBar
        info={info} top={top} tb={tb} simTime={simTime} autoLint={autoLint} tools={tools} busy={busy}
        onTop={setTop} onTb={setTb} onSimTime={setSimTime} onAutoLint={setAutoLint}
        onClose={closeWorkspace} onRefresh={() => rescan().catch((e) => log('error', errMsg(e)))}
        onSimulate={runSim} onSchematic={runSchematic} onLint={runLint}
        onAddFiles={addFiles} onShowTools={() => setShowTools(true)} onShowDev={() => setShowDev(true)}
        onOpenPalette={() => setShowPalette(true)}
      />
      <div className="flex-1 flex min-h-0">
        <aside className="w-64 flex-shrink-0 border-r glass">
          <Explorer
            info={info} top={top} tb={tb} activeFile={file?.path ?? null}
            onOpenFile={openFile} onSelectTop={setTop} onSelectTb={setTb}
          />
        </aside>
        <div className="flex-1 flex flex-col min-w-0">
          <nav className="flex border-b glass flex-shrink-0">
            {VIEWS.map((v) => {
              const Icon = v.icon;
              const lbl =
                v.id === 'code'
                  ? tr.tabCode
                  : v.id === 'schematic'
                  ? tr.tabSchematic
                  : v.id === 'wave'
                  ? tr.tabWave
                  : v.id === 'analysis'
                  ? tr.tabAnalysis
                  : tr.tabEdgeAi;
              return (
                <button
                  key={v.id}
                  onClick={() => setView(v.id)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm border-b-2 ${
                    view === v.id
                      ? 'border-primary text-white'
                      : v.id === 'edgeai'
                      ? 'border-transparent text-indigo-300 hover:text-white'
                      : 'border-transparent text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${v.id === 'edgeai' ? 'text-indigo-400' : ''}`} /> {lbl}
                  {v.id === 'schematic' && stale && graph && <span className="w-2 h-2 rounded-full bg-yellow-400" />}
                </button>
              );
            })}
          </nav>
          <main className="flex-1 min-h-0 overflow-hidden">
            {view === 'code' && (file ? (
              <CodeEditor
                file={file.path} content={file.content} dirty={dirty}
                gotoLine={goto.line} gotoNonce={goto.nonce} diagnostics={problems}
                onChange={(content) => setFile({ ...file, content })} onSave={saveFile}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">{tr.selectFilePrompt}</div>
            ))}
            {view === 'schematic' && (
              <CircuitViewer
                graph={graph} top={top} busy={busy === 'şematik'} stale={stale} error={schematicErr}
                flatten={flatten} onFlatten={setFlatten} onGenerate={runSchematic}
              />
            )}
            {view === 'wave' && (
              <WaveformViewer
                wave={wave} tbTop={tb} busy={busy === 'simülasyon'} onRun={runSim}
                status={sim && !sim.success ? (sim.error ?? '') : ''}
              />
            )}
            {view === 'analysis' && (
              <AnalysisView
                info={info} top={top} lint={lint} stats={stats} busy={busy}
                onLint={runLint} onSynth={runSynth} onGoto={gotoDiag}
                onAutoFixed={(fixedFile, newContent, lineNo) => {
                  setFile((cur) => (cur && cur.path === fixedFile ? { path: fixedFile, content: newContent, saved: newContent } : cur));
                  setStale(true);
                  rescan().catch(() => undefined);
                  log('ok', `Otomatik RTL düzeltmesi uygulandı: ${fixedFile}:${lineNo}`);
                }}
              />
            )}
            {view === 'edgeai' && (
              <EdgeAiView
                info={info}
                onInjected={(updated, rtlFile, rtlCode, topMod, tbMod) => {
                  if (updated) setInfo(updated);
                  setTop(topMod);
                  setTb(tbMod);
                  setFile({ path: rtlFile, content: rtlCode, saved: rtlCode });
                  setStale(true);
                  log('ok', `Edge AI hızlandırıcı (${topMod}) ve Golden Testbench (${tbMod}) projeye eklendi.`);
                }}
                onRunSim={runSim}
                onRunSchematic={runSchematic}
              />
            )}
          </main>
          <BottomPanel problems={problems} logs={logs} simLog={sim?.log ?? sim?.error ?? ''} onGoto={gotoDiag} />
        </div>
      </div>
    </div>
  );
}

export default App;
