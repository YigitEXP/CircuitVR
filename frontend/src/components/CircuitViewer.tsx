import { Loader2, Workflow } from 'lucide-react';
import { SchematicGraph } from '../types';
import SchematicViewer from './SchematicViewer';

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
  return (
    <div className="h-full flex flex-col overflow-auto">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-slate-700 bg-dark text-sm">
        <button
          className="px-3 py-1 rounded bg-primary hover:bg-blue-600 text-white flex items-center gap-1 disabled:opacity-40"
          disabled={!top || busy}
          onClick={onGenerate}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Workflow className="w-4 h-4" />}
          Şematik Üret
        </button>
        <span className="text-xs text-gray-400">top: {top || '—'}</span>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={flatten} onChange={(e) => onFlatten(e.target.checked)} /> Flatten
        </label>
        {stale && graph && <span className="text-xs text-yellow-400">● Kaynak değişti, şematik güncel değil</span>}
      </div>
      {error && <p className="m-3 text-sm text-red-400 whitespace-pre-wrap">{error}</p>}
      {graph ? (
        <div className="p-3 flex-1 min-h-0">
          <SchematicViewer graph={graph} />
        </div>
      ) : (
        !error && (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Yosys ile gerçek netlist'ten şematik üretmek için "Şematik Üret"e basın.
          </div>
        )
      )}
    </div>
  );
}
