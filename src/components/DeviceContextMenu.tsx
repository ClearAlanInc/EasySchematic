import { useCallback, useEffect, useMemo } from "react";
import { useUpdateNodeInternals } from "@xyflow/react";
import { useSchematicStore } from "../store";
import type { DeviceData, RackElevationPage } from "../types";
import { useContextMenuPosition } from "../hooks/useContextMenuPosition";
import { inferRackHeightU } from "../rackUtils";
import { buildManagementTarget, buildSshTarget, describeManagementGap, findManagementPort, effectiveAuthMode } from "../managementUrl";

export default function DeviceContextMenu() {
  const menu = useSchematicStore((s) => s.deviceContextMenu);
  const schematicSheets = useSchematicStore((s) => s.schematicSheets);
  const activeSheetId = useSchematicStore((s) => s.activeSheetId);
  const moveNodesToSheet = useSchematicStore((s) => s.moveNodesToSheet);
  const addSchematicSheet = useSchematicStore((s) => s.addSchematicSheet);
  const allPages = useSchematicStore((s) => s.pages);
  const pages = useMemo(() => allPages.filter((p): p is RackElevationPage => p.type === "rack-elevation"), [allPages]);
  const setActivePage = useSchematicStore((s) => s.setActivePage);
  const nodes = useSchematicStore((s) => s.nodes);
  const updateNodeInternals = useUpdateNodeInternals();
  const { ref: menuRef, pos: menuPos } = useContextMenuPosition(
    menu?.screenX ?? 0,
    menu?.screenY ?? 0,
  );

  useEffect(() => {
    if (!menu) return;
    const close = () => useSchematicStore.setState({ deviceContextMenu: null });
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
    useSchematicStore.setState({ deviceContextMenu: null });
  }, [menu]);

  const swapDevice = useCallback(() => {
    if (!menu) return;
    useSchematicStore.setState({
      deviceSwapTarget: { nodeId: menu.nodeId },
      deviceContextMenu: null,
    });
  }, [menu]);

  const openManagementUi = useCallback(() => {
    if (!menu) return;
    const { nodes: ns, addToast } = useSchematicStore.getState();
    const node = ns.find((n) => n.id === menu.nodeId);
    useSchematicStore.setState({ deviceContextMenu: null });
    if (node?.type !== "device") return;
    const data = node.data as DeviceData;
    const target = buildManagementTarget(data);
    if (!target) return;

    const mode = effectiveAuthMode(data);
    // Hand the credentials over before navigating, so they're ready to paste.
    if (mode === "clipboard" && (data.username || data.password) && navigator.clipboard) {
      navigator.clipboard
        .writeText(data.password ?? data.username ?? "")
        .then(() =>
          addToast(
            data.password
              ? `Password copied — user "${data.username ?? ""}" · ${target.host}`
              : `Username copied · ${target.host}`,
            "info",
          ),
        )
        .catch(() => { /* clipboard blocked — the tab still opens */ });
    }

    // noopener/noreferrer: the opened device page must not get a handle on this window.
    window.open(target.urlWithCredentials ?? target.url, "_blank", "noopener,noreferrer");
  }, [menu]);

  const openConsole = useCallback(() => {
    if (!menu) return;
    const { nodes: ns, addToast } = useSchematicStore.getState();
    const node = ns.find((n) => n.id === menu.nodeId);
    useSchematicStore.setState({ deviceContextMenu: null });
    if (node?.type !== "device") return;
    const data = node.data as DeviceData;
    const ssh = buildSshTarget(data);
    if (!ssh) return;

    const announce = (extra: string) =>
      addToast(
        `Opening SSH to ${ssh.username ? ssh.username + "@" : ""}${ssh.host}${extra}` +
          " — needs an ssh:// handler (Terminal on macOS)",
        "info",
        6000,
      );

    // SSH takes no password from the URL, so hand it over via the clipboard.
    if (ssh.hasPassword && navigator.clipboard) {
      navigator.clipboard
        .writeText(data.password ?? "")
        .then(() => announce(" · password copied"))
        .catch(() => announce(""));
    } else {
      announce("");
    }

    // Custom scheme: assigning location lets the OS claim it without leaving a blank tab.
    window.location.href = ssh.url;
  }, [menu]);

  const deleteDevice = useCallback(() => {
    if (!menu) return;
    useSchematicStore.setState({ deviceContextMenu: null });
    useSchematicStore.getState().deleteNode(menu.nodeId);
  }, [menu]);

  const toggleShowOnlyConnected = useCallback(() => {
    if (!menu) return;
    const { patchDeviceData, nodes: ns } = useSchematicStore.getState();
    const node = ns.find((n) => n.id === menu.nodeId);
    if (!node || node.type !== "device") return;
    const cur = (node.data as DeviceData).showOnlyConnectedPorts;
    patchDeviceData(menu.nodeId, { showOnlyConnectedPorts: cur ? undefined : true });
    // Handle count changes when ports are filtered — re-measure so edges stay routed.
    updateNodeInternals(menu.nodeId);
    useSchematicStore.setState({ deviceContextMenu: null });
  }, [menu, updateNodeInternals]);

  if (!menu) return null;

  const { nodeId } = menu;
  const node = nodes.find((n) => n.id === nodeId);
  const deviceData = node?.type === "device" ? (node.data as DeviceData) : null;

  const placement = pages
    .flatMap((p) => p.placements.map((pl) => ({ page: p, placement: pl })))
    .find((x) => x.placement.deviceNodeId === nodeId);

  const managementTarget = deviceData ? buildManagementTarget(deviceData) : undefined;
  const sshTarget = deviceData ? buildSshTarget(deviceData) : undefined;
  // Designated as management but not yet reachable — show the actions greyed out
  // with the reason rather than hiding them and leaving the user guessing.
  const managementGap = deviceData ? describeManagementGap(deviceData) : undefined;
  const sshDesignated = !!(deviceData && findManagementPort(deviceData)?.networkConfig?.supportsSsh);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-white border border-gray-300 rounded shadow-lg py-1 min-w-[160px]"
      style={{
        left: menuPos.x,
        top: menuPos.y,
        maxHeight: menuPos.maxHeight,
        overflowY: menuPos.maxHeight ? "auto" : undefined,
        visibility: menuPos.ready ? "visible" : "hidden",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem label="Edit Properties..." onClick={editProperties} />
      <MenuItem label="Swap Device..." onClick={swapDevice} />

      {managementTarget ? (
        <MenuItem
          label="Connect / Control..."
          onClick={openManagementUi}
          title={`Open ${managementTarget.url} in a new tab${
            managementTarget.viaPortLabel ? ` (via ${managementTarget.viaPortLabel})` : ""
          }`}
        />
      ) : managementGap ? (
        <MenuItem label="Connect / Control..." onClick={editProperties} disabled title={managementGap} />
      ) : null}
      {sshTarget ? (
        <MenuItem
          label="Console..."
          onClick={openConsole}
          title={`Open a terminal: ${sshTarget.url}${sshTarget.hasPassword ? " (password copied to clipboard)" : ""}`}
        />
      ) : sshDesignated && managementGap ? (
        <MenuItem label="Console..." onClick={editProperties} disabled title={managementGap} />
      ) : null}
      {managementGap && (
        <div className="px-3 py-1 text-[10px] text-amber-600 max-w-[240px] leading-snug">{managementGap}</div>
      )}

      {deviceData && (
        <>
          <div className="border-t border-gray-200 my-1" />
          <MenuItem
            label="Show Only Connected Ports"
            onClick={toggleShowOnlyConnected}
            checked={!!deviceData.showOnlyConnectedPorts}
          />
          {(placement || pages.length > 0) && (
            <div className="border-t border-gray-200 my-1" />
          )}
          {placement ? (
            <MenuItem
              label={`Show in Rack (${placement.page.label})`}
              onClick={() => {
                setActivePage(placement.page.id);
                useSchematicStore.setState({ deviceContextMenu: null });
              }}
            />
          ) : pages.length > 0 ? (
            <>
              <div className="px-3 py-1 text-neutral-400 text-[10px] uppercase tracking-wider">
                Place in Rack
              </div>
              {pages.map((page) =>
                page.racks.map((rack) => (
                  <MenuItem
                    key={`${page.id}-${rack.id}`}
                    label={`${rack.label} (${rack.heightU}U)`}
                    indent
                    onClick={() => {
                      const state = useSchematicStore.getState();
                      const heightU = inferRackHeightU(deviceData);
                      for (let u = 1; u <= rack.heightU - heightU + 1; u++) {
                        if (state.isRackSlotAvailable(page.id, rack.id, u, heightU, "front")) {
                          state.addRackPlacement(page.id, {
                            rackId: rack.id,
                            deviceNodeId: nodeId,
                            uPosition: u,
                            face: "front",
                          });
                          state.addToast(`Placed ${deviceData.label} in ${rack.label} at U${u}`, "success");
                          useSchematicStore.setState({ deviceContextMenu: null });
                          return;
                        }
                      }
                      state.addToast(`No space in ${rack.label} for ${heightU}U device`, "error");
                      useSchematicStore.setState({ deviceContextMenu: null });
                    }}
                  />
                ))
              )}
            </>
          ) : null}
        </>
      )}

      {/* Always shown — "New Page…" is how the second page gets created. */}
      <div className="border-t border-gray-200 my-1" />
      <div className="px-3 py-1 text-neutral-400 text-[10px] uppercase tracking-wider">
        Move to Page
      </div>
      {schematicSheets.filter((sh) => sh.id !== activeSheetId).map((sh) => (
        <MenuItem
          key={sh.id}
          label={sh.label}
          indent
          onClick={() => {
            const state = useSchematicStore.getState();
            // Move the whole selection when the clicked node is part of it.
            const selected = state.nodes.filter((n) => n.selected).map((n) => n.id);
            const ids = selected.includes(nodeId) ? selected : [nodeId];
            moveNodesToSheet(ids, sh.id);
            state.addToast(`Moved to ${sh.label} — crossing wires became tags`, "success");
            useSchematicStore.setState({ deviceContextMenu: null });
          }}
        />
      ))}
      <MenuItem
        label="New Page…"
        indent
        onClick={() => {
          const state = useSchematicStore.getState();
          const selected = state.nodes.filter((n) => n.selected).map((n) => n.id);
          const ids = selected.includes(nodeId) ? selected : [nodeId];
          const newId = addSchematicSheet();
          moveNodesToSheet(ids, newId);
          useSchematicStore.setState({ deviceContextMenu: null });
        }}
      />

      <div className="border-t border-gray-200 my-1" />
      <MenuItem label="Delete Device" onClick={deleteDevice} danger />
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  danger,
  indent,
  checked,
  title,
  disabled,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  indent?: boolean;
  checked?: boolean;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className={`w-full text-left py-1.5 text-xs ${indent ? "px-5" : "px-3"} ${
        checked != null ? "flex items-center gap-1.5" : ""
      } ${
        disabled
          ? "text-gray-400 cursor-default"
          : danger
            ? "text-red-600 hover:bg-red-50 hover:text-red-700 cursor-pointer"
            : "text-gray-700 hover:bg-blue-50 hover:text-blue-700 cursor-pointer"
      }`}
      onClick={onClick}
      title={title}
    >
      {checked != null && (
        <span className="w-3 text-center shrink-0 text-[10px]">{checked ? "✓" : ""}</span>
      )}
      {checked != null ? <span className="flex-1">{label}</span> : label}
    </button>
  );
}
