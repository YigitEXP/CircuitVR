import { useMemo, useState } from 'react';
import {
  Activity,
  Check,
  Clock,
  Code2,
  Copy,
  Play,
  RotateCcw,
  Wand2,
  X,
} from 'lucide-react';
import { WorkspaceInfo } from '../types';
import { useI18n } from '../i18n';

interface PortConfig {
  name: string;
  width: number;
  type: 'clock' | 'reset' | 'data';
  valuesStr: string;
  radix: 'hex' | 'dec' | 'bin';
}

interface Props {
  isOpen?: boolean;
  onClose: () => void;
  info?: WorkspaceInfo | null;
  activeTop: string;
  fileContent?: string;
  activeCode?: string;
  onSaveTb: (tbFileName: string, tbContent: string, tbModuleName: string) => void;
}

export default function VisualTbBuilderModal({
  isOpen = true,
  onClose,
  activeTop,
  fileContent = '',
  activeCode,
  onSaveTb,
}: Props) {
  const { lang } = useI18n();
  const isTr = lang === 'tr';

  const [clkPeriodNs, setClkPeriodNs] = useState(10);
  const [rstActiveHigh, setRstActiveHigh] = useState(true);
  const [rstDurationNs, setRstDurationNs] = useState(20);
  const [simCycles, setSimCycles] = useState(10);
  const [copied, setCopied] = useState(false);

  // Extract input ports from active top / fileContent
  const defaultPorts: PortConfig[] = useMemo(() => {
    const ports: PortConfig[] = [];
    const targetCode = activeCode || fileContent;

    const portRegex = /\binput\s+(?:(logic|wire|reg|bit)\s+)?(?:\[([\w\s\-\+\*\/:]+)\]\s+)?([a-zA-Z_]\w*)/g;
    let m: RegExpExecArray | null;

    while ((m = portRegex.exec(targetCode)) !== null) {
      const range = m[2] || '';
      const name = m[3];
      let width = 1;

      if (range) {
        const rm = /\[\s*([\w\s\-\+\*\/]+)\s*:\s*([\w\s\-\+\*\/]+)\s*\]/.exec(range);
        if (rm) {
          const msb = parseInt(rm[1], 10);
          const lsb = parseInt(rm[2], 10);
          if (!isNaN(msb) && !isNaN(lsb)) {
            width = Math.max(1, Math.abs(msb - lsb) + 1);
          } else {
            width = 8;
          }
        }
      }

      const isClock = /^(clk|clock)/i.test(name);
      const isReset = /^(rst|reset|rst_n)/i.test(name);

      ports.push({
        name,
        width,
        type: isClock ? 'clock' : isReset ? 'reset' : 'data',
        valuesStr: isClock || isReset ? '' : width === 1 ? '1, 1, 1, 0, 1' : '10, 20, 30, 40, 50',
        radix: width > 1 ? 'hex' : 'bin',
      });
    }

    if (ports.length === 0) {
      ports.push({ name: 'clk', width: 1, type: 'clock', valuesStr: '', radix: 'bin' });
      ports.push({ name: 'rst', width: 1, type: 'reset', valuesStr: '', radix: 'bin' });
      ports.push({ name: 'valid_in', width: 1, type: 'data', valuesStr: '1, 1, 1, 0, 1', radix: 'bin' });
      ports.push({ name: 'data_in', width: 8, type: 'data', valuesStr: '10, 20, 30, 40, 50', radix: 'hex' });
    }

    return ports;
  }, [activeCode, fileContent, activeTop]);

  const [ports, setPorts] = useState<PortConfig[]>(defaultPorts);

  if (isOpen === false) return null;

  const topName = activeTop || 'top_module';
  const tbModuleName = `tb_${topName}`;
  const tbFileName = `tb/tb_${topName}.sv`;

  const handleUpdatePort = (idx: number, updates: Partial<PortConfig>) => {
    setPorts((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...updates };
      return next;
    });
  };

  const handleQuickFill = (idx: number, pattern: 'zeros' | 'count' | 'random' | 'pulse') => {
    const p = ports[idx];
    const n = simCycles;
    let vals: string[] = [];
    if (pattern === 'zeros') {
      vals = Array(n).fill('0');
    } else if (pattern === 'count') {
      vals = Array.from({ length: n }, (_, i) => String(i + 1));
    } else if (pattern === 'random') {
      const max = (1 << Math.min(p.width, 8)) - 1;
      vals = Array.from({ length: n }, () => String(Math.floor(Math.random() * max)));
    } else if (pattern === 'pulse') {
      vals = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? '1' : '0'));
    }
    handleUpdatePort(idx, { valuesStr: vals.join(', ') });
  };

  // Generate SystemVerilog testbench
  const generatedTbCode = `\`timescale 1ns/1ps

module ${tbModuleName};
    localparam int CLK_PERIOD = ${clkPeriodNs};

    // Testbench Sinyalleri
${ports
  .map((p) => {
    const range = p.width > 1 ? `[${p.width - 1}:0] ` : '';
    return `    logic ${range}${p.name} = '0;`;
  })
  .join('\n')}

    // DUT (Device Under Test) Orneklemesi
    ${topName} dut (
${ports.map((p, i) => `        .${p.name}(${p.name})${i < ports.length - 1 ? ',' : ''}`).join('\n')}
    );

    // Saat Ureteci (${(1000 / clkPeriodNs).toFixed(0)} MHz)
    always #(CLK_PERIOD / 2) clk = ~clk;

    initial begin
        // VCD Dalga Formu Kaydi
        $dumpfile("wave.vcd");
        $dumpvars(0, ${tbModuleName});

        // 1. Reset Dizisi
        rst = ${rstActiveHigh ? "1'b1" : "1'b0"};
        #${rstDurationNs};
        rst = ${rstActiveHigh ? "1'b0" : "1'b1"};
        @(posedge clk);

        // 2. Gorsel Testbench Tarafindan Olusturulan Zaman Adimli Uyari Girisleri
