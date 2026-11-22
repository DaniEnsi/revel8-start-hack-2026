/**
 * revel8 dashboard — trace parsing & normalisation.
 *
 * A faithful TS port of the tolerant readers in the standalone viewer
 * (dashboard/app.js). The agent's real trace drifts from the documented schema
 * (e.g. `plan.decision.*` nesting, `target` vs `target_id`, no persona/sender),
 * so every getter falls back across the known shapes. If the loop's trace
 * diverges again, reconcile HERE (getTouch / normEvent / getPage / deriveMeta).
 */

import { numOrNull } from "./format";
import { traceFieldNames } from "./redaction";
import { isTerminalTraceRecord } from "./run-status";
import type {
	NormEvent,
	Playbook,
	Row,
	Session,
	SessionMeta,
	Touch,
	TraceRecord,
} from "./types";

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec =>
	v && typeof v === "object" ? (v as Rec) : {};

export function getTouch(rec: TraceRecord): Touch {
	const plan = asRec(rec.plan);
	const decision = asRec(plan.decision);
	const notecard = asRec(rec.notecard);
	const topics = (rec.topics ?? notecard.topics ?? null) as Touch["topics"];
	const briefValue = (rec.writer_brief ??
		(rec as Rec).brief ??
		plan.writer_brief ??
		null) as Touch["brief"];
	const brief = asRec(briefValue);
	const draft = asRec(rec.draft);
	const events = Array.isArray(rec.events) ? rec.events : [];
	const planTopicId = topics
		? Object.keys(plan).find((key) => topics[key] !== undefined)
		: undefined;
	const eventChannel = events
		.map((event) => asRec(event).channel)
		.find(
			(channel): channel is string =>
				typeof channel === "string" && channel.length > 0,
		);
	const fallbackAction =
		rec.conversation || rec.turns
			? "converse"
			: brief.include_link === true
				? "strike"
				: Object.keys(brief).length || Object.keys(draft).length
					? "message"
					: "";
	return {
		idx: (rec.touch_idx ?? (rec as Rec).idx ?? null) as number | null,
		action: (plan.action ??
			decision.action ??
			(rec as Rec).objective_step ??
			(rec as Rec).action ??
			fallbackAction) as string,
		channel: (plan.channel ??
			decision.channel ??
			(rec as Rec).channel ??
			eventChannel ??
			"") as string,
		topicId: (plan.topic_id ??
			decision.topic_id ??
			(rec as Rec).topic_id ??
			planTopicId ??
			"") as string,
		topicLabel: (plan.topic_label ??
			(rec as Rec).topic_label ??
			brief.topic ??
			"") as string,
		reason: (plan.reason ?? decision.reason ?? "") as string,
		sender: (plan.sender ??
			(rec as Rec).sender ??
			(rec as Rec).persona ??
			null) as Touch["sender"],
		suspicion: numOrNull(rec.suspicion ?? notecard.suspicion),
		touchesLeft: (rec.touches_left ?? null) as number | null,
		topics,
		brief: briefValue,
		draft,
		guard: (rec.guard ?? null) as Touch["guard"],
		events,
		reaction: (rec.reaction ?? (rec as Rec).engagement ?? "") as string,
		fallbacks: Array.isArray(rec.fallbacks) ? (rec.fallbacks as unknown[]) : [],
		objective: (rec.objective ?? "") as string,
		target: ((rec as Rec).target_id ?? (rec as Rec).target ?? "") as string,
		ts: (rec.ts ?? null) as number | null,
		raw: rec,
	};
}

export function normEvent(e: unknown): NormEvent {
	if (typeof e === "string") {
		return {
			type: e,
			text: "",
			url: "",
			fields: null,
			file: "",
			channel: "",
			raw: e,
		};
	}
	if (!e || typeof e !== "object") {
		return {
			type: "unknown",
			text: "",
			url: "",
			fields: null,
			file: "",
			channel: "",
			raw: e,
		};
	}
	const o = e as Rec;
	return {
		type: (o.type ?? o.event ?? o.kind ?? "unknown") as string,
		text: (o.text ?? o.reply ?? o.body ?? "") as string,
		url: (o.url ?? o.link ?? "") as string,
		fields: o.fields == null ? null : traceFieldNames(o.fields),
		file: (o.file ?? o.filename ?? o.attachment ?? "") as string,
		channel: (o.channel ?? "") as string,
		raw: e,
	};
}

export function getPage(rec: TraceRecord): Touch["draft"]["page"] | null {
	const d = asRec(rec.draft);
	const p = d.page ?? (rec as Rec).page ?? (rec as Rec).landing_page ?? null;
	if (p && typeof p === "object") return p as any;
	if (typeof d.html === "string" && d.html.length > 50) {
		return {
			url: (d.page_url ?? (rec as Rec).planned_url ?? "") as string,
			title: (d.page_title ?? "") as string,
			html: d.html,
			fields: (d.fields ?? []) as string[],
		} as any;
	}
	return null;
}

export function senderOf(session: Session, t: Touch) {
	return t.sender || session.meta.persona || null;
}

/* ------------------------------------------------------------- parsing */

export interface ParsedTrace {
	records?: TraceRecord[];
	playbook?: Playbook;
}

