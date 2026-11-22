import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";
import { api } from "@x70-monorepo/database/convex/_generated/api";
import {
	fetchAction,
	fetchMutation,
	fetchQuery,
	preloadQuery,
} from "convex/nextjs";

const convexUrl =
	process.env.CONVEX_URL ||
	process.env.NEXT_PUBLIC_CONVEX_URL ||
	"http://127.0.0.1:3210";
const convexSiteUrl =
	process.env.CONVEX_SITE_URL ||
	process.env.NEXT_PUBLIC_CONVEX_SITE_URL ||
	"http://127.0.0.1:3211";

const { handler, isAuthenticated, getToken } = convexBetterAuthNextJs({
	convexUrl,
	convexSiteUrl,
});

// The helper's fetch wrappers do not forward its convexUrl option. Pass the
// service URL explicitly so Docker never uses the browser's loopback address.
const authOptions = async (options: any = {}) => ({
	...options,
	token: options.token ?? (await getToken()),
	url: convexUrl,
});

export const preloadAuthQuery = async (
	query: any,
	args: any = {},
	options: any = {},
) => preloadQuery(query, args, await authOptions(options));
export const fetchAuthQuery = async (query: any, args: any = {}, options: any = {}) =>
	fetchQuery(query, args, await authOptions(options));
export const fetchAuthMutation = async (
	mutation: any,
	args: any = {},
	options: any = {},
) => fetchMutation(mutation, args, await authOptions(options));
export const fetchAuthAction = async (
	action: any,
	args: any = {},
	options: any = {},
) => fetchAction(action, args, await authOptions(options));

export { handler, isAuthenticated, getToken };

// Compatibility wrapper for auth.api so existing server components/actions continue to work seamlessly
export const auth: any = {
	handler,
	api: {
		getSession: async (_options?: { headers?: any }) => {
			return await fetchAuthQuery(api.auth.getSession);
		},
		listSessions: async (_options?: { headers?: any }) => {
			return await fetchAuthQuery(api.auth.listSessions);
		},
		listDeviceSessions: async (_options?: { headers?: any }) => {
			return await fetchAuthQuery(api.auth.listDeviceSessions);
		},
		getFullOrganization: async (_options?: { headers?: any }) => {
			return await fetchAuthQuery(api.auth.getFullOrganization);
		},
		getOAuthClient: async (options: {
			params: { id: string };
			headers?: any;
		}) => {
			return await fetchAuthQuery(api.auth.getOAuthClient, {
				id: options.params.id,
			});
		},
	},
};
