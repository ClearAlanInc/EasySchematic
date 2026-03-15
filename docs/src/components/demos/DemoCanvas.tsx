import { useMemo, useCallback, useEffect, Component, type ReactNode } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  type Connection,
  type Node,
  type NodeTypes,
  type EdgeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { StoreContext, GRID_SIZE, type DemoStoreState } from "../../storeShim";
import { createDemoStore } from "../../createDemoStore";
import { useStore, type StoreApi } from "zustand";
import type { SchematicNode, ConnectionEdge } from "../../../../src/types";
import { enforceMinSpacing } from "../../../../src/snapUtils";

import DeviceNodeComponent from "../../../../src/components/DeviceNode";
import RoomNodeComponent from "../../../../src/components/RoomNode";
import NoteNodeComponent from "../../../../src/components/NoteNode";
import OffsetEdgeComponent from "../../../../src/components/OffsetEdge";

const demoNodeTypes: NodeTypes = {
  device: DeviceNodeComponent,
  room: RoomNodeComponent,
  note: NoteNodeComponent,
};

const demoEdgeTypes: EdgeTypes = {
  smoothstep: OffsetEdgeComponent,
};

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, background: "#fee", border: "2px solid red", borderRadius: 8, margin: "1rem 0" }}>
          <strong>Demo Error:</strong> {this.state.error.message}
          <pre style={{ fontSize: 11, overflow: "auto", maxHeight: 200 }}>
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const fitViewOptions = { padding: 0.3 };

function DemoFlow({
  store,
  height,
  interactive = true,
}: {
  store: StoreApi<DemoStoreState>;
  height: number;
  interactive?: boolean;
}) {
  const nodes = useStore(store, (s) => s.nodes);
  const edges = useStore(store, (s) => s.edges);
  const isDragging = useStore(store, (s) => s.isDragging);
  const onNodesChange = useStore(store, (s) => s.onNodesChange);
  const onEdgesChange = useStore(store, (s) => s.onEdgesChange);
  const onConnect = useStore(store, (s) => s.onConnect);
  const isValidConnection = useStore(store, (s) => s.isValidConnection);

  const rfInstance = useReactFlow();

  // Freeze routing during drag, recompute after drop
  const nodeDigest = useMemo(
    () => nodes.map((n) => `${n.id}:${Math.round(n.position.x)},${Math.round(n.position.y)}`).join("|"),
    [nodes],
  );
  const edgeDigest = useMemo(
    () => edges.map((e) => `${e.id}:${e.source}:${e.target}`).join("|"),
    [edges],
  );

  useEffect(() => {
    if (isDragging) return;
    const timer = setTimeout(() => {
      store.getState().recomputeRoutes(rfInstance);
    }, 50);
    return () => clearTimeout(timer);
  }, [store, rfInstance, isDragging, nodeDigest, edgeDigest]);

  // Drag handlers matching the real app
  const onNodeDragStart = useCallback(() => {
    store.setState({ isDragging: true });
  }, [store]);

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      const state = store.getState();
      // Enforce minimum spacing so stubs don't land inside neighbor obstacle rects
      const spacing = enforceMinSpacing(draggedNode as SchematicNode, state.nodes);
      if (spacing) {
        const updated = state.nodes.map((n) =>
          n.id === draggedNode.id ? { ...n, position: { x: spacing.x, y: spacing.y } } : n,
        );
        store.setState({ nodes: updated as SchematicNode[], isDragging: false });
      } else {
        store.setState({ isDragging: false });
      }
    },
    [store],
  );

  return (
    <div className="demo-canvas" style={{ height, width: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={interactive ? onNodesChange : undefined}
        onEdgesChange={interactive ? onEdgesChange : undefined}
        onConnect={interactive ? onConnect : undefined}
        isValidConnection={interactive ? (isValidConnection as (c: Connection) => boolean) : undefined}
        onNodeDragStart={interactive ? onNodeDragStart : undefined}
        onNodeDragStop={interactive ? onNodeDragStop : undefined}
        nodeTypes={demoNodeTypes}
        edgeTypes={demoEdgeTypes}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "smoothstep" }}
        nodesDraggable={interactive}
        nodesConnectable={interactive}
        elementsSelectable={interactive}
        connectOnClick={interactive}
        panOnDrag={[1]}
        snapToGrid
        snapGrid={[GRID_SIZE, GRID_SIZE]}
        elevateNodesOnSelect={false}
        multiSelectionKeyCode="Shift"
        deleteKeyCode={null}
        selectionKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE} size={1} color="#d4d4d4" />
        <Controls position="bottom-right" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export default function DemoCanvas({
  initialNodes,
  initialEdges,
  height = 400,
  interactive = true,
}: {
  initialNodes: SchematicNode[];
  initialEdges: ConnectionEdge[];
  height?: number;
  interactive?: boolean;
}) {
  const store = useMemo(
    () => createDemoStore(initialNodes, initialEdges),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <ErrorBoundary>
      <StoreContext.Provider value={store}>
        <ReactFlowProvider>
          <DemoFlow store={store} height={height} interactive={interactive} />
        </ReactFlowProvider>
      </StoreContext.Provider>
    </ErrorBoundary>
  );
}
