import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { redactTraceValue, traceFieldNames } from "./redaction";

export type RunStatus = Doc<"runs">["status"];
export type TraceDetail = Record<string, unknown>;

export interface TraceIngestRecord {
	ordinal: number;
	detail: unknown;
}

export interface TraceIngestArgs {
	sessionId: string;
	records: TraceIngestRecord[];
	status?: RunStatus;
	plannerModel?: string;
	writerModel?: string;
}

const RUN_STATUSES = new Set<RunStatus>([
	"unknown",
	"running",
	"stopped",
	"completed",
	"failed",
]);
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;

function asRecord(value: unknown): TraceDetail {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as TraceDetail)
		: {};
}

function stringValue(...values: unknown[]): string {
	return (
		values.find((value): value is string => typeof value === "string") ?? ""
	);
}

function numberValue(...values: unknown[]): number | undefined {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
	}
	return undefined;
}

function sanitizedRecord(input: TraceIngestRecord, sessionId: string) {
	if (!Number.isInteger(input.ordinal) || input.ordinal < 0) {
		throw new Error("trace ordinal must be a non-negative integer");
	}
	if (
		!input.detail ||
		typeof input.detail !== "object" ||
		Array.isArray(input.detail)
	) {
		throw new Error(`trace record ${input.ordinal} must be an object`);
	}
	const detail = redactTraceValue(input.detail) as TraceDetail;
	const kind = stringValue(
		detail.kind,
		detail.touch_idx !== undefined || detail.draft !== undefined
			? "touch"
			: "marker",
	);
	return {
		sessionId,
		ordinal: input.ordinal,
		sourceKey: `${sessionId}:${input.ordinal}`,
		kind,
		ts: numberValue(detail.ts),
		touchIdx: numberValue(detail.touch_idx, detail.idx),
		detail,
	};
}

function touchSummary(detail: TraceDetail) {
	const plan = asRecord(detail.plan);
	const decision = asRecord(plan.decision);
	const notecard = asRecord(detail.notecard);
	const events = Array.isArray(detail.events) ? detail.events : [];
	const eventChannel = events
		.map((event) => asRecord(event).channel)
		.find((channel): channel is string => typeof channel === "string");
	return {
		idx: numberValue(detail.touch_idx, detail.idx),
		action: stringValue(
			plan.action,
			decision.action,
			detail.objective_step,
			detail.action,
		),
		channel: stringValue(
			plan.channel,
			decision.channel,
			detail.channel,
			eventChannel,
		),
		reaction: stringValue(detail.reaction, detail.engagement),
		suspicion: numberValue(detail.suspicion, notecard.suspicion),
		ts: numberValue(detail.ts),
		target: stringValue(detail.target_id, detail.target),
		objective: stringValue(detail.objective),
	};
}

function deriveRunSummary(
	sessionId: string,
	records: Array<{ detail: TraceDetail }>,
	previous: Doc<"runs"> | null,
	statusOverride: RunStatus | undefined,
	now: number,
) {
	const details = records.map((record) => record.detail);
	const first = (kind: string) =>
		details.find((detail) => detail.kind === kind);
	const start = first("session_start");
	const end = first("session_end");
	const flowEnd = details.find((detail) =>
		["flow_completed", "flow_failed", "stopped"].includes(
			stringValue(detail.kind),
		),
	);
	const terminal = end ?? first("session_ended") ?? flowEnd;
	const incident = first("incident");
	const touchRecords = details.filter(
		(detail) =>
			detail.kind === "touch" ||
			(detail.kind === undefined &&
				(detail.touch_idx !== undefined || detail.draft !== undefined)),
	);
	const touches = touchRecords.map(touchSummary);
	const last = touches[touches.length - 1];
	const incidentTouch = touches.find((touch) => touch.reaction === "incident");
	const channels = [
		...new Set(touches.map((touch) => touch.channel).filter(Boolean)),
	];
	const calculatedBudget = Math.max(
		0,
		...touchRecords.map((detail, index) => {
			const idx = numberValue(detail.touch_idx, detail.idx) ?? index;
			const left = numberValue(detail.touches_left) ?? 0;
			return idx + left;
		}),
	);
	const eventIncident = details.some(
		(detail) =>
			Array.isArray(detail.events) &&
			detail.events.some((event) => {
				const value = asRecord(event);
				return [value.outcome, value.reaction, value.status].includes(
					"incident",
				);
			}),
	);
	const status: RunStatus =
		statusOverride ?? (end ? "completed" : (previous?.status ?? "unknown"));
	const terminalStatus =
		status === "stopped" || status === "failed" || status === "completed"
			? status
			: undefined;
	const endOutcome = stringValue(end?.outcome).trim();
	const traceOutcome =
		endOutcome && !["in progress", "running"].includes(endOutcome.toLowerCase())
			? endOutcome
			: flowEnd?.kind === "flow_completed"
				? "completed"
				: flowEnd?.kind === "flow_failed"
					? "failed"
					: flowEnd?.kind === "stopped"
						? "stopped"
						: terminal
							? "ended"
							: undefined;
	const outcome =
		incident ||
		incidentTouch ||
		eventIncident ||
		previous?.outcome === "incident"
			? "incident"
			: (traceOutcome ?? terminalStatus ?? previous?.outcome ?? "in progress");
	const endTs =
		!terminal && terminalStatus && outcome === terminalStatus
			? ((previous?.status === status && previous.outcome === outcome
					? previous.endTs
					: undefined) ?? now / 1000)
			: numberValue(terminal?.ts, last?.ts, previous?.endTs);
	return {
		sessionId,
		flowRunId: previous?.flowRunId,
		scenario: "practice" as const,
		status,
		target: stringValue(
			start?.target_id,
			start?.target,
			last?.target,
			previous?.target,
		),
		targetName: stringValue(start?.target_name, previous?.targetName),
		arms: start?.arms ?? previous?.arms,
		objective: stringValue(
			start?.objective,
			last?.objective,
			previous?.objective,
		),
		budget:
			numberValue(start?.budget) ?? (calculatedBudget || previous?.budget),
		outcome,
		incidentTouch: numberValue(
			incident?.touch_idx,
			incidentTouch?.idx,
			previous?.incidentTouch,
		),
		incidentVia: stringValue(incident?.via, previous?.incidentVia) || undefined,
		touchesUsed:
			numberValue(end?.touches_used) ??
			(touches.length || previous?.touchesUsed || 0),
		finalSuspicion: numberValue(
			end?.final_suspicion,
			last?.suspicion,
			previous?.finalSuspicion,
		),
		channels: channels.length ? channels : (previous?.channels ?? []),
		persona: start?.persona ?? previous?.persona,
		startTs: numberValue(start?.ts, touches[0]?.ts, previous?.startTs),
		endTs,
		endReason: stringValue(end?.reason, previous?.endReason),
		recordCount: records.length,
	};
}

