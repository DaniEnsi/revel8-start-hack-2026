import { RunView } from "@/components/revel8/run-view";

export default async function RunReplayPage({
	params,
}: {
	params: Promise<{ session: string }>;
}) {
	const { session } = await params;
	return <RunView sessionId={decodeURIComponent(session)} />;
}
