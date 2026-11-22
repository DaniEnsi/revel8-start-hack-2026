"use client";

import { api } from "@x70-monorepo/database/convex/_generated/api";
import { useConvexAuth } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { RubricDemo } from "@/components/revel8/rubric-demo";
import { ScoringWorksheet } from "@/components/revel8/scoring-worksheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { aggregate } from "@/lib/revel8/analytics";
import { getRun, listRuns } from "@/lib/revel8/client";
import {
	ALL_FILTER_VALUES,
	analyticsChannelOptions,
	analyticsTargetOptions,
	filterAnalyticsSessions,
} from "@/lib/revel8/filters";
import { THETA_HARD, THETA_SOFT } from "@/lib/revel8/format";
import { traceRecordsFromQuery } from "@/lib/revel8/realtime";
import { redactTraceValue } from "@/lib/revel8/redaction";
import { buildSession } from "@/lib/revel8/trace";
import type { TraceRecord } from "@/lib/revel8/types";
import { useResilientQuery } from "@/lib/revel8/use-resilient-query";

const EMPTY_STORED_RUNS: [] = [];

const LINE_COLORS = [
	"#38bdf8",
	"#34d399",
	"#f59e0b",
	"#a78bfa",
	"#f472b6",
	"#facc15",
	"#fb7185",
	"#4ade80",
];

