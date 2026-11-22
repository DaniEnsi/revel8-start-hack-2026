"use client";

import { api } from "@x70-monorepo/database/convex/_generated/api";
import type { Doc } from "@x70-monorepo/database/convex/_generated/dataModel";
import { useConvexAuth } from "convex/react";
import {
	ChevronLeft,
	ChevronRight,
	Pause,
	Play,
	Radio,
	RotateCcw,
	Square,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	getRun,
	getSidecarBase,
	listLauncherRunning,
	stopRun,
} from "@/lib/revel8/client";
import { traceRecordsFromQuery } from "@/lib/revel8/realtime";
import { redactTraceValue } from "@/lib/revel8/redaction";
import {
	isTerminalRunStatus,
	resolveRunRunning,
} from "@/lib/revel8/run-status";
import { buildSession } from "@/lib/revel8/trace";
import type { TraceRecord } from "@/lib/revel8/types";
import { useResilientQuery } from "@/lib/revel8/use-resilient-query";
import { PlaybookPanel } from "./playbook-panel";
import { SessionSummary } from "./session-summary";
import { Timeline } from "./timeline";
import { MarkerDetail, TouchDetail } from "./touch-detail";

export function buildRunViewSession(
	sessionId: string,
	records: TraceRecord[],
	run?: Pick<Doc<"runs">, "status" | "outcome" | "endTs">,
) {
	const session = buildSession(sessionId, records);
	if (run?.outcome === "incident" && session.meta.outcome !== "incident") {
		session.meta.outcome = "incident";
		return session;
	}
	if (session.meta.outcome !== "in progress" || !run) return session;

	if (isTerminalRunStatus(run.status)) {
		session.meta.outcome = run.status;
		session.meta.endTs = run.endTs ?? session.meta.endTs;
	}
	return session;
}

async function loadStatic(sessionId: string): Promise<TraceRecord[]> {
	// Zero-backend fallback: the bundled sample, or a ?trace= URL.
	const url =
		sessionId === "sample"
			? "/dashboard/sample-trace.jsonl"
			: new URLSearchParams(window.location.search).get("trace");
	if (!url) throw new Error("no static source");
	const res = await fetch(url);
	if (!res.ok) throw new Error(`static load failed: ${res.status}`);
	const text = await res.text();
	const { parseTraceText } = await import("@/lib/revel8/trace");
	const parsed = parseTraceText(text);
	return parsed?.records ?? [];
}

