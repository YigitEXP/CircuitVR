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
import { SchematicGraph, SchematicNode } from '../types';

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
const CellNode: React.FC<NodeProps<{ node: SchematicNode; dim: boolean }>> = ({ data }) => {
  const n = data.node;
  const colors = KIND_COLORS[n.kind] ?? KIND_COLORS.comb;
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
          width: size.w, height: size.h, border: `2px solid ${colors.border}`,
          background: colors.header, opacity: data.dim ? 0.3 : 1,
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
          style={{ background: colors.border }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        width: size.w, height: size.h, border: `2px solid ${colors.border}`,
        borderRadius: 6, background: '#0f172a', opacity: data.dim ? 0.3 : 1,
      }}
      className="text-white shadow-lg"
      title={`${n.type}\n${Object.entries(n.params).map(([k, v]) => `${k}=${v}`).join('\n')}`}
    >
      <div
        style={{ height: HEADER_H, background: colors.header }}
        className="px-2 flex items-center justify-between text-xs font-semibold rounded-t-sm"
      >
        <span className="truncate">{n.typeLabel ?? n.label}</span>
        {n.label !== n.typeLabel && <span className="text-[10px] opacity-60 truncate ml-1">{n.label}</span>}
      </div>
      {ins.map((p, i) => (
        <React.Fragment key={p.id}>
          <Handle
            type="target" id={p.id} position={Position.Left}
            style={{ top: HEADER_H + i * ROW_H + ROW_H / 2, background: colors.border }}
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
            style={{ top: HEADER_H + i * ROW_H + ROW_H / 2, background: colors.border }}
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
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNet, setSelectedNet] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [layouting, setLayouting] = useState(false);

  // Compute layout when graph changes
  useEffect(() => {
    let cancelled = false;
    setLayouting(true);
    layoutGraph(graph).then((pos) => {
      if (cancelled) return;
      setNodes(
        graph.nodes.map((n) => ({
          id: n.id,
          type: 'cell',
          position: pos.get(n.id) ?? { x: 0, y: 0 },
          data: { node: n, dim: false },
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

  // Net highlight + search dimming
  useEffect(() => {
    const q = query.trim().toLowerCase();
    setEdges((eds) =>
      eds.map((e) => {
        const active = selectedNet !== null && e.data?.net === selectedNet;
        return {
          ...e,
          animated: active,
          style: {
            ...e.style,
            stroke: active ? '#facc15' : selectedNet ? '#334155' : '#64748b',
            strokeWidth: (e.data?.width > 1 ? 3 : 1.5) + (active ? 1 : 0),
          },
        };
      })
    );
    setNodes((nds) =>
      nds.map((n) => {
        const sn = n.data.node as SchematicNode;
        const match = !q || sn.label.toLowerCase().includes(q) || sn.type.toLowerCase().includes(q);
        return n.data.dim === !match ? n : { ...n, data: { ...n.data, dim: !match } };
      })
    );
  }, [selectedNet, query, setEdges, setNodes]);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedNet((cur) => (cur === edge.data?.net ? null : edge.data?.net));
  }, []);

  const typeSummary = useMemo(
    () => Object.entries(graph.stats.by_type).sort((a, b) => b[1] - a[1]),
    [graph]
  );

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold">{graph.module}</span>
        <span className="text-gray-400">
          {graph.stats.cells} cells · {graph.stats.nets} nets · {graph.stats.ports} ports
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search cell / type…"
          className="ml-auto px-2 py-1 rounded bg-darker border border-gray-700 text-sm"
        />
        {selectedNet && (
          <button className="px-2 py-1 rounded bg-yellow-600 text-xs" onClick={() => setSelectedNet(null)}>
            Net: {selectedNet} ✕
          </button>
        )}
      </div>

      <div className="card relative" style={{ height: 640, padding: 0 }}>
        {layouting && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 text-sm">
            Laying out schematic…
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onEdgeClick={onEdgeClick}
          onPaneClick={() => setSelectedNet(null)}
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
          <span>Tıkla: kabloya tıklayınca net vurgulanır · sürükle/zoom serbest</span>
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
