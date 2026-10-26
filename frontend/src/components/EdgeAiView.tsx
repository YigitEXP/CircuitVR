import { useEffect, useState } from 'react';
import {
  BrainCircuit, Cpu, Activity, Sparkles, ArrowRight, CheckCircle2, AlertTriangle, Play, Workflow, Code2, Loader2,
} from 'lucide-react';
import { EdgeAiAnalysis, EdgeAiConfig, WorkspaceInfo } from '../types';
import { errMsg, ws } from '../services/api';
import { useI18n } from '../i18n';

interface Props {
  info: WorkspaceInfo;
  onInjected: (updated: WorkspaceInfo | undefined, rtlFile: string, rtlCode: string, topMod: string, tbMod: string) => void;
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

  const [cfg, setCfg] = useState<EdgeAiConfig>({
    path: info.root,
    ...PRESETS.ecg_qrs.cfg,
  });
  const [weightsText, setWeightsText] = useState(PRESETS.ecg_qrs.cfg.weights.join(', '));
  const [analysis, setAnalysis] = useState<EdgeAiAnalysis | null>(null);
  const [generating, setGenerating] = useState(false);
  const [injectedMsg, setInjectedMsg] = useState('');
  const [err, setErr] = useState('');

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

  const handleGenerate = async () => {
    setGenerating(true);
    setErr('');
    setInjectedMsg('');
    try {
      const res = await ws.edgeAiGenerate({ ...cfg, path: info.root });
      setAnalysis(res.analysis);
      onInjected(res.workspace, res.rtl_file, res.rtl_code, res.top_module, res.tb_module);
      setInjectedMsg(
        isTr
          ? `✓ ${res.rtl_file} ve ${res.tb_file} (${res.analysis.q_format} bit-exact golden testbench) projeye aktarıldı! Şimdi F5 (Simüle Et) veya F6 (Şematik) çalıştırabilirsiniz.`
          : `✓ Generated ${res.rtl_file} & ${res.tb_file} (${res.analysis.q_format} bit-exact golden testbench) into workspace! Click Simulate (F5) or Schematic (F6).`
      );
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
      {/* Header Banner */}
      <div className="card border-indigo-500/30 bg-gradient-to-r from-indigo-950/30 via-slate-900/90 to-emerald-950/20 flex flex-wrap items-center justify-between gap-4">
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
              ? 'Sabit noktalı (Qm.n) niceleme kaybını (SQNR), MAC akümülatör bit genişlemesini, FPGA DSP48 sınırlarını ve EEG/ECG 1D-CNN donanım hızlandırıcısını bit-doğru (bit-exact) Golden Testbench ile birlikte üretir.'
              : 'Explore Qm.n quantization SQNR, automatic MAC accumulator bit-growth, FPGA DSP48 cliffs, and synthesize bit-exact 1D-CNN EEG/ECG accelerators with Golden Testbenches.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="btn-primary text-xs flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 shadow-glow"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {isTr ? 'RTL + Golden Testbench Üret & Projeye Yükle' : 'Generate RTL + Golden TB into Workspace'}
          </button>
        </div>
      </div>

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
            {isTr ? '1. 1D-CNN Çekirdek Ağırlıkları & Biyosinyal' : '1. 1D-CNN Kernel Weights & Biosignal'}
          </div>
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

          <div className="space-y-1">
            <label className="text-[11px] text-slate-400">
              {isTr ? 'Python / PyTorch Float32 Ağırlık Dizisi (virgülle)' : 'Python / PyTorch Float32 Weights (comma-separated)'}
            </label>
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
                <option value="round">{isTr ? 'En Yakına Yuvarla (+0.5 LSB)' : 'Round-to-Nearest (+0.5 LSB)'}</option>
                <option value="trunc">{isTr ? 'Doğrudan Kesme (Truncate)' : 'Direct Truncation'}</option>
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
                  ? `Giriş Biyosinyali (${analysis.series.stimulus.toUpperCase()} — 64 Örnek)`
                  : `Input Biosignal (${analysis.series.stimulus.toUpperCase()} — 64 Samples)`
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

          {/* Quantized Weight ROM Table */}
          <div className="card space-y-2">
            <div className="text-xs font-semibold text-slate-200">
              {isTr
                ? `Niceleme Tablosu & SystemVerilog Ağırlık ROM Sabitleri (${analysis.q_format})`
                : `Quantized Weight Table & SystemVerilog ROM Constants (${analysis.q_format})`}
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
