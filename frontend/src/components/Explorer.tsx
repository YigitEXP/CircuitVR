import { ReactNode, useState } from 'react';
import { ChevronDown, ChevronRight, FileCode2, Folder, Star, FlaskConical } from 'lucide-react';
import { WorkspaceInfo, WsFile } from '../types';
import { useI18n } from '../i18n';

interface Props {
  info: WorkspaceInfo;
  top: string;
  tb: string;
  activeFile: string | null;
  onOpenFile: (path: string, line?: number) => void;
  onSelectTop: (m: string) => void;
  onSelectTb: (m: string) => void;
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1 px-2 py-1 text-[11px] uppercase tracking-wide text-gray-400 hover:text-gray-200"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span className="flex-1 text-left">{title}</span>
        {right}
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

export default function Explorer({ info, top, tb, activeFile, onOpenFile, onSelectTop, onSelectTb }: Props) {
  const { t: tr } = useI18n();
  const groups: { id: 'rtl' | 'tb'; label: string }[] = [
    { id: 'rtl', label: 'rtl' },
    { id: 'tb', label: 'tb' },
  ];

  const langBadge = (f: WsFile) => {
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (ext === 'vhd' || ext === 'vhdl') return <span className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300 font-mono">VHDL</span>;
    if (ext === 'v' || ext === 'vh') return <span className="text-[9px] px-1 rounded bg-emerald-500/20 text-emerald-300 font-mono">V</span>;
    return <span className="text-[9px] px-1 rounded bg-indigo-500/20 text-indigo-300 font-mono">SV</span>;
  };

  const fileRow = (f: WsFile) => (
    <div key={f.path}>
      <button
        onClick={() => onOpenFile(f.path)}
        className={`w-full flex items-center gap-2 pl-6 pr-2 py-1 text-sm text-left hover:bg-slate-800 ${
          activeFile === f.path ? 'bg-slate-800 text-white' : 'text-gray-300'
        }`}
        title={f.path}
      >
        <FileCode2 className="w-4 h-4 text-primary flex-shrink-0" />
        <span className="truncate flex-1">{f.name}</span>
        {langBadge(f)}
      </button>
      {f.modules.map((m) => {
        const isTop = f.group === 'rtl' ? m.name === top : m.name === tb;
        return (
          <div key={m.name} className="flex items-center group">
            <button
              onClick={() => onOpenFile(f.path, m.line)}
              className="flex-1 pl-12 pr-1 py-0.5 text-xs text-left text-gray-400 hover:text-white truncate"
            >
              {m.name}
            </button>
            <button
              onClick={() => (f.group === 'rtl' ? onSelectTop(m.name) : onSelectTb(m.name))}
              title={f.group === 'rtl' ? tr.setTop : tr.setTb}
              className="px-2"
            >
              {f.group === 'rtl' ? (
                <Star className={`w-3 h-3 ${isTop ? 'text-yellow-400 fill-yellow-400' : 'text-slate-600 group-hover:text-slate-400'}`} />
              ) : (
                <FlaskConical className={`w-3 h-3 ${isTop ? 'text-green-400' : 'text-slate-600 group-hover:text-slate-400'}`} />
              )}
            </button>
          </div>
        );
      })}
    </div>
  );

  const Hier = ({ name, depth, seen }: { name: string; depth: number; seen: string[] }) => {
    const m = info.modules[name];
    if (!m || seen.includes(name)) return null;
    return (
      <>
        <button
          onClick={() => onOpenFile(m.file, m.line)}
          style={{ paddingLeft: 12 + depth * 12 }}
          className="w-full text-left pr-2 py-0.5 text-xs text-gray-300 hover:bg-slate-800 truncate"
        >
          <span className="text-slate-500 mr-1">{m.instances.length ? '▾' : '•'}</span>
          {m.name}
        </button>
        {m.instances.map((c) => (
          <Hier key={c} name={c} depth={depth + 1} seen={[...seen, name]} />
        ))}
      </>
    );
  };

  return (
    <div className="h-full overflow-y-auto select-none">
      {groups.map((g) => {
        const files = info.files.filter((f) => f.group === g.id && !f.is_header);
        return (
          <Section key={g.id} title={g.label} right={<span className="text-[10px]">{files.length}</span>}>
            {files.length === 0 && <div className="pl-6 text-xs text-slate-500">{tr.noFiles}</div>}
            {files.map(fileRow)}
          </Section>
        );
      })}
      <Section title={tr.hierTb} right={<Folder className="w-3 h-3" />}>
        {tb && info.modules[tb] ? <Hier name={tb} depth={0} seen={[]} /> : <div className="pl-6 text-xs text-slate-500">—</div>}
      </Section>
      <Section title={tr.hierTop}>
        {top && info.modules[top] ? <Hier name={top} depth={0} seen={[]} /> : <div className="pl-6 text-xs text-slate-500">—</div>}
      </Section>
    </div>
  );
}
