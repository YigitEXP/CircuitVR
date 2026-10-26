import { useState } from 'react';
import {
  FolderOpen, Code2, Workflow, Play, Sparkles, BrainCircuit, Wrench, CheckCircle2, ArrowRight, ArrowLeft, X, Compass,
} from 'lucide-react';
import { useI18n } from '../i18n';

export const ONBOARDING_STORAGE_KEY = 'circuitvr_hide_onboarding';

interface Props {
  onClose: () => void;
  onOpenDemo?: (demoPath: string) => void;
  onOpenTools?: () => void;
}

export default function OnboardingModal({ onClose, onOpenDemo, onOpenTools }: Props) {
  const { lang } = useI18n();
  const isTr = lang === 'tr';

  const [step, setStep] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState<boolean>(
    () => localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1'
  );

  const steps = isTr
    ? [
        {
          badge: 'Adım 1 / 5 · Başlangıç & Proje Yükleme',
          title: 'Projeni Nasıl Açar veya Yüklerim?',
          icon: FolderOpen,
          color: 'text-sky-400 bg-sky-500/15 border-sky-500/30',
          desc: 'CircuitVR, SystemVerilog (.sv), Verilog (.v) ve VHDL (.vhd) projelerini doğrudan klasör yapısıyla çalıştırır.',
          bullets: [
            {
              head: 'Sürükle & Bırak veya Klasör Seç:',
              body: 'Karşılama ekranındaki kesikli alana proje klasörünü (içinde RTL/ ve TB/ bulunan) veya doğrudan .sv / .v / .vhd dosyalarını sürükleyip bırakabilirsin.',
            },
            {
              head: 'Yerel Diskten Aç / Yeni Şablon Oluştur:',
              body: '"Gözat" ile bilgisayarındaki bir klasörü seçip "Aç" diyebilir veya boş bir klasörde "Yeni Proje Şablonu Oluştur" ile hazır dizin yapısını kurabilirsin.',
            },
            {
              head: 'Hazır Çoklu-HDL Örnekleri:',
              body: 'Hiç dosya yüklemeden denemek istersen alttaki "Traffic Light FSM (SV)", "4-Bit Counter (Verilog)" veya "8-Bit ALU (VHDL)" örneklerinden birine tıklaman yeterli.',
            },
          ],
          tip: 'İpucu: Aşağıdaki "Örnek Projeyi Hemen Aç" butonuyla tek tıkla canlı çalışma alanına geçebilirsin.',
        },
        {
          badge: 'Adım 2 / 5 · Gezgin, Kod Editörü & Top/TB Seçimi',
          title: 'Dosyalar Arası Geçiş ve Modül Ayarları',
          icon: Code2,
          color: 'text-indigo-400 bg-indigo-500/15 border-indigo-500/30',
          desc: 'Proje açıldığında sol tarafta Dosya Gezgini, üstte ise Kontrol Çubuğu yer alır.',
          bullets: [
            {
              head: 'Sol Gezgin (RTL & TB):',
              body: 'Sol menüden tasarım dosyalarını (RTL) ve testbench dosyalarını (TB) tıklayarak Monaco tabanlı kod editöründe açıp düzenleyebilirsin.',
            },
            {
              head: 'Üst Çubuktan "Top" ve "TB" Seçimi:',
              body: 'Üst bardaki "Top" kutusundan sentezlenecek ana donanım modülünü, "TB" kutusundan ise simülasyonu koşturacak testbench modülünü seç.',
            },
            {
              head: 'Kaydetme & Otomatik Lint (F7):',
              body: 'Kodda değişiklik yapıp Ctrl+S ile kaydettiğinde "Oto-lint" açıksa Verilator/Icarus üzerinden sözdizimi ve port hataları anında alt panelde listelenir.',
            },
          ],
          tip: 'İpucu: Alt paneldeki bir hataya veya uyarıya tıkladığında editör doğrudan ilgili dosya ve satıra odaklanır.',
        },
        {
          badge: 'Adım 3 / 5 · Şematik (F6) & Dalga Formu (F5)',
          title: 'Devre Şeması Çizdirme ve Sinyal Simülasyonu',
          icon: Workflow,
          color: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30',
          desc: 'Yazdığın HDL kodunun gerçek donanımda nasıl kapılara dönüştüğünü ve sinyallerin zamanla nasıl değiştiğini görselleştir.',
          bullets: [
            {
              head: 'Şematik Üret (F6 Tuşu veya Mavi "Şematik" Butonu):',
              body: 'Yosys sentez motoru RTL kodunu kapı/blok seviyesine çevirir. "Şematik" sekmesinde kapıları, mux\'ları, flip-flop\'ları ve kablo genişliklerini yakınlaştırarak inceleyebilirsin.',
            },
            {
              head: 'Simüle Et (F5 Tuşu veya Yeşil "Simüle Et" Butonu):',
              body: 'Icarus Verilog testbench\'i çalıştırır ve VCD dalga formu üretir. "Dalga Formu" sekmesinde saat darbelerini, giriş/çıkış sinyallerini ve hex/binary değerleri adım adım takip edebilirsin.',
            },
          ],
          tip: 'İpucu: Şematik görünümünde "Düzleştir (Flatten)" kutusunu işaretleyerek alt modüllerin iç yapısını tek şemada açabilirsin.',
        },
        {
          badge: 'Adım 4 / 5 · Akıllı RTL Optimizasyon Danışmanı',
          title: 'Donanım Darboğazlarını ve Hataları Yakala',
          icon: Sparkles,
          color: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
          desc: '"Analiz & Sentez" sekmesi, klasik sentez istatistiklerinin ötesinde kodunu donanım mimarisi açısından denetler.',
          bullets: [
            {
              head: 'Optimizasyon Skoru (0–100):',
              body: '"Analiz & Sentez" sekmesinde "Sentez İstatistiği" butonuna bastığında Yosys hücre sayılarıyla (LUT, FF, Latch, Kritik Yol) statik RTL analizi birleştirilir.',
            },
            {
              head: 'Önce / Sonra (Before / After) Kod Kartları:',
              body: 'İstenmeyen latch oluşumu ($dlatch), derin kombinasyonel yollar (pipeline ihtiyacı), eksik resetler ve bit genişliği uyuşmazlıkları için doğrudan "Önce / Sonra" kod düzeltme önerileri sunulur.',
            },
          ],
          tip: 'İpucu: Öneri kartlarındaki dosya:satır bağlantısına tıklayarak doğrudan ilgili kod satırına gidebilirsin.',
        },
        {
          badge: 'Adım 5 / 5 · Edge AI Lab & Otomatik Araç Kurulumu',
          title: 'Edge AI / Biyosinyal Stüdyosu ve Ayarlar',
          icon: BrainCircuit,
          color: 'text-purple-400 bg-purple-500/15 border-purple-500/30',
          desc: '"Edge AI Lab" sekmesi, Python/PyTorch modellerini FPGA sabit noktalı (Qm.n) donanıma dönüştürmek ve doğrulamak için tasarlandı.',
          bullets: [
            {
              head: '1. Hazır Model Modu vs 2. Kendi RTL/Modelim Modu:',
              body: 'İster hazır ECG/EEG şablonlarıyla sıfırdan RTL üret; ister "Kendi RTL Dosyam & Kendi Modelimle Çalış" moduna geçip projendeki .sv/.v/.vhd dosyasını otomatik algılat ve dışarıdan .json/.csv model/sinyal yükleyerek sadece kendi modülüne özel Golden Testbench üret.',
            },
            {
              head: 'Tek Tıkla Otomatik Araç Kurulumu (Ayarlar / 🔧):',
              body: 'Bilgisayarında Yosys, Icarus Verilog veya Verilator kurulu değilse sağ üstteki 🔧 (Ayarlar & Araçlar) butonuna tıklayıp "Tüm Eksik Araçları Otomatik Kur" diyerek tek tıkla kurabilirsin.',
            },
          ],
          tip: 'Not: "Bir daha gösterme" seçeneğini işaretlersen bu rehber bir daha otomatik açılmaz; istediğin zaman sağ üstteki 🔧 Ayarlar menüsünden "Tanıtım Moduna Geç" butonuyla tekrar açabilirsin.',
        },
      ]
    : [
        {
          badge: 'Step 1 / 5 · Getting Started & Loading Projects',
          title: 'How to Open or Upload Your Project',
          icon: FolderOpen,
          color: 'text-sky-400 bg-sky-500/15 border-sky-500/30',
          desc: 'CircuitVR natively supports SystemVerilog (.sv), Verilog (.v), and VHDL (.vhd) multi-file workspaces.',
          bullets: [
            {
              head: 'Drag & Drop or Upload Folder/Files:',
              body: 'Drop your project folder (containing RTL/ and TB/) or individual .sv / .v / .vhd files directly onto the dashed dropzone on the Welcome Screen.',
            },
            {
              head: 'Open Local Directory or Create Scaffold:',
              body: 'Browse a local folder on your disk and click "Open", or click "Create New Project Scaffold" to generate a ready-to-use RTL/TB directory structure.',
            },
            {
              head: 'Curated Multi-HDL Demo Projects:',
              body: 'Click "Traffic Light FSM (SV)", "4-Bit Counter (Verilog)", or "8-Bit ALU (VHDL)" on the Welcome Screen to launch a pre-configured project immediately.',
            },
          ],
          tip: 'Tip: Click "Open Demo Project Now" below to jump straight into a live workspace.',
        },
        {
          badge: 'Step 2 / 5 · Explorer, Code Editor & Top/TB Selection',
          title: 'Navigating Files and Selecting Modules',
          icon: Code2,
          color: 'text-indigo-400 bg-indigo-500/15 border-indigo-500/30',
          desc: 'Use the left Project Explorer to switch files and the Top Bar to configure synthesis and simulation targets.',
          bullets: [
            {
              head: 'Project Explorer (RTL & TB):',
              body: 'Click any file under RTL or TB in the left sidebar to edit it in the Monaco-powered HDL editor.',
            },
            {
              head: 'Selecting "Top" and "TB" in TopBar:',
              body: 'Choose your main hardware module in the "Top" dropdown for synthesis/schematic, and your testbench module in the "TB" dropdown for simulation.',
            },
            {
              head: 'Save (Ctrl+S) & Auto-Lint (F7):',
              body: 'Saving a file with Auto-Lint enabled automatically runs Verilator/Icarus static checks and lists any syntax or width issues in the bottom panel.',
            },
          ],
          tip: 'Tip: Clicking any diagnostic in the Bottom Panel jumps directly to that file and line.',
        },
        {
          badge: 'Step 3 / 5 · Gate Schematic (F6) & Waveform Sim (F5)',
          title: 'Visualizing Hardware Schematics & Waveforms',
          icon: Workflow,
          color: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30',
          desc: 'Inspect how your HDL synthesizes into logic gates and how signals behave cycle-by-cycle.',
          bullets: [
            {
              head: 'Generate Schematic (F6 or Blue "Schematic" Button):',
              body: 'Runs Yosys synthesis and renders an interactive ELKjs gate/MUX/register schematic under the "Schematic" tab.',
            },
            {
              head: 'Run Simulation (F5 or Green "Simulate" Button):',
              body: 'Compiles and runs your testbench via Icarus Verilog, then plots interactive VCD signal traces under the "Waveform" tab.',
            },
          ],
          tip: 'Tip: Toggle "Flatten" in the Schematic view to expand sub-modules into a single unified netlist.',
        },
        {
          badge: 'Step 4 / 5 · Smart RTL Optimization Advisor',
          title: 'Catch Hardware Bottlenecks & Latch Bugs',
          icon: Sparkles,
          color: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
          desc: 'The "Analysis & Synth" tab audits both your HDL source code and synthesized netlist for hardware quality.',
          bullets: [
            {
              head: 'Optimization Score (0–100):',
              body: 'Click "Synth Stats" to compute LUT/FF counts, logic depth, and an overall hardware health score.',
            },
            {
              head: 'Before / After Refactoring Cards:',
              body: 'Detects unintended latches ($dlatch), deep combinational paths needing pipelining, missing resets, and width mismatches with side-by-side Before/After code fixes.',
            },
          ],
          tip: 'Tip: Click the file:line badge on any advisor card to jump straight to the offending RTL line.',
        },
        {
          badge: 'Step 5 / 5 · Edge AI Lab & 1-Click Toolchain Setup',
          title: 'Edge AI / Biosignal Co-Design & Settings',
          icon: BrainCircuit,
          color: 'text-purple-400 bg-purple-500/15 border-purple-500/30',
          desc: 'Bridge Python/PyTorch float models and bit-exact fixed-point (Qm.n) hardware in the "Edge AI Lab" tab.',
          bullets: [
            {
              head: '1. Preset Templates vs 2. My Own RTL & Custom Model:',
              body: 'Either synthesize standalone ECG/EEG 1D-CNN cores from presets, OR switch to "Work with My Own RTL & Custom Model" to auto-detect your workspace .sv/.v/.vhd ports/weights, upload .json/.csv models, and generate a Golden Testbench for your own module.',
            },
            {
              head: '1-Click Toolchain Installer (Settings / 🔧):',
              body: 'Missing Yosys, Icarus, or Verilator? Click the 🔧 icon in the top-right and press "Auto-Install All Missing Tools".',
            },
          ],
          tip: 'Note: If you check "Don\'t show again", you can always reopen this guide from Settings (🔧) -> "Enter Tour Mode".',
        },
      ];

  const current = steps[step];
  const Icon = current.icon;

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={handleClose}
    >
      <div
        className="glass-strong w-full max-w-3xl rounded-2xl border border-slate-700/80 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-gradient-to-r from-indigo-950/50 via-slate-900 to-emerald-950/30">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/15 border border-primary/30 text-primary">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                {isTr ? 'CircuitVR İnteraktif Kullanım & Tanıtım Rehberi' : 'CircuitVR Interactive Onboarding & Tour'}
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {step + 1} / {steps.length}
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                {isTr
                  ? 'Adım adım devre şeması, dalga formu simülasyonu, RTL optimizasyonu ve Edge AI kullanımı'
                  : 'Step-by-step guide to schematics, waveform simulation, RTL optimization, and Edge AI Lab'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title={isTr ? 'Kapat' : 'Close'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step Progress Pills */}
        <div className="px-6 pt-3 pb-1 flex items-center gap-1.5 bg-slate-950/40">
          {steps.map((s, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setStep(idx)}
              className={`h-2 flex-1 rounded-full transition-all ${
                idx === step
                  ? 'bg-indigo-500 shadow-[0_0_10px_#6366f1]'
                  : idx < step
                  ? 'bg-emerald-500/60 hover:bg-emerald-400'
                  : 'bg-slate-800 hover:bg-slate-700'
              }`}
              title={s.title}
            />
          ))}
        </div>

        {/* Step Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-2xl border flex-shrink-0 ${current.color}`}>
              <Icon className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-mono uppercase tracking-wider text-indigo-400">{current.badge}</div>
              <h3 className="text-lg font-bold text-slate-100">{current.title}</h3>
              <p className="text-xs text-slate-300 leading-relaxed">{current.desc}</p>
            </div>
          </div>

          <div className="space-y-2.5">
            {current.bullets.map((b, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3 rounded-xl bg-darker/80 border border-slate-800/90 hover:border-slate-700 transition"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed">
                  <span className="font-semibold text-slate-100 mr-1.5">{b.head}</span>
                  <span className="text-slate-300">{b.body}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/30 text-xs text-indigo-200 flex flex-wrap items-center justify-between gap-2">
            <span>{current.tip}</span>
            {step === 0 && onOpenDemo && (
              <button
                type="button"
                onClick={() => {
                  handleClose();
                  onOpenDemo('demo://traffic_light_sv');
                }}
                className="tool-btn bg-indigo-600 hover:bg-indigo-500 text-white text-xs flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" />
                {isTr ? 'Örnek Projeyi Hemen Aç' : 'Open Demo Project Now'}
              </button>
            )}
            {step === 4 && onOpenTools && (
              <button
                type="button"
                onClick={() => {
                  handleClose();
                  onOpenTools();
                }}
                className="tool-btn bg-emerald-600 hover:bg-emerald-500 text-white text-xs flex items-center gap-1.5"
              >
                <Wrench className="w-3.5 h-3.5" />
                {isTr ? 'Ayarlar & Araç Kurulumunu Aç' : 'Open Settings & Tools'}
              </button>
            )}
          </div>
        </div>

        {/* Footer with "Don't show again" and Navigation */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950/70 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="rounded border-slate-600 accent-indigo-500 w-3.5 h-3.5"
            />
            <span>
              {isTr
                ? 'Bir daha gösterme (Ayarlar -> "Tanıtım Moduna Geç" ile açılabilir)'
                : "Don't show again (Reopen anytime via Settings -> 'Enter Tour Mode')"}
            </span>
          </label>

          <div className="flex items-center gap-2 ml-auto">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="btn-secondary text-xs flex items-center gap-1.5 py-1.5 px-3"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {isTr ? 'Önceki' : 'Back'}
              </button>
            )}

            {step < steps.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
                className="btn-primary text-xs flex items-center gap-1.5 py-1.5 px-4 bg-indigo-600 hover:bg-indigo-500"
              >
                {isTr ? 'Sonraki Adım' : 'Next Step'}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleClose}
                className="btn-primary text-xs flex items-center gap-1.5 py-1.5 px-4 bg-emerald-600 hover:bg-emerald-500"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {isTr ? 'Anladım, Başla!' : 'Got It, Start!'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
