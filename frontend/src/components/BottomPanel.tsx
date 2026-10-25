import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Diagnostic, LogLine } from '../types';
import { useI18n } from '../i18n';

interface Props {
  problems: Diagnostic[];
  logs: LogLine[];
  simLog: string;
  onGoto: (d: Diagnostic) => void;
}

export default function BottomPanel({ problems, logs, simLog, onGoto }: Props) {
  const { t: tr } = useI18n();
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<'problems' | 'console' | 'sim'>('problems');
  const errors = problems.filter((p) => p.severity === 'error').length;

  const tabBtn = (id: typeof tab, label: string) => (
    <button
      onClick={() => { setTab(id); setOpen(true); }}
      className={`px-3 py-1 text-xs ${tab === id && open ? 'text-white border-b-2 border-primary' : 'text-gray-400 hover:text-gray-200'}`}
    >
      {label}
    </button>
  );

  return (
    <div className={`border-t border-slate-700 bg-dark flex flex-col ${open ? 'h-52' : 'h-8'} flex-shrink-0`}>
      <div className="flex items-center h-8 flex-shrink-0 border-b border-slate-800">
        {tabBtn('problems', `${tr.problems} (${problems.length}${errors ? `, ${errors}` : ''})`)}
        {tabBtn('console', tr.output)}
        {tabBtn('sim', tr.simOutput)}
        <button className="ml-auto px-3 text-gray-400" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>
      {open && (
        <div className="flex-1 overflow-auto font-mono text-xs p-2">
          {tab === 'problems' && (
            problems.length === 0 ? <div className="text-gray-500 p-1">{tr.noProblems}</div> :
            problems.map((p, i) => (
              <button key={i} onClick={() => onGoto(p)} className="w-full text-left flex gap-3 px-2 py-0.5 hover:bg-slate-800 rounded">
                <span className={p.severity === 'error' ? 'text-red-400' : 'text-yellow-400'}>{p.severity === 'error' ? '✖' : '⚠'}</span>
                <span className="text-gray-400">{p.file}:{p.line}</span>
                <span className="text-gray-200 whitespace-pre-wrap">{p.message}</span>
                {p.source && <span className="ml-auto text-slate-500">{p.source}</span>}
              </button>
            ))
          )}
          {tab === 'console' && logs.map((l, i) => (
            <div key={i} className={l.level === 'error' ? 'text-red-400' : l.level === 'ok' ? 'text-green-400' : 'text-gray-300'}>
              <span className="text-slate-500">{l.t}</span> {l.text}
            </div>
          ))}
          {tab === 'sim' && <pre className="whitespace-pre-wrap text-gray-300">{simLog || tr.noSimOutput}</pre>}
        </div>
      )}
    </div>
  );
}
