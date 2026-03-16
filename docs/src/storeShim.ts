/**
 * Store shim for docs demos.
 *
 * Replaces the singleton `useSchematicStore` from src/store.ts with a
 * React Context–based version so each <DemoCanvas> gets its own isolated store.
 */
import { createContext, useContext } from "react";
import { useStore, type StoreApi } from "zustand";
import type { OnNodesChange, OnEdgesChange, Connection } from "@xyflow/react";
import type { SchematicNode, ConnectionEdge, DeviceTemplate } from "../src/types";
import type { AlignOperation } from "../src/alignUtils";
import type { RoutedEdge } from "../src/edgeRouter";
import type { ReactFlowInstance } from "@xyflow/react";
import type { SignalType } from "../src/types";

// Re-export constants that main app code imports from store
export const GRID_SIZE = 20;
export function setReconnectingEdgeId(_id: string | null) {}

export interface DemoStoreState {
  nodes: SchematicNode[];
  edges: ConnectionEdge[];
  schematicName: string;
  editingNodeId: string | null;
  customTemplates: DeviceTemplate[];
  routedEdges: Record<string, RoutedEdge>;
  debugEdges: boolean;
  isDragging: boolean;
  signalColors: Partial<Record<SignalType, string>> | undefined;
  hiddenSignalTypes: string;
  hideDeviceTypes: boolean;

  onNodesChange: OnNodesChange<SchematicNode>;
  onEdgesChange: OnEdgesChange<ConnectionEdge>;
  onConnect: (connection: Connection) => void;

  addDevice: (template: DeviceTemplate, position: { x: number; y: number }) => void;
  removeSelected: () => void;
  copySelected: () => void;
  pasteClipboard: () => void;
  alignSelectedNodes: (op: AlignOperation) => void;
  isValidConnection: (connection: Connection) => boolean;
  updateDeviceLabel: (nodeId: string, label: string) => void;
  updateDevice: (nodeId: string, data: unknown) => void;
  setEditingNodeId: (id: string | null) => void;
  addRoom: (label: string, position: { x: number; y: number }) => void;
  updateRoomLabel: (nodeId: string, label: string) => void;
  addNote: (position: { x: number; y: number }) => void;
  updateNoteHtml: (nodeId: string, html: string) => void;
  reparentNode: (nodeId: string, absolutePosition: { x: number; y: number }) => void;

  pushSnapshot: () => void;
  setPendingUndoSnapshot: () => void;
  clearPendingUndoSnapshot: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  addCustomTemplate: (template: DeviceTemplate) => void;
  removeCustomTemplate: (deviceType: string) => void;

  recomputeRoutes: (rfInstance: ReactFlowInstance) => void;
  toggleDebugEdges: () => void;

  setSignalColors: (colors: Record<SignalType, string>) => void;
  toggleSignalTypeVisibility: (type: SignalType) => void;
  setHideDeviceTypes: (hide: boolean) => void;
  showAllSignalTypes: () => void;

  saveToLocalStorage: () => void;
  loadFromLocalStorage: () => boolean;
  exportToJSON: () => unknown;
  importFromJSON: (data: unknown) => void;
  newSchematic: () => void;
  setSchematicName: (name: string) => void;
}

export const StoreContext = createContext<StoreApi<DemoStoreState> | null>(null);

/**
 * Drop-in replacement for `useSchematicStore` from the main app.
 * Supports both `useSchematicStore((s) => s.foo)` and `useSchematicStore()`.
 */
export function useSchematicStore<T>(selector?: (state: DemoStoreState) => T): T {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error("useSchematicStore must be used within a <StoreContext.Provider>");
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useStore(store, selector ?? ((s) => s as unknown as T));
}

// Attach getState for code that uses `useSchematicStore.getState()` directly.
// In demos this is a no-op placeholder; the real store access comes through context.
useSchematicStore.getState = () => {
  console.warn("useSchematicStore.getState() called outside React context in docs shim");
  return {} as DemoStoreState;
};

useSchematicStore.setState = (_partial: Partial<DemoStoreState>) => {
  console.warn("useSchematicStore.setState() called outside React context in docs shim");
};
