import axios from 'axios';
import {
  DirListing, EdgeAiAnalysis, EdgeAiConfig, EdgeAiGenerated, InspectedRtlInfo, LintResult, OptimizationReport, SchematicGraph, SimResult, SynthStats, ToolStatus, WaveData, WorkspaceInfo,
} from '../types';
import { cloudFallback } from './cloudFallback';

const BASE = (import.meta as any).env?.VITE_API_URL ?? '';
const api = axios.create({ baseURL: BASE, headers: { 'Content-Type': 'application/json' } });

const isCloudPath = (p?: string) => !!p && (p.startsWith('demo://') || p.startsWith('cloud://'));

/** Turn any axios/network error into a readable message. */
export const errMsg = (e: any): string => {
  const d = e?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (d) return JSON.stringify(d);
  if (e?.code === 'ERR_NETWORK' || !e?.response) {
    return 'Backend\'e ulaşılamıyor. Yerel geliştirme için `uvicorn app.main:app --port 8000` çalıştırın veya hazır bulut örneklerini seçin.';
  }
  return e?.message ?? 'Bilinmeyen hata';
};

const P = '/api/workspace';

export interface UploadItem { file: File; path: string; }

export const ws = {
  tools: () =>
    api.get<ToolStatus>(`${P}/tools`).then((r) => r.data).catch(() => cloudFallback.tools()),
  installYosysWasm: () =>
    api.post<{ tools: ToolStatus }>(`${P}/install-yosys-wasm`, null, { timeout: 600000 }).then((r) => r.data.tools),
  installAllTools: () =>
    api.post<{ installed: boolean; logs: string; tools: ToolStatus }>(`${P}/install-all-tools`, null, { timeout: 600000 }).then((r) => r.data),
  listDir: (path: string) =>
    api.get<DirListing>(`${P}/listdir`, { params: { path } }).then((r) => r.data),
  upload: (items: UploadItem[], name: string, root?: string) => {
    if (isCloudPath(root)) return cloudFallback.upload(items, name);
    const fd = new FormData();
    items.forEach((it) => { fd.append('files', it.file, it.file.name); fd.append('paths', it.path); });
    fd.append('name', name);
    if (root) fd.append('root', root);
    return api
      .post<WorkspaceInfo>(`${P}/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data)
      .catch(() => cloudFallback.upload(items, name));
  },
  recent: () =>
    api.get<{ recent: string[] }>(`${P}/recent`).then((r) => r.data.recent).catch(() => cloudFallback.recent()),
  browse: () => api.post<{ path: string | null }>(`${P}/browse`).then((r) => r.data.path),
  open: (path: string) => {
    if (isCloudPath(path)) return Promise.resolve(cloudFallback.open(path));
    return api.post<WorkspaceInfo>(`${P}/open`, { path }).then((r) => r.data);
  },
  create: (path: string) => api.post<WorkspaceInfo>(`${P}/create`, { path }).then((r) => r.data),
  fingerprint: (path: string) => {
    if (isCloudPath(path)) return Promise.resolve(cloudFallback.open(path).fingerprint);
    return api.get<{ fingerprint: string }>(`${P}/fingerprint`, { params: { path } }).then((r) => r.data.fingerprint);
  },
  readFile: (path: string, file: string) => {
    if (isCloudPath(path)) return Promise.resolve(cloudFallback.readFile(path, file));
    return api.post<{ content: string }>(`${P}/file`, { path, file }).then((r) => r.data.content);
  },
  saveFile: (path: string, file: string, content: string) => {
    if (isCloudPath(path)) return Promise.resolve(cloudFallback.saveFile(path, file, content));
    return api.put(`${P}/file`, { path, file, content }).then((r) => r.data);
  },
  schematic: (path: string, top?: string, flatten = false) => {
    if (isCloudPath(path)) return Promise.resolve(cloudFallback.schematic(path, top));
    return api
      .post<{ schematic: SchematicGraph }>(`${P}/schematic`, { path, top, flatten })
      .then((r) => r.data.schematic)
      .catch(() => cloudFallback.schematic(path, top));
  },
  simulate: (path: string, tb_top: string, max_time_ns: number) => {
    if (isCloudPath(path)) return Promise.resolve(cloudFallback.simulate());
    return api
      .post<SimResult>(`${P}/simulate`, { path, tb_top, max_time_ns })
      .then((r) => (r.data.missing_tool ? cloudFallback.simulate() : r.data))
      .catch(() => cloudFallback.simulate());
  },
  lint: (path: string, top?: string) => {
    if (isCloudPath(path)) return Promise.resolve(cloudFallback.lint(path));
    return api
      .post<LintResult>(`${P}/lint`, { path, top })
      .then((r) => (!r.data.success && !r.data.tool ? cloudFallback.lint(path) : r.data))
      .catch(() => cloudFallback.lint(path));
  },
  synth: (path: string, top: string) => {
    if (isCloudPath(path)) return Promise.resolve(cloudFallback.synth(path, top));
    return api
      .post<SynthStats>(`${P}/synth-stats`, { path, top })
      .then((r) => (!r.data.success ? cloudFallback.synth(path, top) : r.data))
      .catch(() => cloudFallback.synth(path, top));
  },
  optimize: (path: string, top?: string) => {
    if (isCloudPath(path)) return Promise.resolve(cloudFallback.optimize(path));
    return api
      .post<OptimizationReport>(`${P}/optimize`, { path, top })
      .then((r) => r.data)
      .catch(() => cloudFallback.optimize(path));
  },
  wave: (path: string, vcd?: string) => {
    if (isCloudPath(path)) return Promise.resolve(cloudFallback.wave());
    return api
      .post<WaveData>(`${P}/wave`, { path, vcd })
      .then((r) => r.data)
      .catch(() => cloudFallback.wave());
  },
  edgeAiInspectRtl: (path: string, file: string) => {
    if (isCloudPath(path)) return Promise.resolve(cloudFallback.edgeAiInspectRtl(path, file));
    return api
      .post<InspectedRtlInfo>(`${P}/edge-ai/inspect-rtl`, { path, file })
      .then((r) => r.data)
      .catch(() => cloudFallback.edgeAiInspectRtl(path, file));
  },
  edgeAiAnalyze: (cfg: EdgeAiConfig) => {
    if (isCloudPath(cfg.path)) return Promise.resolve(cloudFallback.edgeAiAnalyze(cfg));
    return api
      .post<EdgeAiAnalysis>(`${P}/edge-ai/analyze`, cfg)
      .then((r) => r.data)
      .catch(() => cloudFallback.edgeAiAnalyze(cfg));
  },
  edgeAiGenerate: (cfg: EdgeAiConfig) => {
    if (isCloudPath(cfg.path)) return Promise.resolve(cloudFallback.edgeAiGenerate(cfg));
    return api
      .post<EdgeAiGenerated>(`${P}/edge-ai/generate`, cfg)
      .then((r) => r.data)
      .catch(() => cloudFallback.edgeAiGenerate(cfg));
  },
};
