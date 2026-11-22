import { baseUrl, SITE_NAME } from "@/lib/metadata";
import { renderOgImage } from "@/lib/og";

export const runtime = "edge";

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const title = searchParams.get("title") ?? `x70 · ${SITE_NAME}`;
	const description = searchParams.get("description") ?? "x70 Portal";

	return renderOgImage({
		title,
		description,
		siteName: SITE_NAME,
		domain: baseUrl.host,
	});
}
