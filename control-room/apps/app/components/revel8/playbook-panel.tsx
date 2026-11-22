"use client";

import { useEffect, useState } from "react";
import { getPlaybook } from "@/lib/revel8/client";
import { fmtTs, numOrNull } from "@/lib/revel8/format";
import { formatTraceValue } from "@/lib/revel8/redaction";
import type { Playbook, PlaybookTargetEntry } from "@/lib/revel8/types";
import { cn } from "@/lib/utils";
import { ChannelTag } from "./primitives";

async function loadPlaybook(): Promise<Playbook | null> {
	const pb = await getPlaybook();
	if (pb) return pb;
	try {
		const res = await fetch("/dashboard/sample-playbook.json");
		if (res.ok) return (await res.json()) as Playbook;
	} catch {
		/* ignore */
	}
	return null;
}

function ListBlock({ title, arr }: { title: string; arr?: string[] }) {
	if (!Array.isArray(arr) || !arr.length) return null;
	return (
		<div className="mt-2">
			<div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
				{title}
			</div>
			<ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-foreground/90">
				{arr.map((x, i) => (
					<li key={i}>{typeof x === "string" ? x : formatTraceValue(x)}</li>
				))}
			</ul>
		</div>
	);
}

function TargetCard({
	tid,
	e,
	highlight,
}: {
	tid: string;
	e: PlaybookTargetEntry;
	highlight?: boolean;
}) {
	const ident = e.winning_identity;
	return (
		<div
			className={cn(
				"rounded-lg border bg-card p-3",
				highlight
					? "border-sky-500/40 ring-1 ring-sky-500/20"
					: "border-border",
			)}
		>
			<h3 className="font-mono text-sm font-semibold">{tid}</h3>
			<dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
				<dt className="text-muted-foreground">Learned hook</dt>
				<dd className="min-w-0 break-words">
					{e.learned_hook ? (
						<>
							{e.learned_hook.topic_id}{" "}
							<span className="text-muted-foreground">
								({numOrNull(e.learned_hook.confidence)?.toFixed(2) ?? "?"})
							</span>
							{e.learned_hook.label ? (
								<div className="text-[11px] text-muted-foreground">
									{e.learned_hook.label}
								</div>
							) : null}
						</>
					) : (
						"—"
					)}
				</dd>
				<dt className="text-muted-foreground">Winning channel</dt>
				<dd className="min-w-0 break-words">
					{e.winning_channel ? <ChannelTag channel={e.winning_channel} /> : "—"}
				</dd>
				{ident ? (
					<>
						<dt className="text-muted-foreground">Winning identity</dt>
						<dd className="min-w-0 break-words">
							{ident.name}{" "}
							<span className="font-mono text-muted-foreground">
								&lt;{ident.address ?? ""}&gt;
							</span>
							<div className="text-[11px] text-muted-foreground">
								{ident.role ?? ""}
								{ident.org ? `, ${ident.org}` : ""}
							</div>
						</dd>
					</>
				) : null}
				{e.reached_incident ? (
					<>
						<dt className="text-muted-foreground">Incident</dt>
						<dd className="text-yellow-300">
							{e.reached_incident.objective ?? ""} in{" "}
							{e.reached_incident.touches_to_incident ?? "?"} touches · via{" "}
							{e.reached_incident.via ?? "?"}
						</dd>
					</>
				) : null}
			</dl>
			<ListBlock title="Safe facts (landed clean)" arr={e.safe_facts} />
			<ListBlock title="Traps hit" arr={e.traps_hit} />
			<ListBlock title="Burned senders" arr={e.burned_senders} />
			<ListBlock
				title="Suspicion-triggering lines"
				arr={e.suspicion_triggering_lines}
			/>
		</div>
	);
}

export function PlaybookPanel({ targetFilter }: { targetFilter?: string }) {
	const [pb, setPb] = useState<Playbook | null>(null);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		let alive = true;
		loadPlaybook().then((p) => {
			if (alive) {
				setPb(p);
				setLoaded(true);
			}
		});
		return () => {
			alive = false;
		};
	}, []);

	if (!loaded || !pb) return null;
	const perTarget = pb.per_target ?? {};
	const sessions = pb.sessions ?? [];
	if (!Object.keys(perTarget).length && !sessions.length) return null;

	return (
		<details className="rounded-lg border border-border bg-card" open>
			<summary className="cursor-pointer select-none border-b border-border/60 bg-muted/30 px-4 py-3">
				<span className="text-sm font-semibold">Cross-session playbook</span>
				<span className="ml-2 text-xs text-muted-foreground">
					D-P · what the agent carries into the next session
				</span>
			</summary>
			<div className="p-4">
				<div className="grid gap-3 md:grid-cols-2">
					{Object.entries(perTarget).map(([tid, e]) => (
						<TargetCard
							key={tid}
							tid={tid}
							e={e}
							highlight={!!targetFilter && tid === targetFilter}
						/>
					))}
				</div>
				{sessions.length ? (
					<div className="mt-4 overflow-x-auto">
						<div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
							Sessions recorded ({sessions.length})
						</div>
						<table className="w-full text-xs">
							<thead>
								<tr className="border-b border-border text-left text-muted-foreground">
									<th className="py-1 pr-3 font-medium">session</th>
									<th className="py-1 pr-3 font-medium">target</th>
									<th className="py-1 pr-3 font-medium">outcome</th>
									<th className="py-1 pr-3 font-medium">touches</th>
									<th className="py-1 pr-3 font-medium">final susp.</th>
									<th className="py-1 pr-3 font-medium">when</th>
									<th className="py-1 font-medium">notes</th>
								</tr>
							</thead>
							<tbody>
								{sessions.map((x, i) => (
									<tr key={i} className="border-b border-border/40">
										<td className="py-1 pr-3 font-mono">
											{x.session_id ?? ""}
										</td>
										<td className="py-1 pr-3">{x.target_id ?? ""}</td>
										<td
											className={cn(
												"py-1 pr-3",
												x.outcome === "incident"
													? "text-yellow-300"
													: "text-muted-foreground",
											)}
										>
											{x.outcome ?? ""}
										</td>
										<td className="py-1 pr-3 tabular-nums">
											{x.touches_used ?? ""}
										</td>
										<td className="py-1 pr-3 tabular-nums">
											{numOrNull(x.final_suspicion)?.toFixed(2) ?? "—"}
										</td>
										<td className="py-1 pr-3">{fmtTs(x.ts)}</td>
										<td className="py-1 text-muted-foreground">
											{x.notes ?? ""}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : null}
			</div>
		</details>
	);
}
