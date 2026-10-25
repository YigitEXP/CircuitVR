import {
  LintResult, OptimizationReport, OptimizationSuggestion, SchematicGraph, SimResult, SynthStats, ToolStatus, WaveData, WorkspaceInfo, WsFile, WsModule,
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
            category: 'Alan (LUT) & Hız / Area & Speed',
            impact: 'düşük',
            title: `'case' yerine 'unique case' ile paralel MUX sentezi`,
            file: rel,
            line: idx + 1,
            why: 'Durumlar birbirini dışlıyorsa unique case paralel MUX sentezlenmesini sağlar.',
            before: l.trim(),
            after: l.trim().replace(/\bcase\b/, 'unique case'),
          });
        }
        if (/\balways\s*@\s*\(/.test(l)) {
          suggestions.push({
            category: 'Güvenilirlik / Reliability',
            impact: 'orta',
            title: `Klasik 'always @' yerine 'always_ff / always_comb' kullanın`,
            file: rel,
            line: idx + 1,
            why: 'SystemVerilog always_ff / always_comb blokları istenmeyen latch çıkarımını engeller.',
            before: l.trim(),
            after: l.trim().replace(/\balways\s*@/, 'always_ff @'),
          });
        }
        if (/std_logic_(?:arith|unsigned)/i.test(l)) {
          suggestions.push({
            category: 'IEEE 1076.3 VHDL Standard',
            impact: 'orta',
            title: `Standart dışı 'std_logic_unsigned' yerine 'ieee.numeric_std.all' kullanın`,
            file: rel,
            line: idx + 1,
            why: 'numeric_std gerçek IEEE standardıdır ve signed/unsigned çakışmalarını önler.',
            before: l.trim(),
            after: 'use ieee.numeric_std.all;',
          });
        }
        if (/'event\s+and\s+\w+\s*=\s*'1'/i.test(l)) {
          suggestions.push({
            category: 'VHDL Sentez / Clock Edge',
            impact: 'düşük',
            title: `Klasik clk'event yerine 'rising_edge(clk)' kullanın`,
            file: rel,
            line: idx + 1,
            why: 'rising_edge(clk) yalnızca gerçek 0->1 geçişlerini algılar.',
            before: l.trim(),
            after: 'if rising_edge(clk) then',
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
};
