import DemoCanvas from "./DemoCanvas";
import { deviceDemoNodes, deviceDemoEdges } from "../../data/deviceDemo";

export default function DeviceShowcase() {
  return (
    <DemoCanvas
      initialNodes={deviceDemoNodes}
      initialEdges={deviceDemoEdges}
      height={300}
    />
  );
}
