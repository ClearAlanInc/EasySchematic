import RoutingDemo from "../components/demos/RoutingDemo";

export default function EdgeRoutingPage() {
  return (
    <>
      <h1>Connection Routing</h1>

      <h2>Smart routing</h2>
      <p>
        EasySchematic uses an <strong>A* pathfinding algorithm</strong> to route connections around
        devices. Instead of simple straight lines or basic smooth-step paths, connections find intelligent paths that:
      </p>
      <ul>
        <li><strong>Avoid overlapping</strong> with devices</li>
        <li><strong>Nest parallel connections</strong> when multiple connections run between the same pair of devices</li>
        <li><strong>Minimize crossings</strong> with other connections</li>
        <li>
          <strong>Use orthogonal paths</strong> (horizontal and vertical segments only) for a clean, professional look
        </li>
      </ul>

      <h2>See it in action</h2>
      <p>Drag the devices around and watch the connections re-route in real time:</p>
      <RoutingDemo />

      <h2>How it works</h2>
      <ol>
        <li>
          <strong>Obstacle map</strong> — All devices are converted into rectangular obstacle zones with padding
          for port stubs
        </li>
        <li>
          <strong>A* pathfinding</strong> — Each connection runs A* from its source port to its target port, avoiding
          obstacles
        </li>
        <li>
          <strong>Parallel connection nesting</strong> — Connections sharing endpoints are grouped and offset so they nest
          without overlapping
        </li>
        <li>
          <strong>Iterative refinement</strong> — Routes are computed centrally so all connections are aware of each other
        </li>
      </ol>

      <h3>Routing priorities</h3>
      <p>The algorithm optimizes for these aesthetics (in order):</p>
      <ol>
        <li>No connection-through-device collisions</li>
        <li>Minimal total path length</li>
        <li>Minimal number of turns</li>
        <li>Parallel connections nest cleanly (outermost connection has the widest span)</li>
        <li>Consistent horizontal flow (left-to-right preference)</li>
      </ol>

      <h2>Performance</h2>
      <p>
        Routes are recomputed when devices move or connections change, but <strong>frozen during drag</strong> for
        smooth interaction. A small delay after drag-stop lets the canvas measure port positions before routing
        kicks in.
      </p>

      <h2>Debug mode</h2>
      <p>
        Press <strong>Ctrl+B</strong> to toggle debug connection overlay, which shows connection IDs and routing metadata at
        both endpoints of each connection.
      </p>
    </>
  );
}
