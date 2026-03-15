/**
 * Factory for creating isolated Zustand stores for docs demos.
 */
import { createStore } from "zustand";
import {
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
} from "@xyflow/react";
import type { SchematicNode, ConnectionEdge, DeviceData, Port } from "../src/types";
import type { DemoStoreState } from "./storeShim";
import { routeAllEdges } from "../../src/edgeRouter";

function getPortFromHandle(
  nodes: SchematicNode[],
  nodeId: string,
  handleId: string | null,
): Port | undefined {
  if (!handleId) return undefined;
  const node = nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "device") return undefined;
  const ports = (node.data as DeviceData).ports;
  const direct = ports.find((p) => p.id === handleId);
  if (direct) return direct;
  const baseId = handleId.replace(/-(in|out)$/, "");
  return ports.find((p) => p.id === baseId);
}

let edgeCounter = 1000;

export function createDemoStore(
  initialNodes: SchematicNode[],
  initialEdges: ConnectionEdge[],
) {
  return createStore<DemoStoreState>((set, get) => ({
    nodes: initialNodes,
    edges: initialEdges,
    schematicName: "Demo",
    editingNodeId: null,
    customTemplates: [],
    routedEdges: {},
    debugEdges: false,
    isDragging: false,
    signalColors: undefined,

    onNodesChange: (changes) => {
      set({
        nodes: applyNodeChanges(changes, get().nodes) as SchematicNode[],
      });
    },

    onEdgesChange: (changes) => {
      set({
        edges: applyEdgeChanges(changes, get().edges) as ConnectionEdge[],
      });
    },

    onConnect: (connection) => {
      const state = get();
      if (!state.isValidConnection(connection)) return;

      const sourcePort = getPortFromHandle(
        state.nodes,
        connection.source,
        connection.sourceHandle,
      );

      const newEdge: ConnectionEdge = {
        id: `demo-edge-${++edgeCounter}`,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        data: { signalType: sourcePort?.signalType ?? "custom" },
        style: {
          stroke: `var(--color-${sourcePort?.signalType ?? "custom"})`,
          strokeWidth: 2,
        },
      };

      set({ edges: [...state.edges, newEdge] });
    },

    isValidConnection: (connection) => {
      const state = get();
      const sourcePort = getPortFromHandle(state.nodes, connection.source, connection.sourceHandle);
      const targetPort = getPortFromHandle(state.nodes, connection.target, connection.targetHandle);
      if (!sourcePort || !targetPort) return false;
      const canSource = sourcePort.direction === "output" || sourcePort.direction === "bidirectional";
      const canTarget = targetPort.direction === "input" || targetPort.direction === "bidirectional";
      if (!canSource || !canTarget) return false;
      if (sourcePort.signalType !== targetPort.signalType) return false;
      const duplicate = state.edges.some(
        (e) => e.target === connection.target && e.targetHandle === connection.targetHandle,
      );
      return !duplicate;
    },

    // Stubs for features not needed in demos
    addDevice: () => {},
    removeSelected: () => {},
    copySelected: () => {},
    pasteClipboard: () => {},
    alignSelectedNodes: () => {},
    updateDeviceLabel: () => {},
    updateDevice: () => {},
    setEditingNodeId: (id) => set({ editingNodeId: id }),
    addRoom: () => {},
    updateRoomLabel: () => {},
    addNote: () => {},
    updateNoteHtml: () => {},
    reparentNode: () => {},
    pushSnapshot: () => {},
    setPendingUndoSnapshot: () => {},
    clearPendingUndoSnapshot: () => {},
    undo: () => {},
    redo: () => {},
    canUndo: () => false,
    canRedo: () => false,
    addCustomTemplate: () => {},
    removeCustomTemplate: () => {},
    recomputeRoutes: (rfInstance) => {
      const state = get();
      const results = routeAllEdges(state.nodes, state.edges, rfInstance, false);
      set({ routedEdges: results });
    },
    toggleDebugEdges: () => {},
    setSignalColors: () => {},
    saveToLocalStorage: () => {},
    loadFromLocalStorage: () => false,
    exportToJSON: () => ({}),
    importFromJSON: () => {},
    newSchematic: () => {},
    setSchematicName: () => {},
  }));
}
