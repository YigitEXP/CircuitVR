/**
 * Visual Table-Based Test Scenario Builder (Kolay Test Senaryosu Olusturucu)
 * Enables engineers and students to visually configure cycle-by-cycle stimulus vectors
 * in a spreadsheet-like matrix without writing tedious #10 or @(posedge clk) Verilog syntax.
 * 
 * Complies with strict Engineering Manifesto: ZERO EMOJIS, technical rigor.
 */

import { useMemo, useState } from 'react';
import {
  Activity,
  Check,
  Clock,
  Code2,
  Copy,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { useI18n } from '../i18n';

export interface VisualPort {
  name: string;
  width: number;
}

interface Props {
  isOpen?: boolean;
  onClose: () => void;
  activeTop: string;
  activeCode: string;
  onSaveTb: (tbFileName: string, tbContent: string, tbModuleName: string) => void;
}

export default function VisualTbModal({
  isOpen = true,
  onClose,
  activeTop,
  activeCode = '',
  onSaveTb,
}: Props) {
  const { lang } = useI18n();
  const isTr = lang === 'tr';

  const [clkPeriodNs, setClkPeriodNs] = useState<number>(10);
  const [rstDurationNs, setRstDurationNs] = useState<number>(20);
  const [rstActiveHigh, setRstActiveHigh] = useState<boolean>(true);
  const [showCodePreview, setShowCodePreview] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // 1. Detect input ports from activeCode
  const detectedPorts: VisualPort[] = useMemo(() => {
    const list: VisualPort[] = [];
    const target = activeCode;
    const portRegex = /\binput\s+(?:(logic|wire|reg|bit)\s+)?(?:\[([\w\s\-\+\*\/:]+)\]\s+)?([a-zA-Z_]\w*)/g;
    let m: RegExpExecArray | null;

    while ((m = portRegex.exec(target)) !== null) {
      const range = m[2] || '';
      const name = m[3];
      if (/^(clk|clock|rst|rst_n|reset|reset_n)$/i.test(name)) continue;

      let width = 1;
      if (range) {
        const rm = /\[\s*([\w\s\-\+\*\/]+)\s*:\s*([\w\s\-\+\*\/]+)\s*\]/.exec(range);
        if (rm) {
          const hi = parseInt(rm[1], 10);
          const lo = parseInt(rm[2], 10);
          if (!isNaN(hi) && !isNaN(lo)) {
            width = Math.abs(hi - lo) + 1;
          } else {
            width = 8;
          }
        }
      }
      list.push({ name, width });
    }

    if (list.length === 0) {
      list.push({ name: 'valid_in', width: 1 });
      list.push({ name: 'data_in', width: 8 });
    }
    return list;
  }, [activeCode]);

  // 2. Cycle-by-cycle matrix: array of rows
  const [cycleRows, setCycleRows] = useState<Record<string, string>[]>(() => {
    const initialRows: Record<string, string>[] = [];
    const count = 5;
    for (let c = 0; c < count; c++) {
      const row: Record<string, string> = {};
      detectedPorts.forEach((p) => {
        row[p.name] = p.width === 1 ? (c === 3 ? '0' : '1') : String((c + 1) * 10);
      });
      initialRows.push(row);
    }
    return initialRows;
  });

  if (isOpen === false) return null;

  const topName = activeTop || 'top_module';
  const tbModuleName = `tb_${topName}`;
  const tbFileName = `tb/tb_${topName}.sv`;

  const handleCellChange = (cycleIdx: number, portName: string, val: string) => {
    setCycleRows((prev) => {
      const copy = [...prev];
      copy[cycleIdx] = { ...copy[cycleIdx], [portName]: val };
      return copy;
    });
  };

  const handleAddCycle = () => {
    const lastRow = cycleRows[cycleRows.length - 1] || {};
    const newRow: Record<string, string> = {};
    detectedPorts.forEach((p) => {
      if (p.width === 1) {
        newRow[p.name] = '1';
      } else {
        const lastNum = parseInt(lastRow[p.name] || '0', 10);
        newRow[p.name] = isNaN(lastNum) ? '10' : String(lastNum + 10);
      }
    });
    setCycleRows((p) => [...p, newRow]);
  };

  const handleRemoveCycle = () => {
    if (cycleRows.length <= 1) return;
    setCycleRows((p) => p.slice(0, p.length - 1));
  };

  const handlePresetFill = (preset: 'zeros' | 'counter' | 'random' | 'pulse') => {
    setCycleRows((prev) =>
      prev.map((_, c) => {
        const row: Record<string, string> = {};
        detectedPorts.forEach((p) => {
          if (preset === 'zeros') {
            row[p.name] = '0';
          } else if (preset === 'counter') {
            row[p.name] = p.width === 1 ? (c % 2 === 0 ? '1' : '0') : String(c + 1);
          } else if (preset === 'random') {
            const max = p.width === 1 ? 2 : Math.min(255, (1 << p.width) - 1);
            row[p.name] = String(Math.floor(Math.random() * max));
          } else if (preset === 'pulse') {
            row[p.name] = c % 2 === 0 ? '1' : '0';
          }
        });
        return row;
      })
    );
  };

  // Generate SystemVerilog Testbench
  const generatedTbCode = `\`timescale 1ns/1ps

module ${tbModuleName};
    localparam int CLK_PERIOD = ${clkPeriodNs};

    // Testbench Clock & Reset Signals
    logic clk;
    logic ${rstActiveHigh ? 'rst' : 'rst_n'};

    // UUT Input Signals Driven by Visual Scenario
${detectedPorts.map((p) => `    logic ${p.width > 1 ? `[${p.width - 1}:0] ` : ''}${p.name};`).join('\n')}

    // Instantiate Unit Under Test (UUT)
    ${topName} uut (
        .clk(clk),
        .${rstActiveHigh ? 'rst(rst)' : 'rst_n(rst_n)'},
${detectedPorts.map((p) => `        .${p.name}(${p.name})`).join(',\n')}
    );

    // 100 MHz Clock Generator (${(1000 / clkPeriodNs).toFixed(0)} MHz)
    initial clk = 0;
    always #(CLK_PERIOD / 2) clk = ~clk;

    // Simulation Stimulus Pipeline
    initial begin
        // Waveform Telemetry Dump
        $dumpfile("wave.vcd");
        $dumpvars(0, ${tbModuleName});

        // 1. Initial Reset Sequence
        ${rstActiveHigh ? 'rst' : 'rst_n'} = ${rstActiveHigh ? "1'b1" : "1'b0"};
${detectedPorts.map((p) => `        ${p.name} = '0;`).join('\n')}
        #${rstDurationNs};
        ${rstActiveHigh ? 'rst' : 'rst_n'} = ${rstActiveHigh ? "1'b0" : "1'b1"};
        @(posedge clk);

        // 2. Table-Driven Clock Cycle Stimulus
${cycleRows.map((row, cIdx) => {
  const assignments = detectedPorts.map((p) => {
    const rawVal = row[p.name] ?? '0';
    return `        ${p.name} <= ${p.width}'d${rawVal};`;
  }).join('\n');
  return `        // --- Clock ${cIdx + 1} ---\n${assignments}\n        @(posedge clk);`;
}).join('\n\n')}

        // 3. Post-Stimulus Settle & Finish
        #(CLK_PERIOD * 4);
        $display("[PASS] Kolay Test Senaryosu Basariyla Tamamlandi (%0d Cevrim).", ${cycleRows.length});
        $finish;
    end

endmodule
`;

  const handleSimulate = () => {
    onSaveTb(tbFileName, generatedTbCode, tbModuleName);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl glass-strong border border-slate-700/80 shadow-2xl bg-slate-950/95 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>{isTr ? 'Kolay Test Senaryosu Olusturucu' : 'Visual Test Scenario Builder'}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                  top: {topName}
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                {isTr
                  ? 'Saat vuruslarina gore giris portlarini tabloda belirleyin; SystemVerilog testbench dosyasini otomatik calistirin.'
                  : 'Configure input stimulus in a cycle-by-cycle matrix and run automated SystemVerilog simulation.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Global Parameters Toolbar */}
        <div className="px-5 py-2.5 border-b border-slate-800 bg-slate-900/40 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 text-slate-300">
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              <span>{isTr ? 'Saat Periyodu:' : 'Clock:'}</span>
              <input
                type="number"
                min={1}
                max={100}
                value={clkPeriodNs}
                onChange={(e) => setClkPeriodNs(Math.max(1, parseInt(e.target.value, 10) || 10))}
                className="w-16 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-xs font-mono text-center"
              />
              <span className="text-slate-400">ns</span>
            </label>

            <label className="flex items-center gap-1.5 text-slate-300">
              <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
              <span>{isTr ? 'Reset Suresi:' : 'Reset:'}</span>
              <input
                type="number"
                min={1}
                max={100}
                value={rstDurationNs}
                onChange={(e) => setRstDurationNs(Math.max(1, parseInt(e.target.value, 10) || 20))}
                className="w-16 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-xs font-mono text-center"
              />
              <span className="text-slate-400">ns</span>
            </label>

            <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={rstActiveHigh}
                onChange={(e) => setRstActiveHigh(e.target.checked)}
              />
              <span>{rstActiveHigh ? 'Active-High (rst=1)' : 'Active-Low (rst_n=0)'}</span>
            </label>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-400 font-sans">{isTr ? 'Sablon:' : 'Preset:'}</span>
            <button
              type="button"
              onClick={() => handlePresetFill('zeros')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 border border-slate-700"
            >
              0
            </button>
            <button
              type="button"
              onClick={() => handlePresetFill('counter')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 border border-slate-700"
            >
              1,2,3..
            </button>
            <button
              type="button"
              onClick={() => handlePresetFill('pulse')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 border border-slate-700"
            >
              1,0,1..
            </button>
            <button
              type="button"
              onClick={() => handlePresetFill('random')}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 border border-slate-700"
            >
              Rand
            </button>
          </div>
        </div>

        {/* Matrix Table & Optional SV Preview */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-200 font-mono flex items-center gap-2">
              <Wand2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isTr ? 'Saat Adimli Uyarim Tablosu' : 'Step-by-Step Clock Stimulus Grid'}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/30">
                {cycleRows.length} {isTr ? 'Cevrim' : 'Cycles'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAddCycle}
                className="px-2.5 py-1 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-500/40 text-xs flex items-center gap-1 font-mono transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isTr ? '+ Cevrim Ekle' : '+ Add Cycle'}</span>
              </button>
              <button
                type="button"
                onClick={handleRemoveCycle}
                disabled={cycleRows.length <= 1}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-300 disabled:opacity-40 border border-slate-700 text-xs flex items-center gap-1 font-mono transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isTr ? 'Sil' : 'Remove'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowCodePreview(!showCodePreview)}
                className={`px-2.5 py-1 rounded-lg border text-xs flex items-center gap-1 font-mono transition ${
                  showCodePreview
                    ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-200'
                    : 'bg-slate-800 border-slate-700 text-slate-300'
                }`}
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>{isTr ? 'SV Kodu' : 'SV Code'}</span>
              </button>
            </div>
          </div>

          {/* Table Matrix */}
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 shadow-inner">
            <table className="w-full text-xs font-mono border-collapse">
              <thead>
                <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3 text-left font-semibold w-28">
                    {isTr ? 'Saat / Cevrim' : 'Clock Cycle'}
                  </th>
                  {detectedPorts.map((p) => (
                    <th key={p.name} className="py-2.5 px-3 text-left font-semibold">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-200">{p.name}</span>
                        <span className="text-[10px] text-slate-500">
                          {p.width > 1 ? `[${p.width - 1}:0]` : '[bit]'}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {cycleRows.map((row, cIdx) => (
                  <tr key={cIdx} className="hover:bg-slate-800/40 transition">
                    <td className="py-2 px-3 text-slate-400 font-semibold flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-indigo-400" />
                      <span>Clock #{cIdx + 1}</span>
                    </td>
                    {detectedPorts.map((p) => (
                      <td key={p.name} className="py-2 px-3">
                        <input
                          type="text"
                          value={row[p.name] ?? '0'}
                          onChange={(e) => handleCellChange(cIdx, p.name, e.target.value)}
                          className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-slate-100 focus:border-indigo-500 focus:outline-none transition"
                          placeholder="0"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Optional SystemVerilog Code Preview */}
          {showCodePreview && (
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                <span>{tbFileName}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedTbCode);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="flex items-center gap-1 hover:text-emerald-300 transition"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? (isTr ? 'Kopyalandi' : 'Copied') : (isTr ? 'Kopyala' : 'Copy')}</span>
                </button>
              </div>
              <pre className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-emerald-300 overflow-x-auto whitespace-pre max-h-56">
                {generatedTbCode}
              </pre>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-800 bg-slate-900/70">
          <div className="text-xs text-slate-400 font-mono">
            <span>{isTr ? 'Hedef Dosya:' : 'Target File:'}</span>{' '}
            <span className="text-slate-200">{tbFileName}</span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 border border-slate-700 transition"
            >
              {isTr ? 'Iptal' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={handleSimulate}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-2 shadow-glow transition"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{isTr ? 'Simüle Et & Kostur (F5)' : 'Simulate Scenario (F5)'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
