export const FLOW_SCHEMA_VERSION = 1 as const;
export const PRACTICE_TARGETS = ["julius", "robert", "tom"] as const;
export type PracticeTarget = (typeof PRACTICE_TARGETS)[number];

export interface FlowStepDefinition {
	id: string;
	channel: "email" | "sms" | "phone_call";
	action: "message" | "conversation" | "debrief";
	delay_seconds: number;
	content: Record<string, string>;
	next?: string;
	wait_seconds?: number;
	on_reply?: string;
	on_timeout?: string;
}

export interface OrderedFlowDefinition {
	version: typeof FLOW_SCHEMA_VERSION;
	flow_id: string;
	scenario: "practice";
	target_id: PracticeTarget;
	sender: { name: string; address: string };
	story_start: string;
	start: string;
	steps: [
		FlowStepDefinition,
		FlowStepDefinition,
		FlowStepDefinition,
		FlowStepDefinition,
	];
}

export type FlowValidationResult =
	| { success: true; definition: OrderedFlowDefinition }
	| { success: false; issues: string[] };

type Rec = Record<string, unknown>;
const ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const HTML_RE = /<[^>]*>/;
const URI_RE = /\b[a-z][a-z0-9+.-]*:\/\/|\bwww\./i;
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/i;
const SENSITIVE_RE =
	/\b(?:passwords?|passcodes?|credentials?|pins?|otps?|one[- ]time codes?|verification codes?|tokens?|api[- ]keys?|secrets?|ibans?|card numbers?|social security numbers?|private keys?|recovery codes?)\b/i;
const INJECTION_RES = [
	/ignore (?:your|all|previous|prior) (?:instructions|guidelines|rules)/i,
	/disregard (?:your|all|any) (?:instructions|training|guidelines)/i,
	/system prompt/i,
	/you are (?:an?|the) (?:ai|language model|assistant|simulation)/i,
	/as an ai (?:language )?model/i,
	/\bsimulation note\b/i,
	/\bthis is a simulation\b/i,
	/\beval(?:uation)? scenario\b/i,
	/\bjailbreak\b/i,
	/\bdo anything now\b/i,
	/act as if you (?:have no|don'?t have) (?:rules|restrictions|guidelines)/i,
];
const ROOT_KEYS = new Set([
	"version",
	"flow_id",
	"scenario",
	"target_id",
	"sender",
	"story_start",
	"start",
	"steps",
]);
const STEP_KEYS = new Set([
	"id",
	"channel",
	"action",
	"delay_seconds",
	"content",
	"next",
	"wait_seconds",
	"on_reply",
	"on_timeout",
]);
const EXPECTED_STEPS = [
	{ channel: "email", action: "message", content: ["subject", "body"] },
	{ channel: "sms", action: "message", content: ["body"] },
	{ channel: "phone_call", action: "conversation", content: ["say"] },
	{ channel: "email", action: "debrief", content: ["subject", "body"] },
] as const;

function asRecord(value: unknown): Rec | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Rec)
		: null;
}

function validNumber(
	value: unknown,
	minimum: number,
	maximum: number,
): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= minimum &&
		value <= maximum
	);
}

function normalizeStoryTime(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const match = value
		.trim()
		.match(
			/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
		);
	if (!match || Number.isNaN(Date.parse(value))) return null;
	return `${match[1]}T${match[2]}${match[3] === "Z" ? "+00:00" : match[3]}`;
}

function contentIssues(
	step: FlowStepDefinition,
	expected: (typeof EXPECTED_STEPS)[number],
): string[] {
	const issues: string[] = [];
	const keys = Object.keys(step.content);
	if (
		keys.length !== expected.content.length ||
		!expected.content.every((key) => keys.includes(key))
	) {
		issues.push(`content keys must be exactly ${expected.content.join(", ")}`);
	}
	const textParts: string[] = [];
	for (const key of expected.content) {
		const value = step.content[key];
		if (typeof value !== "string" || !value.trim()) {
			issues.push(`content.${key} must be a non-empty string`);
			continue;
		}
		const limit = key === "subject" ? 200 : 4000;
		if (value.length > limit) issues.push(`content.${key} exceeds ${limit}`);
		if (CONTROL_RE.test(value)) issues.push(`content.${key} has controls`);
		textParts.push(value);
	}
	const text = textParts.join("\n");
	if (HTML_RE.test(text)) issues.push("HTML/markup is disabled");
	if (URI_RE.test(text) || DOMAIN_RE.test(text)) {
		issues.push("links, domains, and asset references are disabled");
	}
	if (SENSITIVE_RE.test(text)) issues.push("sensitive requests are disabled");
	if (INJECTION_RES.some((pattern) => pattern.test(text))) {
		issues.push("injection/sim-breaking language is disabled");
	}
	if (
		step.action === "debrief" &&
		(!text.toLowerCase().includes("debrief") ||
			!text.toLowerCase().includes("practice simulation"))
	) {
		issues.push("terminal email must be an explicit practice simulation debrief");
	}
	return issues;
}

