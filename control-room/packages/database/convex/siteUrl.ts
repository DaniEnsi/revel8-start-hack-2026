// Better Auth runs inside the Convex runtime (see `http.ts`), NOT on Vercel.
// That means `VERCEL_URL` is never available here, so the frontend origin has to
// come from a Convex environment variable instead.
//
// Set it once per deployment (value lives in Convex env, not in source):
//   npx convex env set SITE_URL https://admin.x70.one   (production)
// Local dev needs nothing — it falls back to localhost automatically.
export const getSiteUrl = (): string =>
	process.env.SITE_URL?.replace(/\/$/, "") || "http://localhost:3000";
