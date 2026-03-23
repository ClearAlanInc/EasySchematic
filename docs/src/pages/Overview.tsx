export default function OverviewPage() {
  return (
    <>
      <h1>EasySchematic</h1>

      <p>
        EasySchematic is a browser-based tool for designing <strong>AV signal flow diagrams</strong> (hook-up
        sheets). It's built for broadcast engineers, live production teams, and AV integrators who need to quickly map
        out how devices connect.
      </p>
      <p>
        Everything runs in the browser — no install required. Your work auto-saves to localStorage, or create a
        free account to save schematics to the cloud and access them from any browser.
      </p>
      <p>
        <strong>
          <a href="https://easyschematic.live/">Open EasySchematic &rarr;</a>
        </strong>
      </p>

      <h2>Key features</h2>
      <ul>
        <li>
          <strong>Devices</strong> with typed input/output ports (SDI, HDMI, NDI, Dante, DMX, MADI, and 30 signal types total)
        </li>
        <li>
          <strong>Signal-type coloring</strong> — connections are color-coded by signal type, with customizable colors
        </li>
        <li>
          <strong>Smart connection routing</strong> — A* pathfinding routes connections around devices with parallel-connection nesting
        </li>
        <li>
          <strong>Room grouping</strong> — drag devices into room containers to organize by physical location, with lock/unlock to prevent accidental moves
        </li>
        <li>
          <strong>Notes &amp; annotations</strong> — rich text annotations with rectangle and ellipse shapes, plus formatting (bold, italic, bullets, font sizes)
        </li>
        <li>
          <strong>Cable ID labels</strong> — auto-assigned labels for connections, making it easy to reference specific cable runs
        </li>
        <li>
          <strong>Line jump arcs</strong> — arc markers at connection crossings for visual clarity
        </li>
        <li>
          <strong>Device library</strong> — 365+ real-world device templates across cameras, switchers, audio, lighting,
          LED video, and more
        </li>
        <li>
          <strong>Expansion slots</strong> — devices with swappable card bays; right-click a slot to swap I/O cards in or out
        </li>
        <li>
          <strong>User templates &amp; presets</strong> — save device configurations or set project-wide defaults for any template
        </li>
        <li>
          <strong>Favorites</strong> — star frequently-used devices for instant access
        </li>
        <li>
          <strong>Quick-add</strong> — double-click the canvas to search and place a device in one step
        </li>
        <li>
          <strong>Room styling</strong> — customize background color, border style, and label size via right-click context menu
        </li>
        <li>
          <strong>Cloud storage</strong> — save up to 10 schematics to the cloud with a free account; access from any browser
        </li>
        <li>
          <strong>Sharing</strong> — generate a link to share any cloud-saved schematic with anyone
        </li>
        <li>
          <strong>Trackpad support</strong> — pinch-to-zoom and two-finger pan with configurable sensitivity
        </li>
        <li>
          <strong>Alignment tools</strong> — align and distribute selected devices horizontally or vertically
        </li>
        <li>
          <strong>Export</strong> — PNG, SVG, PDF, DXF (for CAD/Vectorworks), and JSON for sharing
        </li>
        <li>
          <strong>Print View</strong> — page boundary overlay with configurable paper size, orientation, and scale
        </li>
        <li>
          <strong>Title block editor</strong> — customizable grid layout with logo upload for professional print output
        </li>
      </ul>

      <h2>Tech stack</h2>
      <ul>
        <li>React 19 + TypeScript</li>
        <li>
          <a href="https://reactflow.dev/">React Flow</a> (xyflow v12) for the canvas
        </li>
        <li>Zustand for state management</li>
        <li>Tailwind CSS v4</li>
        <li>Cloudflare Workers + D1 + R2 for API and cloud storage</li>
        <li>Deployed on Cloudflare Workers</li>
      </ul>
    </>
  );
}
