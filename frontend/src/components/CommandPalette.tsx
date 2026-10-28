import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Play, Workflow, ShieldCheck, Cpu, BrainCircuit, Code2, Activity, BarChart3, Sparkles, Wrench, FileCode2, Languages, X,
} from 'lucide-react';
import { WorkspaceInfo } from '../types';
import { useI18n } from '../i18n';

interface CommandItem {
  id: string;
  titleTr: string;
  titleEn: string;
  categoryTr: string;
  categoryEn: string;
  shortcut?: string;
  icon: typeof Search;
  action: () => void;
}

interface Props {
  info: WorkspaceInfo | null;
  onClose: () => void;
  onSelectView: (v: 'code' | 'schematic' | 'wave' | 'analysis' | 'edgeai') => void;
  onOpenFile: (path: string) => void;
  onSimulate: () => void;
  onSchematic: () => void;
  onLint: () => void;
  onSynth: () => void;
  onStartTour: () => void;
  onShowTools: () => void;
}

export default function CommandPalette({
  info,
  onClose,
  onSelectView,
  onOpenFile,
  onSimulate,
  onSchematic,
  onLint,
  onSynth,
  onStartTour,
  onShowTools,
}: Props) {
  const { lang, setLang } = useI18n();
  const isTr = lang === 'tr';
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items: CommandItem[] = useMemo(() => {
    const base: CommandItem[] = [
      {
        id: 'sim',
        titleTr: 'Simülasyonu Çalıştır & VCD Dalga Formu Üret',
        titleEn: 'Run Simulation & Generate VCD Waveform',
        categoryTr: 'EDA Aksiyonu',
        categoryEn: 'EDA Action',
        shortcut: 'F5',
        icon: Play,
        action: () => {
          onSimulate();
          onClose();
        },
      },
      {
        id: 'schem',
        titleTr: 'Yosys Kapı Seviyesi RTL Şematik & Kritik Yol (Fmax) Çiz',
        titleEn: 'Generate Gate-Level RTL Schematic & Critical Path (Fmax)',
        categoryTr: 'EDA Aksiyonu',
        categoryEn: 'EDA Action',
        shortcut: 'F6',
        icon: Workflow,
        action: () => {
          onSchematic();
          onClose();
        },
      },
      {
        id: 'lint',
        titleTr: 'Verilator / Icarus Statik Lint Denetimi Çalıştır',
        titleEn: 'Run Verilator / Icarus Static Lint Check',
        categoryTr: 'EDA Aksiyonu',
        categoryEn: 'EDA Action',
        shortcut: 'F7',
        icon: ShieldCheck,
        action: () => {
          onLint();
          onClose();
        },
      },
      {
        id: 'synth',
        titleTr: 'Sentez İstatistikleri (LUT/FF) & Akıllı RTL Optimizasyon + CDC Analizi',
        titleEn: 'Run Synthesis Stats (LUT/FF) & Smart RTL Optimizer + CDC Check',
        categoryTr: 'EDA Aksiyonu',
        categoryEn: 'EDA Action',
        icon: Cpu,
        action: () => {
          onSelectView('analysis');
          onSynth();
          onClose();
        },
      },
      {
        id: 'view-edgeai',
        titleTr: 'Edge AI & Biyosinyal (1D-CNN / DSP) Stüdyosunu Aç',
        titleEn: 'Open Edge AI & Biosignal (1D-CNN / DSP) Studio',
        categoryTr: 'Görünüm',
        categoryEn: 'Navigation',
        icon: BrainCircuit,
        action: () => {
          onSelectView('edgeai');
          onClose();
        },
      },
      {
        id: 'view-code',
        titleTr: 'Kod Editörü Sekmesine Geç',
        titleEn: 'Switch to Code Editor Tab',
        categoryTr: 'Görünüm',
        categoryEn: 'Navigation',
        icon: Code2,
        action: () => {
          onSelectView('code');
          onClose();
        },
      },
      {
        id: 'view-wave',
        titleTr: 'Waveform (A/B İmleç & Analog Mod) Sekmesine Geç',
        titleEn: 'Switch to Waveform Viewer (A/B Cursors & Analog Mode)',
        categoryTr: 'Görünüm',
        categoryEn: 'Navigation',
        icon: Activity,
        action: () => {
          onSelectView('wave');
          onClose();
        },
      },
      {
        id: 'view-analysis',
        titleTr: 'Analiz & Tek Tıkla Otomatik RTL Düzeltme (Auto-Fix) Sekmesine Geç',
        titleEn: 'Switch to Analysis & One-Click RTL Auto-Fix Tab',
        categoryTr: 'Görünüm',
        categoryEn: 'Navigation',
        icon: BarChart3,
        action: () => {
          onSelectView('analysis');
          onClose();
        },
      },
      {
        id: 'tour',
        titleTr: 'İnteraktif Tanıtım Turunu Başlat (Rehber)',
        titleEn: 'Launch Interactive Onboarding Tour',
        categoryTr: 'Sistem',
        categoryEn: 'System',
        icon: Sparkles,
        action: () => {
          onStartTour();
          onClose();
        },
      },
      {
        id: 'tools',
        titleTr: 'Araç Durumu & Ayarları Aç',
        titleEn: 'Open Toolchain Status & Settings',
        categoryTr: 'Sistem',
        categoryEn: 'System',
        icon: Wrench,
        action: () => {
          onShowTools();
          onClose();
        },
      },
      {
        id: 'lang',
        titleTr: 'Arayüz Dilini Değiştir (TR ↔ EN)',
        titleEn: 'Toggle Interface Language (TR ↔ EN)',
        categoryTr: 'Sistem',
        categoryEn: 'System',
        icon: Languages,
        action: () => {
          setLang(lang === 'tr' ? 'en' : 'tr');
          onClose();
        },
      },
    ];

    const fileItems: CommandItem[] = (info?.files ?? []).map((f) => ({
      id: `file:${f.path}`,
      titleTr: `${f.path} dosyasını aç`,
      titleEn: `Open file ${f.path}`,
      categoryTr: f.group === 'tb' ? 'Testbench Dosyası' : 'RTL Dosyası',
      categoryEn: f.group === 'tb' ? 'Testbench File' : 'RTL File',
      icon: FileCode2,
      action: () => {
        onOpenFile(f.path);
        onClose();
      },
    }));

    return [...base, ...fileItems];
  }, [info, lang, setLang, onClose, onLint, onOpenFile, onSchematic, onSelectView, onShowTools, onSimulate, onStartTour, onSynth]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.titleTr.toLowerCase().includes(q) ||
        it.titleEn.toLowerCase().includes(q) ||
        it.categoryTr.toLowerCase().includes(q) ||
        it.categoryEn.toLowerCase().includes(q)
    );
  }, [items, query]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(Math.max(0, filtered.length - 1), i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter' && filtered[selectedIdx]) {
        e.preventDefault();
        filtered[selectedIdx].action();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, selectedIdx, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-20 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-dark border border-slate-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-800 bg-darker">
          <Search className="w-4 h-4 text-indigo-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              isTr
                ? 'Komut çalıştır veya dosya ara (Simüle Et, Şematik, CDC, conv1d...)'
                : 'Type a command or search files (Simulate, Schematic, CDC, conv1d...)'
            }
            className="flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">ESC</span>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/60">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              {isTr ? 'Eşleşen komut veya dosya bulunamadı.' : 'No matching commands or files found.'}
            </div>
          ) : (
            filtered.map((it, idx) => {
              const Icon = it.icon;
              const active = idx === selectedIdx;
              return (
                <button
                  key={it.id}
                  type="button"
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={it.action}
                  className={`w-full px-4 py-2.5 text-left flex items-center justify-between gap-3 transition ${
                    active ? 'bg-indigo-600/20 text-white' : 'text-slate-300 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-indigo-400' : 'text-slate-400'}`} />
                    <span className="text-xs truncate">{isTr ? it.titleTr : it.titleEn}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-400 font-mono">
                      {isTr ? it.categoryTr : it.categoryEn}
                    </span>
                    {it.shortcut && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                        {it.shortcut}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
