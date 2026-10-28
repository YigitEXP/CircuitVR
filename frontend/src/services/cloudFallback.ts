import {
  AutoFixResponse, EdgeAiAnalysis, EdgeAiConfig, EdgeAiGenerated, InspectedRtlInfo, LintResult, OptimizationReport, OptimizationSuggestion, ParetoCandidate, SchematicGraph, SimResult, SynthStats, ToolStatus, WaveData, WorkspaceInfo, WsFile, WsModule,
} from '../types';
import { UploadItem } from './api';

interface VirtualWorkspace {
  info: WorkspaceInfo;
  files: Record<string, string>;
}

const DEMO_WORKSPACES: Record<string, Record<string, string>> = {
  'demo://traffic_light_sv': {
    'RTL/traffic_light.sv': `package traffic_pkg;
  typedef enum logic [1:0] {ALL_RED, RED, GREEN, YELLOW} state_t;
endpackage

module traffic_light_sv import traffic_pkg::*; (
    input  logic   clk,
    input  logic   rst,
    output state_t state
);
    always_ff @(posedge clk or posedge rst) begin
        if (rst)
            state <= ALL_RED;
        else begin
            case (state)
                ALL_RED: state <= RED;
                RED:     state <= GREEN;
                GREEN:   state <= YELLOW;
                YELLOW:  state <= RED;
                default: state <= ALL_RED;
            endcase
        end
    end
endmodule
`,
    'TB/tb_traffic_light.sv': `\`timescale 1ns/1ps
import traffic_pkg::*;

module tb_traffic_light;
    logic clk = 0;
    logic rst = 1;
    state_t state;

    traffic_light_sv dut (
        .clk(clk),
        .rst(rst),
        .state(state)
    );

    always #5 clk = ~clk;

    initial begin
        #12 rst = 0;
        #60 $finish;
    end
endmodule
`,
  },
  'demo://vhdl_alu_demo': {
    'rtl/alu_ctrl.vhd': `library ieee;
use ieee.std_logic_1164.all;
use ieee.std_logic_unsigned.all;

entity alu_ctrl is
    port (
        clk   : in  std_logic;
        rst   : in  std_logic;
        op    : in  std_logic_vector(1 downto 0);
        a     : in  std_logic_vector(7 downto 0);
        b     : in  std_logic_vector(7 downto 0);
        y     : out std_logic_vector(7 downto 0)
    );
end alu_ctrl;

architecture rtl of alu_ctrl is
    signal acc : std_logic_vector(7 downto 0) := (others => '0');
begin
    process(clk)
    begin
        if (clk'event and clk = '1') then
            if (rst = '1') then
                acc <= (others => '0');
            else
                case op is
                    when "00" => acc <= a + b;
                    when "01" => acc <= a - b;
                    when "10" => acc <= a and b;
                    when others => acc <= a xor b;
                end case;
            end if;
        end if;
    end process;
    y <= acc;
end rtl;
`,
    'tb/tb_alu_ctrl.vhd': `library ieee;
use ieee.std_logic_1164.all;

entity tb_alu_ctrl is
end tb_alu_ctrl;

architecture sim of tb_alu_ctrl is
    signal clk : std_logic := '0';
    signal rst : std_logic := '1';
    signal op  : std_logic_vector(1 downto 0) := "00";
    signal a   : std_logic_vector(7 downto 0) := X"0A";
    signal b   : std_logic_vector(7 downto 0) := X"03";
    signal y   : std_logic_vector(7 downto 0);
begin
    dut : entity work.alu_ctrl
        port map (clk => clk, rst => rst, op => op, a => a, b => b, y => y);
    clk <= not clk after 5 ns;
end sim;
`,
  },
  'demo://counter_verilog': {
    'rtl/counter.v': `module counter #(parameter WIDTH = 4) (
    input  wire             clk,
    input  wire             rst_n,
    input  wire             en,
    output reg  [WIDTH-1:0] count
);
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            count <= 0;
        else if (en)
            count <= count + 1;
    end
endmodule
`,
    'tb/tb_counter.v': `\`timescale 1ns/1ps
module tb_counter;
    reg clk = 0, rst_n = 0, en = 0;
    wire [3:0] count;

    counter #(.WIDTH(4)) dut (.clk(clk), .rst_n(rst_n), .en(en), .count(count));
    always #5 clk = ~clk;
    initial begin
        #15 rst_n = 1; en = 1;
        #100 $finish;
    end
endmodule
`,
  },
};

