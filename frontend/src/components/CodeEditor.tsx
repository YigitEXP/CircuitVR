import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Cpu, FileCode, AlertTriangle, CheckCircle2, X, Zap, Layers, HelpCircle, ArrowRight, Copy, Check, ChevronDown } from 'lucide-react';
import { Diagnostic } from '../types';
import { useI18n } from '../i18n';
import { explainRtlHardware, HardwareExplainerResult } from '../services/hardwareExplainer';
import { RTL_SNIPPETS, RtlSnippet } from '../services/rtlSnippets';
import { explainRtlError } from '../services/errorExplainer';

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
  const [showSnippets, setShowSnippets] = useState(false);
  const [selectedMentorDiag, setSelectedMentorDiag] = useState<Diagnostic | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [copiedMentorExample, setCopiedMentorExample] = useState(false);

  const fileDiags = useMemo(() => diagnostics.filter((d) => d.file === file), [diagnostics, file]);

  const lineCount = useMemo(() => content.split('\n').length, [content]);
  const marks = useMemo(() => {
    const m = new Map<number, 'error' | 'warning'>();
    fileDiags.forEach((d) => {
      if (m.get(d.line) !== 'error') m.set(d.line, d.severity);
    });
    return m;
  }, [fileDiags]);

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

  const insertSnippet = (snippet: RtlSnippet) => {
    const ta = taRef.current;
    if (!ta) {
      onChange(content + '\n' + snippet.code);
      setShowSnippets(false);
      setContextMenu(null);
      return;
    }
    const start = ta.selectionStart ?? content.length;
    const end = ta.selectionEnd ?? content.length;
    const next = content.slice(0, start) + snippet.code + content.slice(end);
    onChange(next);
    setShowSnippets(false);
    setContextMenu(null);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + snippet.code.length, start + snippet.code.length);
    });
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

        <div className="ml-auto flex items-center gap-2 relative">
          {/* Neden Hata Aldim? Mentor Button (If active file has errors) */}
          {fileDiags.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedMentorDiag(fileDiags[0])}
              className="px-2.5 py-1 rounded bg-amber-950/60 hover:bg-amber-900/60 text-amber-300 border border-amber-500/40 text-xs flex items-center gap-1.5 transition font-medium"
              title={isTr ? 'Bu dosyadaki hatalari insan dilinde cozumle' : 'Explain file errors in plain human language'}
            >
              <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
              <span>{isTr ? `Neden Hata Aldim? (${fileDiags.length})` : `Why Did I Get Errors? (${fileDiags.length})`}</span>
            </button>
          )}

          {/* Snippets Dropdown Trigger */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSnippets(!showSnippets)}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 hover:text-sky-200 border border-sky-500/30 text-xs flex items-center gap-1.5 transition font-medium"
              title={isTr ? 'Temel RTL yapi taslarini (Snippets) koda ekle' : 'Insert RTL Snippets and hardware templates'}
            >
              <Layers className="w-3.5 h-3.5 text-sky-400" />
              <span>{isTr ? 'Yapi Tasi Ekle' : 'RTL Snippets'}</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showSnippets && (
              <div className="absolute right-0 top-full mt-1.5 w-80 rounded-xl bg-slate-950 border border-slate-700 shadow-2xl p-2 z-40 space-y-1 backdrop-blur-xl">
                <div className="px-2 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800 mb-1">
                  {isTr ? 'Temel Donanim Kaliplari (Snippets)' : 'Hardware Snippet Templates'}
                </div>
                {RTL_SNIPPETS.map((snip) => (
                  <button
                    key={snip.id}
                    type="button"
                    onClick={() => insertSnippet(snip)}
                    className="w-full text-left p-2 rounded-lg hover:bg-slate-800/80 border border-transparent hover:border-slate-700 transition group"
                  >
                    <div className="text-xs font-semibold text-sky-300 group-hover:text-white flex items-center justify-between">
                      <span>{isTr ? snip.nameTr : snip.nameEn}</span>
                      <ArrowRight className="w-3 h-3 text-slate-500 group-hover:text-sky-400 transition" />
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                      {isTr ? snip.descTr : snip.descEn}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleExplainHardware}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-indigo-200 border border-indigo-500/30 text-xs flex items-center gap-1.5 transition"
            title={isTr ? 'Secili kod blogunun FPGA uzerinde hangi fiziksel kapi ve yazmaclara donustugunu aciklar' : 'Explains synthesized FPGA primitives for selected code'}
          >
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            <span>{isTr ? 'Donanim Karsiligini Acikla' : 'Explain Hardware'}</span>
          </button>

          {onOpenTbBuilder && (
            <button
              type="button"
              onClick={onOpenTbBuilder}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 text-xs flex items-center gap-1.5 transition"
              title={isTr ? 'Gorsel Testbench Olusturucuyu Ac' : 'Open Visual Testbench Builder'}
            >
              <FileCode className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isTr ? 'Gorsel TB' : 'Visual TB'}</span>
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
      <div className="flex-1 relative overflow-hidden bg-darker font-mono text-[13px]" onClick={() => { if (showSnippets) setShowSnippets(false); if (contextMenu) setContextMenu(null); }}>
        <div className="absolute inset-y-0 left-0 w-12 overflow-hidden bg-dark border-r border-slate-800 text-right text-slate-500 pr-2 select-none">
          <div ref={gutterRef}>
            {Array.from({ length: lineCount }, (_, i) => {
              const lineNo = i + 1;
              const sev = marks.get(lineNo);
              const lineDiag = fileDiags.find((d) => d.line === lineNo);
              return (
                <div
                  key={i}
                  style={lineStyle}
                  onClick={() => {
                    if (lineDiag) setSelectedMentorDiag(lineDiag);
                  }}
                  className={`cursor-pointer ${
                    sev === 'error'
                      ? 'text-red-400 font-bold bg-red-950/30'
                      : sev === 'warning'
                      ? 'text-yellow-400 font-bold bg-yellow-950/20'
                      : 'hover:text-slate-300'
                  }`}
                  title={lineDiag ? `${lineDiag.message} (Tikla: Neden hata aldim?)` : undefined}
                >
                  {lineNo}
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
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY });
          }}
          style={{ lineHeight: `${LINE_H}px`, tabSize: 2 }}
          className="absolute inset-y-0 left-12 right-0 pl-3 bg-transparent text-gray-100 outline-none resize-none whitespace-pre overflow-auto"
        />

        {/* Right-Click Context Menu */}
        {contextMenu && (
          <div
            style={{ top: Math.min(contextMenu.y - 40, window.innerHeight - 280), left: Math.min(contextMenu.x - 20, window.innerWidth - 300) }}
            className="fixed z-50 w-64 rounded-xl bg-slate-950/95 border border-slate-700 shadow-2xl p-2 backdrop-blur-xl space-y-1 font-sans text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                handleExplainHardware();
              }}
              className="w-full text-left px-2.5 py-1.5 rounded hover:bg-slate-800 text-indigo-300 hover:text-white flex items-center gap-2 transition"
            >
              <Cpu className="w-4 h-4 text-indigo-400" />
              <span>{isTr ? 'Donanim Karsiligini Acikla' : 'Explain Hardware'}</span>
            </button>

            {fileDiags.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setContextMenu(null);
                  setSelectedMentorDiag(fileDiags[0]);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-slate-800 text-amber-300 hover:text-white flex items-center gap-2 transition"
              >
                <HelpCircle className="w-4 h-4 text-amber-400" />
                <span>{isTr ? 'Neden Hata Aldim? (Mentor)' : 'Why Did I Get Errors?'}</span>
              </button>
            )}

            <div className="border-t border-slate-800 my-1 pt-1 px-2 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
              {isTr ? 'RTL Yapi Tasi Ekle' : 'Insert RTL Snippet'}
            </div>

            {RTL_SNIPPETS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => insertSnippet(s)}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-sky-300 flex items-center justify-between transition"
              >
                <span className="truncate">{isTr ? s.nameTr : s.nameEn}</span>
                <ArrowRight className="w-3 h-3 opacity-50" />
              </button>
            ))}
          </div>
        )}

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

        {/* Error Mentor Drawer ("Neden Hata Aldım?") */}
        {selectedMentorDiag && (() => {
          const explanation = explainRtlError(selectedMentorDiag.message, isTr);
          return (
            <div className="absolute inset-y-0 right-0 w-full max-w-lg bg-slate-950/95 border-l border-amber-500/40 p-5 shadow-2xl backdrop-blur-xl z-40 flex flex-col overflow-y-auto">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-amber-400" />
                  <div>
                    <h3 className="font-sans font-bold text-slate-100 text-sm">
                      {isTr ? 'Neden Hata Aldım? (Mentor Paneli)' : 'Why Did I Get This Error? (Mentor Panel)'}
                    </h3>
                    <span className="font-mono text-[11px] text-slate-400">
                      {selectedMentorDiag.file}:{selectedMentorDiag.line}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedMentorDiag(null)}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-500/40">
                  {explanation.ruleCode}
                </span>
                <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${
                  selectedMentorDiag.severity === 'error'
                    ? 'bg-red-950 text-red-300 border border-red-500/40'
                    : 'bg-yellow-950 text-yellow-300 border border-yellow-500/40'
                }`}>
                  {selectedMentorDiag.severity.toUpperCase()}
                </span>
              </div>

              <div className="mt-2 text-xs font-mono text-slate-300 bg-slate-900/90 p-2.5 rounded border border-slate-800">
                {selectedMentorDiag.message}
              </div>

              {/* 1. Ne Oldu? */}
              <div className="mt-4 space-y-1">
                <label className="text-[11px] font-sans font-semibold text-slate-400 uppercase tracking-wider block">
                  1. {isTr ? 'Ne Oldu?' : 'What Happened?'}
                </label>
                <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-xs font-sans text-slate-200 leading-relaxed">
                  {explanation.whatHappened}
                </div>
              </div>

              {/* 2. Donanımda Ne Anlama Gelir? */}
              <div className="mt-4 space-y-1">
                <label className="text-[11px] font-sans font-semibold text-amber-400 uppercase tracking-wider block">
                  2. {isTr ? 'Donanımda Ne Anlama Gelir?' : 'What Does It Mean in Hardware?'}
                </label>
                <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-500/30 text-xs font-sans text-amber-200/90 leading-relaxed">
                  {explanation.hardwareMeaning}
                </div>
              </div>

              {/* 3. Doğru Yazım Örneği */}
              <div className="mt-4 space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-sans font-semibold text-emerald-400 uppercase tracking-wider block">
                    3. {isTr ? 'Doğru Yazım Örneği' : 'Correct Code Example'}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(explanation.correctExample);
                      setCopiedMentorExample(true);
                      setTimeout(() => setCopiedMentorExample(false), 2000);
                    }}
                    className="text-[11px] font-mono text-slate-400 hover:text-emerald-300 flex items-center gap-1 transition"
                  >
                    {copiedMentorExample ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedMentorExample ? (isTr ? 'Kopyalandı' : 'Copied') : (isTr ? 'Kopyala' : 'Copy')}</span>
                  </button>
                </div>
                <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-300 overflow-x-auto whitespace-pre">
                  {explanation.correctExample}
                </pre>
              </div>

              {/* Action: Add snippet to code */}
              <div className="mt-5 pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    insertSnippet({
                      id: 'fix_example',
                      nameTr: 'Düzeltme Kodu',
                      nameEn: 'Fix Code',
                      descTr: 'Mentor örnek kodu',
                      descEn: 'Mentor example code',
                      code: '\n' + explanation.correctExample + '\n',
                    });
                    setSelectedMentorDiag(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 transition shadow-sm"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>{isTr ? 'Örnek Kodu Editöre Ekle' : 'Insert Example into Editor'}</span>
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
