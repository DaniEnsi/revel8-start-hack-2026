import { ControlPanel } from "@/components/revel8/control-panel";
import { FlowPanel } from "@/components/revel8/flow-panel";

export default function ControlPage() {
	return (
		<div className="flex flex-col gap-8">
			<ControlPanel />
			<FlowPanel />
		</div>
	);
}
