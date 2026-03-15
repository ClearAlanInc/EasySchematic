import DemoCanvas from "./DemoCanvas";
import { routingDemoNodes, routingDemoEdges } from "../../data/routingDemo";

export default function RoutingDemo() {
  return (
    <DemoCanvas
      initialNodes={routingDemoNodes}
      initialEdges={routingDemoEdges}
      height={400}
    />
  );
}
