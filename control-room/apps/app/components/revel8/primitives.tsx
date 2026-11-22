"use client";

import { fmtDelta, THETA_HARD, THETA_SOFT } from "@/lib/revel8/format";
import type { TopicBelief } from "@/lib/revel8/types";
import { cn } from "@/lib/utils";

/** Inline badge/pill with explicit color classes (action / reaction / channel). */
export function Pill({
	children,
	className,
	title,
}: {
	children: React.ReactNode;
	className?: string;
	title?: string;
}) {
	return (
		<span
			title={title}
			className={cn(
				"inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
				className,
			)}
		>
			{children}
		</span>
	);
}

export function ChannelTag({ channel }: { channel?: string }) {
	return (
		<span className="inline-flex items-center rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
			{channel || "?"}
		</span>
	);
}

export function DeltaText({ d }: { d?: number | null }) {
	const f = fmtDelta(d);
	const cls =
		f.kind === "up"
			? "text-red-400"
			: f.kind === "down"
				? "text-emerald-400"
				: "text-muted-foreground";
	return <span className={cn("font-mono text-[11px]", cls)}>{f.text}</span>;
}

/** Section card used throughout the replay detail. */
export function TraceCard({
	title,
	right,
	children,
	accent,
}: {
	title: string;
	right?: React.ReactNode;
	children: React.ReactNode;
	accent?: boolean;
}) {
	return (
		<div
			className={cn(
				"overflow-hidden rounded-lg border bg-card",
				accent ? "border-yellow-400/40" : "border-border",
			)}
		>
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
				<span className="min-w-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					{title}
				</span>
				{right ? (
					<span className="text-xs text-muted-foreground">{right}</span>
				) : null}
			</div>
			<div className="p-3">{children}</div>
		</div>
	);
}

/** Suspicion sparkline (SVG). θ_soft reference line dashed. */
export function Sparkline({
	vals,
	className,
}: {
	vals: number[];
	className?: string;
}) {
	if (!vals.length) return null;
	const w = 120;
	const h = 26;
	const pad = 2;
	const step = vals.length > 1 ? (w - pad * 2) / (vals.length - 1) : 0;
	const pts = vals.map(
		(v, i) =>
			`${(pad + i * step).toFixed(1)},${(h - pad - v * (h - pad * 2)).toFixed(1)}`,
	);
	const yTheta = h - pad - THETA_SOFT * (h - pad * 2);
	return (
		<svg width={w} height={h} className={className} aria-hidden="true">
			<line
				x1="0"
				y1={yTheta}
				x2={w}
				y2={yTheta}
				stroke="rgba(226,166,61,.4)"
				strokeDasharray="3 2"
			/>
			<polyline
				points={pts.join(" ")}
				fill="none"
				stroke="rgb(245,180,80)"
				strokeWidth="1.6"
			/>
			{pts.map((p, i) => {
				const [cx, cy] = p.split(",");
				return <circle key={i} cx={cx} cy={cy} r="2" fill="rgb(245,180,80)" />;
			})}
		</svg>
	);
}

/** Suspicion gauge with θ_soft / θ_hard threshold zones (config.py). */
export function SuspicionGauge({
	suspicion,
	prevSuspicion,
}: {
	suspicion: number | null;
	prevSuspicion?: number | null;
}) {
	const pct = suspicion != null ? Math.round(suspicion * 100) : 0;
	const delta =
		suspicion != null && prevSuspicion != null
			? suspicion - prevSuspicion
			: null;
	return (
		<div>
			<div className="flex items-baseline gap-2">
				<span className="font-mono text-2xl font-semibold tabular-nums">
					{suspicion != null ? suspicion.toFixed(2) : "—"}
				</span>
				<span className="text-[11px] text-muted-foreground">
					suspicion (inferred — never shown by the API)
				</span>
				<DeltaText d={delta} />
			</div>
			<div className="relative mt-3">
				<div className="relative flex h-2.5 overflow-hidden rounded-full">
					<div
						style={{ width: `${THETA_SOFT * 100}%` }}
						className="bg-emerald-500/30"
					/>
					<div
						style={{ width: `${(THETA_HARD - THETA_SOFT) * 100}%` }}
						className="bg-amber-500/30"
					/>
					<div
						style={{ width: `${(1 - THETA_HARD) * 100}%` }}
						className="bg-red-500/30"
					/>
					<div
						className="absolute inset-y-0 left-0 rounded-full bg-foreground/80"
						style={{ width: `${pct}%` }}
					/>
				</div>
				<div className="relative mt-1 h-8 text-[10px] text-muted-foreground">
					<span
						className="absolute -translate-x-1/2 whitespace-nowrap"
						style={{ left: `${THETA_SOFT * 100}%` }}
					>
						<span className="block h-2 w-px bg-amber-400/50" />
						θ_soft {THETA_SOFT}
						<br />
						soften
					</span>
					<span
						className="absolute -translate-x-1/2 whitespace-nowrap"
						style={{ left: `${THETA_HARD * 100}%` }}
					>
						<span className="block h-2 w-px bg-red-400/50" />
						θ_hard {THETA_HARD}
						<br />
						stop
					</span>
				</div>
			</div>
		</div>
	);
}

/** Per-topic posterior confidence bars with touch-over-touch deltas. */
export function TopicPosteriors({
	topics,
	prevTopics,
}: {
	topics: Record<string, TopicBelief> | null;
	prevTopics?: Record<string, TopicBelief> | null;
}) {
	if (!topics || typeof topics !== "object") {
		return (
			<div className="rounded border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
				no topic snapshot in this record
			</div>
		);
	}
	const entries = Object.entries(topics);
	return (
		<div className="flex flex-col gap-2">
			{entries.map(([tid, info]) => {
				const conf = Number(info?.confidence) || 0;
				const status = info?.status ?? "untested";
				const prevConf = prevTopics?.[tid]?.confidence;
				const d = prevConf != null ? conf - Number(prevConf) : null;
				const fill =
					status === "engaged"
						? "bg-emerald-400"
						: status === "cold"
							? "bg-zinc-500"
							: "bg-sky-400";
				const statusColor =
					status === "engaged"
						? "text-emerald-400"
						: status === "cold"
							? "text-muted-foreground"
							: "text-sky-400";
				return (
					<div
						key={tid}
						className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1"
					>
						<span
							className="truncate font-mono text-[11px] text-foreground/90"
							title={tid}
						>
							{tid}
						</span>
						<span className="text-right font-mono text-[11px] tabular-nums">
							{conf.toFixed(2)}{" "}
							<span className={cn("ml-1", statusColor)}>{status}</span>
						</span>
						<div className="col-span-1 h-1.5 overflow-hidden rounded-full bg-muted">
							<div
								className={cn("h-full", fill)}
								style={{ width: `${Math.round(conf * 100)}%` }}
							/>
						</div>
						<div className="text-right">
							{d != null ? <DeltaText d={d} /> : null}
						</div>
					</div>
				);
			})}
		</div>
	);
}
