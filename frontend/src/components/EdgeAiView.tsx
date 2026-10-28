import { ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  BrainCircuit, Cpu, Activity, Sparkles, ArrowRight, CheckCircle2, AlertTriangle, Play, Workflow, Code2, Loader2, Upload, FileCode2, FolderSearch, RefreshCw, Download, Layers,
} from 'lucide-react';
import { EdgeAiAnalysis, EdgeAiConfig, InspectedRtlInfo, WorkspaceInfo } from '../types';
import { errMsg, ws } from '../services/api';
import { useI18n } from '../i18n';

interface Props {
  info: WorkspaceInfo;
  onInjected: (updated: WorkspaceInfo | undefined, targetFile: string, targetCode: string, topMod: string, tbMod: string) => void;
  onRunSim: () => void;
  onRunSchematic: () => void;
}

const PRESETS: Record<string, { labelTr: string; labelEn: string; cfg: Omit<EdgeAiConfig, 'path'> }> = {
  ecg_qrs: {
    labelTr: 'ECG QRS & Aritmi 1D-CNN Çekirdeği (7-Tap)',
    labelEn: 'ECG QRS & Arrhythmia 1D-CNN Kernel (7-Tap)',
    cfg: {
      weights: [-0.125, -0.25, 0.375, 0.875, 0.375, -0.25, -0.125],
      bias: 0.0,
      int_bits: 2,
      frac_bits: 6,
      rounding: 'round',
      stimulus: 'ecg',
      activation: 'relu',
      threshold: 0.45,
      clock_mhz: 100,
      reuse_factor: 1,
    },
  },
  eeg_spike: {
    labelTr: 'EEG Epileptik Diken-Dalga (Spike) 1D-CNN Filtresi (5-Tap)',
    labelEn: 'EEG Seizure Spike-Wave 1D-CNN Extractor (5-Tap)',
    cfg: {
      weights: [-0.1875, 0.3125, 0.75, 0.3125, -0.1875],
      bias: 0.03125,
      int_bits: 2,
      frac_bits: 6,
      rounding: 'round',
      stimulus: 'eeg',
      activation: 'leaky_relu',
      threshold: 0.40,
      clock_mhz: 100,
      reuse_factor: 1,
    },
  },
  fir_denoise: {
    labelTr: 'Biyosinyal 50/60Hz Gürültü Bastırma FIR (5-Tap)',
    labelEn: 'Biosignal 50/60Hz Artifact Denoising FIR (5-Tap)',
    cfg: {
      weights: [0.09375, 0.21875, 0.375, 0.21875, 0.09375],
      bias: 0.0,
      int_bits: 2,
      frac_bits: 6,
      rounding: 'round',
      stimulus: 'ecg',
      activation: 'none',
      threshold: 0.50,
      clock_mhz: 100,
      reuse_factor: 1,
    },
  },
};

function SignalPlot({
  title,
  primary,
  secondary,
  primaryLabel,
  secondaryLabel,
  threshold,
  anomalies,
}: {
  title: string;
  primary: number[];
  secondary: number[];
  primaryLabel: string;
  secondaryLabel: string;
  threshold?: number;
  anomalies?: number[];
}) {
  const W = 680;
  const H = 135;
  const padX = 28;
  const padY = 16;
  const all = [...primary, ...secondary, ...(threshold !== undefined ? [threshold] : []), -0.2, 0.5];
  const minV = Math.min(...all);
  const maxV = Math.max(...all);
  const span = Math.max(0.001, maxV - minV);

  const toX = (i: number) => padX + (i / Math.max(1, primary.length - 1)) * (W - 2 * padX);
  const toY = (v: number) => H - padY - ((v - minV) / span) * (H - 2 * padY);

  const pathOf = (arr: number[]) =>
    arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');

  const zeroY = toY(0);
  const threshY = threshold !== undefined ? toY(threshold) : null;

  return (
    <div className="bg-darker/90 border border-slate-800 rounded-lg p-3 space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-200">{title}</span>
        <div className="flex items-center gap-3 text-[11px] font-mono">
          <span className="flex items-center gap-1 text-sky-300">
            <span className="w-2.5 h-0.5 bg-sky-400 inline-block" /> {primaryLabel}
          </span>
          <span className="flex items-center gap-1 text-emerald-300">
            <span className="w-2.5 h-0.5 bg-emerald-400 inline-block" /> {secondaryLabel}
          </span>
          {threshold !== undefined && (
            <span className="flex items-center gap-1 text-rose-300">
              <span className="w-2.5 h-0.5 bg-rose-400 inline-block" /> Threshold ({threshold})
            </span>
          )}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-32 overflow-visible">
        <line x1={padX} y1={zeroY} x2={W - padX} y2={zeroY} stroke="#1e293b" strokeWidth="1" />
        {threshY !== null && (
          <line
            x1={padX}
            y1={threshY}
            x2={W - padX}
            y2={threshY}
            stroke="#f43f5e"
            strokeWidth="1"
            strokeDasharray="4 3"
          />
        )}
        <path d={pathOf(primary)} fill="none" stroke="#38bdf8" strokeWidth="1.6" strokeDasharray="3 2" opacity={0.85} />
        <path d={pathOf(secondary)} fill="none" stroke="#10b981" strokeWidth="2" />
        {anomalies?.map((idx) => (
          <circle
            key={idx}
            cx={toX(idx)}
            cy={toY(secondary[idx] ?? 0)}
            r="3.8"
            fill="#f43f5e"
            stroke="#0f172a"
            strokeWidth="1.2"
          />
        ))}
      </svg>
    </div>
  );
}

