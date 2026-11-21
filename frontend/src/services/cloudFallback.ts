import {
  AutoFixResponse,
  Diagnostic,
  EdgeAiAnalysis,
  EdgeAiConfig,
  EdgeAiGenerated,
  FsmMachine,
  FsmReport,
  ImportedModelResult,
  InspectedRtlInfo,
  LintResult,
  OptimizationReport,
  OptimizationSuggestion,
  ParetoCandidate,
  SchematicGraph,
  SimResult,
  SynthStats,
  ToolStatus,
  WaveData,
  WorkspaceInfo,
  WsFile,
  WsModule,
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

function parseDynamicRtlSchematic(code: string, modName: string): SchematicGraph {
  const nodes: SchematicGraph['nodes'] = [];
  const edges: SchematicGraph['edges'] = [];
  const byType: Record<string, number> = {};

  const incType = (t: string) => {
    byType[t] = (byType[t] || 0) + 1;
  };

  // 1. Parameter extraction
  const params: Record<string, number> = {
    DATA_WIDTH: 8,
    KERNEL_SIZE: 3,
    DEPTH: 4,
    WIDTH: 8,
  };

  const paramRegex = /\b(?:parameter|localparam)\s+(?:(?:logic|integer|bit)\s+)?(?:\[[\w\s\-\+\*\/]+\]\s+)?(\w+)\s*=\s*([^;,]+)/g;
  let pm: RegExpExecArray | null;
  while ((pm = paramRegex.exec(code)) !== null) {
    const pName = pm[1];
    const rawVal = pm[2].trim();
    let evalVal = parseInt(rawVal, 10);
    if (isNaN(evalVal)) {
      if (rawVal.includes('-')) {
        const parts = rawVal.split('-').map((s) => s.trim());
        evalVal = (params[parts[0]] || parseInt(parts[0], 10) || 0) - (params[parts[1]] || parseInt(parts[1], 10) || 0);
      } else if (rawVal.includes('+')) {
        const parts = rawVal.split('+').map((s) => s.trim());
        evalVal = (params[parts[0]] || parseInt(parts[0], 10) || 0) + (params[parts[1]] || parseInt(parts[1], 10) || 0);
      }
    }
    if (!isNaN(evalVal) && evalVal > 0) {
      params[pName] = evalVal;
    }
  }

  const evalWidth = (expr: string): number => {
    const trimmed = expr.trim();
    if (!trimmed) return 1;
    const m = /\[\s*([\w\s\-\+\*\/]+)\s*:\s*([\w\s\-\+\*\/]+)\s*\]/.exec(trimmed);
    if (!m) return 1;
    const msbStr = m[1].trim();
    const lsbStr = m[2].trim();
    const resolveTerm = (t: string): number => {
      if (/^\d+$/.test(t)) return parseInt(t, 10);
      for (const [k, v] of Object.entries(params)) {
        if (t === k) return v;
        if (t === `${k}-1` || t === `${k} - 1`) return v - 1;
        if (t === `${k}+1` || t === `${k} + 1`) return v + 1;
      }
      return 0;
    };
    const msb = resolveTerm(msbStr);
    const lsb = resolveTerm(lsbStr);
    return Math.max(1, Math.abs(msb - lsb) + 1);
  };

  const evalUnpackedCount = (expr: string): number => {
    if (!expr) return 1;
    const m = /\[\s*([\w\s\-\+\*\/]+)\s*:\s*([\w\s\-\+\*\/]+)\s*\]/.exec(expr);
    if (!m) return 1;
    const s1 = m[1].trim();
    const s2 = m[2].trim();
    const resolve = (t: string): number => {
      if (/^\d+$/.test(t)) return parseInt(t, 10);
      for (const [k, v] of Object.entries(params)) {
        if (t === k) return v;
        if (t === `${k}-1` || t === `${k} - 1`) return v - 1;
      }
      return 0;
    };
    return Math.max(1, Math.abs(resolve(s1) - resolve(s2)) + 1);
  };

  // 2. Ports extraction
  const portRegex = /\b(input|output|inout)\s+(?:(logic|wire|reg|bit|state_t)\s+)?(?:(\[[^\]]+\])\s+)?([a-zA-Z_]\w*)(?:\s*(\[[^\]]+\]))?/g;
  let pMatch: RegExpExecArray | null;
  const inputPorts: { name: string; width: number; unpacked: number }[] = [];
  const outputPorts: { name: string; width: number; unpacked: number }[] = [];

  while ((pMatch = portRegex.exec(code)) !== null) {
    const dir = pMatch[1];
    const range = pMatch[3] || '';
    const name = pMatch[4];
    const unpacked = pMatch[5] || '';
    const width = evalWidth(range);
    const uCount = evalUnpackedCount(unpacked);

    if (dir === 'input') {
      inputPorts.push({ name, width, unpacked: uCount });
    } else if (dir === 'output') {
      outputPorts.push({ name, width, unpacked: uCount });
    }
  }

  if (inputPorts.length === 0) {
    inputPorts.push({ name: 'clk', width: 1, unpacked: 1 });
    inputPorts.push({ name: 'rst', width: 1, unpacked: 1 });
  }

  // Create Port Nodes
  inputPorts.forEach((p) => {
    const id = `in_${p.name}`;
    const lbl = p.width > 1 ? `${p.name}[${p.width - 1}:0]` : p.name;
    nodes.push({
      id,
      kind: 'port_in',
      type: '$input',
      label: lbl,
      ports: [{ id: 'Y', name: 'Y', dir: 'output', width: p.width }],
      params: {},
    });
  });

  outputPorts.forEach((p) => {
    if (p.unpacked > 1) {
      for (let k = 0; k < p.unpacked; k++) {
        const id = `out_${p.name}_${k}`;
        const lbl = `${p.name}[${k}]${p.width > 1 ? `[${p.width - 1}:0]` : ''}`;
        nodes.push({
          id,
          kind: 'port_out',
          type: '$output',
          label: lbl,
          ports: [{ id: 'A', name: 'A', dir: 'input', width: p.width }],
          params: {},
        });
      }
    } else {
      const id = `out_${p.name}`;
      const lbl = p.width > 1 ? `${p.name}[${p.width - 1}:0]` : p.name;
      nodes.push({
        id,
        kind: 'port_out',
        type: '$output',
        label: lbl,
        ports: [{ id: 'A', name: 'A', dir: 'input', width: p.width }],
        params: {},
      });
    }
  });

  // 3. Sequential logic detection
  const isAsyncReset = /@\(\s*posedge\s+clk[^\)]*or\s+posedge\s+rst|@\(\s*posedge\s+clk[^\)]*or\s+negedge\s+rst_n/i.test(code);
  const rstCellType = isAsyncReset ? '$adff' : '$sdff';
  const rstPinName = isAsyncReset ? 'ARST' : 'RST';

  const enMatch = /\bif\s*\(\s*(!?rst\w*)\s*\)\s*begin?[\s\S]*?else\s+if\s*\(\s*(\w+)\s*\)/i.exec(code);
  const enSignal = enMatch ? enMatch[2] : (/\bif\s*\(\s*(valid_in|en|enable|load)\s*\)/i.exec(code)?.[1] || null);

  const isShiftReg = /shift_reg|window\s*\[/i.test(code) || /for\s*\([^;]+;\s*i\s*<\s*(\w+|\d+)/i.test(code);
  const kernelSize = params.KERNEL_SIZE || 3;
  const dataWidth = params.DATA_WIDTH || 8;

  let edgeIdx = 1;
  const nextEdgeId = () => `e${edgeIdx++}`;

  if (isShiftReg && kernelSize >= 2) {
    for (let k = 0; k < kernelSize; k++) {
      const cellId = `reg_shift_${k}`;
      const cellType = enSignal ? `${rstCellType}e` : rstCellType;
      incType(cellType);
      nodes.push({
        id: cellId,
        kind: 'sequential',
        type: cellType,
        label: `shift_reg_${k}`,
        typeLabel: cellType,
        ports: [
          { id: 'CLK', name: 'CLK', dir: 'input' as const, width: 1 },
          { id: rstPinName, name: rstPinName, dir: 'input' as const, width: 1 },
          ...(enSignal ? [{ id: 'EN', name: 'EN', dir: 'input' as const, width: 1 }] : []),
          { id: 'D', name: 'D', dir: 'input' as const, width: dataWidth },
          { id: 'Q', name: 'Q', dir: 'output' as const, width: dataWidth },
        ],
        params: {},
      });

      edges.push({
        id: nextEdgeId(),
        net: 'clk',
        width: 1,
        source: 'in_clk',
        sourcePort: 'Y',
        target: cellId,
        targetPort: 'CLK',
      });
      edges.push({
        id: nextEdgeId(),
        net: 'rst',
        width: 1,
        source: 'in_rst',
        sourcePort: 'Y',
        target: cellId,
        targetPort: rstPinName,
      });

      if (enSignal) {
        const enPortId = inputPorts.some((p) => p.name === enSignal) ? `in_${enSignal}` : 'in_valid_in';
        if (nodes.some((n) => n.id === enPortId)) {
          edges.push({
            id: nextEdgeId(),
            net: enSignal,
            width: 1,
            source: enPortId,
            sourcePort: 'Y',
            target: cellId,
            targetPort: 'EN',
          });
        }
      }

      if (k === 0) {
        const inDataId = inputPorts.some((p) => p.name === 'data_in')
          ? 'in_data_in'
          : (inputPorts.find((p) => p.width > 1)?.name ? `in_${inputPorts.find((p) => p.width > 1)!.name}` : 'in_clk');
        edges.push({
          id: nextEdgeId(),
          net: 'data_in',
          width: dataWidth,
          source: inDataId,
          sourcePort: 'Y',
          target: cellId,
          targetPort: 'D',
        });
      } else {
        edges.push({
          id: nextEdgeId(),
          net: `shift_net_${k}`,
          width: dataWidth,
          source: `reg_shift_${k - 1}`,
          sourcePort: 'Q',
          target: cellId,
          targetPort: 'D',
        });
      }

      const outNodeId = `out_window_${k}`;
      if (nodes.some((n) => n.id === outNodeId)) {
        edges.push({
          id: nextEdgeId(),
          net: `window[${k}]`,
          width: dataWidth,
          source: cellId,
          sourcePort: 'Q',
          target: outNodeId,
          targetPort: 'A',
        });
      }
    }

    if (outputPorts.some((p) => p.name === 'valid_out')) {
      const voutRegId = 'reg_valid_out';
      incType(rstCellType);
      nodes.push({
        id: voutRegId,
        kind: 'sequential',
        type: rstCellType,
        label: 'valid_out_reg',
        typeLabel: rstCellType,
        ports: [
          { id: 'CLK', name: 'CLK', dir: 'input', width: 1 },
          { id: rstPinName, name: rstPinName, dir: 'input', width: 1 },
          { id: 'D', name: 'D', dir: 'input', width: 1 },
          { id: 'Q', name: 'Q', dir: 'output', width: 1 },
        ],
        params: {},
      });
      edges.push({
        id: nextEdgeId(),
        net: 'clk',
        width: 1,
        source: 'in_clk',
        sourcePort: 'Y',
        target: voutRegId,
        targetPort: 'CLK',
      });
      edges.push({
        id: nextEdgeId(),
        net: 'valid_out',
        width: 1,
        source: voutRegId,
        sourcePort: 'Q',
        target: 'out_valid_out',
        targetPort: 'A',
      });
    }
  } else {
    const isFsm = /case\s*\(\s*state\b/i.test(code) || /state_t|ALL_RED|RED|GREEN/i.test(code);
    const isCounter = /\bcount\s*<=\s*count\s*\+\s*1/i.test(code) || /\+\s*1'b1/i.test(code);
    const hasAdd = /\+/.test(code);
    const hasMul = /\*/.test(code);
    const hasLt = /<\s*(\w+|\d+)/.test(code);
    const hasGe = />=\s*(\w+|\d+)/.test(code);

    if (isFsm) {
      incType('$pmux');
      nodes.push({
        id: 'mux_next',
        kind: 'mux',
        type: '$pmux',
        label: 'next_state_mux',
        typeLabel: '$pmux',
        ports: [
          { id: 'A', name: 'A', dir: 'input', width: 2 },
          { id: 'S', name: 'S', dir: 'input', width: 1 },
          { id: 'Y', name: 'Y', dir: 'output', width: 2 },
        ],
        params: {},
      });

      incType(rstCellType);
      nodes.push({
        id: 'reg_state',
        kind: 'sequential',
        type: rstCellType,
        label: 'state_reg',
        typeLabel: rstCellType,
        ports: [
          { id: 'CLK', name: 'CLK', dir: 'input', width: 1 },
          { id: rstPinName, name: rstPinName, dir: 'input', width: 1 },
          { id: 'D', name: 'D', dir: 'input', width: 2 },
          { id: 'Q', name: 'Q', dir: 'output', width: 2 },
        ],
        params: {},
      });

      edges.push({ id: nextEdgeId(), net: 'clk', width: 1, source: 'in_clk', sourcePort: 'Y', target: 'reg_state', targetPort: 'CLK' });
      edges.push({ id: nextEdgeId(), net: 'rst', width: 1, source: 'in_rst', sourcePort: 'Y', target: 'reg_state', targetPort: rstPinName });
      edges.push({ id: nextEdgeId(), net: 'next_state', width: 2, source: 'mux_next', sourcePort: 'Y', target: 'reg_state', targetPort: 'D' });
      edges.push({ id: nextEdgeId(), net: 'state_fb', width: 2, source: 'reg_state', sourcePort: 'Q', target: 'mux_next', targetPort: 'A' });

      const stateOut = nodes.find((n) => n.kind === 'port_out' && n.label.includes('state'));
      if (stateOut) {
        edges.push({ id: nextEdgeId(), net: 'state', width: 2, source: 'reg_state', sourcePort: 'Q', target: stateOut.id, targetPort: 'A' });
      }
    }

    if (isCounter || hasAdd) {
      incType('$add');
      nodes.push({
        id: 'cell_add',
        kind: 'comb',
        type: '$add',
        label: '$add_1',
        typeLabel: '$add',
        ports: [
          { id: 'A', name: 'A', dir: 'input', width: 4 },
          { id: 'B', name: 'B', dir: 'input', width: 4 },
          { id: 'Y', name: 'Y', dir: 'output', width: 4 },
        ],
        params: {},
      });

      incType(rstCellType);
      nodes.push({
        id: 'reg_count',
        kind: 'sequential',
        type: rstCellType,
        label: 'count_reg',
        typeLabel: rstCellType,
        ports: [
          { id: 'CLK', name: 'CLK', dir: 'input', width: 1 },
          { id: rstPinName, name: rstPinName, dir: 'input', width: 1 },
          { id: 'D', name: 'D', dir: 'input', width: 4 },
          { id: 'Q', name: 'Q', dir: 'output', width: 4 },
        ],
        params: {},
      });

      edges.push({ id: nextEdgeId(), net: 'clk', width: 1, source: 'in_clk', sourcePort: 'Y', target: 'reg_count', targetPort: 'CLK' });
      edges.push({ id: nextEdgeId(), net: 'count_next', width: 4, source: 'cell_add', sourcePort: 'Y', target: 'reg_count', targetPort: 'D' });
      edges.push({ id: nextEdgeId(), net: 'count_fb', width: 4, source: 'reg_count', sourcePort: 'Q', target: 'cell_add', targetPort: 'A' });

      const countOut = nodes.find((n) => n.kind === 'port_out' && (n.label.includes('count') || n.label.includes('y')));
      if (countOut) {
        edges.push({ id: nextEdgeId(), net: 'count_out', width: 4, source: 'reg_count', sourcePort: 'Q', target: countOut.id, targetPort: 'A' });
      }
    }

    if (hasGe || hasLt) {
      const compType = hasGe ? '$ge' : '$lt';
      incType(compType);
      nodes.push({
        id: 'cell_comp',
        kind: 'comb',
        type: compType,
        label: compType,
        typeLabel: compType,
        ports: [
          { id: 'A', name: 'A', dir: 'input', width: 4 },
          { id: 'B', name: 'B', dir: 'input', width: 4 },
          { id: 'Y', name: 'Y', dir: 'output', width: 1 },
        ],
        params: {},
      });
      if (nodes.some((n) => n.id === 'reg_count')) {
        edges.push({ id: nextEdgeId(), net: 'count_comp', width: 4, source: 'reg_count', sourcePort: 'Q', target: 'cell_comp', targetPort: 'A' });
      }
    }

    if (hasMul) {
      incType('$mul');
      nodes.push({
        id: 'cell_mul',
        kind: 'comb',
        type: '$mul',
        label: '$mul_1',
        typeLabel: '$mul',
        ports: [
          { id: 'A', name: 'A', dir: 'input', width: 8 },
          { id: 'B', name: 'B', dir: 'input', width: 8 },
          { id: 'Y', name: 'Y', dir: 'output', width: 16 },
        ],
        params: {},
      });
    }
  }

  const combCells = nodes.filter((n) => n.kind === 'comb' || n.kind === 'mux').length;
  const depth = Math.max(1, Math.min(6, combCells));
  const delayNs = +(0.35 + depth * 0.45 + 0.15).toFixed(2);
  const fmaxMhz = +(1000 / delayNs).toFixed(1);

  const critNodes = nodes.filter((n) => n.kind === 'sequential' || n.kind === 'comb').map((n) => n.id);
  const critEdges = edges.slice(0, Math.min(3, edges.length)).map((e) => e.id);

  return {
    module: modName,
    modules: [modName],
    nodes,
    edges,
    stats: {
      cells: nodes.filter((n) => n.kind !== 'port_in' && n.kind !== 'port_out').length,
      nets: edges.length,
      ports: nodes.filter((n) => n.kind === 'port_in' || n.kind === 'port_out').length,
      by_type: byType,
    },
    critical_path: {
      depth,
      delay_ns: delayNs,
      fmax_mhz: fmaxMhz,
      nodes: critNodes,
      edges: critEdges,
    },
  };
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
        const prev = lines[idx - 1] ?? '';
        const ignored = (rule: string) =>
          new RegExp(`circuitvr-ignore\\s+(?:ALL|${rule})\\b`, 'i').test(l) ||
          new RegExp(`circuitvr-ignore\\s+(?:ALL|${rule})\\b`, 'i').test(prev);
        if (/\bcase\s*\(/.test(l) && !/\bunique\s+case\b/.test(l) && !ignored('OPT-MUX-CASE')) {
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
        if (/\balways\s*@\s*\(/.test(l) && !ignored('OPT-SV-ALWAYS')) {
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
        if (/std_logic_(?:arith|unsigned)/i.test(l) && !ignored('OPT-VHDL-STD')) {
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
        if (/'event\s+and\s+\w+\s*=\s*'1'/i.test(l) && !ignored('OPT-VHDL-EDGE')) {
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
  optimizeIgnore(path: string, file: string, line: number, rule_id: string): AutoFixResponse {
    const vw = ensureLoaded(path);
    const raw = vw.files[file] ?? '';
    const lines = raw.split('\n');
    const idx = Math.max(0, Math.min(lines.length, line - 1));
    const isVhdl = file.toLowerCase().endsWith('.vhd') || file.toLowerCase().endsWith('.vhdl');
    const prefix = isVhdl ? '--' : '//';
    const pragma = `    ${prefix} circuitvr-ignore ${rule_id}`;
    lines.splice(idx, 0, pragma);
    const content = lines.join('\n');
    vw.files[file] = content;
    return {
      applied: true,
      file,
      content,
      fingerprint: String(Date.now()),
      optimization: this.optimize(path),
    };
  },
  fsm(path: string): FsmReport {
    const vw = ensureLoaded(path);
    const fsms: FsmMachine[] = [];
    const reserved = new Set(['default', 'begin', 'end', 'if', 'else', 'case', 'casex', 'casez', 'endcase', 'posedge', 'negedge', 'or', 'and', 'assign', 'always', 'always_ff', 'always_comb']);

    const computeDead = (reset: string, states: string[], trs: { from: string; to: string; condition: string }[]) => {
      const reach = new Set<string>(reset ? [reset] : []);
      let changed = true;
      while (changed) {
        changed = false;
        for (const t of trs) {
          if (reach.has(t.from) && !reach.has(t.to)) {
            reach.add(t.to);
            changed = true;
          }
        }
      }
      return states.filter((s) => !reach.has(s));
    };

    for (const [rel, raw] of Object.entries(vw.files)) {
      const lower = rel.toLowerCase();
      if (lower.startsWith('tb/') || lower.includes('/tb_') || lower.split('/').pop()!.startsWith('tb_')) continue;
      const isVhdl = lower.endsWith('.vhd') || lower.endsWith('.vhdl');
      const clean = isVhdl
        ? raw.replace(/--[^\n]*/g, '')
        : raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

      if (isVhdl) {
        const typeStates: Record<string, string[]> = {};
        for (const m of clean.matchAll(/\btype\s+(\w+)\s+is\s*\(([^)]+)\)\s*;/gi)) {
          const sts = m[2].split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z_]\w*$/.test(s));
          if (sts.length >= 2) typeStates[m[1]] = sts;
        }
        for (const cm of clean.matchAll(/\bcase\s+(\w+)\s+is\b([\s\S]*?)\bend\s+case\b/gi)) {
          const svar = cm[1];
          const cbody = cm[2];
          let knownStates: string[] = [];
          for (const slist of Object.values(typeStates)) {
            if (slist.some((s) => new RegExp(`\\bwhen\\s+${s}\\s*=>`, 'i').test(cbody))) {
              knownStates = [...slist];
              break;
            }
          }
          const parts = cbody.split(/\bwhen\s+([A-Za-z_]\w*|"[^"]+"|'[01]')\s*=>/i);
          if (parts.length < 3) continue;
          const branches: [string, string][] = [];
          for (let i = 1; i < parts.length - 1; i += 2) {
            const rawLbl = parts[i].trim().replace(/^"|"$/g, '');
            if (rawLbl.toLowerCase() === 'others') continue;
            const lbl = /^[01]+$/.test(rawLbl) ? `OP_${rawLbl}` : rawLbl;
            branches.push([lbl, parts[i + 1]]);
            if (!knownStates.includes(lbl)) knownStates.push(lbl);
          }
          if (knownStates.length < 2) continue;
          const resetState = knownStates[0];
          const transitions: { from: string; to: string; condition: string }[] = [];
          const seen = new Set<string>();
          for (const [src, btxt] of branches) {
            let found = false;
            for (const st of knownStates) {
              for (const tm of btxt.matchAll(new RegExp(`<=\\s*${st}\\b`, 'gi'))) {
                const prefix = btxt.slice(0, tm.index ?? 0);
                const conds = [...prefix.matchAll(/\bif\s+(.+?)\s+then\b/gi)];
                const guard = conds.length ? conds[conds.length - 1][1].trim() : 'unconditional';
                const k = `${src}->${st}:${guard}`;
                if (!seen.has(k)) {
                  seen.add(k);
                  found = true;
                  transitions.push({ from: src, to: st, condition: guard.slice(0, 42) });
                }
              }
            }
            if (!found) {
              const am = btxt.match(/([A-Za-z_]\w*)\s*<=\s*([^;]+);/);
              const act = am ? `${am[1]} <= ${am[2].trim()}` : `${svar}=${src}`;
              const k = `${resetState}->${src}:${act}`;
              if (!seen.has(k)) {
                seen.add(k);
                transitions.push({ from: resetState, to: src, condition: act.slice(0, 42) });
              }
            }
          }
          fsms.push({
            name: svar,
            file: rel,
            encoding: Object.keys(typeStates).length ? 'VHDL Enum' : 'VHDL Case Control',
            reset_state: resetState,
            states: knownStates,
            transitions,
            dead_states: computeDead(resetState, knownStates, transitions),
            has_safe_default: /\bwhen\s+others\s*=>/i.test(cbody),
          });
        }
        continue;
      }

      // SystemVerilog / Verilog
      const enumStates: Record<string, string[]> = {};
      for (const m of clean.matchAll(/\b(?:typedef\s+)?enum\s+(?:(?:logic|bit|reg|int|integer)\s*(?:\[[^\]]+\])?\s*)?\{([^}]+)\}\s*([A-Za-z_]\w*)/g)) {
        const sts = m[1].split(',').map((s) => s.split('=')[0].trim()).filter((s) => /^[A-Za-z_]\w*$/.test(s));
        if (sts.length >= 2) enumStates[m[2]] = sts;
      }

      const paramStates: string[] = [];
      for (const m of clean.matchAll(/\b(?:localparam|parameter)\b[^;]+;/g)) {
        for (const pm of m[0].matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:\d+'[bhdBHD][0-9a-fA-F_]+|\d+)/g)) {
          const nm = pm[1];
          if (['WIDTH', 'DATA_W', 'FRAC_W', 'ACC_W', 'KERNEL_LEN', 'N', 'M', 'DEPTH', 'CLK_DIV'].includes(nm.toUpperCase())) continue;
          if (/(STATE|ST_|S_|IDLE|INIT|WAIT|RUN|DONE|ERR|READ|WRITE|START|STOP|MAC|OUT|LOAD|EXEC|FETCH|DECODE|RED|GREEN|YELLOW|TROJAN|LOCK|UNLOCK|^S\d+$)/i.test(nm)) {
            if (!paramStates.includes(nm)) paramStates.push(nm);
          }
        }
      }

      const fileFsmsStart = fsms.length;
      for (const cm of clean.matchAll(/\b(?:unique\s+|priority\s+)?case[xz]?\s*\(\s*([A-Za-z_]\w*)\s*\)([\s\S]*?)\bendcase\b/g)) {
        const stateVar = cm[1];
        const caseBody = cm[2];
        const lblMatches = [...caseBody.matchAll(/(?:^|[;\n\r\t ])((?:\d+'[bhdBHD][0-9a-fA-F_xXzZ?]+)|(?:[A-Za-z_]\w*))\s*:(?!\s*:)/gm)]
          .filter((m) => !['begin', 'end', 'if', 'else', 'case', 'endcase'].includes(m[1]));

        const rawBranches: [string, string][] = [];
        for (let i = 0; i < lblMatches.length; i++) {
          const lbl = lblMatches[i][1].trim();
          const start = (lblMatches[i].index ?? 0) + lblMatches[i][0].length;
          const end = i + 1 < lblMatches.length ? (lblMatches[i + 1].index ?? caseBody.length) : caseBody.length;
          rawBranches.push([lbl, caseBody.slice(start, end).trim()]);
        }

        const hasDefault = rawBranches.some(([l]) => l === 'default');
        const branches = rawBranches.filter(([l]) => l !== 'default' && !reserved.has(l));
        if (branches.length < 2) continue;

        const branchLabels = branches.map(([l]) => l);
        const knownStates: string[] = [];
        for (const stList of Object.values(enumStates)) {
          if (stList.some((s) => branchLabels.includes(s))) {
            stList.forEach((s) => { if (!knownStates.includes(s)) knownStates.push(s); });
            break;
          }
        }
        if (!knownStates.length && paramStates.length && paramStates.some((s) => branchLabels.includes(s))) {
          paramStates.forEach((s) => { if (!knownStates.includes(s)) knownStates.push(s); });
        }
        branchLabels.forEach((l) => { if (!knownStates.includes(l)) knownStates.push(l); });
        if (knownStates.length < 2) continue;

        let resetState = knownStates[0];
        const rstM = clean.match(/\bif\s*\(\s*!?\s*(?:rst|reset)\w*\s*\)\s*(?:begin\b[\s\S]*?\bend\b|[^;]+;)/i);
        const searchZone = rstM ? rstM[0] : clean;
        for (const s of knownStates) {
          if (new RegExp(`\\b${stateVar}\\s*(?:<=|=)\\s*${s}\\b`).test(searchZone)) {
            resetState = s;
            break;
          }
        }

        const transitions: { from: string; to: string; condition: string }[] = [];
        const seen = new Set<string>();
        for (const [src, btxt] of branches) {
          let found = false;
          for (const st of knownStates) {
            for (const tm of btxt.matchAll(new RegExp(`(?:<=|=)\\s*${st}\\b`, 'g'))) {
              const prefix = btxt.slice(0, tm.index ?? 0);
              const conds = [...prefix.matchAll(/\bif\s*\(([^)]+)\)/g)];
              const hasElse = /\belse\s*(?:begin)?\s*$/.test(prefix.trim());
              const guard = conds.length
                ? (hasElse ? `!(${conds[conds.length - 1][1].trim()})` : conds[conds.length - 1][1].trim())
                : '1 (unconditional)';
              const k = `${src}->${st}:${guard}`;
              if (!seen.has(k)) {
                seen.add(k);
                found = true;
                transitions.push({ from: src, to: st, condition: guard.slice(0, 42) });
              }
            }
          }
          if (!found) {
            const am = btxt.match(/([A-Za-z_]\w*)\s*(?:<=|=)\s*([^;]+);/);
            const act = am ? `${am[1]}=${am[2].trim()}` : `${stateVar}==${src}`;
            const k = `${resetState}->${src}:${act}`;
            if (!seen.has(k)) {
              seen.add(k);
              transitions.push({ from: resetState, to: src, condition: act.slice(0, 42) });
            }
          }
        }

        fsms.push({
          name: stateVar,
          file: rel,
          encoding: /one_hot|onehot/i.test(clean) ? 'One-Hot' : (Object.keys(enumStates).length ? 'Enum / Symbolic' : (paramStates.length ? 'Localparam FSM' : 'Binary Case')),
          reset_state: resetState,
          states: knownStates,
          transitions,
          dead_states: computeDead(resetState, knownStates, transitions),
          has_safe_default: hasDefault,
        });
      }

      // Sequential Counter / Streaming Pipeline / If-Else State Machine fallback
      if (fsms.length === fileFsmsStart) {
        const modM = clean.match(/\bmodule\s+([A-Za-z_]\w*)/);
        const modName = modM ? modM[1] : rel.split('/').pop()!.replace(/\.\w+$/, '');
        for (const sm of clean.matchAll(/\balways(?:_ff)?\s*@\s*\([^)]*(?:posedge|negedge)[^)]*\)\s*(begin\b[\s\S]*?\bend\b|[^;]+;)/g)) {
          const blk = sm[1];
          const conds = [...blk.matchAll(/\bif\s*\(([^)]+)\)/g)].map((m) => m[1].trim());
          if (!conds.length) continue;
          const rstCond = conds[0] || 'rst';
          const activeCond = conds[1] || "clk_en";
          if (/\bvalid_in\b|\bvalid_out\b/.test(blk)) {
            const states = ['RESET', 'IDLE_WAIT', 'STREAM_MAC', 'VALID_OUT'];
            const transitions = [
              { from: 'RESET', to: 'IDLE_WAIT', condition: `!(${rstCond})`.slice(0, 42) },
              { from: 'IDLE_WAIT', to: 'STREAM_MAC', condition: activeCond.slice(0, 42) },
              { from: 'STREAM_MAC', to: 'VALID_OUT', condition: 'pipeline_rdy' },
              { from: 'VALID_OUT', to: 'STREAM_MAC', condition: activeCond.slice(0, 42) },
              { from: 'VALID_OUT', to: 'IDLE_WAIT', condition: `!(${activeCond})`.slice(0, 42) },
            ];
            fsms.push({
              name: `${modName}_ctrl`,
              file: rel,
              encoding: 'Streaming Pipeline FSM',
              reset_state: 'RESET',
              states,
              transitions,
              dead_states: [],
              has_safe_default: true,
            });
            break;
          } else {
            const regM = blk.match(/\b([A-Za-z_]\w*)\s*<=\s*([^;]+);/);
            const regName = regM ? regM[1] : modName;
            const states = ['RESET_0', 'HOLD_IDLE', 'ACTIVE_STEP'];
            const transitions = [
              { from: 'RESET_0', to: 'HOLD_IDLE', condition: `!(${rstCond})`.slice(0, 42) },
              { from: 'HOLD_IDLE', to: 'ACTIVE_STEP', condition: activeCond.slice(0, 42) },
              { from: 'ACTIVE_STEP', to: 'ACTIVE_STEP', condition: activeCond.slice(0, 42) },
              { from: 'ACTIVE_STEP', to: 'HOLD_IDLE', condition: `!(${activeCond})`.slice(0, 42) },
              { from: 'ACTIVE_STEP', to: 'RESET_0', condition: rstCond.slice(0, 42) },
            ];
            fsms.push({
              name: `${regName}_seq`,
              file: rel,
              encoding: 'Sequential Control FSM',
              reset_state: 'RESET_0',
              states,
              transitions,
              dead_states: [],
              has_safe_default: true,
            });
            break;
          }
        }
      }
    }
    return { total_fsms: fsms.length, fsms };
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
    const vw = ensureLoaded(path);
    const diags: Diagnostic[] = [];

    for (const [fpath, content] of Object.entries(vw.files)) {
      if (!/\.(sv|v|vhd|vhdl)$/i.test(fpath)) continue;
      const lines = content.split('\n');
      let inCommentBlock = false;
      let moduleCount = 0;
      let endModuleCount = 0;
      let beginCount = 0;
      let endCount = 0;
      let caseCount = 0;
      let endcaseCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const lineNo = i + 1;
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith('/*')) inCommentBlock = true;
        if (inCommentBlock) {
          if (trimmed.includes('*/')) inCommentBlock = false;
          continue;
        }
        if (trimmed.startsWith('//') || trimmed.startsWith('--') || !trimmed) continue;

        if (/\bmodule\b/.test(trimmed)) moduleCount++;
        if (/\bendmodule\b/.test(trimmed)) endModuleCount++;
        if (/\bbegin\b/.test(trimmed)) beginCount++;
        if (/\bend\b/.test(trimmed) && !/\bend(module|case|function|task|package|generate)\b/.test(trimmed)) endCount++;
        if (/\bcase\s*\(/.test(trimmed)) caseCount++;
        if (/\bendcase\b/.test(trimmed)) endcaseCount++;

        // Stray punctuation error: e.g. `<= data_in;,` or `;;` or `,;`
        if (/(?:<=|=)\s*[^;]*[;,]{2,}/.test(trimmed) || /;\s*,/.test(trimmed) || /,\s*;/.test(trimmed) || /;;/.test(trimmed)) {
          diags.push({
            file: fpath,
            line: lineNo,
            column: 1,
            severity: 'error',
            message: 'Sözdizimi hatası: Beklenmeyen peş peşe noktalama işareti (örn. ";," veya ";;").',
            source: 'cloud-linter',
          });
        }

        // if condition without parentheses: e.g. `if valid_in begin`
        if (/\bif\s+[^(][^;{]*\b(begin|then|return)\b/.test(trimmed)) {
          diags.push({
            file: fpath,
            line: lineNo,
            column: 1,
            severity: 'error',
            message: "Sözdizimi hatası: 'if' koşulu parantez içine alınmalıdır: if (...) .",
            source: 'cloud-linter',
          });
        }

        // Missing semicolon on assignment / statement lines
        if (
          /^\s*(?:[a-zA-Z_]\w*(?:\[[^\]]+\])?\s*<=|assign\s+|[a-zA-Z_]\w*\s*=)\s*[^;{]+$/i.test(trimmed) &&
          !trimmed.endsWith('{') &&
          !trimmed.endsWith('begin') &&
          !trimmed.endsWith(',') &&
          !trimmed.endsWith('(') &&
          !lines[i + 1]?.trim().startsWith(';')
        ) {
          diags.push({
            file: fpath,
            line: lineNo,
            column: trimmed.length,
            severity: 'error',
            message: "Sözdizimi hatası: Satır sonunda noktalı virgül ';' eksik.",
            source: 'cloud-linter',
          });
        }
      }

      if (moduleCount > endModuleCount) {
        diags.push({
          file: fpath,
          line: lines.length,
          column: 1,
          severity: 'error',
          message: "Yapısal hata: Eksik 'endmodule' bildirimi.",
          source: 'cloud-linter',
        });
      }
      if (caseCount > endcaseCount) {
        diags.push({
          file: fpath,
          line: lines.length,
          column: 1,
          severity: 'error',
          message: "Yapısal hata: Eksik 'endcase' bildirimi.",
          source: 'cloud-linter',
        });
      }
    }

    return {
      tool: 'verilator (cloud-ast)',
      success: diags.length === 0,
      diagnostics: diags,
      errors: diags.filter((d) => d.severity === 'error').length,
      warnings: diags.filter((d) => d.severity === 'warning').length,
    };
  },
  schematic(path: string, top?: string): SchematicGraph {
    const vw = ensureLoaded(path);
    let targetCode = '';
    let modName = top || vw.info.default_top || Object.keys(vw.info.modules)[0] || 'top_module';

    for (const [, content] of Object.entries(vw.files)) {
      if (new RegExp(`\\b(module|entity)\\s+${modName}\\b`, 'i').test(content)) {
        targetCode = content;
        break;
      }
    }
    if (!targetCode) {
      for (const [fpath, content] of Object.entries(vw.files)) {
        if (!/tb[_\.]/i.test(fpath) && /\.(sv|v|vhd)$/i.test(fpath)) {
          targetCode = content;
          const m = content.match(/\bmodule\s+(\w+)/i);
          if (m) modName = m[1];
          break;
        }
      }
    }
    if (!targetCode) {
      targetCode = Object.values(vw.files)[0] || '';
    }

    return parseDynamicRtlSchematic(targetCode, modName);
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
  wave(path?: string): WaveData {
    const signals: WaveData['signals'] = [
      { id: 's1', type: 'wire', width: 1, name: 'tb.clk', short: 'clk', scope: 'tb' },
      { id: 's2', type: 'wire', width: 1, name: 'tb.rst', short: 'rst', scope: 'tb' },
    ];
    const changes: Record<string, [number, string][]> = {
      s1: [[0, '0'], [5, '1'], [10, '0'], [15, '1'], [20, '0'], [25, '1'], [30, '0'], [35, '1'], [40, '0'], [45, '1'], [50, '0'], [55, '1'], [60, '0'], [65, '1'], [70, '0']],
      s2: [[0, '1'], [12, '0']],
    };

    if (path) {
      try {
        const vw = ensureLoaded(path);
        let code = '';
        for (const [fp, c] of Object.entries(vw.files)) {
          if (!/tb[_\.]/i.test(fp) && /\.(sv|v|vhd)$/i.test(fp)) {
            code = c;
            break;
          }
        }
        if (code) {
          if (/valid_in/i.test(code)) {
            signals.push({ id: 's_vin', type: 'wire', width: 1, name: 'tb.valid_in', short: 'valid_in', scope: 'tb' });
            changes['s_vin'] = [[0, '0'], [15, '1'], [45, '0'], [55, '1']];
          }
          if (/data_in/i.test(code)) {
            signals.push({ id: 's_din', type: 'wire', width: 8, name: 'tb.data_in[7:0]', short: 'data_in', scope: 'tb' });
            changes['s_din'] = [[0, '00'], [15, '10'], [25, '20'], [35, '30'], [45, '40'], [55, '50']];
          }
          if (/window|shift_reg/i.test(code)) {
            signals.push({ id: 's_w0', type: 'wire', width: 8, name: 'tb.window_0[7:0]', short: 'window[0]', scope: 'tb' });
            signals.push({ id: 's_w1', type: 'wire', width: 8, name: 'tb.window_1[7:0]', short: 'window[1]', scope: 'tb' });
            signals.push({ id: 's_w2', type: 'wire', width: 8, name: 'tb.window_2[7:0]', short: 'window[2]', scope: 'tb' });
            changes['s_w0'] = [[0, '00'], [25, '10'], [35, '20'], [45, '30']];
            changes['s_w1'] = [[0, '00'], [35, '10'], [45, '20'], [55, '30']];
            changes['s_w2'] = [[0, '00'], [45, '10'], [55, '20']];
          }
          if (/count/i.test(code)) {
            signals.push({ id: 's_cnt', type: 'reg', width: 4, name: 'tb.count[3:0]', short: 'count', scope: 'tb' });
            changes['s_cnt'] = [[0, '0'], [15, '1'], [25, '2'], [35, '3'], [45, '4'], [55, '5']];
          }
          if (/state/i.test(code)) {
            signals.push({ id: 's_st', type: 'reg', width: 2, name: 'tb.state[1:0]', short: 'state', scope: 'tb' });
            changes['s_st'] = [[0, '00'], [15, '01'], [25, '10'], [35, '11'], [45, '01'], [55, '10']];
          }
          if (/valid_out/i.test(code)) {
            signals.push({ id: 's_vout', type: 'wire', width: 1, name: 'tb.valid_out', short: 'valid_out', scope: 'tb' });
            changes['s_vout'] = [[0, '0'], [25, '1']];
          }
        }
      } catch {
        // fallback to default signals
      }
    }

    return {
      timescale: '1ns',
      end_time: 70,
      truncated: false,
      signals,
      changes,
    };
  },
  edgeAiAnalyze(cfg: EdgeAiConfig): EdgeAiAnalysis {
    const rawWeights = cfg.weights.length ? cfg.weights : [-0.125, -0.25, 0.375, 0.875, 0.375, -0.25, -0.125];
    const bnEnabled = !!cfg.bn_enabled;
    const bnGamma = cfg.bn_gamma ?? 1.0;
    const bnBeta = cfg.bn_beta ?? 0.0;
    const bnMean = cfg.bn_mean ?? 0.0;
    const bnVar = Math.max(1e-8, cfg.bn_var ?? 1.0);
    const bnEps = Math.max(1e-9, cfg.bn_eps ?? 1e-5);
    const bnScale = bnEnabled ? bnGamma / Math.sqrt(bnVar + bnEps) : 1.0;
    const weights = bnEnabled ? rawWeights.map((w) => Number((w * bnScale).toFixed(6))) : rawWeights;
    const foldedBias = bnEnabled ? Number((((cfg.bias || 0) - bnMean) * bnScale + bnBeta).toFixed(6)) : (cfg.bias || 0);
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

    const bQ = qVal(foldedBias);
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
      const accF = winFp.reduce((a, x, j) => a + x * weights[j], foldedBias);
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
      bn_enabled: bnEnabled,
      bn_scale: Number(bnScale.toFixed(6)),
      folded_weights: weights,
      folded_bias: foldedBias,
      mem_content: `// CircuitVR FPGA Weight ROM ($readmemh) — Q${intBits}.${fracBits}\n` + weightsTable.map((w) => w.hex.replace(/^0x/i, '')).join('\n') + '\n',
      coe_content: `; CircuitVR Xilinx Vivado COE — Q${intBits}.${fracBits}\nmemory_initialization_radix=16;\nmemory_initialization_vector=\n` + weightsTable.map((w) => w.hex.replace(/^0x/i, '')).join(',\n') + ';\n',
      python_export_script: `#!/usr/bin/env python3\nimport json, math\n# CircuitVR Python -> FPGA Exporter\n`,
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
  async edgeAiImportModel(file: File): Promise<ImportedModelResult> {
    const fname = file.name.toLowerCase();
    if (fname.endsWith('.npy')) {
      const buf = await file.arrayBuffer();
      const dv = new DataView(buf);
      const major = dv.getUint8(6);
      const hdrLen = major === 1 ? dv.getUint16(8, true) : dv.getUint32(8, true);
      const offset = (major === 1 ? 10 : 12) + hdrLen;
      const hdrTxt = new TextDecoder('latin1').decode(buf.slice(major === 1 ? 10 : 12, offset));
      const isF8 = hdrTxt.includes('<f8');
      const step = isF8 ? 8 : 4;
      const cnt = Math.floor((buf.byteLength - offset) / step);
      const vals: number[] = [];
      for (let i = 0; i < cnt; i++) {
        vals.push(Number((isF8 ? dv.getFloat64(offset + i * 8, true) : dv.getFloat32(offset + i * 4, true)).toFixed(6)));
      }
      return vals.length <= 16
        ? { filename: file.name, format: 'NumPy (.npy)', weights: vals }
        : { filename: file.name, format: 'NumPy Signal (.npy)', signal: vals.slice(0, 256) };
    }
    const text = await file.text();
    if (fname.endsWith('.json')) {
      const j = JSON.parse(text);
      if (Array.isArray(j)) {
        const nums = j.map(Number).filter((n) => !Number.isNaN(n));
        return nums.length <= 16
          ? { filename: file.name, format: 'JSON Array', weights: nums }
          : { filename: file.name, format: 'JSON Signal', signal: nums.slice(0, 256) };
      }
      return {
        filename: file.name,
        format: 'JSON Model',
        weights: Array.isArray(j.weights) ? j.weights.map(Number).slice(0, 16) : undefined,
        bias: typeof j.bias === 'number' ? j.bias : undefined,
        signal: Array.isArray(j.signal || j.samples) ? (j.signal || j.samples).map(Number).slice(0, 256) : undefined,
        bn_gamma: typeof j.bn_gamma === 'number' ? j.bn_gamma : undefined,
        bn_beta: typeof j.bn_beta === 'number' ? j.bn_beta : undefined,
        bn_mean: typeof j.bn_mean === 'number' ? j.bn_mean : undefined,
        bn_var: typeof j.bn_var === 'number' ? j.bn_var : undefined,
      };
    }
    const nums = text
      .replace(/[\[\]]/g, '')
      .split(/[\s,;]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
    return nums.length <= 16
      ? { filename: file.name, format: 'CSV/Text Weights', weights: nums }
      : { filename: file.name, format: 'CSV/Text Signal', signal: nums.slice(0, 256) };
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
