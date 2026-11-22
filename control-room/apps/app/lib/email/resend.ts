import { Resend } from "resend";

export function getResendClient() {
	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey || apiKey === "re_123") {
		throw new Error("RESEND_API_KEY is not configured.");
	}
	return new Resend(apiKey);
}

export const resend = getResendClient();
