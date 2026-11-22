export async function register() {
	if (
		process.env.NEXT_RUNTIME !== "nodejs" ||
		process.env.NEXT_PHASE === "phase-production-build"
	)
		return;
	const { reconcileAgentProcesses } = await import(
		"./lib/revel8/server-runner"
	);
	await reconcileAgentProcesses().catch((error) => {
		console.error("[revel8] startup reconciliation failed", error);
	});
}
