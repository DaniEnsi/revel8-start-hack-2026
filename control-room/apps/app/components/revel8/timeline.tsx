"use client";

import { ACTION_CLASS, badgeClass, REACTION_CLASS } from "@/lib/revel8/format";
import { markerSub, markerTitle } from "@/lib/revel8/trace";
import type { Row, Session } from "@/lib/revel8/types";
import { cn } from "@/lib/utils";
import { ChannelTag, Pill } from "./primitives";

export function Timeline({
	session,
	selRow,
	onSelect,
}: {
	session: Session;
	selRow: number;
	onSelect: (i: number) => void;
}) {
	return (
		<div className="flex flex-col">
			<div className="border-b border-border/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				Timeline — {session.touches.length} touches
			</div>
			<div className="flex flex-col">
				{session.rows.map((row, i) => (
					<TimelineRow
						key={i}
						row={row}
						idx={i}
						selected={i === selRow}
						onSelect={() => onSelect(i)}
					/>
				))}
			</div>
		</div>
	);
}

function TimelineRow({
	row,
	idx,
	selected,
	onSelect,
}: {
	row: Row;
	idx: number;
	selected: boolean;
	onSelect: () => void;
}) {
	const base = cn(
		"flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-left transition-colors",
		selected ? "bg-secondary" : "hover:bg-secondary/50",
	);

	if (row.type === "touch" && row.t) {
		const t = row.t;
		return (
			<button type="button" className={base} onClick={onSelect}>
				<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-mono text-muted-foreground">
					{t.idx ?? idx + 1}
				</span>
				<span className="min-w-0 flex-1">
					<span className="flex items-center gap-1.5">
						<Pill className={cn("px-1.5", badgeClass(ACTION_CLASS, t.action))}>
							{t.action || "touch"}
						</Pill>
						<ChannelTag channel={t.channel} />
					</span>
					<span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
						{t.topicId || ""}
					</span>
				</span>
				<span className="flex shrink-0 flex-col items-end gap-0.5">
					<Pill
						className={cn("px-1.5", badgeClass(REACTION_CLASS, t.reaction))}
					>
						{t.reaction || "—"}
					</Pill>
					{t.suspicion != null ? (
						<span className="font-mono text-[10px] text-muted-foreground">
							s {t.suspicion.toFixed(2)}
						</span>
					) : null}
				</span>
			</button>
		);
	}

	const isInc = row.kind === "incident";
	return (
		<button type="button" className={base} onClick={onSelect}>
			<span
				className={cn(
					"flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px]",
					isInc
						? "border-yellow-400 text-yellow-300"
						: "border-border text-muted-foreground",
				)}
			>
				{isInc ? "★" : "·"}
			</span>
			<span className="min-w-0 flex-1">
				<span
					className={cn(
						"block truncate text-xs font-medium",
						isInc ? "text-yellow-300" : "text-muted-foreground",
					)}
				>
					{markerTitle(row.rec)}
				</span>
				<span className="block truncate font-mono text-[10px] text-muted-foreground/70">
					{markerSub(row.rec)}
				</span>
			</span>
		</button>
	);
}
