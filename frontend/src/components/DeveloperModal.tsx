import { X, Cpu, Shield, Terminal, Activity, ExternalLink, Sparkles } from 'lucide-react';
import { useI18n } from '../i18n';
import { APP_BUILD_TIME, APP_VERSION } from '../version';

interface Props {
  onClose: () => void;
}

export const GITHUB_URL = 'https://github.com/YigitEXP';
export const LINKEDIN_URL = 'https://www.linkedin.com/in/yi%C4%9Fit-can-akt%C3%BCrk-6b48262b6/';

export default function DeveloperModal({ onClose }: Props) {
  const { lang } = useI18n();
  const isTr = lang === 'tr';

  const stack = [
    {
      label: isTr ? 'Donanım & Silikon (RTL / FPGA)' : 'Low-Level & Hardware (RTL / FPGA)',
      items: ['SystemVerilog', 'Verilog', 'VHDL', 'FPGA Architecture', 'Vivado', 'Yosys / Verilator'],
    },
    {
      label: isTr ? 'Edge AI & Veri Bilimi' : 'Edge AI & Data Science (ML / DL)',
      items: ['1D-CNN on FPGA', 'EEG / ECG DSP', 'Scikit-Learn', 'NumPy', 'Pandas', 'Matplotlib / Seaborn'],
    },
    {
      label: isTr ? 'Backend, Güvenlik & Altyapı' : 'Backend, DevSecOps & Systems',
      items: ['Python (FastAPI)', 'Node.js / Express', 'Redis', 'Docker', 'Nginx', 'OWASP ZAP', 'Grafana k6'],
    },
    {
      label: isTr ? 'Veri Katmanı & Önyüz' : 'Data Persistence & Frontend',
      items: ['React', 'TypeScript', 'Tailwind CSS', 'MongoDB', 'SQL Server', 'SQLite'],
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="glass-strong w-full max-w-2xl max-h-[86vh] overflow-auto border border-slate-700/80 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-darker/60">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
            <Terminal className="w-3.5 h-3.5 text-primary" />
            <span>circuitvr://about-architect</span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-500">{APP_VERSION}</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-sm">
          {/* Identity header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold text-slate-100 tracking-tight">Yiğit Can Aktürk</h2>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
                  @YigitEXP
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {isTr
                  ? 'Donanım-Yazılım Ortak Tasarımı (Co-Design) · Edge AI / FPGA · T-Shaped Full Stack'
                  : 'Hardware-Software Co-Design · Edge AI on FPGA · T-Shaped Full Stack'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-darker hover:bg-slate-800 border border-slate-700 text-xs font-mono text-slate-200 transition"
              >
                GitHub <ExternalLink className="w-3 h-3 text-slate-400" />
              </a>
              <a
                href={LINKEDIN_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0077B5]/15 hover:bg-[#0077B5]/25 border border-[#0077B5]/40 text-xs font-mono text-sky-300 transition"
              >
                LinkedIn <ExternalLink className="w-3 h-3 text-sky-400" />
              </a>
            </div>
          </div>

          {/* Bio quote */}
          <p className="text-xs leading-relaxed text-slate-300 bg-darker/70 border border-slate-800/90 rounded-lg p-3.5">
            {isTr
              ? 'Yüksek seviyeli arka uç sistemleri ile düşük seviyeli silikon/FPGA mimarileri arasındaki boşluğu kapatmak için geliştiriyorum. Mühendislik benim için yalnızca kodun ekranda çalışması değil; sistemin ağır yük altında ayakta kalması ("Security by Design") ve veriyi buluta ihtiyaç duymadan doğrudan çip üzerinde sıfır gecikmeyle işlemesidir.'
              : 'Bridging the gap between high-level backend systems and low-level silicon architectures. For me, engineering isn’t just about making code work on a screen—it’s about how the system survives under heavy stress ("Security by Design") and processes raw data directly on-chip with zero latency.'}
          </p>

          {/* DevLog #03 Status Card */}
          <div className="rounded-lg bg-indigo-950/20 border border-indigo-500/30 p-3.5 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-mono font-semibold text-indigo-300">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              {isTr
                ? 'GÜNCEL ODAK · DevLog #03 — FPGA Üzerinde Derin Öğrenme (1D-CNN)'
                : 'CURRENT FOCUS · DevLog #03 — Deep Learning on FPGA (1D-CNN)'}
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {isTr
                ? 'Karmaşık insan biyosinyallerini (EEG, ECG) buluta bağımlı kalmadan, doğrudan donanım üzerinde gerçek zamanlı filtrelemek ve anomali tespiti yapmak üzere 1D-CNN ve sayısal sinyal işleme (DSP) hızlandırıcı mimarileri üzerinde çalışıyorum.'
                : 'Focusing on 1D-CNN hardware acceleration and DSP pipelines on FPGA to filter and classify complex human biosignals (EEG, ECG) directly on-chip with zero latency.'}
            </p>
          </div>

          {/* Core Pillars */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
            <div className="p-3 rounded-lg bg-darker/60 border border-slate-800 space-y-1">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-sky-400" /> Low-Level & Edge AI
              </div>
              <p className="text-slate-400 text-[11px] leading-snug">
                {isTr
                  ? 'SystemVerilog, Verilog ve VHDL ile sinir sistemi hızında gerçek zamanlı sinyal işleme donanımları.'
                  : 'Digital logic and hardware acceleration in SystemVerilog, Verilog & VHDL for real-time signal pipelines.'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-darker/60 border border-slate-800 space-y-1">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-emerald-400" /> Security by Design
              </div>
              <p className="text-slate-400 text-[11px] leading-snug">
                {isTr
                  ? 'Docker & Nginx izolasyonu, OWASP ZAP güvenlik denetimi ve Grafana k6 ile stres/kırılma testi.'
                  : 'Container isolation with Docker & Nginx, OWASP ZAP security auditing, and Grafana k6 stress testing.'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-darker/60 border border-slate-800 space-y-1">
              <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-amber-400" /> {isTr ? 'Mühendislik & Liderlik' : 'Beyond the Screen'}
              </div>
              <p className="text-slate-400 text-[11px] leading-snug">
                {isTr
                  ? 'Teknoloji toplulukları kurucu ortaklığı, teknik proje yönetimi ve açık kaynak araç geliştirme.'
                  : 'Co-founder of student tech organizations, technical project leadership, and open-source tooling.'}
              </p>
            </div>
          </div>

          {/* Tech Stack */}
          <div className="space-y-2">
            <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
              {isTr ? 'Teknoloji Yığını (Tech Stack)' : 'Tech Stack & Engineering Tools'}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {stack.map((group) => (
                <div key={group.label} className="p-2.5 rounded-lg bg-darker/50 border border-slate-800/80 space-y-1.5">
                  <div className="text-[11px] font-medium text-slate-300">{group.label}</div>
                  <div className="flex flex-wrap gap-1">
                    {group.items.map((item) => (
                      <span
                        key={item}
                        className="px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-300 font-mono text-[10px]"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Subtle footer note */}
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500 font-mono">
            <span>
              {isTr
                ? 'Açık fikir alışverişi, Ar-Ge ve yazılım/donanım staj işbirliklerine açık'
                : 'Open to R&D discussions & Software / Hardware Engineering Internships'}
            </span>
            <span>{APP_BUILD_TIME}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
