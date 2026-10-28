import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import ELK from 'elkjs/lib/elk.bundled.js';
import { Zap } from 'lucide-react';
import { SchematicGraph, SchematicNode } from '../types';
import { useI18n } from '../i18n';

const NODE_W = 170;
const HEADER_H = 26;
const ROW_H = 20;
const TERMINAL_W = 90;
const TERMINAL_H = 28;

const KIND_COLORS: Record<string, { border: string; header: string }> = {
  port_in: { border: '#22c55e', header: '#14532d' },
  port_out: { border: '#f59e0b', header: '#78350f' },
  comb: { border: '#3b82f6', header: '#1e3a8a' },
  mux: { border: '#a855f7', header: '#581c87' },
  sequential: { border: '#ef4444', header: '#7f1d1d' },
  instance: { border: '#14b8a6', header: '#134e4a' },
};

function nodeSize(n: SchematicNode) {
  if (n.kind === 'port_in' || n.kind === 'port_out') return { w: TERMINAL_W, h: TERMINAL_H };
  const ins = n.ports.filter((p) => p.dir !== 'output').length;
  const outs = n.ports.filter((p) => p.dir === 'output').length;
  return { w: NODE_W, h: HEADER_H + Math.max(ins, outs, 1) * ROW_H + 6 };
}

