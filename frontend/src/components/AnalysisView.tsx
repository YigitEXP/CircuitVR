import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, Cpu, Sparkles, ArrowRight, FileCode } from 'lucide-react';
import { Diagnostic, LintResult, OptimizationReport, SynthStats, WorkspaceInfo } from '../types';
import { ws } from '../services/api';
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
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="bg-darker rounded-lg border border-slate-700 p-4" title={hint}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-gray-400 mt-1">{label}</div>
    </div>
  );
}

const IMPACT_STYLE: Record<string, string> = {
  'yüksek': 'bg-red-500/15 text-red-300 border-red-500/40',
  'orta': 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  'düşük': 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  'bilgi': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
};

export default function AnalysisView({ info, top, lint, stats, busy, onLint, onSynth, onGoto }: Props) {
  const { t: tr } = useI18n();
  const [opt, setOpt] = useState<OptimizationReport | null>(null);

  useEffect(() => {
    if (stats?.optimization) {
      setOpt(stats.optimization);
      return;
    }
    ws.optimize(info.root, top || undefined).then(setOpt).catch(() => undefined);
  }, [info.root, info.fingerprint, top, stats]);

  const rtlFiles = info.files.filter((f) => f.group === 'rtl' && !f.is_header);
  const tbFiles = info.files.filter((f) => f.group === 'tb' && !f.is_header);
  const lines = info.files.reduce((a, f) => a + f.lines, 0);
  const cells = stats?.cells ? Object.entries(stats.cells).sort((a, b) => b[1] - a[1]) : [];
  const maxCell = cells.length ? cells[0][1] : 1;
  const report = stats?.optimization ?? opt;

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label={tr.rtlFiles} value={rtlFiles.length} />
        <Stat label={tr.tbFiles} value={tbFiles.length} />
        <Stat label={tr.modules} value={Object.keys(info.modules).length} />
        <Stat label={tr.lines} value={lines} />
        <Stat label={tr.submodules} value={top && info.modules[top] ? info.modules[top].children : 0} />
      </div>

      {/* RTL Optimization Advisor */}
      <div className="card space-y-3 border-indigo-500/30">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="font-semibold flex items-center gap-2 text-indigo-300">
            <Sparkles className="w-4 h-4 text-indigo-400" /> {tr.optAdvisor}
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
          <span className="text-xs text-slate-400 ml-auto">
            {stats?.success ? tr.optActiveSynth : tr.optStaticOnly}
          </span>
        </div>

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
                      <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                        {s.category}
                      </span>
                      <span className="font-medium text-sm text-slate-100">{s.title}</span>
                      {s.file && (
                        <button
                          onClick={() => onGoto({ severity: 'warning', file: s.file, line: s.line, message: s.title })}
                          className="ml-auto flex items-center gap-1 text-xs font-mono text-indigo-400 hover:text-indigo-300 hover:underline"
                        >
                          <FileCode className="w-3.5 h-3.5" /> {s.file}:{s.line}
                        </button>
                      )}
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
