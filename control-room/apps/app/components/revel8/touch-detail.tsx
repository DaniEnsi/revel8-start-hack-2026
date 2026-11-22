"use client";

import {
	ACTION_CLASS,
	badgeClass,
	EVENT_CLASS,
	fmtTs,
	linkify,
	REACTION_CLASS,
	wordCount,
} from "@/lib/revel8/format";
import { formatTraceValue, traceFieldNames } from "@/lib/revel8/redaction";
import { getPage, normEvent, senderOf } from "@/lib/revel8/trace";
import type {
	GuardResult,
	Session,
	Touch,
	WriterBrief,
} from "@/lib/revel8/types";
import { cn } from "@/lib/utils";
import {
	ChannelTag,
	Pill,
	SuspicionGauge,
	TopicPosteriors,
	TraceCard,
} from "./primitives";

function RawRecord({ rec }: { rec: unknown }) {
	return (
		<details className="group min-w-0 rounded-lg border border-border bg-card">
			<summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
				Raw trace record
			</summary>
			<pre className="max-h-[420px] overflow-auto border-t border-border/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
				{formatTraceValue(rec, 2)}
			</pre>
		</details>
	);
}

function MessageBody({ body }: { body: string }) {
	return (
		<div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
			{linkify(body).map((seg, i) =>
				seg.url ? (
					<span
						key={i}
						title="lookalike URL inside the simulation"
						className="break-all text-sky-400 underline decoration-sky-400/50"
					>
						{seg.text}
					</span>
				) : (
					<span key={i}>{seg.text}</span>
				),
			)}
		</div>
	);
}

function MessageCard({ session, t }: { session: Session; t: Touch }) {
	const sender = senderOf(session, t);
	const d = t.draft as { subject?: string; body?: string };
	const turns =
		((t.raw as any).conversation?.turns as any[]) ??
		((t.raw as any).turns as any[]) ??
		null;
	const body = d.body ?? "(no body)";
	return (
		<TraceCard
			title="Message — as rendered for the twin"
			right={`${wordCount(d.body)} words`}
		>
			{Array.isArray(turns) && turns.length ? (
				<div className="flex flex-col gap-2">
					{turns.map((u, i) => {
						const us = (u.who ?? u.speaker) === "us";
						return (
							<div
								key={i}
								className={cn(
									"max-w-[85%] rounded-lg px-3 py-2 text-sm",
									us
										? "self-end bg-primary/10 text-foreground"
										: "self-start bg-muted text-foreground/90",
								)}
							>
								<div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
									{us ? "us (agent)" : "target"}
								</div>
								{u.text ?? u.say ?? ""}
							</div>
						);
					})}
				</div>
			) : (
				<div className="flex flex-col gap-2">
					<div className="flex flex-col gap-1 rounded-md border border-border/60 bg-muted/20 p-2 text-xs">
						<div className="flex gap-2">
							<span className="w-16 shrink-0 text-muted-foreground">From</span>
							<span className="min-w-0 break-words">
								{sender?.name ?? "—"}{" "}
								<span className="font-mono text-muted-foreground">
									&lt;{sender?.address ?? ""}&gt;
								</span>
								{sender?.role ? (
									<span className="text-muted-foreground">
										{" "}
										· {sender.role}
										{sender.org ? `, ${sender.org}` : ""}
									</span>
								) : null}
							</span>
						</div>
						<div className="flex gap-2">
							<span className="w-16 shrink-0 text-muted-foreground">To</span>
							<span className="min-w-0 break-words">
								{t.target || session.meta.target || "—"}
							</span>
						</div>
						<div className="flex items-center gap-2">
							<span className="w-16 shrink-0 text-muted-foreground">
								Channel
							</span>
							<ChannelTag channel={t.channel} />
						</div>
					</div>
					{d.subject ? (
						<div className="border-b border-border/60 pb-1 text-sm font-semibold">
							{d.subject}
						</div>
					) : null}
					<MessageBody body={body} />
				</div>
			)}
		</TraceCard>
	);
}

