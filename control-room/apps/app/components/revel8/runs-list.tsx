"use client";

import { api } from "@x70-monorepo/database/convex/_generated/api";
import { useConvexAuth } from "convex/react";
import {
	AlertTriangle,
	CheckCircle2,
	FileText,
	Loader2,
	Radio,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listRuns as listSidecarRuns } from "@/lib/revel8/client";
import {
	ALL_FILTER_VALUES,
	filterRuns,
	runOutcomeOptions,
} from "@/lib/revel8/filters";
import { fmtTs } from "@/lib/revel8/format";
import { mapRunListItems, mergeRunListItems } from "@/lib/revel8/realtime";
import type { RunListItem } from "@/lib/revel8/types";
import { useResilientQuery } from "@/lib/revel8/use-resilient-query";
import { cn } from "@/lib/utils";

function OutcomeIcon({
	outcome,
	running,
}: {
	outcome?: string;
	running?: boolean;
}) {
	if (running) return <Loader2 className="h-4 w-4 animate-spin text-sky-400" />;
	if (outcome === "incident")
		return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
	return <CheckCircle2 className="h-4 w-4 text-muted-foreground" />;
}

export function RunsList() {
	const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
	const { value: storedRuns, error: convexError } = useResilientQuery(
		api.runs.list,
		isAuthenticated ? {} : "skip",
	);
	const [fallbackRuns, setFallbackRuns] = useState<RunListItem[]>([]);
	const convexReady = storedRuns !== undefined || Boolean(convexError);
	const runs = useMemo(
		() => mergeRunListItems(mapRunListItems(storedRuns ?? []), fallbackRuns),
		[storedRuns, fallbackRuns],
	);
	const [importing, setImporting] = useState(false);
	const [importMessage, setImportMessage] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [outcome, setOutcome] = useState(ALL_FILTER_VALUES);
	const outcomeOptions = useMemo(() => runOutcomeOptions(runs), [runs]);
	const filteredRuns = useMemo(
		() => filterRuns(runs, { query, outcome }),
		[runs, query, outcome],
	);
	const hasFilters = Boolean(query.trim()) || outcome !== ALL_FILTER_VALUES;

	useEffect(() => {
		if (!isAuthenticated || !convexReady) return;
		let alive = true;
		listSidecarRuns()
			.then((legacy) => {
				if (alive) setFallbackRuns(legacy);
			})
			.catch(() => {
				if (alive) setFallbackRuns([]);
			});
		return () => {
			alive = false;
		};
	}, [isAuthenticated, convexReady]);

	const importJsonl = async () => {
		setImporting(true);
		setImportMessage(null);
		try {
			const response = await fetch("/api/revel8/import", { method: "POST" });
			const body = await response.json();
			if (!response.ok) throw new Error(body.detail ?? "import failed");
			setImportMessage(
				`Reconciled ${body.sessions} sessions: ${body.inserted} new, ${body.unchanged} unchanged${body.errors.length ? `, ${body.errors.length} failed` : ""}.`,
			);
		} catch (error) {
			setImportMessage((error as Error).message);
		} finally {
			setImporting(false);
		}
	};

	return (
		<div className="flex min-w-0 flex-col gap-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h1 className="text-xl font-semibold">Runs</h1>
					<p className="text-sm text-muted-foreground">
						Sanitized operational state in Convex. Live launches and idempotent
						JSONL imports update these cards in realtime.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={importJsonl}
						disabled={importing}
					>
						{importing ? "Importing…" : "Import JSONL"}
					</Button>
					<Button asChild size="sm">
						<Link href="/dashboard/control">Start a run →</Link>
					</Button>
				</div>
			</div>

			{importMessage ? (
				<div className="rounded-lg border border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
					{importMessage}
				</div>
			) : null}

			{convexError ? (
				<div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs text-amber-200">
					Convex is unavailable; showing the JSONL/sidecar fallback.
				</div>
			) : null}

			{runs.length ? (
				<div className="grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end">
					<div className="grid min-w-0 gap-1.5">
						<Label htmlFor="runs-search">Search runs</Label>
						<Input
							id="runs-search"
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Session, target, or outcome"
						/>
					</div>
					<div className="grid min-w-0 gap-1.5">
						<Label htmlFor="runs-outcome">Outcome</Label>
						<select
							id="runs-outcome"
							className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm"
							value={outcome}
							onChange={(event) => setOutcome(event.target.value)}
						>
							<option value={ALL_FILTER_VALUES}>All outcomes</option>
							{outcomeOptions.map((option) => (
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
							setQuery("");
							setOutcome(ALL_FILTER_VALUES);
						}}
					>
						Clear filters
					</Button>
					<p
						aria-live="polite"
						className="text-xs text-muted-foreground sm:col-span-3"
					>
						Showing {filteredRuns.length} of {runs.length} runs.
					</p>
				</div>
			) : null}

			{authLoading || (isAuthenticated && !convexReady) ? (
				<div className="py-16 text-center text-sm text-muted-foreground">
					Loading runs…
				</div>
			) : filteredRuns.length ? (
				<div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{filteredRuns.map((r: RunListItem) => (
						<Link
							key={r.session_id}
							href={`/dashboard/runs/${encodeURIComponent(r.session_id)}`}
							className={cn(
								"group min-w-0 rounded-lg border bg-card p-4 transition-colors hover:border-foreground/30",
								r.running
									? "border-sky-500/40"
									: r.meta.outcome === "incident"
										? "border-yellow-400/30"
										: "border-border",
							)}
						>
							<div className="flex items-center gap-2">
								<OutcomeIcon outcome={r.meta.outcome} running={r.running} />
								<span className="truncate font-mono text-sm font-semibold">
									{r.session_id}
								</span>
								{r.running ? (
									<span className="ml-auto flex items-center gap-1 text-[11px] font-medium text-sky-400">
										<Radio className="h-3 w-3 animate-pulse" /> live
									</span>
								) : null}
							</div>
							<div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
								<span>
									target{" "}
									<b className="text-foreground/80">{r.meta.target || "—"}</b>
								</span>
								<span>
									outcome{" "}
									<b
										className={cn(
											r.meta.outcome === "incident"
												? "text-yellow-300"
												: "text-foreground/80",
										)}
									>
										{r.meta.outcome || "—"}
									</b>
								</span>
								<span>
									touches{" "}
									<b className="text-foreground/80 tabular-nums">
										{r.meta.touchesUsed ?? "?"}/{r.meta.budget ?? "?"}
									</b>
								</span>
								<span>
									susp.{" "}
									<b className="text-foreground/80 tabular-nums">
										{r.meta.finalSuspicion != null
											? r.meta.finalSuspicion.toFixed(2)
											: "—"}
									</b>
								</span>
							</div>
							<div className="mt-2 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground/70">
								<FileText className="h-3 w-3 shrink-0" />
								<span className="min-w-0 truncate">{r.file}</span>
								<span className="ml-auto shrink-0">{fmtTs(r.mtime)}</span>
							</div>
						</Link>
					))}
				</div>
			) : runs.length ? (
				<div className="rounded-lg border border-dashed border-border py-16 text-center">
					<p className="text-sm text-muted-foreground">
						No runs match these filters.
					</p>
					<Button
						variant="outline"
						size="sm"
						className="mt-3"
						onClick={() => {
							setQuery("");
							setOutcome(ALL_FILTER_VALUES);
						}}
					>
						Clear filters
					</Button>
				</div>
			) : (
				<div className="rounded-lg border border-dashed border-border py-16 text-center">
					<p className="text-sm text-muted-foreground">
						No imported traces yet. Use <b>Import JSONL</b>, start a run, or{" "}
						<Link
							href="/dashboard/runs/sample"
							className="text-sky-400 underline"
						>
							open the sample
						</Link>
						.
					</p>
				</div>
			)}
		</div>
	);
}