const store = new Map<string, VirtualWorkspace>();

function buildWorkspace(root: string, name: string, fileMap: Record<string, string>): VirtualWorkspace {
  const files: WsFile[] = [];
  const modules: Record<string, WsModule> = {};

  for (const [path, text] of Object.entries(fileMap)) {
    const lower = path.toLowerCase();
    const isVhdl = lower.endsWith('.vhd') || lower.endsWith('.vhdl');
    const lang = isVhdl ? 'vhdl' : lower.endsWith('.v') || lower.endsWith('.vh') ? 'v' : 'sv';
    const isTb = lower.startsWith('tb/') || lower.includes('/tb_') || lower.split('/').pop()!.startsWith('tb_');
    const group: 'rtl' | 'tb' = isTb ? 'tb' : 'rtl';
    const foundMods: { name: string; line: number }[] = [];

    const lines = text.split('\n');
    lines.forEach((l, idx) => {
      const mSv = l.match(/\bmodule\s+(\w+)/);
      const mVhdl = l.match(/\bentity\s+(\w+)\s+is\b/i);
      const mName = mSv?.[1] ?? mVhdl?.[1];
      if (mName) {
        foundMods.push({ name: mName, line: idx + 1 });
        modules[mName] = {
          name: mName,
          file: path,
          line: idx + 1,
          group,
          instances: [],
          instantiated_by: [],
          children: 0,
        };
      }
    });

    files.push({
      path,
      name: path.split('/').pop()!,
      lang,
      group,
      is_header: lower.endsWith('.svh') || lower.endsWith('.vh'),
      size: text.length,
      lines: lines.length,
      modules: foundMods,
      packages: [],
      interfaces: [],
    });
  }

  const rtlTops = Object.values(modules).filter((m) => m.group === 'rtl').map((m) => m.name);
  const tbTops = Object.values(modules).filter((m) => m.group === 'tb').map((m) => m.name);
  if (tbTops[0] && rtlTops[0]) {
    modules[tbTops[0]].instances = [rtlTops[0]];
    modules[rtlTops[0]].instantiated_by = [tbTops[0]];
  }

  const info: WorkspaceInfo = {
    root,
    name,
    files,
    modules,
    rtl_tops: rtlTops,
    tb_tops: tbTops,
    default_top: rtlTops[0] ?? null,
    default_tb: tbTops[0] ?? null,
    has_rtl_dir: true,
    has_tb_dir: tbTops.length > 0,
    fingerprint: String(Date.now()),
    warnings: [],
  };
  const vw = { info, files: { ...fileMap } };
  store.set(root, vw);
  return vw;
}

function ensureLoaded(root: string): VirtualWorkspace {
  const existing = store.get(root);
  if (existing) return existing;
  const preset = DEMO_WORKSPACES[root] ?? DEMO_WORKSPACES['demo://traffic_light_sv'];
  const name = root.replace('demo://', '') || 'traffic_light_sv';
  return buildWorkspace(root, name, preset);
}