/* ---------- Custom node ---------- */
const CellNode: React.FC<NodeProps<{ node: SchematicNode; dim: boolean; critical?: boolean }>> = ({ data }) => {
  const n = data.node;
  const colors = KIND_COLORS[n.kind] ?? KIND_COLORS.comb;
  const borderCol = data.critical ? '#f43f5e' : colors.border;
  const boxShadow = data.critical ? '0 0 14px rgba(244,63,94,0.65)' : undefined;
  const isTerminal = n.kind === 'port_in' || n.kind === 'port_out';
  const ins = n.ports.filter((p) => p.dir !== 'output');
  const outs = n.ports.filter((p) => p.dir === 'output');
  const size = nodeSize(n);

  if (isTerminal) {
    const p = n.ports[0];
    const isIn = n.kind === 'port_in';
    return (
      <div
        style={{
          width: size.w, height: size.h, border: `2px solid ${borderCol}`,
          background: colors.header, opacity: data.dim ? 0.25 : 1,
          boxShadow,
          clipPath: isIn
            ? 'polygon(0 0, 85% 0, 100% 50%, 85% 100%, 0 100%)'
            : 'polygon(15% 0, 100% 0, 100% 100%, 15% 100%, 0 50%)',
        }}
        className="flex items-center justify-center text-xs font-mono text-white"
        title={`${n.label} (${isIn ? 'input' : 'output'}, ${p.width} bit)`}
      >
        {n.label}{p.width > 1 ? `[${p.width - 1}:0]` : ''}
        <Handle
          type={isIn ? 'source' : 'target'}
          id={p.id}
          position={isIn ? Position.Right : Position.Left}
          style={{ background: borderCol }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        width: size.w, height: size.h, border: `2px solid ${borderCol}`,
        borderRadius: 6, background: '#0f172a', opacity: data.dim ? 0.25 : 1,
        boxShadow,
      }}
      className="text-white shadow-lg"
      title={`${n.type}\n${Object.entries(n.params).map(([k, v]) => `${k}=${v}`).join('\n')}`}
    >
      <div
        style={{ height: HEADER_H, background: data.critical ? '#881337' : colors.header }}
        className="px-2 flex items-center justify-between text-xs font-semibold rounded-t-sm"
      >
        <span className="truncate">{n.typeLabel ?? n.label}</span>
        {n.label !== n.typeLabel && <span className="text-[10px] opacity-60 truncate ml-1">{n.label}</span>}
      </div>
      {ins.map((p, i) => (
        <React.Fragment key={p.id}>
          <Handle
            type="target" id={p.id} position={Position.Left}
            style={{ top: HEADER_H + i * ROW_H + ROW_H / 2, background: borderCol }}
          />
          <div
            style={{ position: 'absolute', left: 8, top: HEADER_H + i * ROW_H, height: ROW_H }}
            className="text-[10px] font-mono text-gray-300 flex items-center"
          >
            {p.name}{p.width > 1 ? `[${p.width - 1}:0]` : ''}
          </div>
        </React.Fragment>
      ))}
      {outs.map((p, i) => (
        <React.Fragment key={p.id}>
          <Handle
            type="source" id={p.id} position={Position.Right}
            style={{ top: HEADER_H + i * ROW_H + ROW_H / 2, background: borderCol }}
          />
          <div
            style={{ position: 'absolute', right: 8, top: HEADER_H + i * ROW_H, height: ROW_H }}
            className="text-[10px] font-mono text-gray-300 flex items-center"
          >
            {p.name}{p.width > 1 ? `[${p.width - 1}:0]` : ''}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
};

const nodeTypes = { cell: CellNode };
const elk = new ELK();

async function layoutGraph(graph: SchematicGraph) {
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '70',
      'elk.spacing.nodeNode': '28',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: graph.nodes.map((n) => {
      const { w, h } = nodeSize(n);
      return { id: n.id, width: w, height: h };
    }),
    edges: graph.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const result = await elk.layout(elkGraph);
  const pos = new Map<string, { x: number; y: number }>();
  (result.children ?? []).forEach((c: any) => pos.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 }));
  return pos;
}

/* ---------- Viewer ---------- */
interface Props {
  graph: SchematicGraph;
}

const Inner: React.FC<Props> = ({ graph }) => {
  const { lang } = useI18n();
  const isTr = lang === 'tr';
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNet, setSelectedNet] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showCritical, setShowCritical] = useState(false);
  const [query, setQuery] = useState('');
  const [layouting, setLayouting] = useState(false);

  const critNodeSet = useMemo(() => new Set(graph.critical_path?.nodes ?? []), [graph]);
  const critEdgeSet = useMemo(() => new Set(graph.critical_path?.edges ?? []), [graph]);

  // Compute layout when graph changes
  useEffect(() => {
    let cancelled = false;
    setLayouting(true);
    setSelectedNet(null);
    setSelectedNodeId(null);
    layoutGraph(graph).then((pos) => {
      if (cancelled) return;
      setNodes(
        graph.nodes.map((n) => ({
          id: n.id,
          type: 'cell',
          position: pos.get(n.id) ?? { x: 0, y: 0 },
          data: { node: n, dim: false, critical: false },
        })) as Node[]
      );
      setEdges(
        graph.edges.map((e) => ({
          id: e.id,
          source: e.source,
          sourceHandle: e.sourcePort,
          target: e.target,
          targetHandle: e.targetPort,
          type: 'smoothstep',
          data: { net: e.net, width: e.width },
          label: e.width > 1 ? `${e.net}[${e.width - 1}:0]` : undefined,
          labelStyle: { fill: '#94a3b8', fontSize: 10 },
          labelBgStyle: { fill: '#0f172a' },
          style: { stroke: '#64748b', strokeWidth: e.width > 1 ? 3 : 1.5 },
        })) as Edge[]
      );
      setLayouting(false);
    });
    return () => { cancelled = true; };
  }, [graph, setNodes, setEdges]);

  // Compute Fan-In / Fan-Out cone for selectedNodeId
  const coneInfo = useMemo(() => {
    if (!selectedNodeId) return null;
    const coneNodes = new Set<string>([selectedNodeId]);
    const coneEdges = new Set<string>();
    graph.edges.forEach((e) => {
      if (e.source === selectedNodeId || e.target === selectedNodeId) {
        coneNodes.add(e.source);
        coneNodes.add(e.target);
        coneEdges.add(e.id);
      }
    });
    return { coneNodes, coneEdges };
  }, [selectedNodeId, graph.edges]);

  // Net / Critical Path / Cone highlight + search dimming
  useEffect(() => {
    const q = query.trim().toLowerCase();
    setEdges((eds) =>
      eds.map((e) => {
        const isCrit = showCritical && critEdgeSet.has(e.id);
        const isCone = coneInfo ? coneInfo.coneEdges.has(e.id) : false;
        const isNet = selectedNet !== null && e.data?.net === selectedNet;
        const active = isCrit || isCone || isNet;
        const anyFilter = showCritical || !!coneInfo || selectedNet !== null;
        return {
          ...e,
          animated: active,
          style: {
            ...e.style,
            stroke: isCrit ? '#f43f5e' : isCone ? '#38bdf8' : isNet ? '#facc15' : anyFilter ? '#1e293b' : '#64748b',
            strokeWidth: (e.data?.width > 1 ? 3 : 1.5) + (active ? 1.2 : 0),
          },
        };
      })
    );
    setNodes((nds) =>
      nds.map((n) => {
        const sn = n.data.node as SchematicNode;
        const matchQ = !q || sn.label.toLowerCase().includes(q) || sn.type.toLowerCase().includes(q);
        const isCrit = showCritical && critNodeSet.has(n.id);
        const isCone = coneInfo ? coneInfo.coneNodes.has(n.id) : true;
        const dim = !matchQ || (showCritical && !isCrit) || (coneInfo !== null && !isCone);
        return { ...n, data: { ...n.data, dim, critical: isCrit } };
      })
    );
  }, [selectedNet, selectedNodeId, showCritical, query, critEdgeSet, critNodeSet, coneInfo, setEdges, setNodes]);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedNodeId(null);
    setSelectedNet((cur) => (cur === edge.data?.net ? null : edge.data?.net));
  }, []);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNet(null);
    setSelectedNodeId((cur) => (cur === node.id ? null : node.id));
  }, []);

  const typeSummary = useMemo(
    () => Object.entries(graph.stats.by_type).sort((a, b) => b[1] - a[1]),
    [graph]
  );

  const cp = graph.critical_path;

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold">{graph.module}</span>
        <span className="text-gray-400 text-xs">
          {graph.stats.cells} {isTr ? 'hücre' : 'cells'} · {graph.stats.nets} {isTr ? 'hat' : 'nets'} · {graph.stats.ports} port
        </span>

        {cp && (
          <button
            type="button"
            onClick={() => {
              setSelectedNet(null);
              setSelectedNodeId(null);
              setShowCritical((v) => !v);
            }}
            className={`px-2.5 py-1 rounded-lg border text-xs font-mono flex items-center gap-1.5 transition ${
              showCritical
                ? 'bg-rose-600/30 border-rose-400 text-rose-200 shadow-glow'
                : 'bg-darker border-slate-700 text-slate-300 hover:border-rose-500/50 hover:text-rose-300'
            }`}
            title={
              isTr
                ? 'En uzun kombinasyonel kritik yolu ve tahmini maksimum çalışma frekansını (Fmax) vurgula'
                : 'Highlight longest combinational critical path and estimated Fmax'
            }
          >
            <Zap className="w-3.5 h-3.5 text-rose-400" />
            <span>
              {isTr ? 'Kritik Yol:' : 'Critical Path:'} {cp.depth} {isTr ? 'kademe' : 'stages'} (~{cp.delay_ns} ns · {isTr ? 'Tahmini' : 'Est.'} Fmax ≈ {cp.fmax_mhz} MHz)
            </span>
          </button>
        )}

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={isTr ? 'Hücre / kapı ara…' : 'Search cell / type…'}
          className="ml-auto px-2 py-1 rounded bg-darker border border-gray-700 text-xs"
        />
        {selectedNet && (
          <button className="px-2 py-1 rounded bg-yellow-600 text-xs" onClick={() => setSelectedNet(null)}>
            Net: {selectedNet} ✕
          </button>
        )}
        {selectedNodeId && (
          <button className="px-2 py-1 rounded bg-sky-600 text-xs" onClick={() => setSelectedNodeId(null)}>
            Fan-In/Out: {selectedNodeId.replace(/^(cell:|port:)/, '')} ✕
          </button>
        )}
      </div>

      <div className="card relative" style={{ height: 640, padding: 0 }}>
        {layouting && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 text-sm">
            {isTr ? 'Şematik yerleştiriliyor…' : 'Laying out schematic…'}
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onEdgeClick={onEdgeClick}
          onNodeClick={onNodeClick}
          onPaneClick={() => {
            setSelectedNet(null);
            setSelectedNodeId(null);
          }}
          nodeTypes={nodeTypes}
          nodesConnectable={false}
          minZoom={0.05}
          fitView
          style={{ background: '#0b1220' }}
        >
          <Background color="#1e293b" gap={20} />
          <Controls />
          <MiniMap
            pannable zoomable
            nodeColor={(n) => KIND_COLORS[(n.data?.node as SchematicNode)?.kind]?.border ?? '#3b82f6'}
            style={{ background: '#0f172a' }}
          />
        </ReactFlow>
      </div>

      <div className="card">
        <div className="flex flex-wrap gap-2 text-xs">
          {typeSummary.map(([t, c]) => (
            <span key={t} className="px-2 py-1 rounded bg-surface">{t}: {c}</span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-400">
          {Object.entries(KIND_COLORS).map(([k, c]) => (
            <span key={k} className="flex items-center gap-1">
              <span style={{ background: c.border }} className="inline-block w-3 h-3 rounded-sm" />{k}
            </span>
          ))}
          <span>
            {isTr
              ? 'Kabloya tıkla: sinyali izle · Hücreye tıkla: Fan-In/Fan-Out konisini gör · Kritik Yol butonu: Fmax darboğazını parlat'
              : 'Click wire: trace net · Click cell: highlight Fan-In/Out cone · Critical Path button: highlight Fmax bottleneck'}
          </span>
        </div>
      </div>
    </div>
  );
};

const SchematicViewer: React.FC<Props> = (props) => (
  <ReactFlowProvider>
    <Inner {...props} />
  </ReactFlowProvider>
);

export default SchematicViewer;
