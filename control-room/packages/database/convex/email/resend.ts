import { Resend } from "resend";

const defaultFrom = "contact@x70.one";

export function getResendClient() {
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey || apiKey === "re_123") {
		throw new Error(
			"RESEND_API_KEY is not configured on the Convex deployment.",
		);
	}
	return new Resend(apiKey);
}

export function getFromEmail(): string {
	return process.env.BETTER_AUTH_EMAIL || defaultFrom;
}

export async function sendTransactionalEmail(options: {
	to: string;
	subject: string;
	html: string;
}): Promise<void> {
	const resend = getResendClient();
	const { data, error } = await resend.emails.send({
		from: getFromEmail(),
		to: options.to,
		subject: options.subject,
		html: options.html,
	});

	if (error) {
		console.error("[email] Resend error:", error);
		throw new Error(error.message);
	}

	console.log(
		"[email] Sent",
		options.subject,
		"to",
		options.to,
		"id:",
		data?.id,
	);
}