/** Validate the UI's deliberately small, linear subset of agent.flow v1. */
export function validateOrderedFlowDefinition(
	value: unknown,
): FlowValidationResult {
	const issues: string[] = [];
	const root = asRecord(value);
	if (!root) return { success: false, issues: ["definition must be an object"] };
	for (const key of Object.keys(root)) {
		if (!ROOT_KEYS.has(key)) issues.push(`unknown root key: ${key}`);
	}
	if (root.version !== FLOW_SCHEMA_VERSION) issues.push("version must be 1");
	if (root.scenario !== "practice") issues.push("scenario must be practice");
	if (typeof root.flow_id !== "string" || !ID_RE.test(root.flow_id)) {
		issues.push("flow_id is invalid");
	}
	if (!PRACTICE_TARGETS.includes(root.target_id as PracticeTarget)) {
		issues.push("target_id is outside the practice allowlist");
	}
	const storyStart = normalizeStoryTime(root.story_start);
	if (!storyStart) issues.push("story_start must be timezone-aware ISO 8601");
	const senderValue = asRecord(root.sender);
	const senderKeys = senderValue ? Object.keys(senderValue).sort() : [];
	if (
		!senderValue ||
		senderKeys.join(",") !== "address,name" ||
		(["name", "address"] as const).some((key) => {
			const item = senderValue[key];
			return (
				typeof item !== "string" ||
				!item.trim() ||
				item.length > 200 ||
				/[\r\n]/.test(item) ||
				CONTROL_RE.test(item)
			);
		})
	) {
		issues.push("sender requires short single-line name and address");
	}
	if (!Array.isArray(root.steps) || root.steps.length !== 4) {
		issues.push("ordered editor requires exactly four steps");
		return { success: false, issues };
	}

	const steps: FlowStepDefinition[] = [];
	const ids = new Set<string>();
	root.steps.forEach((raw, index) => {
		const expected = EXPECTED_STEPS[index];
		const record = asRecord(raw);
		if (!record) {
			issues.push(`steps[${index}] must be an object`);
			return;
		}
		for (const key of Object.keys(record)) {
			if (!STEP_KEYS.has(key)) issues.push(`steps[${index}] has unknown ${key}`);
		}
		const id = typeof record.id === "string" ? record.id : "";
		if (!ID_RE.test(id) || ids.has(id)) issues.push(`steps[${index}].id is invalid`);
		ids.add(id);
		const content = asRecord(record.content) ?? {};
		const step: FlowStepDefinition = {
			id,
			channel: record.channel as FlowStepDefinition["channel"],
			action: record.action as FlowStepDefinition["action"],
			delay_seconds: record.delay_seconds as number,
			content: content as Record<string, string>,
		};
		if (record.next !== undefined) step.next = record.next as string;
		if (record.wait_seconds !== undefined)
			step.wait_seconds = record.wait_seconds as number;
		if (record.on_reply !== undefined) step.on_reply = record.on_reply as string;
		if (record.on_timeout !== undefined)
			step.on_timeout = record.on_timeout as string;
		if (step.channel !== expected.channel || step.action !== expected.action) {
			issues.push(
				`steps[${index}] must be ${expected.channel}/${expected.action}`,
			);
		}
		if (!validNumber(step.delay_seconds, 0, 604800)) {
			issues.push(`steps[${index}].delay_seconds is outside 0..604800`);
		}
		for (const issue of contentIssues(step, expected)) {
			issues.push(`steps[${index}]: ${issue}`);
		}
		steps.push(step);
	});
	if (steps.length !== 4) return { success: false, issues };
	const tuple = steps as OrderedFlowDefinition["steps"];
	if (root.start !== tuple[0].id) issues.push("start must name the first step");
	for (let index = 0; index < 3; index += 1) {
		const step = tuple[index];
		const nextId = tuple[index + 1].id;
		if (step.wait_seconds !== undefined) {
			if (!validNumber(step.wait_seconds, 0.001, 86400)) {
				issues.push(`steps[${index}].wait_seconds is outside 0.001..86400`);
			}
			if (
				step.next !== undefined ||
				step.on_reply !== nextId ||
				step.on_timeout !== nextId
			) {
				issues.push(`steps[${index}] wait branches must both target the next step`);
			}
		} else if (
			step.next !== nextId ||
			step.on_reply !== undefined ||
			step.on_timeout !== undefined
		) {
			issues.push(`steps[${index}] must link only to the next step`);
		}
	}
	const debrief = tuple[3];
	if (
		debrief.next !== undefined ||
		debrief.wait_seconds !== undefined ||
		debrief.on_reply !== undefined ||
		debrief.on_timeout !== undefined
	) {
		issues.push("terminal debrief cannot have outgoing transitions");
	}
	if (issues.length) return { success: false, issues };
	return {
		success: true,
		definition: {
			version: FLOW_SCHEMA_VERSION,
			flow_id: root.flow_id as string,
			scenario: "practice",
			target_id: root.target_id as PracticeTarget,
			sender: {
				name: (senderValue?.name as string).trim(),
				address: (senderValue?.address as string).trim(),
			},
			story_start: storyStart as string,
			start: root.start as string,
			steps: tuple,
		},
	};
}