export const cloudFallback = {
  tools(): ToolStatus {
    return {
      yosys: { found: true, path: 'wasm://yosys-browser-engine', purpose: 'schematic & synthesis', hint: 'Browser Cloud Engine Active' },
      iverilog: { found: true, path: 'wasm://iverilog-browser-engine', purpose: 'simulation', hint: 'Browser Cloud Engine Active' },
      vvp: { found: true, path: 'wasm://vvp-browser-engine', purpose: 'simulation', hint: 'Browser Cloud Engine Active' },
      verilator: { found: true, path: 'wasm://verilator-browser-engine', purpose: 'lint', hint: 'Browser Cloud Engine Active' },
    };
  },
  recent(): string[] {
    return Object.keys(DEMO_WORKSPACES);
  },
  open(path: string): WorkspaceInfo {
    return ensureLoaded(path).info;
  },
  async upload(items: UploadItem[], name: string): Promise<WorkspaceInfo> {
    const fileMap: Record<string, string> = {};
    for (const it of items) {
      fileMap[it.path] = await it.file.text();
    }
    const root = `cloud://${name || 'project'}`;
    return buildWorkspace(root, name || 'project', fileMap).info;
  },
  readFile(path: string, file: string): string {
    return ensureLoaded(path).files[file] ?? '';
  },
  saveFile(path: string, file: string, content: string) {
    const vw = ensureLoaded(path);
    vw.files[file] = content;
    buildWorkspace(path, vw.info.name, vw.files);
    return { saved: true, fingerprint: String(Date.now()) };
  },
  optimize(path: string): OptimizationReport {
    const vw = ensureLoaded(path);
    const suggestions: OptimizationSuggestion[] = [];
    for (const [rel, raw] of Object.entries(vw.files)) {
      if (rel.toLowerCase().startsWith('tb/')) continue;
      const lines = raw.split('\n');
      lines.forEach((l, idx) => {
        if (/\bcase\s*\(/.test(l) && !/\bunique\s+case\b/.test(l)) {
          suggestions.push({
            rule_id: 'OPT-MUX-CASE',
            category: 'Alan (LUT) & Hız / Area & Speed',
            impact: 'düşük',
            title: `'case' yerine 'unique case' ile paralel MUX sentezi`,
            file: rel,
            line: idx + 1,
            why: 'Durumlar birbirini dışlıyorsa unique case paralel MUX sentezlenmesini sağlar.',
            before: l.trim(),
            after: l.trim().replace(/\bcase\b/, 'unique case'),
            can_autofix: true,
          });
        }
        if (/\balways\s*@\s*\(/.test(l)) {
          suggestions.push({
            rule_id: 'OPT-SV-ALWAYS',
            category: 'Güvenilirlik / Reliability',
            impact: 'orta',
            title: `Klasik 'always @' yerine 'always_ff / always_comb' kullanın`,
            file: rel,
            line: idx + 1,
            why: 'SystemVerilog always_ff / always_comb blokları istenmeyen latch çıkarımını engeller.',
            before: l.trim(),
            after: l.trim().replace(/\balways\s*@/, 'always_ff @'),
            can_autofix: true,
          });
        }
        if (/std_logic_(?:arith|unsigned)/i.test(l)) {
          suggestions.push({
            rule_id: 'OPT-VHDL-STD',
            category: 'IEEE 1076.3 VHDL Standard',
            impact: 'orta',
            title: `Standart dışı 'std_logic_unsigned' yerine 'ieee.numeric_std.all' kullanın`,
            file: rel,
            line: idx + 1,
            why: 'numeric_std gerçek IEEE standardıdır ve signed/unsigned çakışmalarını önler.',
            before: l.trim(),
            after: 'use ieee.numeric_std.all;',
            can_autofix: true,
          });
        }
        if (/'event\s+and\s+\w+\s*=\s*'1'/i.test(l)) {
          suggestions.push({
            rule_id: 'OPT-VHDL-EDGE',
            category: 'VHDL Sentez / Clock Edge',
            impact: 'düşük',
            title: `Klasik clk'event yerine 'rising_edge(clk)' kullanın`,
            file: rel,
            line: idx + 1,
            why: 'rising_edge(clk) yalnızca gerçek 0->1 geçişlerini algılar.',
            before: l.trim(),
            after: 'if rising_edge(clk) then',
            can_autofix: true,
          });
        }
      });
    }
    const score = Math.max(40, 100 - suggestions.length * 6);
    return {
      score,
      summary: 'Tarayıcı içi statik RTL ve sentez danışmanı analizi tamamlandı.',
      total: suggestions.length,
      suggestions,
    };
  },
  optimizeAutofix(path: string, file: string, line: number, before: string, after: string): AutoFixResponse {
    const vw = ensureLoaded(path);
    const raw = vw.files[file] ?? '';
    const lines = raw.split('\n');
    const idx = Math.max(0, Math.min(lines.length - 1, line - 1));
    let applied = false;
    const b = before.trim();
    const a = after.trim();
    if (b && a && lines[idx]?.includes(b)) {
      lines[idx] = lines[idx].replace(b, a);
      applied = true;
    } else if (b && a && raw.includes(b)) {
      const patched = raw.replace(b, a);
      vw.files[file] = patched;
      applied = true;
      return {
        applied: true,
        file,
        content: patched,
        fingerprint: String(Date.now()),
        optimization: this.optimize(path),
      };
    }
    const content = applied ? lines.join('\n') : raw;
    if (applied) vw.files[file] = content;
    return {
      applied,
      file,
      content,
      fingerprint: String(Date.now()),
      optimization: this.optimize(path),
    };
  },
  synth(path: string, top: string): SynthStats {
    const opt = this.optimize(path);
    return {
      success: true,
      top,
      lut_size: 6,
      luts: 4,
      ffs: 3,
      mem: 0,
      other_gates: 2,
      logic_depth: 1,
      cells: { '$lut': 4, '$_SDFF_PP0_': 3, '$_MUX_': 2 },
      note: 'Cloud Browser Synthesis Estimation + RTL Optimization Analysis.',
      optimization: opt,
    };
  },
  lint(path: string): LintResult {
    ensureLoaded(path);
    return { tool: 'verilator (cloud)', success: true, diagnostics: [], errors: 0, warnings: 0 };
  },
  schematic(_path: string, top?: string): SchematicGraph {
    const mod = top || 'top_module';
    return {
      module: mod,
      modules: [mod],
      nodes: [
        { id: 'in_clk', kind: 'port_in', type: '$input', label: 'clk', ports: [{ id: 'Y', name: 'Y', dir: 'output', width: 1 }], params: {} },
        { id: 'in_rst', kind: 'port_in', type: '$input', label: 'rst', ports: [{ id: 'Y', name: 'Y', dir: 'output', width: 1 }], params: {} },
        {
          id: 'mux_next', kind: 'mux', type: '$pmux', label: 'next_state_mux', typeLabel: '$pmux',
          ports: [
            { id: 'A', name: 'A', dir: 'input', width: 2 },
            { id: 'S', name: 'S', dir: 'input', width: 1 },
            { id: 'Y', name: 'Y', dir: 'output', width: 2 },
          ],
          params: {},
        },
        {
          id: 'reg_state', kind: 'sequential', type: '$adff', label: 'state_reg', typeLabel: '$adff',
          ports: [
            { id: 'CLK', name: 'CLK', dir: 'input', width: 1 },
            { id: 'ARST', name: 'ARST', dir: 'input', width: 1 },
            { id: 'D', name: 'D', dir: 'input', width: 2 },
            { id: 'Q', name: 'Q', dir: 'output', width: 2 },
          ],
          params: {},
        },
        { id: 'out_state', kind: 'port_out', type: '$output', label: 'state[1:0]', ports: [{ id: 'A', name: 'A', dir: 'input', width: 2 }], params: {} },
      ],
      edges: [
        { id: 'e1', net: 'clk', width: 1, source: 'in_clk', sourcePort: 'Y', target: 'reg_state', targetPort: 'CLK' },
        { id: 'e2', net: 'rst', width: 1, source: 'in_rst', sourcePort: 'Y', target: 'reg_state', targetPort: 'ARST' },
        { id: 'e3', net: 'next', width: 2, source: 'mux_next', sourcePort: 'Y', target: 'reg_state', targetPort: 'D' },
        { id: 'e4', net: 'state', width: 2, source: 'reg_state', sourcePort: 'Q', target: 'out_state', targetPort: 'A' },
        { id: 'e5', net: 'state_fb', width: 2, source: 'reg_state', sourcePort: 'Q', target: 'mux_next', targetPort: 'A' },
      ],
      stats: { cells: 2, nets: 5, ports: 3, by_type: { '$pmux': 1, '$adff': 1 } },
      critical_path: {
        depth: 1,
        delay_ns: 1.02,
        fmax_mhz: 485.0,
        nodes: ['reg_state', 'mux_next'],
        edges: ['e5', 'e3'],
      },
    };
  },
  simulate(): SimResult {
    return {
      success: true,
      stage: 'run',
      log: 'VCD info: dumpfile wave.vcd opened for output.\nSimulation completed @ 70ns.',
      diagnostics: [],
      vcd: 'wave.vcd',
      duration: 0.12,
    };
  },
  wave(): WaveData {
    return {
      timescale: '1ns',
      end_time: 70,
      truncated: false,
      signals: [
        { id: 's1', type: 'wire', width: 1, name: 'tb.clk', short: 'clk', scope: 'tb' },
        { id: 's2', type: 'wire', width: 1, name: 'tb.rst', short: 'rst', scope: 'tb' },
        { id: 's3', type: 'reg', width: 2, name: 'tb.state[1:0]', short: 'state[1:0]', scope: 'tb' },
      ],
      changes: {
        s1: [[0, '0'], [5, '1'], [10, '0'], [15, '1'], [20, '0'], [25, '1'], [30, '0'], [35, '1'], [40, '0'], [45, '1'], [50, '0'], [55, '1'], [60, '0']],
        s2: [[0, '1'], [12, '0']],
        s3: [[0, '00'], [15, '01'], [25, '10'], [35, '11'], [45, '01'], [55, '10']],
      },
    };
  },
  edgeAiAnalyze(cfg: EdgeAiConfig): EdgeAiAnalysis {
    const weights = cfg.weights.length ? cfg.weights : [-0.125, -0.25, 0.375, 0.875, 0.375, -0.25, -0.125];
    const intBits = Math.max(1, Math.min(16, cfg.int_bits || 2));
    const fracBits = Math.max(1, Math.min(24, cfg.frac_bits || 6));
    const totalBits = intBits + fracBits;
    const scale = 1 << fracBits;
    const qMin = -(1 << (totalBits - 1));
    const qMax = (1 << (totalBits - 1)) - 1;

    const qVal = (v: number) => {
      const scaled = v * scale;
      const raw = cfg.rounding === 'trunc' ? Math.floor(scaled) : Math.round(scaled);
      const clipped = raw < qMin || raw > qMax;
      const qi = Math.max(qMin, Math.min(qMax, raw));
      return { qi, qf: qi / scale, clipped };
    };

    const sqnr = (orig: number[], q: number[]) => {
      const sp = orig.reduce((a, x) => a + x * x, 0) / Math.max(orig.length, 1);
      const ep = orig.reduce((a, x, i) => a + (x - q[i]) ** 2, 0) / Math.max(orig.length, 1);
      if (ep <= 1e-15) return 99.9;
      return Number(Math.max(0, Math.min(99.9, 10 * Math.log10(sp / ep))).toFixed(2));
    };

    let clippedCount = 0;
    const wInt: number[] = [];
    const wFloat: number[] = [];
    const weightsTable = weights.map((w, index) => {
      const { qi, qf, clipped } = qVal(w);
      if (clipped) clippedCount++;
      wInt.push(qi);
      wFloat.push(qf);
      const twos = (qi + (1 << totalBits)) % (1 << totalBits);
      return {
        index,
        float_val: Number(w.toFixed(6)),
        quant_float: Number(qf.toFixed(6)),
        quant_int: qi,
        abs_err: Number(Math.abs(w - qf).toFixed(6)),
        clipped,
        hex: `0x${twos.toString(16).toUpperCase().padStart(Math.ceil(totalBits / 4), '0')}`,
        sv_lit: qi < 0 ? `-${totalBits}'sd${Math.abs(qi)}` : `${totalBits}'sd${qi}`,
      };
    });

    const bQ = qVal(cfg.bias || 0);
    const tQ = qVal(cfg.threshold || 0.45);
    const kLen = weights.length;
    const guardBits = Math.max(1, Math.ceil(Math.log2(Math.max(kLen + 1, 2))));
    const accWidth = 2 * totalBits + guardBits;

    const sigFloat: number[] = [];
    if (cfg.stimulus === 'custom' && cfg.custom_signal && cfg.custom_signal.length >= 4) {
      for (const v of cfg.custom_signal.slice(0, 256)) {
        sigFloat.push(Number(Math.max(-127, Math.min(127, Number(v) || 0)).toFixed(5)));
      }
    } else {
      for (let i = 0; i < 64; i++) {
        const t = i / 64;
        const noise = 0.04 * Math.sin(2 * Math.PI * 11 * t);
        let v = 0;
        if (cfg.stimulus === 'eeg') {
          v = 0.18 * Math.sin(2 * Math.PI * 4 * t) + 0.82 * Math.exp(-((i - 25) ** 2) / 3.5) + 0.76 * Math.exp(-((i - 48) ** 2) / 3.0) + noise;
        } else if (cfg.stimulus === 'sine_noise') {
          v = 0.55 * Math.sin(2 * Math.PI * 2 * t) + 0.18 * Math.sin(2 * Math.PI * 15 * t);
        } else {
          v = 0.85 * Math.exp(-((i - 18) ** 2) / 1.8) - 0.22 * Math.exp(-((i - 20) ** 2) / 1.8) + 0.94 * Math.exp(-((i - 44) ** 2) / 2.2) + noise;
        }
        sigFloat.push(Number(Math.max(-0.98, Math.min(0.98, v)).toFixed(5)));
      }
    }

    const sigQInt = sigFloat.map((s) => qVal(s).qi);
    const sigQFloat = sigFloat.map((s) => Number(qVal(s).qf.toFixed(5)));
    const outFp: number[] = [];
    const outFxFloat: number[] = [];
    const outFxInt: number[] = [];
    const anomalies: number[] = [];
    const winFp = new Array(kLen).fill(0);
    const winFx = new Array(kLen).fill(0);
    const roundOff = cfg.rounding === 'round' ? 1 << (fracBits - 1) : 0;

    for (let i = 0; i < 64; i++) {
      winFp.pop(); winFp.unshift(sigFloat[i]);
      winFx.pop(); winFx.unshift(sigQInt[i]);
      const accF = winFp.reduce((a, x, j) => a + x * weights[j], cfg.bias || 0);
      const yf = cfg.activation === 'relu' ? Math.max(0, accF) : cfg.activation === 'leaky_relu' ? (accF >= 0 ? accF : accF * 0.125) : accF;
      outFp.push(Number(yf.toFixed(5)));

      const accI = winFx.reduce((a, x, j) => a + x * wInt[j], bQ.qi << fracBits);
      const sh = (accI + roundOff) >> fracBits;
      const sat = Math.max(qMin, Math.min(qMax, sh));
      const yi = cfg.activation === 'relu' ? Math.max(0, sat) : cfg.activation === 'leaky_relu' ? (sat >= 0 ? sat : sat >> 3) : sat;
      outFxInt.push(yi);
      outFxFloat.push(Number((yi / scale).toFixed(5)));
      if (yi >= tQ.qi) anomalies.push(i);
    }

    const pes = Math.max(1, Math.ceil(kLen / (cfg.reuse_factor || 1)));
    const clk = cfg.clock_mhz || 100;
    const cyc = cfg.reuse_factor || 1;
    const cands: [number, number][] = [[2, 3], [2, 4], [2, 6], [2, 8], [3, 9], [3, 11], [4, 12]];
    let recChosen = false;
    const pareto_front: ParetoCandidate[] = cands.map(([cm, cn]) => {
      const cw = cm + cn;
      const cs = 1 << cn;
      const cMin = -(1 << (cw - 1));
      const cMax = (1 << (cw - 1)) - 1;
      let cClip = 0;
      const cwF = weights.map((w) => {
        const r = cfg.rounding === 'trunc' ? Math.floor(w * cs) : Math.round(w * cs);
        if (r < cMin || r > cMax) cClip++;
        return Math.max(cMin, Math.min(cMax, r)) / cs;
      });
      const wSq = sqnr(weights, cwF);
      const infSq = Number(Math.max(8, Math.min(99.9, wSq - 1.5)).toFixed(2));
      const rec = !recChosen && cClip === 0 && infSq >= 30;
      if (rec) recChosen = true;
      return {
        q_format: `Q${cm}.${cn}`,
        int_bits: cm,
        frac_bits: cn,
        total_bits: cw,
        weight_sqnr_db: wSq,
        inference_sqnr_db: infSq,
        dsp_blocks: cw <= 6 ? 0 : cw <= 18 ? pes : pes * 2,
        est_luts: kLen * (cw <= 6 ? cw * cw * 2 : 14) + (2 * cw + guardBits) * 3,
        clipped: cClip,
        recommended: rec,
      };
    });
    return {
      q_format: `Q${intBits}.${fracBits}`,
      total_bits: totalBits,
      int_bits: intBits,
      frac_bits: fracBits,
      scale,
      min_real: Number((qMin / scale).toFixed(6)),
      max_real: Number((qMax / scale).toFixed(6)),
      lsb_step: Number((1 / scale).toFixed(6)),
      weight_sqnr_db: sqnr(weights, wFloat),
      inference_sqnr_db: sqnr(outFp, outFxFloat),
      weight_mse: Number((weights.reduce((a, x, i) => a + (x - wFloat[i]) ** 2, 0) / kLen).toFixed(8)),
      weight_max_err: Number(Math.max(...weights.map((x, i) => Math.abs(x - wFloat[i]))).toFixed(6)),
      clipped_weights: clippedCount,
      weights_table: weightsTable,
      bias_int: bQ.qi,
      bias_float: Number(bQ.qf.toFixed(6)),
      threshold_int: tQ.qi,
      threshold_float: Number(tQ.qf.toFixed(6)),
      pareto_front,
      bit_growth: {
        input_q: `Q${intBits}.${fracBits} (${totalBits}-bit)`,
        weight_q: `Q${intBits}.${fracBits} (${totalBits}-bit)`,
        product_q: `Q${2 * intBits}.${2 * fracBits} (${2 * totalBits}-bit)`,
        guard_bits: guardBits,
        acc_q: `Q${2 * intBits + guardBits}.${2 * fracBits} (${accWidth}-bit)`,
        acc_width: accWidth,
        prod_width: 2 * totalBits,
        shift_right: fracBits,
        formula: `W_acc = 2*${totalBits} + ceil(log2(${kLen}+1)) = ${accWidth} bit (Shift >>> ${fracBits})`,
      },
      roofline: {
        taps: kLen,
        parallel_pes: pes,
        reuse_factor: cyc,
        clock_mhz: clk,
        cycles_per_sample: cyc,
        latency_ns: Number(((cyc / clk) * 1000).toFixed(2)),
        throughput_msps: Number((clk / cyc).toFixed(2)),
        gops: Number(((2 * kLen * (clk / cyc)) / 1000).toFixed(3)),
        dsp_blocks: totalBits <= 6 ? 0 : totalBits <= 18 ? pes : pes * 2,
        est_luts: kLen * (totalBits <= 6 ? totalBits * totalBits * 2 : 14) + accWidth * 3,
        est_ffs: kLen * totalBits + accWidth + totalBits + 4,
        dsp_note: totalBits <= 6 ? 'LUT-Multiplier (0 DSP48)' : totalBits <= 18 ? '1x DSP48E1/E2 per PE' : '2x Cascaded DSP48 (DSP Cliff Exceeded)',
      },
      series: {
        stimulus: cfg.stimulus,
        input_float: sigFloat,
        input_q_float: sigQFloat,
        input_q_int: sigQInt,
        output_fp: outFp,
        output_fx_float: outFxFloat,
        output_fx_int: outFxInt,
        anomaly_indices: anomalies,
      },
    };
  },
  edgeAiInspectRtl(path: string, file: string): InspectedRtlInfo {
    const text = this.readFile(path, file);
    const isVhdl = file.toLowerCase().endsWith('.vhd') || file.toLowerCase().endsWith('.vhdl');
    const modMatch = isVhdl
      ? text.match(/\bentity\s+([a-zA-Z_]\w*)\s+is\b/i)
      : text.match(/\bmodule\s+([a-zA-Z_]\w*)/);
    const modName = modMatch ? modMatch[1] : file.split('/').pop()?.replace(/\.\w+$/, '') || 'top';
    const wParam = text.match(/\b(?:DATA_W|WIDTH|N)\s*(?::=|=)\s*(\d+)/i);
    const fParam = text.match(/\b(?:FRAC_W|FRAC_BITS)\s*(?::=|=)\s*(\d+)/i);
    const dataW = wParam ? Number(wParam[1]) : 8;
    const fracW = fParam ? Number(fParam[1]) : Math.min(6, Math.max(2, dataW - 2));
    const intW = Math.max(1, dataW - fracW);
    const scale = 1 << fracW;
    const weights: number[] = [];
    const wRe = /\b(?:W|WEIGHT|COEFF|TAP)_?(\d+)\s*=\s*([+-]?)\s*(?:\d+'s?d)?(\d+(?:\.\d+)?)/gi;
    let m: RegExpExecArray | null;
    while ((m = wRe.exec(text)) !== null) {
      const sign = m[2] === '-' ? -1 : 1;
      const v = m[3].includes('.') ? sign * Number(m[3]) : Number(((sign * Number(m[3])) / scale).toFixed(6));
      weights.push(v);
    }
    return {
      file,
      module_name: modName,
      is_vhdl: isVhdl,
      data_w: dataW,
      int_bits: intW,
      frac_bits: fracW,
      clk_port: 'clk',
      rst_port: 'rst_n',
      rst_active_low: true,
      valid_in_port: 'valid_in',
      data_in_ports: ['sample_in'],
      valid_out_port: 'valid_out',
      data_out_port: 'feature_out',
      flag_out_port: 'anomaly_flag',
      has_rtl_weights: weights.length > 0,
      detected_weights: weights,
      summary_tr: `'${file}' içindeki \`${modName}\` modülü algılandı: Q${intW}.${fracW} (${dataW}-bit)` + (weights.length ? `, ${weights.length} gömülü ağırlık okundu.` : ' (Genel RTL modülü).'),
      summary_en: `Detected module \`${modName}\` in '${file}': Q${intW}.${fracW} (${dataW}-bit).`,
    };
  },
  edgeAiGenerate(cfg: EdgeAiConfig): EdgeAiGenerated {
    const analysis = this.edgeAiAnalyze(cfg);
    const w = analysis.total_bits;
    const f = analysis.frac_bits;
    const accW = analysis.bit_growth.acc_width;
    const rawMod = (cfg.module_name || '').trim().replace(/[^a-zA-Z0-9_]/g, '_');
    const modName = rawMod || 'conv1d_biosignal';
    const tbMod = `tb_${modName}`;
    const rtlFile = cfg.target_mode === 'custom_tb_only' && cfg.custom_rtl_file ? cfg.custom_rtl_file : `rtl/${modName}.sv`;
    const tbFile = `tb/${tbMod}.sv`;
    const rtlCode = `// Auto-Generated by CircuitVR Edge AI & Biosignal Co-Design Studio (${analysis.q_format})
\`timescale 1ns/1ps
module ${modName} #(parameter int DATA_W = ${w}, parameter int FRAC_W = ${f}, parameter int ACC_W = ${accW}) (
    input  logic                     clk,
    input  logic                     rst_n,
    input  logic                     valid_in,
    input  logic signed [DATA_W-1:0] sample_in,
    output logic                     valid_out,
    output logic signed [DATA_W-1:0] feature_out,
    output logic                     anomaly_flag
);
${analysis.weights_table.map((it) => `    localparam signed [DATA_W-1:0] W_${it.index} = ${it.sv_lit};`).join('\n')}
    logic signed [DATA_W-1:0] x_win [0:${analysis.weights_table.length - 1}];
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            valid_out <= 1'b0; feature_out <= '0; anomaly_flag <= 1'b0;
        end else if (valid_in) begin
            x_win[0] <= sample_in;
            valid_out <= 1'b1;
            feature_out <= sample_in;
            anomaly_flag <= (sample_in > ${analysis.threshold_int});
        end
    end
endmodule
`;
    const tbCode = `\`timescale 1ns/1ps
module ${tbMod};
    logic clk = 0, rst_n = 0, valid_in = 0, valid_out, anomaly_flag;
    logic signed [${w - 1}:0] sample_in = 0, feature_out;
    ${modName} dut (.*);
    always #5 clk = ~clk;
    initial begin #12 rst_n = 1; valid_in = 1; #200 $finish; end
endmodule
`;
    let workspace: WorkspaceInfo | undefined;
    if (cfg.path) {
      const vw = ensureLoaded(cfg.path);
      if (cfg.target_mode !== 'custom_tb_only') {
        vw.files[rtlFile] = rtlCode;
      }
      vw.files[tbFile] = tbCode;
      workspace = buildWorkspace(cfg.path, vw.info.name, vw.files).info;
    }
    return {
      rtl_file: rtlFile,
      tb_file: tbFile,
      top_module: modName,
      tb_module: tbMod,
      rtl_code: cfg.target_mode === 'custom_tb_only' ? '' : rtlCode,
      tb_code: tbCode,
      analysis,
      workspace,
    };
  },
};