function LandingPageCard({
	page,
}: {
	page: NonNullable<ReturnType<typeof getPage>>;
}) {
	const p = page as {
		url?: string;
		title?: string;
		fields?: string[];
		html?: string;
	};
	return (
		<TraceCard title="Landing page — registered with the API">
			<div className="mb-2 flex flex-col gap-1 text-xs text-muted-foreground">
				<span>
					<b className="text-foreground/80">URL</b> {p.url || "—"}
				</span>
				<span>
					<b className="text-foreground/80">Title</b> {p.title || "—"}
				</span>
				<span>
					<b className="text-foreground/80">Fields</b>{" "}
					{traceFieldNames(p.fields).join(", ") || "—"}{" "}
					<span className="text-muted-foreground/70">
						(submitted field names are the incident signal)
					</span>
				</span>
			</div>
			{p.html ? (
				<>
					<div className="overflow-hidden rounded-md border border-border bg-white">
						<iframe
							title="landing page preview"
							sandbox=""
							srcDoc={p.html}
							className="h-[420px] w-full"
						/>
					</div>
					<details className="mt-2 rounded border border-border">
						<summary className="cursor-pointer px-2 py-1 text-xs text-muted-foreground">
							HTML source
						</summary>
						<pre className="max-h-64 overflow-auto p-2 text-[11px] text-muted-foreground">
							{p.html}
						</pre>
					</details>
				</>
			) : (
				<div className="rounded border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
					declared page (no HTML captured in the trace)
				</div>
			)}
		</TraceCard>
	);
}

function EventsCard({ events }: { events: ReturnType<typeof normEvent>[] }) {
	return (
		<TraceCard
			title="Events returned"
			right={`${events.length} event${events.length === 1 ? "" : "s"}`}
		>
			{!events.length ? (
				<div className="rounded border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
					[ ] — ignored. No reaction came back; the angle/topic confidence
					decays.
				</div>
			) : (
				<div className="flex flex-col gap-2">
					<div className="flex flex-wrap gap-1.5">
						{events.map((e, i) => (
							<Pill key={i} className={badgeClass(EVENT_CLASS, e.type)}>
								{e.type}
							</Pill>
						))}
					</div>
					{events.map((e, i) => {
						if (e.type === "reply" && e.text) {
							return (
								<div
									key={i}
									className="rounded-md border-l-2 border-emerald-500/50 bg-emerald-500/5 px-3 py-2"
								>
									<div className="mb-0.5 text-[10px] uppercase tracking-wide text-emerald-400">
										↩ target reply{e.channel ? ` · ${e.channel}` : ""}
									</div>
									<div className="text-sm text-foreground/90">{e.text}</div>
								</div>
							);
						}
						if (e.type === "link.opened" && e.url) {
							return (
								<div key={i} className="text-xs text-sky-300">
									opened: {e.url} — hook confirmed, no submit yet
								</div>
							);
						}
						if (e.type === "page.submitted") {
							return (
								<div key={i} className="text-xs font-medium text-yellow-300">
									submitted fields: {JSON.stringify(e.fields ?? [])} — names
									only, values are never returned. This IS the credentials
									incident.
								</div>
							);
						}
						if (e.type === "attachment.opened" && e.file) {
							return (
								<div key={i} className="text-xs text-violet-300">
									opened attachment: {e.file}
								</div>
							);
						}
						return null;
					})}
				</div>
			)}
		</TraceCard>
	);
}

