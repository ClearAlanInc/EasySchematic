export default function SchematicPagesPage() {
  return (
    <>
      <h1>Schematic Pages</h1>
      <p>
        A project file can hold <strong>multiple schematic pages</strong> ("sheets"), each with its own canvas —
        one page per room, per system, or per drawing in a package. Everything still lives in one file and one
        model: reports, VLAN propagation, and connectivity span every page automatically.
      </p>

      <h2>Working with pages</h2>
      <ul>
        <li>The tab bar above the canvas shows one tab per schematic page. Click the <strong>▦+</strong> button to add a page.</li>
        <li><strong>Double-click</strong> a page tab to rename it; <strong>right-click</strong> for rename/delete.</li>
        <li>Only <strong>empty</strong> pages can be deleted, and the first page is permanent.</li>
        <li>Files with a single page open and save exactly as before — pages are purely additive.</li>
      </ul>

      <h2>Moving devices between pages</h2>
      <ul>
        <li>Right-click a device → <strong>Move to Page</strong> and pick a destination, or <strong>New Page…</strong> to create and move in one step.</li>
        <li>If the device is part of a multi-selection, the whole selection moves.</li>
        <li>Anything inside a room moves with its room — a device can't leave its container behind.</li>
      </ul>

      <h2>Wires that cross pages</h2>
      <p>
        A wire never crosses pages directly. When a move would split a connection across two pages, the wire is
        automatically converted into a <strong>wire tag pair</strong> (fly-offs): each page shows a floating tag
        where the wire leaves, labeled with a shared tag code (T1, T2, …), the far end's device and port, and the
        far end's page name — for example <code>T1 | → Amp Rack [CH 1] Pg Amps</code>.
      </p>
      <p>
        The connection stays <strong>logically intact</strong>: cable numbers, the cable schedule, the pack list,
        and VLAN propagation all treat the pair as one wire. Right-click a tag for <strong>Go to Other End</strong>
        (jumps to the partner's page and centers it) and <strong>Rename Tag…</strong>. See{" "}
        <a href="/connections">Connections → Wire tags</a> for the full behavior.
      </p>

      <h2>Reports and printing</h2>
      <ul>
        <li>Reports (cable schedule, pack list, network report) always cover the <strong>whole file</strong>, all pages.</li>
        <li>Print View, page guides, and PDF export operate on the <strong>active page's</strong> canvas.</li>
      </ul>
    </>
  );
}
