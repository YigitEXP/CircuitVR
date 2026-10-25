export interface SchematicPort { id: string; name: string; dir: 'input' | 'output' | 'inout'; width: number; }
export interface SchematicNode { id: string; kind: 'port_in' | 'port_out' | 'comb' | 'sequential' | 'mux' | 'instance'; type: string; label: string; typeLabel?: string; params: Record<string, any>; ports: SchematicPort[]; }
export interface SchematicEdge { id: string; net: string; width: number; source: string; sourcePort: string; target: string; targetPort: string; }
export interface SchematicGraph { module: string; modules: string[]; nodes: SchematicNode[]; edges: SchematicEdge[]; stats: { cells: number; nets: number; ports: number; by_type: Record<string, number> }; }

export interface WsModule {
  name: string;
  file: string;
  line: number;
  group: 'rtl' | 'tb';
  instances: string[];
  instantiated_by: string[];
  children: number;
}

export interface WsFile {
  path: string;
  name: string;
  lang?: 'sv' | 'v' | 'vhdl';
  group: 'rtl' | 'tb';
  is_header: boolean;
  size: number;
  lines: number;
  modules: { name: string; line: number }[];
  packages: string[];
  interfaces: string[];
}

export interface WorkspaceInfo {
  root: string;
  name: string;
  files: WsFile[];
  modules: Record<string, WsModule>;
  rtl_tops: string[];
  tb_tops: string[];
  default_top: string | null;
  default_tb: string | null;
  has_rtl_dir: boolean;
  has_tb_dir: boolean;
  fingerprint: string;
  warnings: string[];
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  code?: string | null;
  file: string;
  line: number;
  column?: number | null;
  message: string;
  source?: string;
}

export interface SimResult {
  success: boolean;
  stage?: string;
  log: string;
  error?: string | null;
  missing_tool?: string;
  diagnostics: Diagnostic[];
  vcd: string | null;
  duration?: number;
}

export interface LintResult {
  tool: string | null;
  success: boolean;
  error?: string;
  diagnostics: Diagnostic[];
  errors?: number;
  warnings?: number;
}

export interface OptimizationSuggestion {
  category: string;
  impact: 'yüksek' | 'orta' | 'düşük' | 'bilgi';
  title: string;
  file: string;
  line: number;
  why: string;
  before: string;
  after: string;
}

export interface OptimizationReport {
  score: number;
  summary: string;
  total: number;
  suggestions: OptimizationSuggestion[];
}

export interface SynthStats {
  success: boolean;
  error?: string;
  top?: string;
  lut_size?: number;
  luts?: number;
  ffs?: number;
  mem?: number;
  other_gates?: number;
  logic_depth?: number | null;
  cells?: Record<string, number>;
  note?: string;
  optimization?: OptimizationReport;
}

export interface WaveSignal { id: string; type: string; width: number; name: string; short: string; scope: string; }
export interface WaveData {
  timescale: string;
  end_time: number;
  signals: WaveSignal[];
  changes: Record<string, [number, string][]>;
  truncated: boolean;
}

export interface LogLine { t: string; level: 'info' | 'error' | 'ok'; text: string; }
export interface ToolInfo { found: boolean; path: string | null; purpose: string; hint: string; }
export type ToolStatus = Record<string, ToolInfo>;
export interface DirListing { path: string; parent: string | null; dirs: { name: string; path: string }[]; is_project: boolean; }