function Tile({
	label,
	value,
	sub,
}: {
	label: string;
	value: string;
	sub?: string;
}) {
	return (
		<div className="min-w-0 rounded-lg border border-border bg-card p-4">
			<div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
				{label}
			</div>
			<div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
			{sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
		</div>
	);
}

function Panel({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="min-w-0 rounded-lg border border-border bg-card p-4">
			<div className="mb-3 text-sm font-semibold">{title}</div>
			{children}
		</div>
	);
}

const axis = { stroke: "hsl(var(--muted-foreground))", fontSize: 11 };
const tooltipStyle = {
	background: "hsl(var(--popover))",
	border: "1px solid hsl(var(--border))",
	borderRadius: 8,
	fontSize: 12,
	color: "hsl(var(--popover-foreground))",
};

export function AnalyticsView() {
	const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
	const { value: storedResult, error: convexError } = useResilientQuery(
		api.runs.analytics,
		isAuthenticated ? {} : "skip",
	);
	const stored = convexError ? EMPTY_STORED_RUNS : storedResult;
	const [fallback, setFallback] = useState<
		Array<{ sessionId: string; records: TraceRecord[] }>
	>([]);
	useEffect(() => {
		if (!isAuthenticated || stored === undefined || stored.length > 0) return;
		let alive = true;
		(async () => {
			try {
				const runs = await listRuns();
				const records = await Promise.all(
					runs.map(async (run) => {
						const detail = await getRun(run.session_id);
						return {
							sessionId: run.session_id,
							records: detail.records.map(
								(record) => redactTraceValue(record) as TraceRecord,
							),
						};
					}),
				);
				if (alive) setFallback(records);
			} catch {
				if (alive) setFallback([]);
			}
		})();
		return () => {
			alive = false;
		};
	}, [isAuthenticated, stored]);
	const tracedSessions = useMemo(
		() =>
			(stored?.length ? stored : fallback).map((run) =>
				buildSession(run.sessionId, traceRecordsFromQuery(run)),
			),
		[stored, fallback],
	);
	const allSessions = useMemo(
		() => tracedSessions.filter((session) => session.touches.length > 0),
		[tracedSessions],
	);
	const [target, setTarget] = useState(ALL_FILTER_VALUES);
	const [channel, setChannel] = useState(ALL_FILTER_VALUES);
	const targetOptions = useMemo(
		() => analyticsTargetOptions(allSessions),
		[allSessions],
	);
	const channelOptions = useMemo(
		() => analyticsChannelOptions(allSessions),
		[allSessions],
	);
	const sessions = useMemo(
		() => filterAnalyticsSessions(allSessions, { target, channel }),
		[allSessions, target, channel],
	);
	const hasFilters =
		target !== ALL_FILTER_VALUES || channel !== ALL_FILTER_VALUES;
	const loading = authLoading || (isAuthenticated && stored === undefined);
	const agg = useMemo(() => aggregate(sessions), [sessions]);

	// Build a merged suspicion-curve dataset indexed by touch number.
	const curveData = useMemo(() => {
		const maxTouch = Math.max(
			1,
			...agg.suspicionCurves.flatMap((c) => c.points.map((p) => p.touch)),
		);
		const rows: Record<string, number | null>[] = [];
		for (let i = 1; i <= maxTouch; i++) {
			const row: Record<string, number | null> = { touch: i };
			for (const c of agg.suspicionCurves) {
				const p = c.points.find((pt) => pt.touch === i);
				row[c.sessionId] = p ? p.suspicion : null;
			}
			rows.push(row);
		}
		return rows;
	}, [agg]);

	if (loading) {
		return (
			<div className="py-20 text-center text-sm text-muted-foreground">
				Crunching traces…
			</div>
		);
	}

	return (
		<div className="flex min-w-0 flex-col gap-5">
			<h1 className="text-xl font-semibold">Analytics</h1>
			<ScoringWorksheet sessions={tracedSessions} />
			<RubricDemo />
			<div>
				<h2 className="text-sm font-semibold">Practice and proxy analytics</h2>
				<p className="text-sm text-muted-foreground">
					{convexError
						? "JSONL/sidecar fallback"
						: "Realtime Convex aggregation"}{" "}
					across {agg.totalSessions} of {allSessions.length} trace
					{allSessions.length === 1 ? "" : "s"}.
				</p>
			</div>

			{allSessions.length ? (
				<div className="grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
					<div className="grid min-w-0 gap-1.5">
						<Label htmlFor="analytics-target">Target twin</Label>
						<select
							id="analytics-target"
							className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm"
							value={target}
							onChange={(event) => setTarget(event.target.value)}
						>
							<option value={ALL_FILTER_VALUES}>All targets</option>
							{targetOptions.map((option) => (
								<option key={option} value={option}>
									{option}
								</option>
							))}
						</select>
					</div>
					<div className="grid min-w-0 gap-1.5">
						<Label htmlFor="analytics-channel">Channel used</Label>
						<select
							id="analytics-channel"
							className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm"
							value={channel}
							onChange={(event) => setChannel(event.target.value)}
						>
							<option value={ALL_FILTER_VALUES}>All channels</option>
							{channelOptions.map((option) => (
								<option key={option} value={option}>
									{option}
								</option>
							))}
						</select>
					</div>
					<Button
						variant="ghost"
						size="sm"
						disabled={!hasFilters}
						onClick={() => {
							setTarget(ALL_FILTER_VALUES);
							setChannel(ALL_FILTER_VALUES);
						}}
					>
						Clear filters
					</Button>
					<p className="text-xs text-muted-foreground sm:col-span-3">
						Channel filtering selects sessions with at least one touch on that
						channel. These filters apply to the proxy analytics below.
					</p>
				</div>
			) : null}

			{!sessions.length ? (
				<div className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
					{allSessions.length
						? "No traces match these target/channel filters."
						: "No traces to analyze. Import JSONL from the Runs page or start a practice run."}
				</div>
			) : (
				<>
					<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
						<Tile
							label="Incident rate"
							value={`${Math.round(agg.incidentRate * 100)}%`}
							sub={`${agg.incidents}/${agg.totalSessions} sessions`}
						/>
						<Tile
							label="Avg touches → incident"
							value={
								agg.avgTouchesToIncident != null
									? agg.avgTouchesToIncident.toFixed(1)
									: "—"
							}
							sub="contacts to first disclosure"
						/>
						<Tile
							label="Avg final suspicion"
							value={
								agg.avgFinalSuspicion != null
									? agg.avgFinalSuspicion.toFixed(2)
									: "—"
							}
							sub={`θ_soft ${THETA_SOFT} · θ_hard ${THETA_HARD}`}
						/>
						<Tile
							label="Twins engaged"
							value={String(agg.perTarget.length)}
							sub="distinct targets"
						/>
					</div>

					<Panel title="Suspicion curves — per session (θ thresholds dashed)">
						<ResponsiveContainer width="100%" height={280}>
							<LineChart
								data={curveData}
								margin={{ top: 8, right: 16, bottom: 4, left: -16 }}
							>
								<CartesianGrid
									stroke="hsl(var(--border))"
									strokeDasharray="3 3"
								/>
								<XAxis
									dataKey="touch"
									{...axis}
									label={{
										value: "touch",
										position: "insideBottom",
										offset: -2,
										fontSize: 11,
									}}
								/>
								<YAxis domain={[0, 1]} {...axis} />
								<Tooltip contentStyle={tooltipStyle} />
								{agg.suspicionCurves.map((c, i) => (
									<Line
										key={c.sessionId}
										type="monotone"
										dataKey={c.sessionId}
										stroke={LINE_COLORS[i % LINE_COLORS.length]}
										strokeWidth={c.outcome === "incident" ? 2.4 : 1.4}
										dot={{ r: 2 }}
										connectNulls
										name={`${c.sessionId.slice(0, 10)} (${c.target || "?"})`}
									/>
								))}
								<Line
									dataKey={() => THETA_SOFT}
									stroke="rgba(245,180,80,.5)"
									strokeDasharray="4 3"
									dot={false}
									legendType="none"
									name="θ_soft"
								/>
								<Line
									dataKey={() => THETA_HARD}
									stroke="rgba(248,113,113,.5)"
									strokeDasharray="4 3"
									dot={false}
									legendType="none"
									name="θ_hard"
								/>
							</LineChart>
						</ResponsiveContainer>
					</Panel>

					<div className="grid gap-4 lg:grid-cols-2">
						<Panel title="Per-twin incident rate">
							<ResponsiveContainer width="100%" height={240}>
								<BarChart
									data={agg.perTarget.map((p) => ({
										target: p.target,
										rate: Math.round(p.incidentRate * 100),
										sessions: p.sessions,
									}))}
									margin={{ top: 8, right: 8, bottom: 4, left: -16 }}
								>
									<CartesianGrid
										stroke="hsl(var(--border))"
										strokeDasharray="3 3"
									/>
									<XAxis dataKey="target" {...axis} />
									<YAxis domain={[0, 100]} {...axis} unit="%" />
									<Tooltip contentStyle={tooltipStyle} />
									<Bar dataKey="rate" radius={[4, 4, 0, 0]}>
										{agg.perTarget.map((target, i) => (
											<Cell
												key={target.target}
												fill={LINE_COLORS[i % LINE_COLORS.length]}
											/>
										))}
									</Bar>
								</BarChart>
							</ResponsiveContainer>
							<div className="mt-2 overflow-x-auto">
								<table className="w-full text-xs">
									<thead>
										<tr className="border-b border-border text-left text-muted-foreground">
											<th className="py-1 pr-3 font-medium">twin</th>
											<th className="py-1 pr-3 font-medium">sessions</th>
											<th className="py-1 pr-3 font-medium">incidents</th>
											<th className="py-1 pr-3 font-medium">rate</th>
											<th className="py-1 font-medium">avg→inc</th>
										</tr>
									</thead>
									<tbody>
										{agg.perTarget.map((p) => (
											<tr key={p.target} className="border-b border-border/40">
												<td className="py-1 pr-3 font-mono">{p.target}</td>
												<td className="py-1 pr-3 tabular-nums">{p.sessions}</td>
												<td className="py-1 pr-3 tabular-nums">
													{p.incidents}
												</td>
												<td className="py-1 pr-3 tabular-nums">
													{Math.round(p.incidentRate * 100)}%
												</td>
												<td className="py-1 tabular-nums">
													{p.avgTouchesToIncident != null
														? p.avgTouchesToIncident.toFixed(1)
														: "—"}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</Panel>

						<Panel title="A/B arm outcomes">
							{agg.armOutcomes.length ? (
								<div className="overflow-x-auto">
									<table className="w-full text-xs">
										<thead>
											<tr className="border-b border-border text-left text-muted-foreground">
												<th className="py-1 pr-3 font-medium">arm</th>
												<th className="py-1 pr-3 font-medium">value</th>
												<th className="py-1 pr-3 font-medium">n</th>
												<th className="py-1 pr-3 font-medium">incidents</th>
												<th className="py-1 pr-3 font-medium">rate</th>
												<th className="py-1 font-medium">avg→inc</th>
											</tr>
										</thead>
										<tbody>
											{agg.armOutcomes.map((a) => (
												<tr
													key={`${a.arm}-${a.value}`}
													className="border-b border-border/40"
												>
													<td className="py-1 pr-3 font-mono uppercase">
														{a.arm}
													</td>
													<td className="py-1 pr-3 font-mono">{a.value}</td>
													<td className="py-1 pr-3 tabular-nums">
														{a.sessions}
													</td>
													<td className="py-1 pr-3 tabular-nums">
														{a.incidents}
													</td>
													<td className="py-1 pr-3 tabular-nums">
														{Math.round(a.incidentRate * 100)}%
													</td>
													<td className="py-1 tabular-nums">
														{a.avgTouchesToIncident != null
															? a.avgTouchesToIncident.toFixed(1)
															: "—"}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							) : (
								<p className="text-xs text-muted-foreground">
									No arm metadata recorded yet (needs runs with a{" "}
									<code className="font-mono">session_start.arms</code> record).
								</p>
							)}
							<div className="mt-4 text-sm font-semibold">Channel usage</div>
							<ResponsiveContainer width="100%" height={160}>
								<BarChart
									data={agg.channelUsage}
									layout="vertical"
									margin={{ top: 8, right: 8, bottom: 4, left: 40 }}
								>
									<CartesianGrid
										stroke="hsl(var(--border))"
										strokeDasharray="3 3"
									/>
									<XAxis type="number" {...axis} allowDecimals={false} />
									<YAxis
										type="category"
										dataKey="channel"
										{...axis}
										width={120}
									/>
									<Tooltip contentStyle={tooltipStyle} />
									<Bar dataKey="count" radius={[0, 4, 4, 0]} fill="#38bdf8" />
								</BarChart>
							</ResponsiveContainer>
						</Panel>
					</div>
				</>
			)}
		</div>
	);
}
