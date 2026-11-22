import type { Metadata } from "next/types";
import { buildOgImagePath } from "@/lib/og";

export const SITE_NAME = "revel8 Control Room";

// Prefer the stable production domain over the per-deployment VERCEL_URL hash.
const productionHost =
	process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;

export const baseUrl =
	process.env.NODE_ENV === "development" || !productionHost
		? new URL("http://localhost:3000")
		: new URL(`https://${productionHost}`);

function resolveTitle(title: Metadata["title"], fallback: string): string {
	if (typeof title === "string") return title;
	return fallback;
}

export function createMetadata(override: Metadata): Metadata {
	const currentUrl = baseUrl.toString().replace(/\/$/, "");
	const title = resolveTitle(override.title, SITE_NAME);
	const description =
		typeof override.description === "string"
			? override.description
			: "Authorized security-awareness simulation control room";
	const image = buildOgImagePath({ title, description });
	return {
		...override,
		openGraph: {
			title: override.title ?? undefined,
			description: override.description ?? undefined,
			url: currentUrl,
			images: [{ url: image, width: 1200, height: 630 }],
			siteName: SITE_NAME,
			...override.openGraph,
		},
		twitter: {
			card: "summary_large_image",
			title: override.title ?? undefined,
			description: override.description ?? undefined,
			images: [image],
			...override.twitter,
		},
	};
}
