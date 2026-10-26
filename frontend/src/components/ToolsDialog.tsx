import { useState } from 'react';
import { CheckCircle2, XCircle, Loader2, ExternalLink, X, RefreshCw, Download, Compass, Settings } from 'lucide-react';
import { errMsg, ws } from '../services/api';
import { ToolStatus } from '../types';
import { useI18n } from '../i18n';

interface Props {
  tools: ToolStatus | null;
  onTools: (t: ToolStatus) => void;
  onClose: () => void;
  onStartTour: () => void;
}

const OSS = 'https://github.com/YosysHQ/oss-cad-suite-build/releases';

export default function ToolsDialog({ tools, onTools, onClose, onStartTour }: Props) {
  const { lang } = useI18n();
  const isTr = lang === 'tr';
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  const recheck = async () => {
    setBusy('check'); setMsg('');
    try { onTools(await ws.tools()); } catch (e) { setMsg(errMsg(e)); } finally { setBusy(''); }
  };
  const installWasm = async () => {
    setBusy('wasm'); setMsg(isTr ? 'Yosys (yowasp-yosys, ~17 MB) kuruluyor…' : 'Installing Yosys (yowasp-yosys, ~17 MB)…');
    try { onTools(await ws.installYosysWasm()); setMsg(isTr ? 'Kurulum tamam.' : 'Installation complete.'); } catch (e) { setMsg(errMsg(e)); } finally { setBusy(''); }
  };
  const installAll = async () => {
    setBusy('all');
    setMsg(
      isTr
        ? 'Tüm eksik araçlar (Yosys + Icarus Verilog + Verilator) otomatik indiriliyor ve kuruluyor… Bu işlem 1-2 dakika sürebilir.'
        : 'Downloading and installing all missing tools (Yosys + Icarus Verilog + Verilator)… This may take 1-2 minutes.'
    );
    try {
      const res = await ws.installAllTools();
      onTools(res.tools);
      setMsg(res.logs || (isTr ? 'Tüm araçlar başarıyla kuruldu!' : 'All tools installed successfully!'));
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="glass-strong w-full max-w-2xl max-h-[85vh] overflow-auto rounded-2xl border border-slate-700" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-700">
          <Settings className="w-4 h-4 text-primary" />
          <h3 className="font-semibold">
            {isTr ? 'Ayarlar & Araç Zinciri (Toolchain)' : 'Settings & EDA Toolchain'}
          </h3>
          <button className="ml-auto text-slate-400 hover:text-white" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          {/* Interactive Tour / Onboarding Section */}
          <div className="p-3.5 rounded-xl bg-gradient-to-r from-indigo-950/40 via-slate-900/90 to-emerald-950/30 border border-indigo-500/40 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="font-semibold text-indigo-300 flex items-center gap-1.5 text-xs">
                <Compass className="w-4 h-4 text-indigo-400" />
                {isTr ? 'Uygulama Rehberi & İnteraktif Tanıtım' : 'Application Guide & Interactive Tour'}
              </div>
              <p className="text-xs text-slate-400">
                {isTr
                  ? 'Şematik üretimi, dalga formu simülasyonu, RTL optimizasyon danışmanı ve Edge AI Lab adımlarını tekrar görüntüleyin.'
                  : 'Revisit the step-by-step walkthrough for schematics, waveform simulation, RTL optimization, and Edge AI Lab.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onStartTour();
              }}
              className="btn-primary text-xs flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 shadow-glow"
            >
              <Compass className="w-4 h-4" />
              {isTr ? 'Tanıtım Moduna Geç' : 'Enter Tour Mode'}
            </button>
          </div>

          <div className="space-y-2">
            {tools && Object.entries(tools).map(([name, t]) => (
              <div key={name} className="flex items-start gap-3 px-3 py-2 rounded-lg bg-darker/60 border border-slate-800">
                {t.found ? <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5" /> : <XCircle className="w-4 h-4 text-red-400 mt-0.5" />}
                <div className="min-w-0">
                  <div className="font-mono">{name} <span className="text-slate-500 text-xs">— {t.purpose}</span></div>
                  <div className="text-xs text-slate-400 break-all">{t.found ? t.path : (isTr ? 'Bulunamadı' : 'Not found')}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <h4 className="font-semibold text-slate-200">{isTr ? 'Kurulum seçenekleri' : 'Installation Options'}</h4>
            <ol className="list-decimal ml-5 space-y-2 text-slate-300">
              <li>
                <b>{isTr ? 'OSS CAD Suite (önerilen, hepsi bir arada):' : 'OSS CAD Suite (recommended, all-in-one):'}</b>{' '}
                {isTr ? (
                  <>
                    indirip zip'i açın (ör. <code className="font-mono">C:\oss-cad-suite</code>), sonra <code className="font-mono">Yeniden kontrol et</code>'e basın. Uygulama bu klasörü otomatik arar; PATH ayarı gerekmez.
                  </>
                ) : (
                  <>
                    download and extract (e.g. <code className="font-mono">C:\oss-cad-suite</code>), then click <code className="font-mono">Re-check</code>. Auto-detected without manual PATH edits.
                  </>
                )}
                <a className="ml-2 text-primary inline-flex items-center gap-1 hover:underline" href={OSS} target="_blank" rel="noreferrer">
                  {isTr ? 'indir' : 'download'} <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                <b>{isTr ? 'Yalnız Yosys (hızlı):' : 'Yosys Only (fast):'}</b>{' '}
                {isTr
                  ? 'aşağıdaki düğme pip ile küçük bir Yosys paketi kurar (şematik + sentez).'
                  : 'installs lightweight yowasp-yosys via pip (schematic + synthesis).'}
              </li>
              <li>
                <b>Icarus Verilog:</b> <code className="font-mono">winget install Icarus.Verilog</code> {isTr ? 'veya OSS CAD Suite.' : 'or OSS CAD Suite.'}
              </li>
              <li>
                {isTr ? (
                  <>
                    Özel klasör: <code className="font-mono">CIRCUITVR_TOOLS</code> ortam değişkenine araçların <code className="font-mono">bin</code> yolunu yazın.
                  </>
                ) : (
                  <>
                    Custom folder: set <code className="font-mono">CIRCUITVR_TOOLS</code> environment variable to your toolchain <code className="font-mono">bin</code> directory.
                  </>
                )}
              </li>
            </ol>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-secondary text-sm flex items-center gap-2" disabled={!!busy} onClick={recheck}>
              {busy === 'check' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}{' '}
              {isTr ? 'Yeniden kontrol et' : 'Re-check'}
            </button>
            <button className="btn-primary text-sm flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500" disabled={!!busy} onClick={installAll}>
              {busy === 'all' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}{' '}
              {isTr ? 'Tüm Eksik Araçları Otomatik Kur (Tek Tık)' : 'Auto-Install All Missing Tools (1-Click)'}
            </button>
            <button className="btn-secondary text-sm flex items-center gap-2" disabled={!!busy} onClick={installWasm}>
              {busy === 'wasm' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}{' '}
              {isTr ? 'Yalnızca Yosys Kur (pip)' : 'Install Yosys Only (pip)'}
            </button>
          </div>
          {msg && <p className="text-xs text-slate-300 whitespace-pre-wrap">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
