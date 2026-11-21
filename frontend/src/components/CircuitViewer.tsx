import { Loader2, Workflow, Cpu, Layers } from 'lucide-react';
import { SchematicGraph } from '../types';
import SchematicViewer from './SchematicViewer';
import { useI18n } from '../i18n';

interface Props {
  graph: SchematicGraph | null;
  top: string;
  busy: boolean;
  stale: boolean;
  error: string;
  flatten: boolean;
  onFlatten: (v: boolean) => void;
  onGenerate: () => void;
}

export default function CircuitViewer({ graph, top, busy, stale, error, flatten, onFlatten, onGenerate }: Props) {
  const { t: tr } = useI18n();

  return (
    <div className="h-full flex flex-col overflow-auto">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-slate-700 bg-dark text-sm">
        <button
          className="px-3 py-1 rounded bg-primary hover:bg-blue-600 text-white flex items-center gap-1.5 disabled:opacity-40 shadow-sm"
          disabled={!top || busy}
          onClick={onGenerate}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Workflow className="w-4 h-4" />}
          {tr.generateSchematic}
        </button>
        <span className="text-xs font-mono text-slate-400">top: {top || '—'}</span>
        <label className="flex items-center gap-1 text-xs text-slate-300 cursor-pointer">
          <input type="checkbox" checked={flatten} onChange={(e) => onFlatten(e.target.checked)} />
          <Layers className="w-3.5 h-3.5 text-slate-400" />
          <span>Flatten</span>
        </label>
        {stale && graph && (
          <span className="text-xs text-amber-400 font-mono flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
            {tr.schematicStale}
          </span>
        )}
      </div>
      {error && <p className="m-3 text-sm text-red-400 whitespace-pre-wrap font-mono">{error}</p>}
      {graph ? (
        <div className="p-3 flex-1 min-h-0">
          <SchematicViewer graph={graph} />
        </div>
      ) : (
        !error && (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="max-w-md w-full glass-strong p-6 rounded-xl border border-slate-700/80 shadow-glass flex flex-col items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary">
                <Cpu className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-slate-200">{tr.schematicZeroTitle}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{tr.schematicZeroDesc(top)}</p>
              </div>
              <button
                type="button"
                disabled={!top || busy}
                onClick={onGenerate}
                className="btn-primary w-full py-2 px-4 text-xs font-semibold flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Workflow className="w-4 h-4" />}
                {tr.generateSchematic} (F6)
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}
