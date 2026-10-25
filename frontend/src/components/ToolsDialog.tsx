import { useState } from 'react';
import { CheckCircle2, XCircle, Loader2, ExternalLink, X, RefreshCw, Download } from 'lucide-react';
import { errMsg, ws } from '../services/api';
import { ToolStatus } from '../types';

interface Props {
  tools: ToolStatus | null;
  onTools: (t: ToolStatus) => void;
  onClose: () => void;
}

const OSS = 'https://github.com/YosysHQ/oss-cad-suite-build/releases';

export default function ToolsDialog({ tools, onTools, onClose }: Props) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  const recheck = async () => {
    setBusy('check'); setMsg('');
    try { onTools(await ws.tools()); } catch (e) { setMsg(errMsg(e)); } finally { setBusy(''); }
  };
  const installWasm = async () => {
    setBusy('wasm'); setMsg('Yosys (yowasp-yosys, ~17 MB) kuruluyor…');
    try { onTools(await ws.installYosysWasm()); setMsg('Kurulum tamam.'); } catch (e) { setMsg(errMsg(e)); } finally { setBusy(''); }
  };
  const installAll = async () => {
    setBusy('all'); setMsg('Tüm eksik araçlar (Yosys + Icarus Verilog + Verilator) otomatik indiriliyor ve kuruluyor… Bu işlem 1-2 dakika sürebilir.');
    try {
      const res = await ws.installAllTools();
      onTools(res.tools);
      setMsg(res.logs || 'Tüm araçlar başarıyla kuruldu!');
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="glass-strong w-full max-w-2xl max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center px-5 py-3 border-b border-slate-700">
          <h3 className="font-semibold">Araç Zinciri (Toolchain)</h3>
          <button className="ml-auto text-slate-400 hover:text-white" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <div className="space-y-2">
            {tools && Object.entries(tools).map(([name, t]) => (
              <div key={name} className="flex items-start gap-3 px-3 py-2 rounded-lg bg-darker/60 border border-slate-800">
                {t.found ? <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5" /> : <XCircle className="w-4 h-4 text-red-400 mt-0.5" />}
                <div className="min-w-0">
                  <div className="font-mono">{name} <span className="text-slate-500 text-xs">— {t.purpose}</span></div>
                  <div className="text-xs text-slate-400 break-all">{t.found ? t.path : 'Bulunamadı'}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-slate-200">Kurulum seçenekleri</h4>
            <ol className="list-decimal ml-5 space-y-2 text-slate-300">
              <li>
                <b>OSS CAD Suite (önerilen, hepsi bir arada):</b> indirip zip'i açın (ör. <code className="font-mono">C:\oss-cad-suite</code>),
                sonra <code className="font-mono">Yeniden kontrol et</code>'e basın. Uygulama bu klasörü otomatik arar; PATH ayarı gerekmez.
                <a className="ml-2 text-primary inline-flex items-center gap-1 hover:underline" href={OSS} target="_blank" rel="noreferrer">
                  indir <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <b>Yalnız Yosys (hızlı):</b> aşağıdaki düğme pip ile küçük bir Yosys paketi kurar (şematik + sentez).
              </li>
              <li>
                <b>Icarus Verilog:</b> <code className="font-mono">winget install Icarus.Verilog</code> veya OSS CAD Suite.
              </li>
              <li>
                Özel klasör: <code className="font-mono">CIRCUITVR_TOOLS</code> ortam değişkenine araçların <code className="font-mono">bin</code> yolunu yazın.
              </li>
            </ol>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-secondary text-sm flex items-center gap-2" disabled={!!busy} onClick={recheck}>
              {busy === 'check' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Yeniden kontrol et
            </button>
            <button className="btn-primary text-sm flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500" disabled={!!busy} onClick={installAll}>
              {busy === 'all' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Tüm Eksik Araçları Otomatik Kur (Tek Tık)
            </button>
            <button className="btn-secondary text-sm flex items-center gap-2" disabled={!!busy} onClick={installWasm}>
              {busy === 'wasm' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Yalnızca Yosys Kur (pip)
            </button>
          </div>
          {msg && <p className="text-xs text-slate-300 whitespace-pre-wrap">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