${(() => {
  const dataPorts = ports.filter((p) => p.type === 'data');
  if (dataPorts.length === 0) return '        // Veri portu tanimlanmadi\n';
  let lines = '';
  for (let cycle = 0; cycle < simCycles; cycle++) {
    lines += `        // --- Cevrim ${cycle + 1} ---\n`;
    dataPorts.forEach((p) => {
      const parts = p.valuesStr.split(',').map((s) => s.trim()).filter(Boolean);
      const val = parts[cycle] ?? '0';
      const prefix = p.radix === 'hex' ? `${p.width}'h` : p.radix === 'bin' ? `${p.width}'b` : `${p.width}'d`;
      lines += `        ${p.name} <= ${prefix}${val};\n`;
    });
    lines += `        @(posedge clk);\n`;
  }
  return lines;
})()}

        // 3. Simülasyonu Sonlandir
        #20;
        $display("[INFO] Gorsel testbench calismasi tamamlandi.");
        $finish;
    end

endmodule
`;

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedTbCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveAndSim = () => {
    onSaveTb(tbFileName, generatedTbCode, tbModuleName);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="flex flex-col w-full max-w-5xl h-[88vh] bg-dark rounded-2xl border border-slate-700 shadow-2xl overflow-hidden">
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-darker">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/15 border border-primary/30 text-primary">
              <Wand2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>{isTr ? 'Görsel Testbench Oluşturucu' : 'Visual Testbench Builder'}</span>
                <span className="text-xs font-mono font-normal px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                  {topName}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                {isTr
                  ? 'Giriş portlarına zaman adımlı değerler vererek tek tıkla standart SystemVerilog testbench üretin.'
                  : 'Specify cycle-accurate stimulus vectors and generate an IEEE 1800-2012 testbench with 1-click.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: Configuration & Stimulus Table */}
          <div className="flex-1 flex flex-col min-h-0 border-r border-slate-800 p-4 overflow-y-auto space-y-4">
            {/* Global Timing Setup */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs font-mono">
              <label className="space-y-1">
                <span className="text-slate-400 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-indigo-400" />
                  {isTr ? 'Saat Periyodu (ns):' : 'Clock Period (ns):'}
                </span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={clkPeriodNs}
                  onChange={(e) => setClkPeriodNs(Math.max(1, parseInt(e.target.value, 10) || 10))}
                  className="input-field text-xs py-1.5 font-mono w-full"
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-400 flex items-center gap-1">
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                  {isTr ? 'Reset Süresi (ns):' : 'Reset Duration (ns):'}
                </span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={rstDurationNs}
                  onChange={(e) => setRstDurationNs(Math.max(1, parseInt(e.target.value, 10) || 20))}
                  className="input-field text-xs py-1.5 font-mono w-full"
                />
              </label>

              <label className="space-y-1">
                <span className="text-slate-400 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5 text-sky-400" />
                  {isTr ? 'Reset Kutupluluğu:' : 'Reset Polarity:'}
                </span>
                <select
                  value={rstActiveHigh ? 'high' : 'low'}
                  onChange={(e) => setRstActiveHigh(e.target.value === 'high')}
                  className="input-field text-xs py-1.5 font-mono w-full bg-slate-900 border border-slate-700"
                >
                  <option value="high">Active High (rst=1)</option>
                  <option value="low">Active Low (rst_n=0)</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-slate-400 flex items-center gap-1">
                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                  {isTr ? 'Çevrim Sayısı:' : 'Stimulus Cycles:'}
                </span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={simCycles}
                  onChange={(e) => setSimCycles(Math.max(1, parseInt(e.target.value, 10) || 10))}
                  className="input-field text-xs py-1.5 font-mono w-full"
                />
              </label>
            </div>

            {/* Stimulus Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 font-mono">
                  {isTr ? 'Giriş Portları ve Zaman Adımlı Uyarıcı Listesi' : 'Input Ports & Timed Stimulus Vectors'}
                </span>
                <span className="text-[11px] text-slate-500 font-mono">
                  {isTr ? 'Virgülle ayrılmış değerler' : 'Comma-separated values per cycle'}
                </span>
              </div>

              <div className="space-y-2">
                {ports.map((p, idx) => {
                  const isSys = p.type === 'clock' || p.type === 'reset';
                  return (
                    <div
                      key={p.name}
                      className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2 text-xs font-mono"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sky-400">{p.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                            {p.width > 1 ? `[${p.width - 1}:0]` : '1-bit'}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 uppercase">
                            {p.type}
                          </span>
                        </div>

                        {!isSys && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-slate-500">
                              {isTr ? 'Hızlı Doldur:' : 'Quick Fill:'}
                            </span>
                            <button
                              onClick={() => handleQuickFill(idx, 'zeros')}
                              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                            >
                              0
                            </button>
                            <button
                              onClick={() => handleQuickFill(idx, 'count')}
                              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                            >
                              1..N
                            </button>
                            <button
                              onClick={() => handleQuickFill(idx, 'random')}
                              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                            >
                              Rand
                            </button>
                            <button
                              onClick={() => handleQuickFill(idx, 'pulse')}
                              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]"
                            >
                              Pulse
                            </button>
                          </div>
                        )}
                      </div>

                      {!isSys ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={p.valuesStr}
                            onChange={(e) => handleUpdatePort(idx, { valuesStr: e.target.value })}
                            placeholder="örn: 10, 20, 30, 40..."
                            className="input-field text-xs py-1.5 font-mono flex-1"
                          />
                          <select
                            value={p.radix}
                            onChange={(e) => handleUpdatePort(idx, { radix: e.target.value as any })}
                            className="input-field text-xs py-1.5 font-mono w-20"
                          >
                            <option value="hex">HEX</option>
                            <option value="dec">DEC</option>
                            <option value="bin">BIN</option>
                          </select>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500 italic">
                          {p.type === 'clock'
                            ? (isTr ? 'Otomatik üretilir (always #(CLK_PERIOD/2) clk = ~clk;)' : 'Auto-generated by clock driver task.')
                            : (isTr ? 'Reset periyodu sonunda otomatik deassert edilir.' : 'Auto-deasserted after reset duration.')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: Code Preview & Actions */}
          <div className="w-full lg:w-[460px] flex flex-col min-h-0 bg-slate-950/90 text-xs font-mono">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/70 text-slate-400">
              <span className="flex items-center gap-1.5 text-slate-200">
                <Code2 className="w-3.5 h-3.5 text-indigo-400" />
                <span>{tbFileName}</span>
              </span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? (isTr ? 'Kopyalandı' : 'Copied') : (isTr ? 'Kopyala' : 'Copy')}</span>
              </button>
            </div>

            <pre className="flex-1 p-3 overflow-auto text-[11px] text-slate-300 leading-relaxed font-mono whitespace-pre bg-darker/90">
              {generatedTbCode}
            </pre>

            <div className="p-3 border-t border-slate-800 bg-darker flex items-center gap-2">
              <button
                onClick={handleSaveAndSim}
                className="btn-primary flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 shadow-none hover:shadow-glow"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{isTr ? 'Projeye Aktar & Simüle Et' : 'Save & Run Simulation'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
