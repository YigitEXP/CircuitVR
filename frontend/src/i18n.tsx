import { createContext, ReactNode, useContext, useState } from 'react';

export type Lang = 'tr' | 'en';

const DICT = {
  tr: {
    subtitle: 'SystemVerilog · Verilog · VHDL tasarım alanı · şematik · simülasyon · optimizasyon',
    toolsMissing: (n: number) => `${n} araç eksik`,
    toolsReady: 'Araçlar hazır',
    dropTitle: 'Klasörü ya da .sv / .v / .vhd dosyalarını buraya sürükleyin',
    dropSub: 'rtl/ ve tb/ klasörleri korunur; yoksa dosyalar adlarına göre (tb_*) otomatik yerleştirilir.',
    uploadFolder: 'Klasör Yükle',
    uploadFile: 'Dosya Yükle',
    uploading: 'Yükleniyor…',
    noHdlFound: 'Seçimde .sv / .v / .vhd / .vhdl dosyası bulunamadı.',
    openLocalTitle: 'Bilgisayardaki klasörü yerinde aç',
    openLocalSub: 'Yükleme olmaz; dosyalar bulundukları yerde okunur ve düzenlemeler canlı izlenir.',
    browse: 'Gözat',
    open: 'Aç',
    createScaffold: 'Bu yolda rtl/ + tb/ yapısını (örnek dosyalarla) oluştur',
    recentProjects: 'Son projeler',
    demoProjects: 'Hazır Örnek Projeler (SV / Verilog / VHDL)',
    tabCode: 'Kod',
    tabSchematic: 'Şematik',
    tabWave: 'Waveform',
    tabAnalysis: 'Analiz',
    selectFilePrompt: 'Soldan bir dosya seçin',
    maxTime: 'Maks',
    simulate: 'Simüle Et',
    schematic: 'Şematik',
    lint: 'Lint',
    autoLint: 'Oto-lint',
    running: 'çalışıyor',
    unsaved: '● kaydedilmedi (Ctrl+S)',
    save: 'Kaydet',
    noFiles: 'dosya yok',
    hierTb: 'Hiyerarşi (testbench)',
    hierTop: 'Hiyerarşi (top)',
    setTop: 'Top modül yap',
    setTb: 'Testbench top yap',
    problems: 'Sorunlar',
    output: 'Çıktı',
    simOutput: 'Simülasyon Çıktısı',
    noProblems: 'Sorun yok',
    noLogs: 'Henüz kayıt yok',
    noSimOutput: 'Simülasyon çıktısı yok',
    rtlFiles: 'RTL dosyası',
    tbFiles: 'TB dosyası',
    modules: 'Modül / Entity',
    lines: 'Satır',
    submodules: 'Hiyerarşi (alt modül)',
    optAdvisor: 'Akıllı RTL Optimizasyon Danışmanı',
    optScore: 'Optimizasyon Skoru',
    optActiveSynth: 'Statik AST + Yosys Sentez Netlist Analizi Aktif',
    optStaticOnly: 'Statik RTL Analizi (Derin analiz için Sentez çalıştırın)',
    optClean: 'Tebrikler! Kodunuzda bilinen bir RTL anti-pattern veya sentez darboğazı tespit edilmedi. ✓',
    impact: 'Etki',
    beforeCode: 'Mevcut Kod',
    afterCode: 'Önerilen Optimize Kod',
    synthTitle: 'Sentez ve Kaynak Kullanımı',
    analyzeBtn: 'Analiz Et',
    synthDesc: (top: string) => `Yosys ile ${top || 'top modül'} sentezlenir; gerçek hücre sayıları gösterilir.`,
    ffLatch: 'Flip-flop / latch',
    logicDepth: 'Mantık derinliği (seviye)',
    memCells: 'Bellek hücresi',
    runLint: 'Lint Çalıştır',
    noIssues: 'Sorun bulunamadı ✓',
    cloudDemoBanner: 'Bulut Demo Modu (Vercel) — Örnek SystemVerilog, Verilog ve VHDL projelerini doğrudan tarayıcıda inceleyebilirsiniz.',
  },
  en: {
    subtitle: 'SystemVerilog · Verilog · VHDL workspace · schematic · simulation · optimization',
    toolsMissing: (n: number) => `${n} tool(s) missing`,
    toolsReady: 'Tools ready',
    dropTitle: 'Drag & drop a project folder or .sv / .v / .vhd files here',
    dropSub: 'rtl/ and tb/ folders are preserved; otherwise files are auto-sorted by name (tb_*).',
    uploadFolder: 'Upload Folder',
    uploadFile: 'Upload Files',
    uploading: 'Uploading…',
    noHdlFound: 'No .sv / .v / .vhd / .vhdl files found in selection.',
    openLocalTitle: 'Open local folder in-place',
    openLocalSub: 'No copying; files are read directly in place and external edits are watched live.',
    browse: 'Browse',
    open: 'Open',
    createScaffold: 'Create rtl/ + tb/ project scaffold (with example files) at this path',
    recentProjects: 'Recent projects',
    demoProjects: 'Built-in Example Projects (SV / Verilog / VHDL)',
    tabCode: 'Code',
    tabSchematic: 'Schematic',
    tabWave: 'Waveform',
    tabAnalysis: 'Analysis',
    selectFilePrompt: 'Select a file from the left explorer',
    maxTime: 'Max',
    simulate: 'Simulate',
    schematic: 'Schematic',
    lint: 'Lint',
    autoLint: 'Auto-lint',
    running: 'running',
    unsaved: '● unsaved (Ctrl+S)',
    save: 'Save',
    noFiles: 'no files',
    hierTb: 'Hierarchy (testbench)',
    hierTop: 'Hierarchy (top)',
    setTop: 'Set as Top module',
    setTb: 'Set as Testbench top',
    problems: 'Problems',
    output: 'Output',
    simOutput: 'Simulation Log',
    noProblems: 'No problems detected',
    noLogs: 'No logs yet',
    noSimOutput: 'No simulation output yet',
    rtlFiles: 'RTL files',
    tbFiles: 'TB files',
    modules: 'Modules / Entities',
    lines: 'Lines',
    submodules: 'Hierarchy (submodules)',
    optAdvisor: 'Smart RTL Optimization Advisor',
    optScore: 'Optimization Score',
    optActiveSynth: 'Static AST + Yosys Synthesis Netlist Analysis Active',
    optStaticOnly: 'Static RTL Analysis (Run Synthesis for deep netlist inspection)',
    optClean: 'Great job! No known RTL anti-patterns or synthesis bottlenecks detected. ✓',
    impact: 'Impact',
    beforeCode: 'Current Code',
    afterCode: 'Suggested Optimized Code',
    synthTitle: 'Synthesis & Resource Utilization',
    analyzeBtn: 'Analyze',
    synthDesc: (top: string) => `Synthesizes ${top || 'top module'} with Yosys and reports exact gate/LUT counts.`,
    ffLatch: 'Flip-flops / latches',
    logicDepth: 'Logic depth (levels)',
    memCells: 'Memory cells',
    runLint: 'Run Lint',
    noIssues: 'No issues found ✓',
    cloudDemoBanner: 'Cloud Demo Mode (Vercel) — Explore SystemVerilog, Verilog, and VHDL projects right in your browser.',
  },
};

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: typeof DICT.tr;
}

const Ctx = createContext<I18nCtx>({
  lang: 'tr',
  setLang: () => undefined,
  t: DICT.tr,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem('cvr.lang') === 'en' ? 'en' : 'tr'));
  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem('cvr.lang', l);
  };
  return <Ctx.Provider value={{ lang, setLang, t: DICT[lang] }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}

export function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div className="inline-flex items-center rounded-md bg-darker border border-slate-700 p-0.5 text-[11px] font-mono">
      <button
        onClick={() => setLang('tr')}
        className={`px-2 py-0.5 rounded transition ${lang === 'tr' ? 'bg-primary text-white font-semibold' : 'text-slate-400 hover:text-white'}`}
      >
        TR
      </button>
      <button
        onClick={() => setLang('en')}
        className={`px-2 py-0.5 rounded transition ${lang === 'en' ? 'bg-primary text-white font-semibold' : 'text-slate-400 hover:text-white'}`}
      >
        EN
      </button>
    </div>
  );
}
