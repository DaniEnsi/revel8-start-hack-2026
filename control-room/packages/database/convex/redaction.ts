const EXACT_SENSITIVE_KEYS = new Set([
	"values",
	"submitteddata",
	"formdata",
	"formpayload",
	"submittedpayload",
	"password",
	"passwords",
	"passwd",
	"passphrase",
	"secret",
	"secrets",
	"token",
	"tokens",
	"apikey",
	"authorization",
	"cookie",
	"cookies",
	"credential",
	"credentials",
	"otp",
	"ssn",
]);

const SENSITIVE_SUFFIXES = [
	"values",
	"password",
	"passwd",
	"passphrase",
	"secret",
	"secretkey",
	"token",
	"apikey",
	"authorization",
	"cookie",
	"credentials",
	"privatekey",
	"accesskey",
	"creditcard",
];

function normalizedKey(key: string): string {
	return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
	const normalized = normalizedKey(key);
	return (
		EXACT_SENSITIVE_KEYS.has(normalized) ||
		SENSITIVE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
	);
}

/**
 * Clone trace JSON while omitting submitted values and secret-bearing fields.
 * Event names, field names, outcomes, timings, and other metadata are retained.
 */
export function redactTraceValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redactTraceValue);
	if (!value || typeof value !== "object") return value;

	const redacted: Record<string, unknown> = {};
	for (const [key, nested] of Object.entries(value)) {
		if (isSensitiveKey(key)) continue;
		redacted[key] =
			normalizedKey(key) === "fields"
				? traceFieldNames(nested)
				: redactTraceValue(nested);
	}
	return redacted;
}

export function formatTraceValue(value: unknown, space = 0): string {
	const redacted = redactTraceValue(value);
	return JSON.stringify(redacted, null, space) ?? String(redacted);
}

/** Return only submitted field names, including from legacy name/value maps. */
export function traceFieldNames(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) {
		return value.flatMap((entry) => {
			if (typeof entry === "string") return [entry];
			if (!entry || typeof entry !== "object") return [];
			const record = entry as Record<string, unknown>;
			for (const key of ["name", "key", "id", "label"]) {
				if (typeof record[key] === "string") return [record[key]];
			}
			return [];
		});
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		if (Array.isArray(record.names)) return traceFieldNames(record.names);
		return Object.keys(record);
	}
	return [];
}
