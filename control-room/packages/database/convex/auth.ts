import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { createClient } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import type { GenericCtx } from "@convex-dev/better-auth/utils";
import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import {
	admin,
	bearer,
	customSession,
	haveIBeenPwned,
	jwt,
	lastLoginMethod,
	multiSession,
	oAuthProxy,
	oneTap,
	openAPI,
	organization,
	twoFactor,
} from "better-auth/plugins";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { apiKeyOptions } from "./apiKey";
import authConfig from "./auth.config";
import authSchema from "./betterAuth/schema";
import { sendTransactionalEmail } from "./email/resend";
import {
	getInvitationEmailHtml,
	getResetPasswordEmailHtml,
	getVerificationEmailHtml,
} from "./email/templates";
import { getSiteUrl } from "./siteUrl";

// Initialize the component client
export const authComponent = createClient<DataModel, typeof authSchema>(
	components.betterAuth as any,
	{
		local: {
			schema: authSchema,
		},
	},
);

const siteUrl = getSiteUrl();

export const createAuthOptions = (ctx: GenericCtx<DataModel>) => {
	return {
		appName: "revel8 Control Room",
		database: authComponent.adapter(ctx),
		secret: process.env.BETTER_AUTH_SECRET,
		baseURL: siteUrl,
		emailVerification: {
			async sendVerificationEmail({ user, url }) {
				await sendTransactionalEmail({
					to: user.email,
					subject: "Verify your email address",
					html: getVerificationEmailHtml(url),
				});
			},
		},
		account: {
			accountLinking: {
				trustedProviders: ["google", "github", "demo-app"],
			},
		},
		emailAndPassword: {
			enabled: true,
			async sendResetPassword({ user, url }) {
				await sendTransactionalEmail({
					to: user.email,
					subject: "Reset your password",
					html: getResetPasswordEmailHtml(user.email, url),
				});
			},
		},
		plugins: [
			// Register JWT first so Convex's /convex/token endpoint is not overwritten.
			jwt({
				disableSettingJwtHeader: true,
			}),
			convex({ authConfig }),
			organization({
				async sendInvitationEmail(data) {
					await sendTransactionalEmail({
						to: data.email,
						subject: "You've been invited to join an organization",
						html: getInvitationEmailHtml(
							data.email,
							data.inviter.user.name ?? data.inviter.user.email,
							data.inviter.user.email,
							data.organization.name,
							`${siteUrl}/accept-invitation/${data.id}`,
						),
					});
				},
			}),
			twoFactor({
				otpOptions: {
					async sendOTP({ user, otp }) {
						await sendTransactionalEmail({
							to: user.email,
							subject: "Your OTP",
							html: `Your OTP is ${otp}`,
						});
					},
				},
			}),
			passkey() as any,
			openAPI(),
			bearer(),
			admin({
				adminUserIds: ["EXD5zjob2SD6CBWcEQ6OpLRHcyoUbnaB"],
			}),
			multiSession(),
			oAuthProxy(),
			oauthProvider({
				loginPage: "/sign-in",
				consentPage: "/oauth/authorize",
				silenceWarnings: {
					oauthAuthServerConfig: true,
				},
			}),
			oneTap(),
			customSession(async (session: any) => {
				return {
					...session,
					user: {
						...session.user,
						dd: "test",
					},
				};
			}),
			apiKey(apiKeyOptions) as any,
			haveIBeenPwned({
				customPasswordCompromisedMessage:
					"This password has been exposed in a data breach. Please choose a different password.",
			}),
			lastLoginMethod({
				storeInDatabase: false,
			}),
		],
		trustedOrigins: [siteUrl],
	} satisfies BetterAuthOptions;
};

export const createAuth = (ctx: GenericCtx<DataModel>) => {
	return betterAuth(createAuthOptions(ctx));
};

// Expose queries and mutations for Next.js to call via fetchAuthQuery/fetchAuthMutation

export const getSession = query({
	args: {},
	handler: async (ctx) => {
		try {
			const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
			return await (auth as any).api.getSession({ headers });
		} catch {
			return null;
		}
	},
});

export const listSessions = query({
	args: {},
	handler: async (ctx) => {
		try {
			const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
			return await (auth as any).api.listSessions({ headers });
		} catch {
			return [];
		}
	},
});

export const listDeviceSessions = query({
	args: {},
	handler: async (ctx) => {
		try {
			const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
			return await (auth as any).api.listDeviceSessions({ headers });
		} catch {
			return [];
		}
	},
});

export const getFullOrganization = query({
	args: {},
	handler: async (ctx) => {
		try {
			const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
			return await (auth as any).api.getFullOrganization({ headers });
		} catch {
			return null;
		}
	},
});

export const getOAuthClient = query({
	args: { id: v.string() },
	handler: async (ctx, args) => {
		const auth = createAuth(ctx);
		return await (auth as any).api.getOAuthClient({
			params: { id: args.id },
		});
	},
});

// Client API export for AuthBoundary
export const { getAuthUser } = authComponent.clientApi();
