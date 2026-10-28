import { useEffect, useState } from 'react';
import {
  Loader2, ShieldCheck, Cpu, Sparkles, ArrowRight, FileCode, Wand2, CheckCircle2, Undo2, EyeOff, Eye, GitBranch, AlertTriangle, X,
} from 'lucide-react';
import {
  Diagnostic, FsmMachine, FsmReport, LintResult, OptimizationReport, OptimizationSuggestion, SynthStats, WorkspaceInfo,
} from '../types';
import { errMsg, ws } from '../services/api';
import { useI18n } from '../i18n';

interface Props {
  info: WorkspaceInfo;
  top: string;
  lint: LintResult | null;
  stats: SynthStats | null;
  busy: string | null;
  onLint: () => void;
  onSynth: () => void;
  onGoto: (d: Diagnostic) => void;
  onAutoFixed?: (file: string, content: string, line: number) => void;
}

interface UndoSnapshot {
  file: string;
  prevContent: string;
  label: string;
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="bg-darker rounded-lg border border-slate-700 p-4" title={hint}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-gray-400 mt-1">{label}</div>
    </div>
  );
}

function FsmDiagramCard({ fsm, isTr, onOpenFile }: { fsm: FsmMachine; isTr: boolean; onOpenFile: () => void }) {
  const N = fsm.states.length;
  const W = 520;
  const H = 220;
  const cx = W / 2;
  const cy = H / 2;
  const rx = Math.min(185, Math.max(95, N * 28));
  const ry = 72;

  const coords: Record<string, { x: number; y: number }> = {};
  fsm.states.forEach((st, idx) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * idx) / Math.max(1, N);
    coords[st] = {
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    };
  });

  return (
    <div className="bg-darker/90 border border-slate-800 rounded-lg p-3.5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-sky-400" />
          <span className="font-semibold text-sm text-slate-100 font-mono">{fsm.name}</span>
          <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-mono">
            {fsm.encoding} · {fsm.states.length} {isTr ? 'Durum' : 'States'}
          </span>
          {fsm.has_safe_default ? (
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono">
              ✓ Safe Default
            </span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono">
              ⚠ Missing Default Recovery
            </span>
          )}
          {fsm.dead_states.length > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40 font-mono flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {fsm.dead_states.length} {isTr ? 'Ulaşılamayan (Ölü) Durum!' : 'Unreachable State!'}
            </span>
          )}
        </div>
        <button
          onClick={onOpenFile}
          className="text-xs font-mono text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
        >
          <FileCode className="w-3.5 h-3.5" /> {fsm.file}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-3 items-center">
        <div className="bg-slate-950/80 border border-slate-800/90 rounded-lg p-2">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-48 overflow-visible">
            <defs>
              <marker id={`arrow-${fsm.name}`} markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
                <polygon points="0 0, 8 3.5, 0 7" fill="#38bdf8" />
              </marker>
            </defs>

            {fsm.transitions.map((tr, i) => {
              const p1 = coords[tr.from];
              const p2 = coords[tr.to];
              if (!p1 || !p2) return null;
              if (tr.from === tr.to) {
                return (
                  <path
                    key={i}
                    d={`M ${p1.x - 10} ${p1.y - 18} C ${p1.x - 26} ${p1.y - 46}, ${p1.x + 26} ${p1.y - 46}, ${p1.x + 10} ${p1.y - 18}`}
                    fill="none"
                    stroke="#64748b"
                    strokeWidth="1.3"
                    strokeDasharray="3 2"
                    markerEnd={`url(#arrow-${fsm.name})`}
                  />
                );
              }
              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const len = Math.max(1, Math.hypot(dx, dy));
              const ux = dx / len;
              const uy = dy / len;
              const sx = p1.x + ux * 28;
              const sy = p1.y + uy * 20;
              const ex = p2.x - ux * 30;
              const ey = p2.y - uy * 22;
              const mx = (sx + ex) / 2 - uy * 16;
              const my = (sy + ey) / 2 + ux * 16;
              return (
                <g key={i}>
                  <path
                    d={`M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`}
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="1.5"
                    opacity={0.85}
                    markerEnd={`url(#arrow-${fsm.name})`}
                  />
                </g>
              );
            })}

            {fsm.states.map((st) => {
              const pt = coords[st];
              if (!pt) return null;
              const isReset = st === fsm.reset_state;
              const isDead = fsm.dead_states.includes(st);
              const stroke = isDead ? '#ef4444' : isReset ? '#10b981' : '#6366f1';
              const fill = isDead ? '#450a0a' : isReset ? '#064e3b' : '#1e1b4b';
              return (
                <g key={st}>
                  {isReset && (
                    <ellipse
                      cx={pt.x}
                      cy={pt.y}
                      rx={36}
                      ry={22}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="1"
                      strokeDasharray="3 2"
                    />
                  )}
                  <ellipse cx={pt.x} cy={pt.y} rx={32} ry={18} fill={fill} stroke={stroke} strokeWidth="1.8" />
                  <text
                    x={pt.x}
                    y={pt.y + 3.5}
                    textAnchor="middle"
                    className="fill-slate-100 text-[10px] font-mono font-bold select-none"
                  >
                    {st.length > 10 ? st.slice(0, 9) + '…' : st}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="space-y-1.5 text-xs font-mono max-h-48 overflow-y-auto">
          <div className="text-[11px] text-slate-400 flex items-center justify-between pb-1 border-b border-slate-800">
            <span>{isTr ? 'Durum Geçiş Tablosu (From ➔ To)' : 'State Transitions (From ➔ To)'}</span>
            <span className="text-emerald-400">Reset: {fsm.reset_state}</span>
          </div>
          {fsm.transitions.map((t, idx) => (
            <div key={idx} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-slate-900/70 border border-slate-800/70">
              <span className="text-sky-300">
                {t.from} <span className="text-slate-500">➔</span> <strong className="text-emerald-300">{t.to}</strong>
              </span>
              <span className="text-[10px] text-slate-400 truncate max-w-[170px]" title={t.condition}>
                {t.condition}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const IMPACT_STYLE: Record<string, string> = {
  'yüksek': 'bg-red-500/15 text-red-300 border-red-500/40',
  'orta': 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  'düşük': 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  'bilgi': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
};

export default function AnalysisView({ info, top, lint, stats, busy, onLint, onSynth, onGoto, onAutoFixed }: Props) {
  const { lang, t: tr } = useI18n();
  const isTr = lang === 'tr';
  const [opt, setOpt] = useState<OptimizationReport | null>(null);
  const [fsmReport, setFsmReport] = useState<FsmReport | null>(null);
  const [fixingIdx, setFixingIdx] = useState<number | null>(null);
  const [fixMsg, setFixMsg] = useState<string>('');
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const [diffPreview, setDiffPreview] = useState<{ suggestion: OptimizationSuggestion; idx: number } | null>(null);

  useEffect(() => {
    if (stats?.optimization) {
      setOpt(stats.optimization);
    } else {
      ws.optimize(info.root, top || undefined).then(setOpt).catch(() => undefined);
    }
    ws.fsm(info.root, top || undefined).then(setFsmReport).catch(() => undefined);
  }, [info.root, info.fingerprint, top, stats]);

  const handleApplyFix = async (s: OptimizationSuggestion, idx: number) => {
    if (!s.file) return;
    setFixingIdx(idx);
    setFixMsg('');
    try {
      const prevContent = await ws.readFile(info.root, s.file).catch(() => '');
      const res = await ws.optimizeAutofix(info.root, s.file, s.line, s.before, s.after);
      if (res.applied) {
        if (prevContent) {
          setUndoStack((st) => [{ file: s.file, prevContent, label: `${s.rule_id || 'FIX'} (${s.file}:${s.line})` }, ...st.slice(0, 9)]);
        }
        setOpt(res.optimization);
        setDiffPreview(null);
        setFixMsg(
          isTr
            ? `✓ Otomatik düzeltme uygulandı: ${s.file}:${s.line} (${s.rule_id || s.category})`
            : `✓ Auto-fix applied to ${s.file}:${s.line} (${s.rule_id || s.category})`
        );
        onAutoFixed?.(res.file, res.content, s.line);
      } else {
        setFixMsg(
          isTr
            ? `⚠ İlgili satır zaten değiştirilmiş olabilir; dosyayı açıp kontrol edin (${s.file}:${s.line}).`
            : `⚠ Target snippet already modified; please inspect ${s.file}:${s.line}.`
        );
      }
    } catch (e) {
      setFixMsg(errMsg(e));
    } finally {
      setFixingIdx(null);
    }
  };

  const handleIgnoreRule = async (s: OptimizationSuggestion, idx: number) => {
    if (!s.file || !s.rule_id) return;
    setFixingIdx(idx);
    setFixMsg('');
    try {
      const prevContent = await ws.readFile(info.root, s.file).catch(() => '');
      const res = await ws.optimizeIgnore(info.root, s.file, s.line, s.rule_id);
      if (res.applied) {
        if (prevContent) {
          setUndoStack((st) => [{ file: s.file, prevContent, label: `ignore ${s.rule_id} (${s.file}:${s.line})` }, ...st.slice(0, 9)]);
        }
        setOpt(res.optimization);
        setFixMsg(
          isTr
            ? `✓ Kural bastırıldı (// circuitvr-ignore ${s.rule_id}): ${s.file}:${s.line}`
            : `✓ Rule suppressed (// circuitvr-ignore ${s.rule_id}) at ${s.file}:${s.line}`
        );
        onAutoFixed?.(res.file, res.content, s.line);
      }
    } catch (e) {
      setFixMsg(errMsg(e));
    } finally {
      setFixingIdx(null);
    }
  };

  const handleUndo = async () => {
    const topSnap = undoStack[0];
    if (!topSnap) return;
    try {
      await ws.saveFile(info.root, topSnap.file, topSnap.prevContent);
      setUndoStack((st) => st.slice(1));
      const nextOpt = await ws.optimize(info.root, top || undefined);
      setOpt(nextOpt);
      setFixMsg(
        isTr
          ? `↩ Geri alındı (Rollback): ${topSnap.label}`
          : `↩ Rolled back: ${topSnap.label}`
      );
      onAutoFixed?.(topSnap.file, topSnap.prevContent, 1);
    } catch (e) {
      setFixMsg(errMsg(e));
    }
  };

  const rtlFiles = info.files.filter((f) => f.group === 'rtl' && !f.is_header);
  const tbFiles = info.files.filter((f) => f.group === 'tb' && !f.is_header);
  const lines = info.files.reduce((a, f) => a + f.lines, 0);
  const cells = stats?.cells ? Object.entries(stats.cells).sort((a, b) => b[1] - a[1]) : [];
  const maxCell = cells.length ? cells[0][1] : 1;
  const report = opt ?? stats?.optimization ?? null;

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* Diff Preview Modal */}
      {diffPreview && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setDiffPreview(null)}
        >
          <div
            className="w-full max-w-2xl bg-dark border border-slate-700 rounded-xl shadow-2xl overflow-hidden space-y-3 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold text-sm text-slate-100">
                  {isTr ? 'Otomatik RTL Düzeltme (Diff Önizleme)' : 'RTL Auto-Fix Diff Preview'}
                </span>
                <span className="text-xs font-mono text-indigo-300">
                  {diffPreview.suggestion.file}:{diffPreview.suggestion.line} ({diffPreview.suggestion.rule_id})
                </span>
              </div>
              <button onClick={() => setDiffPreview(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300">{diffPreview.suggestion.why}</p>

            <div className="bg-darker border border-slate-800 rounded-lg p-3 font-mono text-xs space-y-1.5 overflow-x-auto">
              <div className="text-[10px] text-slate-500">
                --- a/{diffPreview.suggestion.file} (Line {diffPreview.suggestion.line})
              </div>
              <div className="text-[10px] text-slate-500">
                +++ b/{diffPreview.suggestion.file} (Patched)
              </div>
              {diffPreview.suggestion.before.split('\n').map((l, i) => (
                <div key={`b-${i}`} className="bg-red-950/35 text-red-300 px-2 py-0.5 rounded">
                  - {l}
                </div>
              ))}
              {diffPreview.suggestion.after.split('\n').map((l, i) => (
                <div key={`a-${i}`} className="bg-emerald-950/35 text-emerald-300 px-2 py-0.5 rounded">
                  + {l}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDiffPreview(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
              >
                {isTr ? 'Vazgeç' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => handleApplyFix(diffPreview.suggestion, diffPreview.idx)}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white flex items-center gap-1.5"
              >
                <Wand2 className="w-3.5 h-3.5" />
                {isTr ? 'Onayla ve Kaynak Koda Uygula' : 'Confirm & Apply Patch'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label={tr.rtlFiles} value={rtlFiles.length} />
        <Stat label={tr.tbFiles} value={tbFiles.length} />
        <Stat label={tr.modules} value={Object.keys(info.modules).length} />
        <Stat label={tr.lines} value={lines} />
        <Stat label={tr.submodules} value={top && info.modules[top] ? info.modules[top].children : 0} />
      </div>

      {/* FSM State Machine Extractor & Dead-State Security Audit */}
      {fsmReport && fsmReport.fsms.length > 0 ? (
        <div className="card space-y-3 border-sky-500/30">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold flex items-center gap-2 text-sky-300">
              <GitBranch className="w-4 h-4 text-sky-400" />
              {isTr
                ? `Otomatik FSM Durum Diyagramı & Güvenlik Denetimi (${fsmReport.total_fsms} Durum Makinesi)`
                : `Automatic FSM State Diagram & Dead-State Audit (${fsmReport.total_fsms} FSMs)`}
            </h2>
            <span className="text-[11px] font-mono text-slate-400">
              {isTr ? 'Yeşil Halka: Reset · Kırmızı: Ulaşılamayan (Dead) Durum' : 'Green Ring: Reset · Red: Unreachable Dead State'}
            </span>
          </div>
          <div className="space-y-3">
            {fsmReport.fsms.map((m, idx) => (
              <FsmDiagramCard
                key={`${m.file}-${m.name}-${idx}`}
                fsm={m}
                isTr={isTr}
                onOpenFile={() => onGoto({ severity: 'warning', file: m.file, line: 1, message: m.name })}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="card space-y-1.5 border-slate-800 bg-slate-900/30 text-xs py-3">
          <div className="flex items-center gap-2 text-slate-400 font-medium">
            <GitBranch className="w-4 h-4 text-slate-500" />
            {isTr ? 'FSM Durum Makinesi Tespiti' : 'FSM State Machine Extraction'}
          </div>
          <p className="text-slate-500 text-[11px]">
            {isTr
              ? 'Mevcut tasarımda sonlu durum makinesi (enum/localparam case) veya ardışıl kontrol bloğu bulunamadı. Tasarım saf kombinasyonel mantıktan oluşuyor olabilir.'
              : 'No finite state machine (enum/localparam case) or sequential control block detected in this design. The module may be purely combinational.'}
          </p>
        </div>
      )}

      {/* RTL Optimization Advisor 2.0 + SecLinter + Diff/Rollback */}
      <div className="card space-y-3 border-indigo-500/30">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="font-semibold flex items-center gap-2 text-indigo-300">
            <Sparkles className="w-4 h-4 text-indigo-400" /> {tr.optAdvisor} &amp; SecLinter
          </h2>
          {report && (
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold border ${
                report.score >= 90
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                  : report.score >= 70
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                  : 'bg-red-500/15 text-red-300 border-red-500/40'
              }`}
            >
              {tr.optScore}: {report.score} / 100
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {undoStack.length > 0 && (
              <button
                type="button"
                onClick={handleUndo}
                className="px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-mono flex items-center gap-1.5 transition"
                title={undoStack[0].label}
              >
                <Undo2 className="w-3.5 h-3.5" />
                {isTr ? `Geri Al (${undoStack.length})` : `Undo (${undoStack.length})`}
              </button>
            )}
            <span className="text-xs text-slate-400">
              {stats?.success ? tr.optActiveSynth : tr.optStaticOnly}
            </span>
          </div>
        </div>

        {fixMsg && (
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-emerald-950/30 border border-emerald-500/40 text-emerald-200 font-mono">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>{fixMsg}</span>
          </div>
        )}

        {report && (
          <>
            <p className="text-xs text-slate-300">{report.summary}</p>
            {report.suggestions.length === 0 ? (
              <div className="text-sm text-emerald-400 bg-emerald-950/20 border border-emerald-500/30 rounded-lg p-3">
                {tr.optClean}
              </div>
            ) : (
              <div className="space-y-3">
                {report.suggestions.map((s, idx) => (
                  <div key={idx} className="bg-darker/90 border border-slate-800 rounded-lg p-3.5 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border font-semibold ${IMPACT_STYLE[s.impact] ?? IMPACT_STYLE.bilgi}`}>
                        {tr.impact}: {s.impact}
                      </span>
                      {s.rule_id && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-mono">
                          {s.rule_id}
                        </span>
                      )}
                      <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                        {s.category}
                      </span>
                      <span className="font-medium text-sm text-slate-100">{s.title}</span>

                      <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                        {s.can_autofix && s.file && (
                          <>
                            <button
                              type="button"
                              onClick={() => setDiffPreview({ suggestion: s, idx })}
                              className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-xs flex items-center gap-1 transition"
                              title={isTr ? 'Yama farkını (Diff) önizle' : 'Preview unified diff before applying'}
                            >
                              <Eye className="w-3.5 h-3.5 text-sky-400" />
                              {isTr ? 'Diff Önizle' : 'Preview Diff'}
                            </button>
                            <button
                              type="button"
                              disabled={fixingIdx !== null}
                              onClick={() => handleApplyFix(s, idx)}
                              className="px-2.5 py-1 rounded-md bg-emerald-600/25 hover:bg-emerald-600/40 border border-emerald-500/40 text-emerald-200 text-xs font-medium flex items-center gap-1.5 transition"
                              title={isTr ? 'Önerilen düzeltmeyi doğrudan kaynak dosyaya uygula' : 'Apply suggested fix directly to source file'}
                            >
                              {fixingIdx === idx ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5 text-emerald-400" />}
                              {isTr ? 'Uygula' : 'Apply Fix'}
                            </button>
                          </>
                        )}
                        {s.file && s.rule_id && (
                          <button
                            type="button"
                            disabled={fixingIdx !== null}
                            onClick={() => handleIgnoreRule(s, idx)}
                            className="px-2 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-slate-200 text-xs flex items-center gap-1 transition"
                            title={isTr ? `Bu satır için // circuitvr-ignore ${s.rule_id} ekle` : `Suppress with // circuitvr-ignore ${s.rule_id}`}
                          >
                            <EyeOff className="w-3 h-3" />
                            {isTr ? 'Yoksay' : 'Ignore'}
                          </button>
                        )}
                        {s.file && (
                          <button
                            onClick={() => onGoto({ severity: 'warning', file: s.file, line: s.line, message: s.title })}
                            className="flex items-center gap-1 text-xs font-mono text-indigo-400 hover:text-indigo-300 hover:underline"
                          >
                            <FileCode className="w-3.5 h-3.5" /> {s.file}:{s.line}
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">{s.why}</p>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-2 items-stretch pt-1">
                      <div className="bg-red-950/20 border border-red-500/20 rounded p-2">
                        <div className="text-[10px] uppercase text-red-400/80 mb-1 font-semibold">{tr.beforeCode}</div>
                        <pre className="text-xs font-mono text-red-200 whitespace-pre-wrap overflow-x-auto">{s.before}</pre>
                      </div>
                      <div className="hidden md:flex items-center justify-center text-slate-500">
                        <ArrowRight className="w-4 h-4" />
                      </div>
                      <div className="bg-emerald-950/20 border border-emerald-500/20 rounded p-2">
                        <div className="text-[10px] uppercase text-emerald-400/80 mb-1 font-semibold">{tr.afterCode}</div>
                        <pre className="text-xs font-mono text-emerald-200 whitespace-pre-wrap overflow-x-auto">{s.after}</pre>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="card space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold flex items-center gap-2"><Cpu className="w-4 h-4" /> {tr.synthTitle}</h2>
          <button className="ml-auto btn-primary text-sm flex items-center gap-1 disabled:opacity-40" disabled={!top || !!busy} onClick={onSynth}>
            {busy === 'synth' && <Loader2 className="w-4 h-4 animate-spin" />} {tr.analyzeBtn}
          </button>
        </div>
        {!stats && <p className="text-sm text-gray-400">{tr.synthDesc(top)}</p>}
        {stats && !stats.success && <p className="text-sm text-red-400 whitespace-pre-wrap">{stats.error}</p>}
        {stats?.success && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label={`LUT${stats.lut_size}`} value={stats.luts ?? 0} />
              <Stat label={tr.ffLatch} value={stats.ffs ?? 0} />
              <Stat label={tr.logicDepth} value={stats.logic_depth ?? '—'} hint="ltp: en uzun kombinasyonel yol" />
              <Stat label={tr.memCells} value={stats.mem ?? 0} />
            </div>
            <div className="space-y-1">
              {cells.map(([name, count]) => (
                <div key={name} className="flex items-center gap-2 text-xs font-mono">
                  <span className="w-40 truncate text-gray-300">{name}</span>
                  <div className="flex-1 h-3 bg-darker rounded">
                    <div className="h-3 rounded bg-primary" style={{ width: `${(count / maxCell) * 100}%` }} />
                  </div>
                  <span className="w-10 text-right">{count}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500">{stats.note}</p>
          </>
        )}
      </div>

      <div className="card space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Lint</h2>
          {lint?.success && <span className="text-xs text-gray-400">{lint.tool} · {lint.errors} · {lint.warnings}</span>}
          <button className="ml-auto btn-secondary text-sm flex items-center gap-1 disabled:opacity-40" disabled={!!busy} onClick={onLint}>
            {busy === 'lint' && <Loader2 className="w-4 h-4 animate-spin" />} {tr.runLint}
          </button>
        </div>
        {lint && !lint.success && <p className="text-sm text-red-400">{lint.error}</p>}
        {lint?.success && lint.diagnostics.length === 0 && <p className="text-sm text-green-400">{tr.noIssues}</p>}
        <div className="space-y-1">
          {lint?.diagnostics.map((d, i) => (
            <button key={i} onClick={() => onGoto(d)} className="w-full text-left text-xs px-3 py-1.5 rounded bg-darker hover:bg-slate-800 flex gap-2">
              <span className={d.severity === 'error' ? 'text-red-400' : 'text-yellow-400'}>{d.severity}</span>
              <span className="font-mono text-gray-400">{d.file}:{d.line}</span>
              <span className="text-gray-200">{d.message}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