export default function EdgeAiView({ info, onInjected, onRunSim, onRunSchematic }: Props) {
  const { lang } = useI18n();
  const isTr = lang === 'tr';

  // Two distinct workflow modes: 'preset' (Ready-made template) vs 'custom' (User's own RTL / Custom uploaded model)
  const rtlFiles = info.files.filter((f) => f.group === 'rtl' && !f.is_header);
  const [workflowMode, setWorkflowMode] = useState<'preset' | 'custom'>('preset');
  const [selectedRtlFile, setSelectedRtlFile] = useState<string>(rtlFiles[0]?.path || '');
  const [inspectedRtl, setInspectedRtl] = useState<InspectedRtlInfo | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [customModuleName, setCustomModuleName] = useState<string>('my_edge_cnn');
  const [customSignalText, setCustomSignalText] = useState<string>('');
  const [uploadNotice, setUploadNotice] = useState<string>('');
  const modelFileRef = useRef<HTMLInputElement>(null);

  const [cfg, setCfg] = useState<EdgeAiConfig>({
    path: info.root,
    ...PRESETS.ecg_qrs.cfg,
  });
  const [weightsText, setWeightsText] = useState(PRESETS.ecg_qrs.cfg.weights.join(', '));
  const [analysis, setAnalysis] = useState<EdgeAiAnalysis | null>(null);
  const [generating, setGenerating] = useState(false);
  const [injectedMsg, setInjectedMsg] = useState('');
  const [err, setErr] = useState('');

  // Keep selectedRtlFile synced when workspace changes
  useEffect(() => {
    if (rtlFiles.length > 0 && !rtlFiles.some((f) => f.path === selectedRtlFile)) {
      setSelectedRtlFile(rtlFiles[0].path);
    }
  }, [info.files, selectedRtlFile]);

  // Auto-inspect the user's selected RTL file when in 'custom' mode
  const inspectRtl = async (rtlPath: string, applyDetectedWeights = true) => {
    if (!rtlPath) return;
    setInspecting(true);
    setErr('');
    try {
      const res = await ws.edgeAiInspectRtl(info.root, rtlPath);
      setInspectedRtl(res);
      setCustomModuleName(res.module_name);
      if (applyDetectedWeights) {
        setCfg((prev) => ({
          ...prev,
          int_bits: res.int_bits,
          frac_bits: res.frac_bits,
          weights: res.has_rtl_weights && res.detected_weights.length > 0 ? res.detected_weights : prev.weights,
        }));
        if (res.has_rtl_weights && res.detected_weights.length > 0) {
          setWeightsText(res.detected_weights.join(', '));
        }
      }
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setInspecting(false);
    }
  };

  useEffect(() => {
    if (workflowMode === 'custom' && selectedRtlFile) {
      inspectRtl(selectedRtlFile, true);
    }
  }, [workflowMode, selectedRtlFile, info.root]);

  useEffect(() => {
    let active = true;
    ws.edgeAiAnalyze({ ...cfg, path: info.root })
      .then((res) => {
        if (active) setAnalysis(res);
      })
      .catch((e) => {
        if (active) setErr(errMsg(e));
      });
    return () => {
      active = false;
    };
  }, [cfg, info.root]);

  const applyPreset = (key: string) => {
    const p = PRESETS[key];
    if (!p) return;
    setWeightsText(p.cfg.weights.join(', '));
    setCfg({ path: info.root, ...p.cfg });
    setInjectedMsg('');
    setUploadNotice('');
  };

  const onWeightsBlur = () => {
    const parsed = weightsText
      .replace(/[\[\]]/g, '')
      .split(/[\s,]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
    if (parsed.length > 0) {
      setCfg((c) => ({ ...c, weights: parsed.slice(0, 16) }));
    }
  };

  const onCustomSignalBlur = () => {
    const parsed = customSignalText
      .replace(/[\[\]]/g, '')
      .split(/[\s,;]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
    if (parsed.length >= 4) {
      setCfg((c) => ({ ...c, stimulus: 'custom', custom_signal: parsed.slice(0, 256) }));
    }
  };

  const downloadTextFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleModelFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr('');
    setUploadNotice('');
    try {
      const imp = await ws.edgeAiImportModel(file);
      if (imp.weights && imp.weights.length > 0) {
        setWeightsText(imp.weights.join(', '));
      }
      if (imp.signal && imp.signal.length > 0) {
        setCustomSignalText(imp.signal.slice(0, 64).join(', '));
      }
      setCfg((c) => ({
        ...c,
        weights: imp.weights && imp.weights.length > 0 ? imp.weights.slice(0, 16) : c.weights,
        bias: typeof imp.bias === 'number' ? imp.bias : c.bias,
        stimulus: imp.signal && imp.signal.length >= 4 ? 'custom' : c.stimulus,
        custom_signal: imp.signal && imp.signal.length >= 4 ? imp.signal.slice(0, 256) : c.custom_signal,
        bn_enabled: typeof imp.bn_gamma === 'number' || typeof imp.bn_var === 'number' ? true : c.bn_enabled,
        bn_gamma: typeof imp.bn_gamma === 'number' ? imp.bn_gamma : c.bn_gamma,
        bn_beta: typeof imp.bn_beta === 'number' ? imp.bn_beta : c.bn_beta,
        bn_mean: typeof imp.bn_mean === 'number' ? imp.bn_mean : c.bn_mean,
        bn_var: typeof imp.bn_var === 'number' ? imp.bn_var : c.bn_var,
      }));
      setUploadNotice(
        isTr
          ? `✓ [${imp.format}] ${imp.filename} yüklendi` +
              (imp.weights ? ` (${imp.weights.length} çekirdek ağırlığı)` : '') +
              (imp.signal ? ` (${imp.signal.length} sinyal örneği)` : '')
          : `✓ [${imp.format}] Loaded ${imp.filename}` +
              (imp.weights ? ` (${imp.weights.length} weights)` : '') +
              (imp.signal ? ` (${imp.signal.length} signal samples)` : '')
      );
      return;
    } catch (ex: any) {
      setErr(ex?.message || String(ex));
      return;
    }
  };

  const handleGenerate = async (targetMode: 'preset' | 'custom_tb_only' | 'custom_rtl_and_tb') => {
    setGenerating(true);
    setErr('');
    setInjectedMsg('');
    try {
      const payload: EdgeAiConfig = {
        ...cfg,
        path: info.root,
        target_mode: targetMode,
        custom_rtl_file: targetMode === 'custom_tb_only' ? selectedRtlFile : undefined,
        module_name:
          targetMode === 'preset'
            ? 'conv1d_biosignal'
            : targetMode === 'custom_tb_only'
            ? inspectedRtl?.module_name || customModuleName
            : customModuleName || 'my_edge_cnn',
      };
      const res = await ws.edgeAiGenerate(payload);
      setAnalysis(res.analysis);
      if (targetMode === 'custom_tb_only') {
        onInjected(res.workspace, res.tb_file, res.tb_code, res.top_module, res.tb_module);
        setInjectedMsg(
          isTr
            ? `✓ Kendi RTL dosyanız (${res.rtl_file} — ${res.top_module}) korundu ve yalnızca ona özel Golden Testbench (${res.tb_file}) üretildi! Şimdi Simüle Et (F5) ile kendi modülünüzü test edebilirsiniz.`
            : `✓ Preserved your RTL (${res.rtl_file} — ${res.top_module}) and generated its dedicated Golden Testbench (${res.tb_file})! Click Simulate (F5) to verify your module.`
        );
      } else {
        onInjected(res.workspace, res.rtl_file, res.rtl_code, res.top_module, res.tb_module);
        setInjectedMsg(
          isTr
            ? `✓ ${res.rtl_file} ve ${res.tb_file} (${res.analysis.q_format} bit-exact golden testbench) projeye aktarıldı! Şimdi F5 (Simüle Et) veya F6 (Şematik) çalıştırabilirsiniz.`
            : `✓ Generated ${res.rtl_file} & ${res.tb_file} (${res.analysis.q_format} bit-exact golden testbench) into workspace! Click Simulate (F5) or Schematic (F6).`
        );
      }
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setGenerating(false);
    }
  };

  const sqnrBadge = (db: number) =>
    db >= 30
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
      : db >= 18
      ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
      : 'bg-red-500/15 text-red-300 border-red-500/40';

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* Header & Mode Switcher */}
      <div className="card border-indigo-500/30 bg-gradient-to-r from-indigo-950/30 via-slate-900/90 to-emerald-950/20 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-indigo-400" />
              <h2 className="font-bold text-base text-slate-100">
                {isTr
                  ? 'Edge AI & Biyosinyal (1D-CNN / DSP) Donanım Ortak-Tasarım Stüdyosu'
                  : 'Edge AI & Biosignal (1D-CNN / DSP) Hardware Co-Design Studio'}
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/40">
                PyTorch/NumPy Float32 ➔ Fixed-Point Qm.n RTL
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {isTr
                ? 'İster hazır biyomedikal 1D-CNN şablonlarıyla sıfırdan donanım sentezleyin, ister kendi yazdığınız RTL (.sv/.v/.vhd) ve kendi model ağırlıklarınızı yükleyip doğrulayın.'
                : 'Test with ready-made biomedical 1D-CNN templates OR auto-detect your own workspace RTL (.sv/.v/.vhd) and import your own custom model weights/signals.'}
            </p>
          </div>
        </div>

        {/* 2-Way Mode Selector: Ready-Made Preset vs User's Own RTL/Model */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => {
              setWorkflowMode('preset');
              setInjectedMsg('');
            }}
            className={`text-left p-3 rounded-xl border transition flex items-start justify-between gap-3 ${
              workflowMode === 'preset'
                ? 'bg-indigo-600/20 border-indigo-400 text-white shadow-glow'
                : 'bg-darker/70 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
            }`}
          >
            <div className="space-y-0.5">
              <div className="text-xs font-bold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                {isTr ? '1. Hazır Biyomedikal Model & Şablonla Test Et' : '1. Test with Ready-Made Biomedical Templates'}
              </div>
              <p className="text-[11px] text-slate-400">
                {isTr
                  ? 'Hazır ECG QRS, EEG Spike veya FIR şablonlarından sıfırdan `rtl/conv1d_biosignal.sv` ve `tb/tb_conv1d_biosignal.sv` sentezler.'
                  : 'Synthesizes standalone `rtl/conv1d_biosignal.sv` & `tb/tb_conv1d_biosignal.sv` from curated ECG/EEG templates.'}
              </p>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${workflowMode === 'preset' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400'}`}>
              {isTr ? 'Hazır Model' : 'Preset'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setWorkflowMode('custom');
              setInjectedMsg('');
            }}
            className={`text-left p-3 rounded-xl border transition flex items-start justify-between gap-3 ${
              workflowMode === 'custom'
                ? 'bg-emerald-600/20 border-emerald-400 text-white shadow-glow'
                : 'bg-darker/70 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
            }`}
          >
            <div className="space-y-0.5">
              <div className="text-xs font-bold flex items-center gap-2">
                <FileCode2 className="w-4 h-4 text-emerald-400" />
                {isTr ? '2. Kendi RTL Dosyam & Kendi Modelimle Çalış' : '2. Work with My Own RTL & Custom Model'}
              </div>
              <p className="text-[11px] text-slate-400">
                {isTr
                  ? 'Projendeki mevcut `.sv/.v/.vhd` dosyalarının portlarını/ağırlıklarını algılar veya dışarıdan `.pkl, .npy, .npz, .pt, .json, .csv, .coe` model yükleyip Golden TB üretir.'
                  : 'Auto-detects your existing `.sv/.v/.vhd` ports & weights or imports `.pkl, .npy, .npz, .pt, .json, .csv, .coe` models to generate a Golden TB for your own RTL.'}
              </p>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${workflowMode === 'custom' ? 'bg-emerald-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-400'}`}>
              {isTr ? 'Kendi Modülüm' : 'Custom RTL'}
            </span>
          </button>
        </div>
      </div>

      {/* Mode-Specific Action Panel */}
      {workflowMode === 'preset' ? (
        <div className="card border-indigo-500/30 bg-indigo-950/15 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-300 space-y-0.5">
            <div className="font-semibold text-indigo-300">
              {isTr ? 'Hazır Şablon Sentezleyici Modu Aktif' : 'Preset Template Synthesizer Mode Active'}
            </div>
            <div className="text-[11px] text-slate-400">
              {isTr
                ? 'Aşağıdan hazır ECG/EEG/FIR şablonunu ve Qm.n bit genişliğini seçin; tek tıkla `rtl/conv1d_biosignal.sv` ve `tb/tb_conv1d_biosignal.sv` projenize eklensin.'
                : 'Choose a preset kernel and Qm.n bit-width below, then generate `rtl/conv1d_biosignal.sv` and `tb/tb_conv1d_biosignal.sv`.'}
            </div>
          </div>
          <button
            onClick={() => handleGenerate('preset')}
            disabled={generating}
            className="btn-primary text-xs flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 shadow-glow"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {isTr ? 'Hazır Model RTL + Golden TB Üret (conv1d_biosignal)' : 'Generate Preset RTL + Golden TB (conv1d_biosignal)'}
          </button>
        </div>
      ) : (
        <div className="card border-emerald-500/40 bg-emerald-950/10 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div className="text-xs font-semibold text-emerald-300 flex items-center gap-2">
              <FolderSearch className="w-4 h-4" />
              {isTr
                ? 'Projendeki Mevcut RTL Dosyasını Algıla & Dışarıdan Kendi Modelini Yükle'
                : 'Auto-Detect Workspace RTL & Import Custom Model / Signal'}
            </div>
            <button
              type="button"
              onClick={() => modelFileRef.current?.click()}
              className="tool-btn bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/40 text-xs flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              {isTr ? 'Python Modeli / Sinyal Yükle (.pkl, .npy, .npz, .pt, .json, .csv, .coe)' : 'Import Python Model / Signal (.pkl, .npy, .npz, .pt, .json, .csv, .coe)'}
            </button>
            {analysis?.python_export_script && (
              <button
                type="button"
                onClick={() => downloadTextFile('export_to_circuitvr.py', analysis.python_export_script!)}
                className="tool-btn bg-indigo-950/60 hover:bg-indigo-900/70 text-indigo-300 border border-indigo-500/40 text-xs flex items-center gap-1.5"
                title={isTr ? 'PyTorch / Scikit-Learn / NumPy modellerini tek komutla dışa aktaran Python betiğini indir' : 'Download Python helper script for PyTorch / Sklearn / NumPy'}
              >
                <Download className="w-3.5 h-3.5" />
                {isTr ? '🐍 export_to_circuitvr.py İndir' : '🐍 Download export_to_circuitvr.py'}
              </button>
            )}
          </div>

          {uploadNotice && (
            <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-500/30 rounded-lg px-3 py-2 font-mono">
              {uploadNotice}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
            {/* Left: Existing Workspace RTL Inspector */}
            <div className="bg-darker/90 border border-slate-800 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">
                  {isTr ? 'A) Projendeki RTL Dosyasını Seç (.sv / .v / .vhd)' : 'A) Select Your Workspace RTL File (.sv / .v / .vhd)'}
                </span>
                <button
                  type="button"
                  onClick={() => inspectRtl(selectedRtlFile, true)}
                  disabled={inspecting || !selectedRtlFile}
                  className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${inspecting ? 'animate-spin' : ''}`} />
                  {isTr ? 'Yeniden Algıla' : 'Re-scan RTL'}
                </button>
              </div>

              {rtlFiles.length > 0 ? (
                <>
                  <select
                    value={selectedRtlFile}
                    onChange={(e) => setSelectedRtlFile(e.target.value)}
                    className="input-field text-xs py-1.5 font-mono"
                  >
                    {rtlFiles.map((f) => (
                      <option key={f.path} value={f.path}>
                        {f.path}
                      </option>
                    ))}
                  </select>

                  {inspectedRtl && (
                    <div className="text-[11px] bg-slate-900/90 border border-slate-800 rounded p-2.5 space-y-1 font-mono">
                      <div className="text-emerald-300 font-semibold">
                        ✓ {isTr ? inspectedRtl.summary_tr : inspectedRtl.summary_en}
                      </div>
                      <div className="text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
                        <span>Modül: <strong className="text-slate-200">{inspectedRtl.module_name}</strong></span>
                        <span>Clk/Rst: <strong className="text-slate-200">{inspectedRtl.clk_port || '—'} / {inspectedRtl.rst_port || '—'}</strong></span>
                        <span>Giriş: <strong className="text-sky-300">{inspectedRtl.data_in_ports.join(', ') || '—'}</strong></span>
                        <span>Çıkış: <strong className="text-amber-300">{inspectedRtl.data_out_port}</strong></span>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-[11px] text-amber-300 bg-amber-950/20 border border-amber-500/30 rounded p-2">
                  {isTr
                    ? 'Projenin rtl/ klasöründe henüz dosya yok. Sol üstten kendi .sv/.v/.vhd dosyanızı yükleyebilir veya sağdaki butonla kendi modelinizden yeni RTL üretebilirsiniz.'
                    : 'No files in rtl/ yet. Upload your .sv/.v/.vhd file or synthesize a new custom RTL module on the right.'}
                </div>
              )}
            </div>

            {/* Right: Two Distinct Generation Actions for Custom Mode */}
            <div className="bg-darker/90 border border-slate-800 rounded-lg p-3 space-y-2.5 flex flex-col justify-between">
              <div className="space-y-1.5">
                <span className="font-semibold text-slate-200 block">
                  {isTr ? 'B) Kendi Dosyaların İçin Ne Üretilsin?' : 'B) Choose Custom Generation Target'}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400 whitespace-nowrap">
                    {isTr ? 'Hedef Modül Adı:' : 'Target Module Name:'}
                  </span>
                  <input
                    type="text"
                    value={customModuleName}
                    onChange={(e) => setCustomModuleName(e.target.value)}
                    className="input-field text-xs py-1 font-mono"
                    placeholder="my_edge_cnn"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => handleGenerate('custom_tb_only')}
                  disabled={generating || !selectedRtlFile}
                  className="btn-primary text-xs flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 py-2"
                >
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {isTr
                    ? `Sadece Seçili RTL'im (${inspectedRtl?.module_name || 'dut'}) İçin Golden Testbench Üret (RTL'ime Dokunma)`
                    : `Generate Golden TB Only for My RTL (${inspectedRtl?.module_name || 'dut'})`}
                </button>

                <button
                  type="button"
                  onClick={() => handleGenerate('custom_rtl_and_tb')}
                  disabled={generating}
                  className="tool-btn justify-center text-xs py-2 bg-indigo-600/25 hover:bg-indigo-600/40 text-indigo-200 border border-indigo-500/40"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {isTr
                    ? `Kendi Ağırlıklarımdan Yeni RTL (rtl/${customModuleName || 'my_edge_cnn'}.sv) + Golden TB Sentezle`
                    : `Synthesize New Custom RTL (rtl/${customModuleName || 'my_edge_cnn'}.sv) + Golden TB`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {injectedMsg && (
        <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs text-emerald-200">
          <span className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            {injectedMsg}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onRunSim} className="tool-btn bg-green-600 hover:bg-green-500 text-white">
              <Play className="w-3.5 h-3.5" /> {isTr ? 'Hemen Simüle Et (ECG/EEG Waveform)' : 'Simulate Now (Waveform)'}
            </button>
            <button onClick={onRunSchematic} className="tool-btn bg-primary hover:bg-blue-500 text-white">
              <Workflow className="w-3.5 h-3.5" /> {isTr ? 'MAC Şematiğini Çiz (Yosys)' : 'Generate MAC Schematic'}
            </button>
          </div>
        </div>
      )}

      {err && <div className="text-xs text-red-400 bg-red-950/20 border border-red-500/30 rounded-lg p-3">{err}</div>}

      {/* Configuration Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Column 1: Presets & Float Weights */}
        <div className="card space-y-3">
          <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-sky-400" />
            {isTr ? '1. 1D-CNN Çekirdek Ağırlıkları & Giriş Sinyali' : '1. 1D-CNN Kernel Weights & Input Stimulus'}
          </div>

          {workflowMode === 'preset' && (
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-400">{isTr ? 'Hazır Biyomedikal / DSP Şablonu' : 'Biomedical / DSP Preset'}</label>
              <div className="grid grid-cols-1 gap-1.5">
                {Object.entries(PRESETS).map(([k, p]) => (
                  <button
                    key={k}
                    onClick={() => applyPreset(k)}
                    className="text-left px-2.5 py-1.5 rounded-lg bg-darker hover:bg-indigo-500/15 border border-slate-700/80 hover:border-indigo-500/40 text-xs text-slate-200 transition"
                  >
                    {isTr ? p.labelTr : p.labelEn}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] text-slate-400">
                {isTr ? 'Python / PyTorch Float32 Ağırlık Dizisi (virgülle)' : 'Python / PyTorch Float32 Weights (comma-separated)'}
              </label>
              <button
                type="button"
                onClick={() => modelFileRef.current?.click()}
                className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 flex items-center gap-1"
                title={isTr ? 'Python .pkl, .npy, .npz, .pt, .json, .csv, .coe model dosyası yükle' : 'Upload Python .pkl, .npy, .npz, .pt, .json, .csv, .coe model file'}
              >
                <Upload className="w-3 h-3" />
                {isTr ? 'Dosyadan Yükle (.pkl/.npy/.pt/.json/.csv)' : 'Upload File (.pkl/.npy/.pt/.json/.csv)'}
              </button>
            </div>
            <input
              ref={modelFileRef}
              type="file"
              accept=".pkl,.pickle,.npy,.npz,.pt,.pth,.json,.csv,.txt,.mem,.coe"
              className="hidden"
              onChange={handleModelFileUpload}
            />
            {uploadNotice && (
              <div className="text-[11px] text-emerald-300 bg-emerald-950/40 border border-emerald-500/30 rounded px-2 py-1 font-mono">
                {uploadNotice}
              </div>
            )}
            <textarea
              rows={2}
              value={weightsText}
              onChange={(e) => setWeightsText(e.target.value)}
              onBlur={onWeightsBlur}
              className="input-field font-mono text-xs"
              placeholder="-0.125, -0.25, 0.375, 0.875, 0.375, -0.25, -0.125"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="space-y-1">
              <span className="text-[11px] text-slate-400">{isTr ? 'Giriş Sinyali (Testbench)' : 'Input Stimulus'}</span>
              <select
                value={cfg.stimulus}
                onChange={(e) => setCfg({ ...cfg, stimulus: e.target.value as EdgeAiConfig['stimulus'] })}
                className="input-field text-xs py-1.5"
              >
                <option value="ecg">{isTr ? 'ECG (QRS + Aritmi)' : 'ECG (QRS + Arrhythmia)'}</option>
                <option value="eeg">{isTr ? 'EEG (Alpha + Epileptik Diken)' : 'EEG (Alpha + Seizure Spike)'}</option>
                <option value="sine_noise">{isTr ? 'Sinüs + Yüksek Frekans Gürültü' : 'Sine + HF Noise'}</option>
                <option value="custom">{isTr ? 'Kendi Sinyal Verim (Özel Dizi)' : 'My Custom Signal Array'}</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-slate-400">{isTr ? 'Donanım Aktivasyonu' : 'Hardware Activation'}</span>
              <select
                value={cfg.activation}
                onChange={(e) => setCfg({ ...cfg, activation: e.target.value as EdgeAiConfig['activation'] })}
                className="input-field text-xs py-1.5"
              >
                <option value="relu">ReLU (Sign-bit Mux)</option>
                <option value="leaky_relu">Leaky ReLU (x &gt;&gt;&gt; 3)</option>
                <option value="sigmoid_lut">Sigmoid (PWL Shift-Add)</option>
                <option value="none">{isTr ? 'Yok (Doğrusal FIR)' : 'None (Linear FIR)'}</option>
              </select>
            </label>
          </div>

          {cfg.stimulus === 'custom' && (
            <div className="space-y-1">
              <label className="text-[11px] text-emerald-300">
                {isTr ? 'Özel Testbench Giriş Sinyali Örnekleri (virgülle)' : 'Custom Testbench Input Samples (comma-separated)'}
              </label>
              <textarea
                rows={2}
                value={customSignalText}
                onChange={(e) => setCustomSignalText(e.target.value)}
                onBlur={onCustomSignalBlur}
                className="input-field font-mono text-xs"
                placeholder="0.1, 0.25, 0.85, -0.2, 0.05, ..."
              />
            </div>
          )}
          {/* PyTorch / Keras BatchNorm1d Folding Engine */}
          <div className="bg-darker/90 border border-slate-800 rounded-lg p-2.5 space-y-2 text-xs">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="font-medium text-indigo-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" />
                {isTr ? 'PyTorch BatchNorm1d Katlama (Fold into Conv1D)' : 'Fold PyTorch BatchNorm1d into Conv1D'}
              </span>
              <input
                type="checkbox"
                checked={!!cfg.bn_enabled}
                onChange={(e) => setCfg({ ...cfg, bn_enabled: e.target.checked })}
                className="accent-indigo-500"
              />
            </label>
            {cfg.bn_enabled && (
              <div className="grid grid-cols-4 gap-1.5 pt-1 text-[11px] font-mono">
                <label className="space-y-0.5">
                  <span className="text-slate-400">γ (gamma)</span>
                  <input
                    type="number"
                    step="0.1"
                    value={cfg.bn_gamma ?? 1.0}
                    onChange={(e) => setCfg({ ...cfg, bn_gamma: Number(e.target.value) })}
                    className="input-field text-[11px] py-1"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-slate-400">β (beta)</span>
                  <input
                    type="number"
                    step="0.05"
                    value={cfg.bn_beta ?? 0.0}
                    onChange={(e) => setCfg({ ...cfg, bn_beta: Number(e.target.value) })}
                    className="input-field text-[11px] py-1"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-slate-400">μ (mean)</span>
                  <input
                    type="number"
                    step="0.05"
                    value={cfg.bn_mean ?? 0.0}
                    onChange={(e) => setCfg({ ...cfg, bn_mean: Number(e.target.value) })}
                    className="input-field text-[11px] py-1"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-slate-400">σ² (var)</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0.001"
                    value={cfg.bn_var ?? 1.0}
                    onChange={(e) => setCfg({ ...cfg, bn_var: Math.max(0.0001, Number(e.target.value) || 1.0) })}
                    className="input-field text-[11px] py-1"
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Column 2: Fixed-Point Qm.n & Bit-Growth */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Code2 className="w-4 h-4 text-emerald-400" />
              {isTr ? '2. Sabit Nokta (Qm.n) & Bit-Genişleme' : '2. Fixed-Point (Qm.n) & Bit-Growth'}
            </span>
            {analysis && (
              <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono text-xs font-bold">
                {analysis.q_format} ({analysis.total_bits}-bit)
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>{isTr ? 'Tam Sayı Biti (m)' : 'Integer Bits (m)'}</span>
                <span className="font-mono text-slate-200">{cfg.int_bits} bit</span>
              </div>
              <input
                type="range"
                min={1}
                max={8}
                value={cfg.int_bits}
                onChange={(e) => setCfg({ ...cfg, int_bits: Number(e.target.value) })}
                className="w-full accent-indigo-500"
              />
            </label>

            <label className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>{isTr ? 'Kesir Biti (n)' : 'Fractional Bits (n)'}</span>
                <span className="font-mono text-slate-200">{cfg.frac_bits} bit</span>
              </div>
              <input
                type="range"
                min={2}
                max={14}
                value={cfg.frac_bits}
                onChange={(e) => setCfg({ ...cfg, frac_bits: Number(e.target.value) })}
                className="w-full accent-emerald-500"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="space-y-1">
              <span className="text-[11px] text-slate-400">{isTr ? 'Yuvarlama Modu' : 'Rounding Mode'}</span>
              <select
                value={cfg.rounding}
                onChange={(e) => setCfg({ ...cfg, rounding: e.target.value as EdgeAiConfig['rounding'] })}
                className="input-field text-xs py-1.5"
              >
                <option value="round">{isTr ? 'Round-Half-Up (+0.5 LSB)' : 'Round-Half-Up (+0.5 LSB)'}</option>
                <option value="rne">{isTr ? 'Yakınsak / Çifte Yuvarla (RNE - IEEE)' : 'Round-to-Nearest-Even (RNE)'}</option>
                <option value="trunc">{isTr ? 'Doğrudan Kesme (Truncate)' : 'Direct Truncation'}</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-slate-400">{isTr ? 'Taşma (Overflow) Modu' : 'Overflow Mode'}</span>
              <select
                value={cfg.overflow_mode ?? 'saturate'}
                onChange={(e) => setCfg({ ...cfg, overflow_mode: e.target.value as EdgeAiConfig['overflow_mode'] })}
                className="input-field text-xs py-1.5"
              >
                <option value="saturate">{isTr ? 'Doyma / Clamping (Saturate)' : 'Saturate (Clamping)'}</option>
                <option value="wrap">{isTr ? '2\'s Complement Wrap-Around' : 'Wrap-Around (No Clamp)'}</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="space-y-1">
              <span className="text-[11px] text-slate-400">{isTr ? 'Donanım Mimarisi (RTL)' : 'Hardware Architecture'}</span>
              <select
                value={cfg.arch_mode ?? 'parallel'}
                onChange={(e) => setCfg({ ...cfg, arch_mode: e.target.value as EdgeAiConfig['arch_mode'] })}
                className="input-field text-xs py-1.5"
              >
                <option value="parallel">{isTr ? 'Paralel Çarpıcı Ağacı (1-Cycle)' : 'Parallel Adder Tree (1-Cycle)'}</option>
                <option value="bram_rom">{isTr ? 'BRAM / LUTRAM ($readmemh .mem)' : 'BRAM / LUTRAM ($readmemh .mem)'}</option>
                <option value="serial_folded">{isTr ? 'Zaman-Çoğullamalı Seri MAC (1 PE)' : 'Time-Multiplexed Serial MAC'}</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-slate-400">{isTr ? 'Anomali Eşiği (Threshold)' : 'Anomaly Threshold'}</span>
              <input
                type="number"
                step="0.05"
                value={cfg.threshold}
                onChange={(e) => setCfg({ ...cfg, threshold: Number(e.target.value) || 0.3 })}
                className="input-field text-xs py-1.5 font-mono"
              />
            </label>
          </div>

          {analysis && (
            <div className="bg-darker/90 border border-slate-800 rounded-lg p-2.5 space-y-1.5 text-[11px] font-mono">
              <div className="text-slate-400 flex justify-between">
                <span>{isTr ? 'Temsil Aralığı:' : 'Dynamic Range:'}</span>
                <span className="text-slate-200">[{analysis.min_real}, +{analysis.max_real}] (LSB={analysis.lsb_step})</span>
              </div>
              <div className="text-slate-400 flex items-center justify-between gap-1 pt-1 border-t border-slate-800">
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-300">{analysis.bit_growth.input_q}</span>
                <ArrowRight className="w-3 h-3 text-slate-500" />
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-amber-300">{analysis.bit_growth.product_q}</span>
                <ArrowRight className="w-3 h-3 text-slate-500" />
                <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-bold">{analysis.bit_growth.acc_q}</span>
              </div>
              <div className="text-[10px] text-slate-400">{analysis.bit_growth.formula}</div>
            </div>
          )}

          {analysis?.pareto_front && analysis.pareto_front.length > 0 && (
            <div className="bg-indigo-950/20 border border-indigo-500/30 rounded-lg p-2.5 space-y-2 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-indigo-300">
                  {isTr ? '🎯 Pareto SQNR vs LUT Otomatik Bit-Genişliği Analizi' : '🎯 Pareto SQNR vs LUT Auto-Tuner'}
                </span>
                {(() => {
                  const rec = analysis.pareto_front.find((p) => p.recommended);
                  if (!rec) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => setCfg((c) => ({ ...c, int_bits: rec.int_bits, frac_bits: rec.frac_bits }))}
                      className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-[10px] transition"
                    >
                      {isTr ? `Oto-Seç: ${rec.q_format} (${rec.inference_sqnr_db} dB)` : `Auto-Tune: ${rec.q_format} (${rec.inference_sqnr_db} dB)`}
                    </button>
                  );
                })()}
              </div>
              <div className="flex flex-wrap gap-1.5 font-mono">
                {analysis.pareto_front.map((p) => {
                  const active = cfg.int_bits === p.int_bits && cfg.frac_bits === p.frac_bits;
                  return (
                    <button
                      key={p.q_format}
                      type="button"
                      onClick={() => setCfg((c) => ({ ...c, int_bits: p.int_bits, frac_bits: p.frac_bits }))}
                      className={`px-2 py-1 rounded border text-[10px] transition flex items-center gap-1 ${
                        active
                          ? 'bg-indigo-600/30 border-indigo-400 text-white'
                          : p.recommended
                          ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/25'
                          : 'bg-darker border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                      title={`SQNR: ${p.inference_sqnr_db} dB | ~${p.est_luts} LUT | Clip: ${p.clipped}`}
                    >
                      <span>{p.q_format}</span>
                      <span className={p.inference_sqnr_db >= 30 ? 'text-emerald-400' : 'text-amber-400'}>
                        {p.inference_sqnr_db}dB
                      </span>
                      <span className="text-slate-500">({p.est_luts}L)</span>
                      {p.recommended && <span className="text-emerald-300">★</span>}
                    </button>
                  );
                })}
              </div>
              {(() => {
                const pts = analysis.pareto_front;
                const minLut = Math.min(...pts.map((p) => p.est_luts), 10);
                const maxLut = Math.max(...pts.map((p) => p.est_luts), minLut + 10);
                const minDb = 0;
                const maxDb = Math.max(...pts.map((p) => p.inference_sqnr_db), 45);
                const W = 320;
                const H = 86;
                const px = (lut: number) => 26 + ((lut - minLut) / Math.max(1, maxLut - minLut)) * (W - 48);
                const py = (db: number) => H - 16 - ((Math.min(maxDb, Math.max(minDb, db)) - minDb) / Math.max(1, maxDb - minDb)) * (H - 28);
                const sorted = [...pts].sort((a, b) => a.est_luts - b.est_luts);
                const linePath = sorted.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.est_luts).toFixed(1)},${py(p.inference_sqnr_db).toFixed(1)}`).join(' ');
                const y30 = py(30);
                return (
                  <div className="bg-slate-950/80 border border-slate-800/80 rounded p-1.5">
                    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20 overflow-visible">
                      <line x1={26} y1={y30} x2={W - 14} y2={y30} stroke="#10b981" strokeWidth="0.8" strokeDasharray="3 2" opacity={0.5} />
                      <text x={W - 12} y={y30 + 3} textAnchor="end" className="fill-emerald-400/70 text-[7px] font-mono">30dB Hedef</text>
                      <path d={linePath} fill="none" stroke="#6366f1" strokeWidth="1.3" opacity={0.75} />
                      {sorted.map((p) => {
                        const isSel = cfg.int_bits === p.int_bits && cfg.frac_bits === p.frac_bits;
                        const cx = px(p.est_luts);
                        const cy = py(p.inference_sqnr_db);
                        return (
                          <g
                            key={p.q_format}
                            className="cursor-pointer"
                            onClick={() => setCfg((c) => ({ ...c, int_bits: p.int_bits, frac_bits: p.frac_bits }))}
                          >
                            <circle
                              cx={cx}
                              cy={cy}
                              r={isSel ? 4.5 : p.recommended ? 4 : 3}
                              fill={isSel ? '#38bdf8' : p.recommended ? '#10b981' : '#94a3b8'}
                              stroke="#0f172a"
                              strokeWidth="1"
                            />
                            <text x={cx} y={cy - 5} textAnchor="middle" className="fill-slate-300 text-[7px] font-mono">
                              {p.q_format}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Column 3: Roofline & Silicon Resource Estimator */}
        <div className="card space-y-3">
          <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-amber-400" />
            {isTr ? '3. Donanım Roofline & FPGA Kaynak Tahmini' : '3. Hardware Roofline & FPGA Silicon Estimate'}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="space-y-1">
              <span className="text-[11px] text-slate-400">{isTr ? 'Hedef Saat (MHz)' : 'Target Clock (MHz)'}</span>
              <input
                type="number"
                min={10}
                max={500}
                value={cfg.clock_mhz}
                onChange={(e) => setCfg({ ...cfg, clock_mhz: Number(e.target.value) || 100 })}
                className="input-field text-xs py-1.5 font-mono"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-slate-400">{isTr ? 'Reuse Factor (Zaman Çoğullama)' : 'Reuse Factor (Folding)'}</span>
              <input
                type="number"
                min={1}
                max={8}
                value={cfg.reuse_factor}
                onChange={(e) => setCfg({ ...cfg, reuse_factor: Math.max(1, Number(e.target.value) || 1) })}
                className="input-field text-xs py-1.5 font-mono"
              />
            </label>
          </div>

          {analysis && (
            <>
              <div className="grid grid-cols-3 gap-2 text-center font-mono">
                <div className="bg-darker border border-slate-800 rounded p-2">
                  <div className="text-sm font-bold text-sky-300">{analysis.roofline.latency_ns} ns</div>
                  <div className="text-[10px] text-slate-400">{isTr ? 'Gecikme' : 'Latency'}</div>
                </div>
                <div className="bg-darker border border-slate-800 rounded p-2">
                  <div className="text-sm font-bold text-emerald-300">{analysis.roofline.dsp_blocks} DSP48</div>
                  <div className="text-[10px] text-slate-400">~{analysis.roofline.est_luts} LUT</div>
                </div>
                <div className="bg-darker border border-slate-800 rounded p-2">
                  <div className="text-sm font-bold text-indigo-300">{analysis.roofline.gops} GOPS</div>
                  <div className="text-[10px] text-slate-400">{analysis.roofline.throughput_msps} MS/s</div>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 bg-darker/70 border border-slate-800 rounded p-2 leading-snug">
                {analysis.roofline.dsp_note}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Quantization SQNR & Plots */}
      {analysis && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className={`rounded-lg border p-3 flex items-center justify-between ${sqnrBadge(analysis.weight_sqnr_db)}`}>
              <div>
                <div className="text-[11px] uppercase font-mono opacity-80">{isTr ? 'Ağırlık Niceleme SQNR' : 'Weight Quantization SQNR'}</div>
                <div className="text-xl font-bold font-mono">{analysis.weight_sqnr_db} dB</div>
              </div>
              <span className="text-xs font-mono">MaxErr: {analysis.weight_max_err}</span>
            </div>

            <div className={`rounded-lg border p-3 flex items-center justify-between ${sqnrBadge(analysis.inference_sqnr_db)}`}>
              <div>
                <div className="text-[11px] uppercase font-mono opacity-80">{isTr ? 'Uçtan Uca Çıkarım SQNR' : 'End-to-End Inference SQNR'}</div>
                <div className="text-xl font-bold font-mono">{analysis.inference_sqnr_db} dB</div>
              </div>
              <span className="text-xs font-mono">{analysis.series.anomaly_indices.length} spike trigger</span>
            </div>

            <div
              className={`rounded-lg border p-3 flex items-center justify-between ${
                analysis.clipped_weights > 0
                  ? 'bg-red-500/15 text-red-300 border-red-500/40'
                  : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
              }`}
            >
              <div>
                <div className="text-[11px] uppercase font-mono opacity-80">{isTr ? 'Doyma / Kırpılma (Clipping)' : 'Weight Clipping Risk'}</div>
                <div className="text-xl font-bold font-mono">
                  {analysis.clipped_weights > 0
                    ? `${analysis.clipped_weights} ${isTr ? 'Ağırlık Taştı!' : 'Clipped!'}`
                    : isTr
                    ? '0 Taşma (Güvenli)'
                    : '0 Clipped (Safe)'}
                </div>
              </div>
              {analysis.clipped_weights > 0 ? <AlertTriangle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SignalPlot
              title={
                isTr
                  ? `Giriş Biyosinyali (${analysis.series.stimulus.toUpperCase()} — ${analysis.series.input_float.length} Örnek)`
                  : `Input Biosignal (${analysis.series.stimulus.toUpperCase()} — ${analysis.series.input_float.length} Samples)`
              }
              primary={analysis.series.input_float}
              secondary={analysis.series.input_q_float}
              primaryLabel="Float32"
              secondaryLabel={`Quantized ${analysis.q_format}`}
            />
            <SignalPlot
              title={
                isTr
                  ? '1D-CNN Donanım Çıkışı (Float64 Referans vs Bit-Doğru RTL Çıkışı & Anomali Tetikleme)'
                  : '1D-CNN Hardware Feature Map (Float64 Ref vs Bit-Exact Fixed-Point RTL & Anomaly Trigger)'
              }
              primary={analysis.series.output_fp}
              secondary={analysis.series.output_fx_float}
              primaryLabel="PyTorch/Float64 Ref"
              secondaryLabel={`Bit-Exact RTL (${analysis.q_format})`}
              threshold={analysis.threshold_float}
              anomalies={analysis.series.anomaly_indices}
            />
          </div>

          {/* Quantized Weight ROM Table & FPGA Memory Exporters (.mem / .coe) */}
          <div className="card space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-200">
                {isTr
                  ? `Niceleme Tablosu & SystemVerilog Ağırlık ROM Sabitleri (${analysis.q_format})`
                  : `Quantized Weight Table & SystemVerilog ROM Constants (${analysis.q_format})`}
              </div>
              <div className="flex items-center gap-2">
                {analysis.mem_content && (
                  <button
                    type="button"
                    onClick={() => downloadTextFile('weights_rom.mem', analysis.mem_content!)}
                    className="px-2.5 py-1 rounded bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 text-sky-300 text-[11px] font-mono flex items-center gap-1"
                    title={isTr ? 'SystemVerilog $readmemh için 2\'s complement Hex bellek dosyasını indir' : 'Download $readmemh .mem file'}
                  >
                    <Download className="w-3 h-3" /> weights_rom.mem ($readmemh)
                  </button>
                )}
                {analysis.coe_content && (
                  <button
                    type="button"
                    onClick={() => downloadTextFile('weights_rom.coe', analysis.coe_content!)}
                    className="px-2.5 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-[11px] font-mono flex items-center gap-1"
                    title={isTr ? 'Xilinx Vivado Block Memory Generator (.coe) dosyasını indir' : 'Download Xilinx Vivado BRAM .coe file'}
                  >
                    <Download className="w-3 h-3" /> weights_rom.coe (Vivado BRAM)
                  </button>
                )}
                {analysis.python_export_script && (
                  <button
                    type="button"
                    onClick={() => downloadTextFile('export_to_circuitvr.py', analysis.python_export_script!)}
                    className="px-2.5 py-1 rounded bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/40 text-indigo-300 text-[11px] font-mono flex items-center gap-1"
                  >
                    <Download className="w-3 h-3" /> export_to_circuitvr.py
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                    <th className="py-1.5 px-2">Tap</th>
                    <th className="py-1.5 px-2">Float32</th>
                    <th className="py-1.5 px-2">Quantized ({analysis.q_format})</th>
                    <th className="py-1.5 px-2">Int ({analysis.total_bits}-bit)</th>
                    <th className="py-1.5 px-2">|Error|</th>
                    <th className="py-1.5 px-2">Hex (2's Comp)</th>
                    <th className="py-1.5 px-2">SystemVerilog Literal</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.weights_table.map((w) => (
                    <tr key={w.index} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                      <td className="py-1 px-2 text-indigo-300">W_{w.index}</td>
                      <td className="py-1 px-2 text-slate-300">{w.float_val}</td>
                      <td className="py-1 px-2 text-emerald-300">{w.quant_float}</td>
                      <td className="py-1 px-2 text-amber-300">{w.quant_int}</td>
                      <td className="py-1 px-2 text-slate-400">{w.abs_err}</td>
                      <td className="py-1 px-2 text-sky-300">{w.hex}</td>
                      <td className="py-1 px-2 text-pink-300">{w.sv_lit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