function GuardCard({ t }: { t: Touch }) {
	const g = t.guard as GuardResult | string[] | null;
	if (!g) {
		return (
			<TraceCard title="Guard (pre-send)">
				<div className="text-xs text-muted-foreground">no guard record</div>
			</TraceCard>
		);
	}
	const isArr = Array.isArray(g);
	const issues = (isArr ? g : (g.issues ?? [])) as string[];
	const passed = isArr
		? issues.length === 0
		: (g.passed ?? issues.length === 0);
	const redos = isArr ? 0 : (g.redos ?? 0);
	const readback = isArr ? null : g.readback;
	const history = isArr ? [] : (g.history ?? []);
	return (
		<TraceCard
			title="Guard (pre-send)"
			right={`${issues.length} issue${issues.length === 1 ? "" : "s"} · ${redos} redos`}
		>
			{passed ? (
				<div className="text-xs font-medium text-emerald-400">
					✓ passed
					{redos
						? ` after ${redos} redo${redos === 1 ? "" : "es"} (cap 2, D-K)`
						: ""}
				</div>
			) : (
				<ul className="list-disc space-y-1 pl-4 text-xs text-foreground/90">
					{issues.map((i, k) => (
						<li key={k}>{i}</li>
					))}
				</ul>
			)}
			{readback ? (
				<div className="mt-2 text-xs text-muted-foreground">
					Planner read-back:{" "}
					<span className={readback.pass ? "text-emerald-400" : "text-red-400"}>
						{readback.pass ? "pass" : "FAIL"}
					</span>{" "}
					· severity {readback.severity ?? "—"}
					{readback.issues?.length ? (
						<ul className="mt-1 list-disc space-y-1 pl-4 text-amber-300">
							{readback.issues.map((i, k) => (
								<li key={k}>{i}</li>
							))}
						</ul>
					) : null}
				</div>
			) : null}
			{history.map((h, k) => (
				<div key={k} className="mt-2 text-[11px] text-muted-foreground">
					attempt {h.attempt ?? "?"}: {h.pass ? "pass" : "rejected"}
					{h.severity ? ` · ${h.severity}` : ""}
					{h.issues?.length ? (
						<ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-300/80">
							{h.issues.map((i, j) => (
								<li key={j}>{i}</li>
							))}
						</ul>
					) : null}
				</div>
			))}
		</TraceCard>
	);
}

function FallbacksCard({ fallbacks }: { fallbacks: unknown[] }) {
	return (
		<TraceCard
			title="Fallbacks / errors (D-L)"
			right={String(fallbacks.length)}
		>
			<ul className="list-disc space-y-1 pl-4 text-xs text-amber-300">
				{fallbacks.map((f, i) => (
					<li key={i}>{typeof f === "string" ? f : formatTraceValue(f)}</li>
				))}
			</ul>
		</TraceCard>
	);
}

function BriefCard({ brief }: { brief: WriterBrief }) {
	const List = ({ arr }: { arr?: string[] }) =>
		Array.isArray(arr) && arr.length ? (
			<ul className="list-disc space-y-0.5 pl-4">
				{arr.map((x, i) => (
					<li key={i}>{x}</li>
				))}
			</ul>
		) : (
			<span className="text-muted-foreground">—</span>
		);
	const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
		<>
			<dt className="text-muted-foreground">{k}</dt>
			<dd className="text-foreground/90">{children}</dd>
		</>
	);
	return (
		<details open className="rounded-lg border border-border bg-card">
			<summary className="cursor-pointer select-none border-b border-border/60 bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				Writer brief (blind, D-C)
			</summary>
			<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 p-3 text-xs">
				{brief.goal ? <Row k="Goal">{brief.goal}</Row> : null}
				{brief.angle ? <Row k="Angle">{brief.angle}</Row> : null}
				{brief.tone ? <Row k="Tone">{brief.tone}</Row> : null}
				<Row k="Key points">
					<List arr={brief.key_points} />
				</Row>
				{brief.asserted_facts?.length ? (
					<Row k="Asserted (ledger)">
						<List arr={brief.asserted_facts} />
					</Row>
				) : null}
				{brief.cta ? <Row k="CTA">{brief.cta}</Row> : null}
			</dl>
		</details>
	);
}

