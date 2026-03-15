import DemoCanvas from "./DemoCanvas";
import { connectionDemoNodes, connectionDemoEdges } from "../../data/connectionDemo";

export default function ConnectionDemo() {
  return (
    <DemoCanvas
      initialNodes={connectionDemoNodes}
      initialEdges={connectionDemoEdges}
      height={350}
    />
  );
}
