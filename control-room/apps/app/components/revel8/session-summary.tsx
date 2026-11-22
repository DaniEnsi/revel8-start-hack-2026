"use client";

import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { fmtDur } from "@/lib/revel8/format";
import type { Session } from "@/lib/revel8/types";
import { cn } from "@/lib/utils";
import { ChannelTag, Sparkline } from "./primitives";

function Stat({
	label,
	children,
	accent,
	wide,
}: {
	label: string;
	children: React.ReactNode;
	accent?: boolean;
	wide?: boolean;
}) {
	return (
		<div
			className={cn(
				"min-w-0 rounded-lg border bg-card p-3",
				accent ? "border-yellow-400/40 bg-yellow-400/5" : "border-border",
				wide && "sm:col-span-2 lg:col-span-5",
			)}
		>
			<div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
				{label}
			</div>
			<div className="mt-1 text-foreground">{children}</div>
		</div>
	);
}

export function SessionSummary({
	session,
	live,
}: {
	session: Session;
	live?: boolean;
}) {
	const m = session.meta;
	const isIncident = m.outcome === "incident";
	const inProgress = m.outcome === "in progress";

	return (
		<div className="flex flex-col gap-3">
			{/* Outcome banner */}
			<div
				className={cn(
					"flex items-center gap-3 rounded-lg border px-4 py-3",
					isIncident
						? "border-yellow-400/40 bg-yellow-400/10 text-yellow-200"
						: inProgress
							? "border-sky-500/30 bg-sky-500/10 text-sky-200"
							: "border-border bg-muted/30 text-muted-foreground",
				)}
			>
				{isIncident ? (
					<AlertTriangle className="h-5 w-5 shrink-0" />
				) : inProgress ? (
					<Loader2 className={cn("h-5 w-5 shrink-0", live && "animate-spin")} />
				) : (
					<CheckCircle2 className="h-5 w-5 shrink-0" />
				)}
				<div className="min-w-0">
					<div className="text-sm font-semibold">
						{isIncident
							? `INCIDENT — ${m.objective || "objective"} reached${
									m.incidentTouch ? ` at touch ${m.incidentTouch}` : ""
								}${m.incidentVia ? ` via ${m.incidentVia}` : ""}`
							: inProgress
								? live
									? "Session in progress — streaming live"
									: "Session in progress"
								: `Session ended — ${m.outcome}`}
					</div>
					{m.endReason ? (
						<div className="truncate text-xs opacity-80">{m.endReason}</div>
					) : null}
				</div>
				{live ? (
					<span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-emerald-400">
						<span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
						LIVE
					</span>
				) : null}
			</div>

			{/* Stat grid */}
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
				<Stat label="Outcome" accent={isIncident}>
					<div className="break-words text-lg font-semibold">
						{isIncident ? "INCIDENT" : m.outcome}
					</div>
				</Stat>
				<Stat label="Touches">
					<div className="text-lg font-semibold tabular-nums">
						{m.touchesUsed}
						<span className="text-sm font-normal text-muted-foreground">
							{" "}
							of {m.budget ?? "?"}
						</span>
					</div>
				</Stat>
				<Stat label="Final suspicion">
					<div className="text-lg font-semibold tabular-nums">
						{m.finalSuspicion != null ? m.finalSuspicion.toFixed(2) : "—"}
						<span className="text-sm font-normal text-muted-foreground">
							{" "}
							/ 1.0
						</span>
					</div>
					<Sparkline
						vals={session.touches.map((t) => t.suspicion ?? 0)}
						className="mt-1"
					/>
				</Stat>
				<Stat label="Channels">
					<div className="flex flex-wrap gap-1">
						{m.channels.length ? (
							m.channels.map((c) => <ChannelTag key={c} channel={c} />)
						) : (
							<span className="text-muted-foreground">—</span>
						)}
					</div>
				</Stat>
				<Stat label="Wall time">
					<div className="text-lg font-semibold tabular-nums">
						{fmtDur(m.startTs, m.endTs) || (inProgress ? "running…" : "—")}
					</div>
				</Stat>
			</div>
		</div>
	);
}
