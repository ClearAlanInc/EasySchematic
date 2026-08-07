# VLAN & Trunking Rules

How VLAN configuration, propagation, and trunk semantics behave across the
schematic. These are deliberate design decisions — when fixing bugs or adding
features in `src/vlanPropagation.ts`, `src/store.ts` (propagation hooks), or
`src/networkValidation.ts`, verify these rules still hold.

---

## Data model

### V1. A port is access-mode unless it says otherwise
`PortNetworkConfig.vlanMode` absent or `"access"` means the port carries one
untagged VLAN in `vlan`. Files written before trunking existed carry only
`vlan` and load unchanged — no migration exists or is needed.

### V2. Trunk ports carry a permitted set
`vlanMode: "trunk"` ports use `trunkVlans` (explicit list), `trunkAllVlans`
(permit 1–4094, the common switch default), and `nativeVlan` (untagged).
A trunk permits a VLAN when it is in the list, is the native VLAN, or the
all-flag is set. The editor accepts and renders the list in range syntax
(`1,10,20-30` — `parseVlanList` / `formatVlanList`).

---

## Propagation (last change wins)

### V3. Scope is one wire hop
Editing an access VLAN writes that value into every access port directly
cabled to the edited port. The hop continues **through** patch-panel /
wall-plate passthrough circuits (enter one face, exit the other, chaining
across panels) and across stub-split edges (`linkedConnectionId`), and fans
out across multi-connect (wireless) links. It **stops at ordinary devices** —
setting VLAN 10 on a switch port tags the far end of that wire, never the
switch's other ports.

### V4. Trunks are propagation boundaries
Propagation never writes to a trunk port and never continues past one. Trunk
allowed-lists are deliberate configuration; validation warns instead (V8).

### V5. Only concrete values propagate
Clearing a VLAN does not propagate the clear. This keeps an accidental field
wipe from silently unconfiguring every connected device.

### V6. Virtual wires are ignored
TCP/UDP stream wires never carry propagation; VLANs ride physical links only.
Stream sub-handles (`parentPortId` set) inherit the parent physical port's
VLAN at read time (`effectiveVlan`) and may carry their own `vlan` as a
per-stream tag override on devices that support it. Sub-handle overrides do
not propagate.

### V7. Connect-time rules
When a new physical network wire lands (both ends access-mode):

- exactly one end configured → its VLAN propagates silently;
- one end is VLAN 1 (the conventional default) → the non-default end wins
  silently, overwriting the 1;
- both ends carry different non-default VLANs → a confirm prompt offers to
  overwrite with the source end's VLAN; declining keeps both and the wire
  shows a mismatch warning until someone edits one end (that edit then wins
  everywhere, per V3).

---

## Validation & display

### V8. Trunk-aware link checks
`computeVlanConflicts` warns on: access↔access VLAN mismatch, an access VLAN
the far trunk doesn't permit, and trunk↔trunk links whose permitted sets
don't intersect. Warnings surface in the Network Report (both endpoints get
flagged) and on the wire itself.

### V9. Misconfigured links don't pass traffic
DHCP reachability (`findReachableDhcpServers`) skips any link with a V8
issue — different broadcast domains — and passes through trunk links that
permit the relevant VLAN.

### V10. Wires display their derived VLAN
The edge badge is computed at read time from the endpoint ports (never stored
on the edge): red and persistent when the link has a V8 issue, blue and
hover/selection-only when healthy, labelled `VLAN 10` for access links and
`Trunk 1,10,20-30` for trunks. The Network Report renders trunk ports as
`Trunk <list> (native N)` and uninherited stream rows as `<N> (inherited)`.