export function RunView({ sessionId }: { sessionId: string }) {
	const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
	const { value: storedResult, error: convexError } = useResilientQuery(
		api.runs.get,
		isAuthenticated && sessionId !== "sample" ? { sessionId } : "skip",
	);
	const stored = convexError ? null : storedResult;
	const [fallbackRecords, setFallbackRecords] = useState<TraceRecord[]>([]);
	const [fallbackRunning, setFallbackRunning] = useState(false);
	const [fallbackSource, setFallbackSource] = useState<"sidecar" | "static">(
		"sidecar",
	);
	const [fallbackAttempted, setFallbackAttempted] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [bridgeRunning, setBridgeRunning] = useState(false);
	const [selRow, setSelRow] = useState(0);
	const [playing, setPlaying] = useState(false);
	const [follow, setFollow] = useState(true);
	const playTimer = useRef<ReturnType<typeof setInterval> | null>(null);

	const records = useMemo(
		() => (stored ? traceRecordsFromQuery(stored) : fallbackRecords),
		[stored, fallbackRecords],
	);
	const session = useMemo(
		() => buildRunViewSession(sessionId, records, stored?.run),
		[sessionId, records, stored?.run],
	);
	const source = stored ? "convex" : fallbackSource;
	const running = resolveRunRunning({
		status: stored?.run.status,
		records,
		processRunning: fallbackRunning || bridgeRunning,
	});
	const live = Boolean(stored && running);
	const loading =
		sessionId === "sample"
			? !fallbackAttempted
			: authLoading ||
				(isAuthenticated && stored === undefined) ||
				(stored === null && !fallbackAttempted);

	// A missing Convex run can still be read once from the JSONL sidecar. This is
	// a compatibility fallback, not the live path; Import JSONL reconciles it.
	const shouldLoadFallback = sessionId === "sample" || stored === null;
	useEffect(() => {
		if (!shouldLoadFallback) return;
		let alive = true;
		setFallbackAttempted(false);
		setError(null);
		(async () => {
			try {
				if (sessionId === "sample") throw new Error("static sample");
				const run = await getRun(sessionId);
				if (!alive) return;
				setFallbackRecords(
					(run.records ?? []).map(
						(record) => redactTraceValue(record) as TraceRecord,
					),
				);
				setFallbackRunning(!!run.running);
				setFallbackSource("sidecar");
			} catch {
				try {
					const recs = await loadStatic(sessionId);
					if (!alive) return;
					setFallbackRecords(
						recs.map((record) => redactTraceValue(record) as TraceRecord),
					);
					setFallbackRunning(false);
					setFallbackSource("static");
				} catch (e) {
					if (alive) setError((e as Error).message);
				}
			} finally {
				if (alive) setFallbackAttempted(true);
			}
		})();
		return () => {
			alive = false;
		};
	}, [sessionId, shouldLoadFallback]);

	// Process state remains separate because Convex cannot inspect Next.js child
	// processes. Trace records and run status themselves arrive over useQuery.
	useEffect(() => {
		if (sessionId === "sample") return;
		let alive = true;
		const check = async () => {
			try {
				const processes = await listLauncherRunning();
				if (alive) {
					setBridgeRunning(
						processes.some((process) => process.session_id === sessionId),
					);
				}
			} catch {
				if (alive) setBridgeRunning(false);
			}
		};
		check();
		const id = setInterval(check, 2000);
		return () => {
			alive = false;
			clearInterval(id);
		};
	}, [sessionId]);

	const rowCount = session.rows.length;

	// Follow the live edge
	useEffect(() => {
		if (live && follow && rowCount > 0) setSelRow(rowCount - 1);
	}, [live, follow, rowCount]);

	const selectRow = useCallback(
		(i: number) => {
			setSelRow(Math.max(0, Math.min(i, rowCount - 1)));
			setFollow(false);
		},
		[rowCount],
	);

	// Play timer
	useEffect(() => {
		if (!playing) {
			if (playTimer.current) clearInterval(playTimer.current);
			playTimer.current = null;
			return;
		}
		playTimer.current = setInterval(() => {
			setSelRow((prev) => {
				if (prev >= rowCount - 1) {
					setPlaying(false);
					return prev;
				}
				return prev + 1;
			});
		}, 2200);
		return () => {
			if (playTimer.current) clearInterval(playTimer.current);
		};
	}, [playing, rowCount]);

	// Keyboard scrub
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const el = e.target as HTMLElement;
			if (el?.matches("input, select, textarea")) return;
			if (e.key === "ArrowRight") {
				setPlaying(false);
				selectRow(selRow + 1);
			} else if (e.key === "ArrowLeft") {
				setPlaying(false);
				selectRow(selRow - 1);
			} else if (e.key === "Home") {
				setPlaying(false);
				selectRow(0);
			} else if (e.key === "End") {
				setPlaying(false);
				selectRow(rowCount - 1);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [selRow, rowCount, selectRow]);

	const onStop = async () => {
		try {
			await stopRun(sessionId);
		} catch {
			/* ignore */
		}
	};

	if (loading) {
		return (
			<div className="py-20 text-center text-sm text-muted-foreground">
				Loading run…
			</div>
		);
	}
	if (error && !records.length) {
		return (
			<div className="mx-auto max-w-lg rounded-lg border border-border bg-card p-6 text-center">
				<p className="text-sm font-medium">Could not load this run.</p>
				<p className="mt-1 text-xs text-muted-foreground">{error}</p>
				<p className="mt-3 text-xs text-muted-foreground">
					The sidecar at <code className="font-mono">{getSidecarBase()}</code>{" "}
					is unreachable and no static trace was found. Start the sidecar, or
					open{" "}
					<Link
						href="/dashboard/runs/sample"
						className="text-sky-400 underline"
					>
						the bundled sample
					</Link>
					.
				</p>
			</div>
		);
	}

	const row = session.rows[selRow];
	const curTouch = row?.type === "touch" ? row.t : null;
	const prevTouch =
		curTouch && session.touches.indexOf(curTouch) > 0
			? session.touches[session.touches.indexOf(curTouch) - 1]
			: null;
	const scrubLabel =
		row?.type === "touch"
			? `touch ${row.t?.idx ?? "?"}`
			: row
				? String(row.rec.kind ?? "").replace(/_/g, " ")
				: "";

	return (
		<div className="flex min-w-0 flex-col gap-4">
			{/* header line */}
			<div className="flex flex-wrap items-center gap-3">
				<Link
					href="/dashboard/runs"
					className="text-xs text-muted-foreground hover:text-foreground"
				>
					← all runs
				</Link>
				<h1 className="min-w-0 break-all font-mono text-sm font-semibold">
					{session.id}
				</h1>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
					{session.meta.target ? (
						<span>
							target <b className="text-foreground/80">{session.meta.target}</b>
						</span>
					) : null}
					{session.meta.objective ? (
						<span>
							objective{" "}
							<b className="text-foreground/80">{session.meta.objective}</b>
						</span>
					) : null}
					{session.meta.scenario ? (
						<span>
							scenario{" "}
							<b className="text-foreground/80">{session.meta.scenario}</b>
						</span>
					) : null}
					{session.meta.arms ? (
						<span className="font-mono">
							arms{" "}
							<b className="text-foreground/80">
								{Object.entries(session.meta.arms)
									.map(([k, v]) => `${k}=${v}`)
									.join(" · ")}
							</b>
						</span>
					) : null}
				</div>
				<div className="ml-auto flex flex-wrap items-center gap-2">
					{source !== "convex" ? (
						<span className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground">
							{source === "sidecar"
								? "JSONL fallback · import to reconcile"
								: "static sample/fallback"}
						</span>
					) : null}
					{live ? (
						<>
							<span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
								<Radio className="h-3.5 w-3.5 animate-pulse" /> live
							</span>
							<Button size="sm" variant="destructive" onClick={onStop}>
								<Square className="mr-1 h-3 w-3" /> Stop
							</Button>
						</>
					) : null}
				</div>
			</div>

			<SessionSummary session={session} live={live} />

			{/* scrub bar */}
			<div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
				<Button
					size="icon"
					variant="ghost"
					aria-label="Previous replay record"
					className="h-8 w-8 shrink-0"
					onClick={() => {
						setPlaying(false);
						selectRow(selRow - 1);
					}}
				>
					<ChevronLeft className="h-4 w-4" />
				</Button>
				<Button
					size="sm"
					variant="secondary"
					onClick={() => {
						if (!playing && selRow >= rowCount - 1) setSelRow(0);
						setFollow(false);
						setPlaying((p) => !p);
					}}
				>
					{playing ? (
						<Pause className="mr-1 h-3.5 w-3.5" />
					) : (
						<Play className="mr-1 h-3.5 w-3.5" />
					)}
					{playing ? "Pause" : "Play"}
				</Button>
				<Button
					size="icon"
					variant="ghost"
					aria-label="Next replay record"
					className="h-8 w-8 shrink-0"
					onClick={() => {
						setPlaying(false);
						selectRow(selRow + 1);
					}}
				>
					<ChevronRight className="h-4 w-4" />
				</Button>
				<input
					type="range"
					min={0}
					max={Math.max(0, rowCount - 1)}
					value={selRow}
					onChange={(e) => {
						setPlaying(false);
						selectRow(Number(e.target.value));
					}}
					aria-label="Replay position"
					className="h-1.5 min-w-0 flex-1 basis-32 cursor-pointer accent-foreground"
				/>
				<span className="w-full min-w-0 font-mono text-[11px] text-muted-foreground sm:w-auto sm:flex-1 sm:text-right">
					{rowCount ? selRow + 1 : 0}/{rowCount} — {scrubLabel}
				</span>
				{live ? (
					<Button
						size="sm"
						variant={follow ? "default" : "outline"}
						onClick={() => {
							setFollow((f) => !f);
							if (!follow) selectRow(rowCount - 1);
						}}
						title="Snap to the latest touch as it streams"
					>
						<RotateCcw className="mr-1 h-3 w-3" /> Follow
					</Button>
				) : null}
			</div>

			{/* main: timeline + detail */}
			<div className="grid min-w-0 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
				<div className="h-fit overflow-hidden rounded-lg border border-border bg-card lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
					<Timeline session={session} selRow={selRow} onSelect={selectRow} />
				</div>
				<div className="min-w-0">
					{!row ? (
						<div className="py-12 text-center text-sm text-muted-foreground">
							No records yet{live ? " — waiting for the first touch…" : ""}.
						</div>
					) : row.type === "touch" && curTouch ? (
						<TouchDetail session={session} t={curTouch} prev={prevTouch} />
					) : (
						<MarkerDetail rec={row.rec} />
					)}
				</div>
			</div>

			<PlaybookPanel targetFilter={session.meta.target} />
		</div>
	);
}
