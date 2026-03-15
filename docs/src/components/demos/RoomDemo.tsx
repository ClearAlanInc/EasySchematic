import DemoCanvas from "./DemoCanvas";
import { roomDemoNodes, roomDemoEdges } from "../../data/roomDemo";

export default function RoomDemo() {
  return (
    <DemoCanvas
      initialNodes={roomDemoNodes}
      initialEdges={roomDemoEdges}
      height={350}
    />
  );
}