export function assertOrderedFlowDefinition(value: unknown): OrderedFlowDefinition {
	const result = validateOrderedFlowDefinition(value);
	if (!result.success) throw new Error(result.issues.join("; "));
	return result.definition;
}

/** Python-compatible canonical JSON for FlowDefinition.digest(). */
export function canonicalFlowJson(definition: OrderedFlowDefinition): string {
	const serialize = (value: unknown, key = ""): string => {
		if (value === null) return "null";
		if (typeof value === "string" || typeof value === "boolean")
			return JSON.stringify(value);
		if (typeof value === "number") {
			if (
				(key === "delay_seconds" || key === "wait_seconds") &&
				Number.isInteger(value)
			) {
				return `${value}.0`;
			}
			return JSON.stringify(value);
		}
		if (Array.isArray(value))
			return `[${value.map((item) => serialize(item)).join(",")}]`;
		const record = value as Rec;
		return `{${Object.keys(record)
			.filter((name) => record[name] !== undefined)
			.sort()
			.map(
				(name) => `${JSON.stringify(name)}:${serialize(record[name], name)}`,
			)
			.join(",")}}`;
	};
	return serialize(definition);
}

export async function flowDefinitionDigest(
	definition: OrderedFlowDefinition,
): Promise<string> {
	const bytes = new TextEncoder().encode(canonicalFlowJson(definition));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function createDefaultFlowDefinition(
	targetId: PracticeTarget = "julius",
): OrderedFlowDefinition {
	return assertOrderedFlowDefinition({
		version: FLOW_SCHEMA_VERSION,
		flow_id: "practice-channel-sequence-v1",
		scenario: "practice",
		target_id: targetId,
		sender: { name: "Practice Coordinator", address: "practice-coordinator" },
		story_start: "2026-11-23T09:00:00+01:00",
		start: "opening_email",
		steps: [
			{
				id: "opening_email",
				channel: "email",
				action: "message",
				delay_seconds: 0,
				content: {
					subject: "Scheduled practice exercise",
					body: "Hello. This is the opening message for your scheduled practice exercise. Please reply when you are ready for the next practice step.",
				},
				wait_seconds: 5,
				on_reply: "sms_followup",
				on_timeout: "sms_followup",
			},
			{
				id: "sms_followup",
				channel: "sms",
				action: "message",
				delay_seconds: 10,
				content: {
					body: "This is the scheduled practice follow-up. The next step is a short text-only practice call.",
				},
				wait_seconds: 5,
				on_reply: "practice_call",
				on_timeout: "practice_call",
			},
			{
				id: "practice_call",
				channel: "phone_call",
				action: "conversation",
				delay_seconds: 10,
				content: {
					say: "Thank you for joining the scheduled practice call. This completes the conversation portion of the exercise.",
				},
				next: "terminal_debrief",
			},
			{
				id: "terminal_debrief",
				channel: "email",
				action: "debrief",
				delay_seconds: 10,
				content: {
					subject: "Practice simulation debrief",
					body: "Practice simulation debrief: the ordered exercise is complete. This was an authorized rehearsal, and no further action is required.",
				},
			},
		],
	});
}
