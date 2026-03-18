import { useEffect, useCallback } from "react";
import { useSchematicStore } from "../store";
import type { RoomData } from "../types";

export default function RoomContextMenu() {
  const menu = useSchematicStore((s) => s.roomContextMenu);

  // Close on click anywhere or Escape
  useEffect(() => {
    if (!menu) return;
    const close = () => useSchematicStore.setState({ roomContextMenu: null });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const timer = setTimeout(() => {
      document.addEventListener("click", close);
      document.addEventListener("contextmenu", close);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", close);
      document.removeEventListener("contextmenu", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const editProperties = useCallback(() => {
    if (!menu) return;
    useSchematicStore.getState().setEditingNodeId(menu.nodeId);
    useSchematicStore.setState({ roomContextMenu: null });
  }, [menu]);

  const toggleLock = useCallback(() => {
    if (!menu) return;
    useSchematicStore.getState().toggleRoomLock(menu.nodeId);
    useSchematicStore.setState({ roomContextMenu: null });
  }, [menu]);

  if (!menu) return null;

  const node = useSchematicStore.getState().nodes.find((n) => n.id === menu.nodeId);
  const isLocked = !!(node?.data as RoomData | undefined)?.locked;

  return (
    <div
      className="fixed z-50 bg-white border border-gray-300 rounded shadow-lg py-1 min-w-[160px]"
      style={{ left: menu.screenX, top: menu.screenY }}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem label="Edit Properties..." onClick={editProperties} />
      <MenuItem label={isLocked ? "Unlock Room" : "Lock Room"} onClick={toggleLock} />
    </div>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer"
      onClick={onClick}
    >
      {label}
    </button>
  );
}