export function TouchDetail({
	session,
	t,
	prev,
}: {
	session: Session;
	t: Touch;
	prev: Touch | null;
}) {
	const page = getPage(t.raw);
	const events = t.events.map(normEvent);

	return (
		<div className="flex min-w-0 flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<h2 className="text-lg font-semibold">Touch {t.idx ?? "?"}</h2>
				<Pill className={badgeClass(ACTION_CLASS, t.action)}>
					{t.action || "touch"}
				</Pill>
				<ChannelTag channel={t.channel} />
				{t.topicId ? (
					<Pill
						className="border-sky-500/30 bg-sky-500/15 text-sky-300"
						title={t.topicLabel}
					>
						{t.topicId}
					</Pill>
				) : null}
				<Pill className={badgeClass(REACTION_CLASS, t.reaction)}>
					{t.reaction || "—"}
				</Pill>
				<div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
					{t.touchesLeft != null ? (
						<span>{t.touchesLeft} touches left after this</span>
					) : null}
					<span>{fmtTs(t.ts)}</span>
				</div>
			</div>
			{t.reason ? (
				<div className="-mt-2 text-xs text-muted-foreground">
					<span className="text-muted-foreground/70">Planner:</span> {t.reason}
				</div>
			) : null}

			<div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
				<div className="flex min-w-0 flex-col gap-4">
					<MessageCard session={session} t={t} />
					{page ? <LandingPageCard page={page} /> : null}
					<EventsCard events={events} />
				</div>
				<div className="flex min-w-0 flex-col gap-4">
					<TraceCard title="Notecard — belief + suspicion">
						<SuspicionGauge
							suspicion={t.suspicion}
							prevSuspicion={prev?.suspicion ?? null}
						/>
						<div className="mb-2 mt-4 text-xs text-muted-foreground">
							Topic belief (posterior confidence)
						</div>
						<TopicPosteriors
							topics={t.topics}
							prevTopics={prev?.topics ?? null}
						/>
					</TraceCard>
					<GuardCard t={t} />
					{t.fallbacks.length ? (
						<FallbacksCard fallbacks={t.fallbacks} />
					) : null}
					{t.brief ? <BriefCard brief={t.brief} /> : null}
				</div>
			</div>
			<RawRecord rec={t.raw} />
		</div>
	);
}

export function MarkerDetail({ rec }: { rec: Record<string, unknown> }) {
	const isInc = rec.kind === "incident";
	const fields = traceFieldNames(rec.fields);
	const title =
		rec.kind === "session_start"
			? "session start"
			: rec.kind === "session_end"
				? `session end — ${rec.outcome ?? ""}`
				: rec.kind === "incident"
					? `INCIDENT — ${rec.objective ?? ""} via ${rec.via ?? "?"}`
					: rec.kind === "page_registered"
						? "landing page registered"
						: String(rec.kind ?? "event").replace(/_/g, " ");
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<h2 className={cn("text-lg font-semibold", isInc && "text-yellow-300")}>
					{title}
				</h2>
				<span className="ml-auto text-xs text-muted-foreground">
					{fmtTs(rec.ts as number)}
				</span>
			</div>
			{isInc ? (
				<TraceCard title="Incident" accent>
					<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
						<dt className="text-muted-foreground">Objective</dt>
						<dd>{String(rec.objective ?? "—")}</dd>
						<dt className="text-muted-foreground">Via</dt>
						<dd>{String(rec.via ?? "—")}</dd>
						<dt className="text-muted-foreground">At touch</dt>
						<dd>{String(rec.touch_idx ?? "—")} of session</dd>
						{fields.length ? (
							<>
								<dt className="text-muted-foreground">Fields</dt>
								<dd className="font-mono">
									{fields.join(", ")}{" "}
									<span className="text-muted-foreground/70">
										(names only — values are never returned)
									</span>
								</dd>
							</>
						) : null}
					</dl>
				</TraceCard>
			) : null}
			<RawRecord rec={rec} />
		</div>
	);
}
