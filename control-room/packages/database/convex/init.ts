"use node";

import { action } from "./_generated/server";
import { createAuth } from "./auth";

export const seedUser = action({
	args: {},
	handler: async (ctx) => {
		const email = process.env.ADMIN_EMAIL;
		const password = process.env.ADMIN_PASSWORD;
		const name = process.env.ADMIN_NAME || "revel8 Admin";
		if (!email || !password) {
			console.log("ADMIN_EMAIL/ADMIN_PASSWORD not set; skipping admin seed.");
			return;
		}
		console.log(`Seeding default admin user (${email})...`);
		try {
			const auth = createAuth(ctx as any);
			await auth.api.signUpEmail({
				body: {
					email,
					password,
					name,
				},
			});
			console.log(`Admin user ${email} created successfully!`);
		} catch (error: any) {
			const errMsg = (error?.message || String(error)).toLowerCase();
			if (
				errMsg.includes("already exists") ||
				errMsg.includes("duplicate") ||
				error?.code === "USER_ALREADY_EXISTS"
			) {
				console.log(`Admin user ${email} already exists.`);
			} else {
				console.error("Failed to seed admin user:", error);
			}
		}
	},
});