export function parseTraceText(text: string): ParsedTrace | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	// 1) whole-document JSON (array, {records}/{touches}, playbook, or single record)
	try {
		const obj = JSON.parse(trimmed);
		if (Array.isArray(obj)) return { records: obj };
		if (obj && typeof obj === "object") {
			if (Array.isArray(obj.records)) return { records: obj.records };
			if (Array.isArray(obj.touches)) return { records: obj.touches };
			if (obj.per_target !== undefined || obj.playbook !== undefined)
				return { playbook: obj as Playbook };
			return { records: [obj] };
		}
		return null;
	} catch {
		/* not a single JSON document — try JSONL */
	}
	// 2) JSONL: one record per line (the trace.py format)
	const records: TraceRecord[] = [];
	const lines = trimmed.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i].trim();
		if (!l) continue;
		try {
			records.push(JSON.parse(l));
		} catch (err) {
			throw new Error(`line ${i + 1}: ${(err as Error).message}`);
		}
	}
	if (!records.length) return null;
	return { records };
}

export function buildSession(name: string, records: TraceRecord[]): Session {
	const rows: Row[] = [];
	const touches: Touch[] = [];
	for (const rec of records) {
		const kind =
			rec.kind ??
			(rec.touch_idx != null || (rec as Rec).draft ? "touch" : "marker");
		if (kind === "touch") {
			const t = getTouch(rec);
			touches.push(t);
			rows.push({ type: "touch", rec, t });
		} else {
			rows.push({ type: "marker", rec, kind: String(kind) });
		}
	}
	const id = name.replace(/\.(jsonl|json)$/i, "");
	const session: Session = { id, name, rows, touches, meta: {} as SessionMeta };
	session.meta = deriveMeta(session, records);
	return session;
}

export function deriveMeta(
	session: Session,
	records: TraceRecord[],
): SessionMeta {
	const first = (k: string) => records.find((r) => r.kind === k) || null;
	const start = first("session_start") as Rec | null;
	const end = first("session_end") as Rec | null;
	const terminal = (records.find(
		(record) =>
			record.kind === "session_end" || record.kind === "session_ended",
	) ?? records.find(isTerminalTraceRecord)) as Rec | undefined;
	const flowTerminal = records.find(
		(record) =>
			record.kind === "flow_failed" ||
			record.kind === "stopped" ||
			record.kind === "flow_completed",
	) as Rec | undefined;
	const incident = first("incident") as Rec | null;
	const touches = session.touches;
	const last = (touches[touches.length - 1] || {}) as Partial<Touch>;
	const incTouch = touches.find((t) => t.reaction === "incident") || null;

	const budget =
		(start?.budget as number) ??
		(Math.max(0, ...touches.map((t) => (t.idx ?? 0) + (t.touchesLeft ?? 0))) ||
			null);
	const channels = [...new Set(touches.map((t) => t.channel).filter(Boolean))];
	const endOutcome = typeof end?.outcome === "string" ? end.outcome.trim() : "";
	const hasActiveEndOutcome = ["in progress", "running"].includes(
		endOutcome.toLocaleLowerCase(),
	);
	const outcome =
		endOutcome && !hasActiveEndOutcome
			? endOutcome
			: incident || incTouch
				? "incident"
				: flowTerminal?.kind === "flow_failed"
					? "failed"
					: flowTerminal?.kind === "stopped"
						? "stopped"
						: flowTerminal?.kind === "flow_completed"
							? "completed"
							: terminal
								? "ended"
								: "in progress";

	return {
		target: (start?.target_id ?? start?.target ?? last.target ?? "") as string,
		targetName: (start?.target_name ?? "") as string,
		scenario: (start?.scenario_id ?? start?.scenario ?? "") as string,
		arms: (start?.arms ?? null) as Record<string, string> | null,
		objective: (start?.objective ?? last.objective ?? "") as string,
		budget: budget as number | null,
		outcome,
		incidentTouch: (incident?.touch_idx ?? incTouch?.idx ?? null) as
			| number
			| null,
		incidentVia: (incident?.via ?? null) as string | null,
		touchesUsed: (end?.touches_used ?? touches.length) as number,
		finalSuspicion: numOrNull(end?.final_suspicion ?? last.suspicion),
		channels,
		persona: (start?.persona ?? null) as SessionMeta["persona"],
		startTs: (start?.ts ?? touches[0]?.ts ?? null) as number | null,
		endTs: (end?.ts ?? terminal?.ts ?? last.ts ?? null) as number | null,
		endReason: (end?.reason ?? terminal?.error ?? "") as string,
	};
}

export function looksLikePlaybook(name: string, obj: unknown): boolean {
	return (
		!!obj &&
		typeof obj === "object" &&
		!Array.isArray(obj) &&
		((obj as Rec).per_target !== undefined || /playbook/i.test(name))
	);
}

/* ------------------------------------------------------------- markers */

export function markerTitle(rec: TraceRecord): string {
	switch (rec.kind) {
		case "session_start":
			return "session start";
		case "session_end":
			return `session end — ${(rec as Rec).outcome ?? ""}`;
		case "incident":
			return `INCIDENT — ${(rec as Rec).objective ?? ""} via ${(rec as Rec).via ?? "?"}`;
		case "page_registered":
			return "landing page registered";
		default:
			return String(rec.kind ?? "event").replace(/_/g, " ");
	}
}

export function markerSub(rec: TraceRecord): string {
	const r = rec as Rec;
	switch (rec.kind) {
		case "session_start":
			return `${r.target_id ?? r.target ?? ""} · budget ${r.budget ?? "?"}`;
		case "session_end":
			return `${r.touches_used ?? "?"} touches used`;
		case "incident":
			return `touch ${r.touch_idx ?? "?"}`;
		case "page_registered":
			return (r.url ?? "") as string;
		default:
			return "";
	}
}
