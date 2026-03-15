import DeviceShowcase from "../components/demos/DeviceShowcase";

export default function OverviewPage() {
  return (
    <>
      <h1>EasySchematic</h1>

      <p>
        EasySchematic is a browser-based tool for designing <strong>audio/video signal flow diagrams</strong> (hook-up
        sheets). It's built for broadcast engineers, live production teams, and AV integrators who need to quickly map
        out how devices connect.
      </p>
      <p>
        Everything runs in the browser — no backend, no accounts, no install. Your work saves to localStorage
        automatically.
      </p>
      <p>
        <strong>
          <a href="https://easyschematic.dylan-uremovich.workers.dev/">Open EasySchematic &rarr;</a>
        </strong>
      </p>

      <h2>What it looks like</h2>
      <p>Drag devices around and see how they are represented:</p>
      <DeviceShowcase />

      <h2>Key features</h2>
      <ul>
        <li>
          <strong>Devices</strong> with typed input/output ports (SDI, HDMI, NDI, Dante, and 15+ signal types)
        </li>
        <li>
          <strong>Signal-type coloring</strong> — connections are color-coded by signal type for instant visual parsing
        </li>
        <li>
          <strong>Smart connection routing</strong> — A* pathfinding routes connections around devices with parallel-connection nesting
        </li>
        <li>
          <strong>Room grouping</strong> — drag devices into room containers to organize by physical location
        </li>
        <li>
          <strong>Device library</strong> — 50+ real-world device templates across cameras, switchers, audio gear, and
          more
        </li>
        <li>
          <strong>Custom templates</strong> — save your own device configurations for reuse
        </li>
        <li>
          <strong>Export</strong> — PNG, SVG, DXF (for CAD/Vectorworks), and JSON for sharing
        </li>
        <li>
          <strong>Print-ready</strong> — clean print layout with title block
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
        <li>Deployed on Cloudflare Workers (static assets)</li>
      </ul>
    </>
  );
}
