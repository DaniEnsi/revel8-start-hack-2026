"use client";

import { api } from "@x70-monorepo/database/convex/_generated/api";
import type { Id } from "@x70-monorepo/database/convex/_generated/dataModel";
import {
	createDefaultFlowDefinition,
	type OrderedFlowDefinition,
	validateOrderedFlowDefinition,
} from "@x70-monorepo/database/convex/flowDefinition";
import { useConvexAuth } from "convex/react";
import { Loader2, Play, Save, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useResilientQuery } from "@/lib/revel8/use-resilient-query";

const ACTIVE_STATUSES = new Set([
	"created",
	"running",
	"sleeping",
	"waiting_reply",
	"retry_pending",
]);

interface SaveResponse {
	definitionId: Id<"flowDefinitions">;
	version: number;
	detail?: string;
	issues?: string[];
}

interface LaunchResponse {
	run_id?: string;
	detail?: string;
}

function editorDefinition(
	validation: ReturnType<typeof validateOrderedFlowDefinition>,
): OrderedFlowDefinition {
	if (!validation.success) throw new Error(validation.issues.join("; "));
	return validation.definition;
}

export function FlowPanel() {
	const { isAuthenticated } = useConvexAuth();
	const definitionsResult = useResilientQuery(
		api.flows.listDefinitions,
		isAuthenticated ? {} : "skip",
	);
	const flowRunsResult = useResilientQuery(
		api.flows.listRuns,
		isAuthenticated ? {} : "skip",
	);
	const definitions = definitionsResult.value;
	const flowRuns = flowRunsResult.value;
	const [definitionId, setDefinitionId] =
		useState<Id<"flowDefinitions"> | null>(null);
	const [baseVersion, setBaseVersion] = useState<number>();
	const [launchVersion, setLaunchVersion] = useState<number>();
	const [text, setText] = useState(() =>
		JSON.stringify(createDefaultFlowDefinition(), null, 2),
	);
	const [issues, setIssues] = useState<string[]>([]);
	const [message, setMessage] = useState<string | null>(null);
	const [busy, setBusy] = useState<"save" | "launch" | null>(null);
	const [dryRun, setDryRun] = useState(true);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const versionsResult = useResilientQuery(
		api.flows.listVersions,
		isAuthenticated && definitionId ? { definitionId } : "skip",
	);
	const selectedFlowResult = useResilientQuery(
		api.flows.getRun,
		isAuthenticated && selectedRunId ? { runId: selectedRunId } : "skip",
	);
	const versions = versionsResult.value;
	const selectedFlow = selectedFlowResult.value;

	useEffect(() => {
		if (!selectedRunId && flowRuns?.[0]) setSelectedRunId(flowRuns[0].runId);
	}, [flowRuns, selectedRunId]);

	const parsed = useMemo(() => {
		try {
			const value: unknown = JSON.parse(text);
			return validateOrderedFlowDefinition(value);
		} catch {
			return {
				success: false as const,
				issues: ["definition must be valid JSON"],
			};
		}
	}, [text]);

	const loadDefinition = (id: Id<"flowDefinitions">) => {
		const selected = definitions?.find((definition) => definition._id === id);
		if (!selected) return;
		setDefinitionId(id);
		setBaseVersion(selected.latestVersion);
		setLaunchVersion(selected.latestVersion);
		setText(JSON.stringify(selected.definition, null, 2));
		setIssues([]);
		setMessage(null);
	};

	const newDefinition = () => {
		const definition = createDefaultFlowDefinition();
		definition.flow_id = `practice-flow-${Date.now().toString(36)}`;
		setDefinitionId(null);
		setBaseVersion(undefined);
		setLaunchVersion(undefined);
		setText(JSON.stringify(definition, null, 2));
		setIssues([]);
		setMessage(null);
	};

	const save = async (): Promise<boolean> => {
		setBusy("save");
		setMessage(null);
		if (!parsed.success) {
			setIssues(parsed.issues);
			setBusy(null);
			return false;
		}
		try {
			const definition = editorDefinition(parsed);
			const response = await fetch("/api/revel8/flows", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					definition,
					...(definitionId && baseVersion ? { baseVersion } : {}),
				}),
			});
			const body = (await response.json()) as SaveResponse;
			if (!response.ok) {
				setIssues(body.issues ?? [body.detail ?? "flow save failed"]);
				return false;
			}
			setDefinitionId(body.definitionId);
			setBaseVersion(body.version);
			setLaunchVersion(body.version);
			setText(JSON.stringify(definition, null, 2));
			setIssues([]);
			setMessage(
				`Saved ${definition.flow_id} version ${body.version} in Convex.`,
			);
			return true;
		} catch (error) {
			setIssues([(error as Error).message]);
			return false;
		} finally {
			setBusy(null);
		}
	};

	const launch = async () => {
		if (!definitionId) {
			setIssues(["Save the definition before launching it."]);
			return;
		}
		setBusy("launch");
		setIssues([]);
		setMessage(null);
		try {
			const response = await fetch("/api/revel8/flow-runs", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					definitionId,
					version: launchVersion,
					dryRun,
				}),
			});
			const body = (await response.json()) as LaunchResponse;
			if (!response.ok || !body.run_id) {
				throw new Error(body.detail ?? "flow launch failed");
			}
			setSelectedRunId(body.run_id);
			setMessage(
				`${dryRun ? "Dry run" : "Practice run"} ${body.run_id} launched with python -m agent.flow_run.`,
			);
		} catch (error) {
			setIssues([(error as Error).message]);
		} finally {
			setBusy(null);
		}
	};

	const stop = async (runId: string) => {
		await fetch(`/api/revel8/flow-runs/${encodeURIComponent(runId)}/stop`, {
			method: "POST",
		});
	};

	return (
		<section className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-5">
			<div>
				<h2 className="text-lg font-semibold">Ordered flow editor</h2>
				<p className="text-sm text-muted-foreground">
					Validate and version the four-step practice flow in Convex, then
					launch the durable CLI and monitor its checkpoint and step state in
					realtime.
				</p>
			</div>

			<div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
				<div className="flex min-w-0 flex-col gap-1.5">
					<Label htmlFor="flow-definition">Saved definition</Label>
					<select
						id="flow-definition"
						className="h-10 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm"
						value={definitionId ?? "new"}
						onChange={(event) => {
							if (event.target.value === "new") newDefinition();
							else loadDefinition(event.target.value as Id<"flowDefinitions">);
						}}
					>
						<option value="new">New practice flow</option>
						{definitions?.map((definition) => (
							<option key={definition._id} value={definition._id}>
								{definition.flowId} · v{definition.latestVersion}
							</option>
						))}
					</select>
				</div>
				<Button variant="outline" onClick={newDefinition}>
					New
				</Button>
				<div className="flex h-10 items-center gap-2 rounded-md border border-border px-3">
					<Switch
						checked={dryRun}
						onCheckedChange={setDryRun}
						aria-label="Dry run"
					/>
					<Label className="text-xs">Dry run (fake transport)</Label>
				</div>
			</div>

			<textarea
				aria-label="Flow definition JSON"
				className="block min-h-[420px] w-full min-w-0 max-w-full resize-y rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed"
				value={text}
				onChange={(event) => setText(event.target.value)}
				spellCheck={false}
			/>
			{!parsed.success ? (
				<p className="text-xs text-amber-300">{parsed.issues[0]}</p>
			) : (
				<p className="text-xs text-emerald-300">
					Valid practice definition · {parsed.definition.steps.length} ordered
					steps
				</p>
			)}

			<div className="flex flex-wrap items-center gap-2">
				<Button onClick={save} disabled={busy !== null}>
					{busy === "save" ? (
						<Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
					) : (
						<Save className="mr-1.5 h-4 w-4" />
					)}
					Save new version
				</Button>
				{definitionId && versions?.length ? (
					<select
						aria-label="Launch version"
						className="h-10 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm"
						value={launchVersion ?? versions[0]?.version}
						onChange={(event) => setLaunchVersion(Number(event.target.value))}
					>
						{versions.map((version) => (
							<option key={version._id} value={version.version}>
								Launch v{version.version}
							</option>
						))}
					</select>
				) : null}
				<Button
					variant={dryRun ? "secondary" : "default"}
					onClick={launch}
					disabled={busy !== null || !definitionId}
				>
					{busy === "launch" ? (
						<Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
					) : (
						<Play className="mr-1.5 h-4 w-4" />
					)}
					{dryRun ? "Launch dry run" : "Launch practice"}
				</Button>
				<code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
					python -m agent.flow_run{" "}
					{dryRun
						? "<definition.json> --dry-run"
						: "--practice <definition.json>"}{" "}
					--state &lt;run-state.json&gt; --trace-dir &lt;trace-dir&gt;
				</code>
			</div>
			{!dryRun ? (
				<p className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200">
					Live delivery is locked to the definition's allowlisted practice
					target. No eval or arbitrary target mode is exposed.
				</p>
			) : null}
			{issues.length ? (
				<ul className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
					{issues.map((issue) => (
						<li key={issue}>{issue}</li>
					))}
				</ul>
			) : null}
			{message ? (
				<p className="text-xs text-muted-foreground">{message}</p>
			) : null}
			{definitionsResult.error ||
			flowRunsResult.error ||
			versionsResult.error ||
			selectedFlowResult.error ? (
				<p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
					Convex flow state is temporarily unavailable. Validation and the JSON
					editor remain local; saved versions and live checkpoints will reappear
					after reconnection.
				</p>
			) : null}

			<div className="grid min-w-0 gap-4 border-t border-border pt-4 lg:grid-cols-[280px_minmax(0,1fr)]">
				<div className="min-w-0">
					<h3 className="mb-2 text-sm font-semibold">
						Flow runs · Convex live
					</h3>
					<div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
						{flowRuns?.map((run) => (
							<button
								type="button"
								key={run._id}
								onClick={() => setSelectedRunId(run.runId)}
								className={`rounded-md border px-3 py-2 text-left text-xs ${selectedRunId === run.runId ? "border-sky-500/50 bg-sky-500/5" : "border-border"}`}
							>
								<div className="truncate font-mono">{run.runId}</div>
								<div className="mt-1 text-muted-foreground">
									{run.flowId} v{run.version} · {run.status} ·{" "}
									{run.dryRun ? "dry" : "practice"}
								</div>
							</button>
						))}
						{flowRuns && !flowRuns.length ? (
							<p className="text-xs text-muted-foreground">No flow runs yet.</p>
						) : null}
					</div>
				</div>
				<div className="min-w-0">
					{selectedFlow ? (
						<div>
							<div className="flex flex-wrap items-center gap-2 text-sm">
								<b>{selectedFlow.run.status}</b>
								<span className="text-xs text-muted-foreground">
									step {selectedFlow.run.currentStepId} · revision{" "}
									{selectedFlow.run.revision}
								</span>
								{ACTIVE_STATUSES.has(selectedFlow.run.status) ? (
									<Button
										size="sm"
										variant="destructive"
										onClick={() => stop(selectedFlow.run.runId)}
									>
										<Square className="mr-1 h-3 w-3" /> Stop
									</Button>
								) : null}
								{selectedFlow.run.sessionId ? (
									<Link
										className="text-xs text-sky-400 underline"
										href={`/dashboard/runs/${encodeURIComponent(selectedFlow.run.sessionId)}`}
									>
										Open session trace →
									</Link>
								) : null}
							</div>
							<div className="mt-3 grid gap-2 sm:grid-cols-2">
								{selectedFlow.steps.map((step) => (
									<div
										key={step._id}
										className="rounded-md border border-border p-3 text-xs"
									>
										<div className="flex items-center justify-between gap-2">
											<span className="font-mono font-semibold">
												{step.stepId}
											</span>
											<span className="text-muted-foreground">
												{step.status}
											</span>
										</div>
										<div className="mt-1 text-muted-foreground">
											{step.outcome || step.nextOperation || "pending"}
											{step.branchTaken ? ` · ${step.branchTaken}` : ""}
										</div>
									</div>
								))}
							</div>
							{selectedFlow.run.error ? (
								<p className="mt-2 text-xs text-destructive-foreground">
									{selectedFlow.run.error}
								</p>
							) : null}
						</div>
					) : (
						<p className="text-xs text-muted-foreground">
							Select a flow run to monitor its steps.
						</p>
					)}
				</div>
			</div>
		</section>
	);
}
