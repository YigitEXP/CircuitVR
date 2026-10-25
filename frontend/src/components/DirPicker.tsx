import { useCallback, useEffect, useState } from 'react';
import { ArrowUp, Folder, HardDrive, Loader2, X, CheckCircle2 } from 'lucide-react';
import { errMsg, ws } from '../services/api';
import { DirListing } from '../types';

interface Props {
  start?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

/** Uygulama içi klasör gezgini: tarayıcı kısıtlarına takılmadan gerçek yol seçer. */
export default function DirPicker({ start, onSelect, onClose }: Props) {
  const [data, setData] = useState<DirListing | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setErr('');
    try {
      setData(await ws.listDir(p));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(start ?? ''); }, [load, start]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="glass-strong w-full max-w-xl flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700">
          <h3 className="font-semibold text-sm">Klasör seç</h3>
          <button className="ml-auto text-slate-400 hover:text-white" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800 text-xs font-mono">
          <button
            className="p-1 rounded hover:bg-slate-700 disabled:opacity-30"
            disabled={!data || data.parent === null}
            onClick={() => data && load(data.parent ?? '')}
            title="Üst klasör"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
          <span className="truncate text-slate-300">{data?.path || 'Bu bilgisayar'}</span>
          {loading && <Loader2 className="w-4 h-4 animate-spin ml-auto" />}
          {data?.is_project && <span className="ml-auto flex items-center gap-1 text-green-400"><CheckCircle2 className="w-3.5 h-3.5" />rtl/tb bulundu</span>}
        </div>
        <div className="flex-1 overflow-auto p-2 min-h-[240px]">
          {err && <p className="p-3 text-sm text-red-400">{err}</p>}
          {data?.dirs.map((d) => (
            <button
              key={d.path}
              onClick={() => load(d.path)}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm text-left hover:bg-primary/15 hover:text-white text-slate-300"
            >
              {data.path === '' && /^[A-Z]:$/.test(d.name) ? <HardDrive className="w-4 h-4 text-accent" /> : <Folder className="w-4 h-4 text-primary" />}
              <span className="truncate">{d.name}</span>
            </button>
          ))}
          {data && data.dirs.length === 0 && !err && <p className="p-3 text-xs text-slate-500">Alt klasör yok</p>}
        </div>
        <div className="flex items-center gap-2 px-4 py-3 border-t border-slate-700">
          <span className="text-[11px] text-slate-500 truncate flex-1">{data?.path}</span>
          <button className="btn-secondary text-sm" onClick={onClose}>İptal</button>
          <button className="btn-primary text-sm" disabled={!data?.path} onClick={() => data?.path && onSelect(data.path)}>
            Bu klasörü seç
          </button>
        </div>
      </div>
    </div>
  );
}