/** Atomic, idempotent JSONL reconciliation. Every detail is redacted again here. */
export async function ingestTraceRecords(
	ctx: MutationCtx,
	args: TraceIngestArgs,
) {
	if (!SESSION_ID_RE.test(args.sessionId))
		throw new Error("invalid session id");
	if (args.records.length > 200)
		throw new Error("trace batch exceeds 200 records");
	if (args.status && !RUN_STATUSES.has(args.status)) {
		throw new Error("invalid run status");
	}
	const existingRun = await ctx.db
		.query("runs")
		.withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
		.unique();
	if (!existingRun && !args.records.length) {
		throw new Error("cannot initialize a run without trace records");
	}
	const inputs = [...args.records].sort((a, b) => a.ordinal - b.ordinal);
	const sanitized = inputs.map((record) =>
		sanitizedRecord(record, args.sessionId),
	);
	let inserted = 0;
	let unchanged = 0;
	for (const record of sanitized) {
		const existing = await ctx.db
			.query("traceRecords")
			.withIndex("by_sourceKey", (q) => q.eq("sourceKey", record.sourceKey))
			.unique();
		if (existing) {
			if (JSON.stringify(existing.detail) !== JSON.stringify(record.detail)) {
				throw new Error(`trace record conflict at ordinal ${record.ordinal}`);
			}
			unchanged += 1;
			continue;
		}
		const now = Date.now();
		await ctx.db.insert("traceRecords", { ...record, createdAt: now });
		if (record.kind === "touch") {
			const summary = touchSummary(record.detail);
			await ctx.db.insert("touches", {
				sessionId: args.sessionId,
				recordKey: record.sourceKey,
				idx: summary.idx,
				action: summary.action,
				channel: summary.channel,
				reaction: summary.reaction,
				suspicion: summary.suspicion,
				ts: summary.ts,
				detail: record.detail,
				createdAt: now,
			});
		}
		const events = Array.isArray(record.detail.events)
			? record.detail.events
			: [];
		for (const [index, rawEvent] of events.entries()) {
			const event = redactTraceValue(rawEvent) as TraceDetail;
			await ctx.db.insert("eventOutcomes", {
				sessionId: args.sessionId,
				recordKey: record.sourceKey,
				eventKey: `${record.sourceKey}:event:${index}`,
				type: stringValue(event.type, event.event, event.kind, "unknown"),
				channel: stringValue(event.channel),
				outcome: stringValue(
					event.outcome,
					event.reaction,
					event.status,
					record.detail.reaction,
				),
				fields: traceFieldNames(event.fields),
				ts: numberValue(event.ts, event.sent_at, record.ts),
				detail: event,
				createdAt: now,
			});
		}
		inserted += 1;
	}
	if (!inserted && !args.status && !args.plannerModel && !args.writerModel) {
		return { inserted, unchanged, updated: 0 };
	}
	const stored = await ctx.db
		.query("traceRecords")
		.withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
		.collect();
	stored.sort((a, b) => a.ordinal - b.ordinal);
	const now = Date.now();
	const summary = deriveRunSummary(
		args.sessionId,
		stored,
		existingRun,
		args.status,
		now,
	);
	const patch = {
		...summary,
		plannerModel: args.plannerModel ?? existingRun?.plannerModel,
		writerModel: args.writerModel ?? existingRun?.writerModel,
		updatedAt: now,
	};
	if (existingRun) {
		await ctx.db.patch(existingRun._id, patch);
	} else {
		await ctx.db.insert("runs", { ...patch, createdAt: now });
	}
	return { inserted, unchanged, updated: 1 };
}

export function mapTraceRecords(
	records: Array<{ ordinal: number; detail: unknown }>,
): unknown[] {
	return [...records]
		.sort((a, b) => a.ordinal - b.ordinal)
		.map((record) => record.detail);
}
