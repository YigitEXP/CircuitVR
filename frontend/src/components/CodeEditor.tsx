import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Cpu, FileCode, AlertTriangle, CheckCircle2, X, Zap } from 'lucide-react';
import { Diagnostic } from '../types';
import { useI18n } from '../i18n';
import { explainRtlHardware, HardwareExplainerResult } from '../services/hardwareExplainer';

const LINE_H = 20;

interface Props {
  file: string;
  content: string;
  dirty: boolean;
  gotoLine?: number;
  gotoNonce: number;
  diagnostics: Diagnostic[];
  onChange: (value: string) => void;
  onSave: () => void;
  onOpenTbBuilder?: () => void;
}

export default function CodeEditor({
  file,
  content,
  dirty,
  gotoLine,
  gotoNonce,
  diagnostics,
  onChange,
  onSave,
  onOpenTbBuilder,
}: Props) {
  const { lang, t: tr } = useI18n();
  const isTr = lang === 'tr';
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [hardwareReport, setHardwareReport] = useState<HardwareExplainerResult | null>(null);

  const lineCount = useMemo(() => content.split('\n').length, [content]);
  const marks = useMemo(() => {
    const m = new Map<number, 'error' | 'warning'>();
    diagnostics.filter((d) => d.file === file).forEach((d) => {
      if (m.get(d.line) !== 'error') m.set(d.line, d.severity);
    });
    return m;
  }, [diagnostics, file]);

  const sync = () => {
    const ta = taRef.current;
    if (!ta) return;
    const t = `translateY(${-ta.scrollTop}px)`;
    if (gutterRef.current) gutterRef.current.style.transform = t;
    if (overlayRef.current) overlayRef.current.style.transform = t;
  };

  const handleExplainHardware = () => {
    const ta = taRef.current;
    let snippet = '';
    if (ta && ta.selectionStart !== ta.selectionEnd) {
      snippet = content.slice(ta.selectionStart, ta.selectionEnd);
    } else {
      snippet = content;
    }
    const report = explainRtlHardware(snippet, isTr);
    setHardwareReport(report);
  };

  useEffect(() => {
    const ta = taRef.current;
    if (!ta || !gotoLine) return;
    ta.scrollTop = Math.max(0, (gotoLine - 5) * LINE_H);
    const lines = content.split('\n');
    const pos = lines.slice(0, gotoLine - 1).reduce((a, l) => a + l.length + 1, 0);
    ta.focus();
    ta.setSelectionRange(pos, pos + (lines[gotoLine - 1]?.length ?? 0));
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gotoNonce]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      onSave();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart: s, selectionEnd: en } = ta;
      onChange(content.slice(0, s) + '  ' + content.slice(en));
      requestAnimationFrame(() => ta.setSelectionRange(s + 2, s + 2));
    }
  };

  const lineStyle = { height: LINE_H, lineHeight: `${LINE_H}px` };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-slate-700 text-xs text-gray-400 bg-dark">
        <span className="font-mono text-gray-200">{file}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono uppercase">
          {file.toLowerCase().endsWith('.vhd') || file.toLowerCase().endsWith('.vhdl') ? 'VHDL' : file.toLowerCase().endsWith('.v') ? 'Verilog' : 'SystemVerilog'}
        </span>
        {dirty && <span className="text-yellow-400">{tr.unsaved}</span>}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleExplainHardware}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-indigo-200 border border-indigo-500/30 text-xs flex items-center gap-1.5 transition"
            title={isTr ? 'Seçili kod bloğunun FPGA üzerinde hangi fiziksel kapı ve yazmaçlara dönüştüğünü açıklar' : 'Explains synthesized FPGA primitives for selected code'}
          >
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            <span>{isTr ? 'Donanım Karşılığını Açıkla' : 'Explain Hardware'}</span>
          </button>

          {onOpenTbBuilder && (
            <button
              type="button"
              onClick={onOpenTbBuilder}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 text-xs flex items-center gap-1.5 transition"
              title={isTr ? 'Görsel Testbench Oluşturucuyu Aç' : 'Open Visual Testbench Builder'}
            >
              <FileCode className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isTr ? 'Görsel TB' : 'Visual TB'}</span>
            </button>
          )}

          <button
            onClick={onSave}
            disabled={!dirty}
            className="px-3 py-1 rounded bg-primary hover:bg-blue-600 text-white disabled:opacity-30 text-xs font-semibold shadow-sm transition"
          >
            {tr.save}
          </button>
        </div>
      </div>
      <div className="flex-1 relative overflow-hidden bg-darker font-mono text-[13px]">
        <div className="absolute inset-y-0 left-0 w-12 overflow-hidden bg-dark border-r border-slate-800 text-right text-slate-500 pr-2">
          <div ref={gutterRef}>
            {Array.from({ length: lineCount }, (_, i) => {
              const sev = marks.get(i + 1);
              return (
                <div
                  key={i}
                  style={lineStyle}
                  className={sev === 'error' ? 'text-red-400 font-bold' : sev === 'warning' ? 'text-yellow-400 font-bold' : ''}
                >
                  {i + 1}
                </div>
              );
            })}
          </div>
        </div>
        <div className="absolute inset-y-0 left-12 right-0 overflow-hidden pointer-events-none">
          <div ref={overlayRef}>
            {Array.from({ length: lineCount }, (_, i) => {
              const sev = marks.get(i + 1);
              const isGoto = gotoLine === i + 1;
              return (
                <div
                  key={i}
                  style={lineStyle}
                  className={
                    isGoto
                      ? 'bg-sky-500/25 border-l-2 border-sky-400'
                      : sev === 'error'
                      ? 'bg-red-500/15'
                      : sev === 'warning'
                      ? 'bg-yellow-500/10'
                      : ''
                  }
                />
              );
            })}
          </div>
        </div>
        <textarea
          ref={taRef}
          value={content}
          spellCheck={false}
          wrap="off"
          onChange={(e) => onChange(e.target.value)}
          onScroll={sync}
          onKeyDown={onKeyDown}
          style={{ lineHeight: `${LINE_H}px`, tabSize: 2 }}
          className="absolute inset-y-0 left-12 right-0 pl-3 bg-transparent text-gray-100 outline-none resize-none whitespace-pre overflow-auto"
        />

        {/* Hardware Synthesis Explainer Modal / Drawer */}
        {hardwareReport && (
          <div className="absolute inset-y-0 right-0 w-full max-w-lg bg-slate-950/95 border-l border-slate-700/80 p-5 shadow-2xl backdrop-blur-xl z-30 flex flex-col overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-indigo-400" />
                <h3 className="font-sans font-bold text-slate-100 text-sm">{hardwareReport.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setHardwareReport(null)}
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span
                className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${
                  hardwareReport.categoryType === 'latch_warn'
                    ? 'bg-rose-950/60 text-rose-300 border-rose-500/50'
                    : hardwareReport.categoryType === 'dsp'
                    ? 'bg-purple-950/60 text-purple-300 border-purple-500/50'
                    : hardwareReport.categoryType === 'seq'
                    ? 'bg-sky-950/60 text-sky-300 border-sky-500/50'
                    : hardwareReport.categoryType === 'unroll'
                    ? 'bg-amber-950/60 text-amber-300 border-amber-500/50'
                    : 'bg-emerald-950/60 text-emerald-300 border-emerald-500/50'
                }`}
              >
                {hardwareReport.category}
              </span>
            </div>

            {/* Target FPGA Primitives */}
            <div className="mt-4">
              <label className="text-[11px] font-sans font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                {isTr ? 'Hedef FPGA Primitifleri (Hücreler)' : 'Target FPGA Primitives'}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {hardwareReport.primitives.map((prim, idx) => (
                  <span
                    key={idx}
                    className="font-mono text-xs px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-200"
                  >
                    {prim}
                  </span>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div className="mt-4 p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-xs font-sans text-slate-300 leading-relaxed">
              {hardwareReport.summary}
            </div>

            {/* Findings */}
            <div className="mt-4">
              <label className="text-[11px] font-sans font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                {isTr ? 'Sentez Çıkarımları' : 'Synthesis Findings'}
              </label>
              <ul className="space-y-1.5 text-xs font-sans text-slate-300">
                {hardwareReport.findings.map((finding, idx) => (
                  <li key={idx} className="flex items-start gap-2 bg-slate-900/50 p-2 rounded border border-slate-800/60">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <span>{finding}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Recommendations */}
            {hardwareReport.recommendations.length > 0 && (
              <div className="mt-4">
                <label className="text-[11px] font-sans font-semibold text-amber-400 uppercase tracking-wider block mb-1.5">
                  {isTr ? 'Mimari Öneriler & Riskler' : 'Architectural Recommendations'}
                </label>
                <ul className="space-y-1.5 text-xs font-sans text-slate-300">
                  {hardwareReport.recommendations.map((rec, idx) => (
                    <li key={idx} className="flex items-start gap-2 bg-amber-950/20 p-2 rounded border border-amber-500/30 text-amber-200">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Timing Impact */}
            <div className="mt-4 p-3 rounded-lg bg-slate-900/60 border border-slate-800 text-xs font-sans">
              <div className="flex items-center gap-1.5 text-sky-400 font-semibold mb-1">
                <Zap className="w-3.5 h-3.5" />
                <span>{isTr ? 'Zamanlama & Fmax Etkisi' : 'Timing & Fmax Impact'}</span>
              </div>
              <p className="text-slate-400 leading-relaxed">{hardwareReport.timingImpact}</p>
            </div>

            {/* Analyzed Snippet Preview */}
            <div className="mt-4">
              <label className="text-[11px] font-sans font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                {isTr ? 'İncelenen Kod Parçacığı' : 'Analyzed Code Snippet'}
              </label>
              <pre className="p-2 rounded bg-slate-900 border border-slate-800 text-[11px] text-slate-400 overflow-x-auto whitespace-pre font-mono">
                {hardwareReport.codeSnippet}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
