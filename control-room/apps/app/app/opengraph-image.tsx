import { baseUrl, SITE_NAME } from "@/lib/metadata";
import { ogContentType, ogSize, renderOgImage } from "@/lib/og";

export const alt = "x70 · Portal";
export const size = ogSize;
export const contentType = ogContentType;
export const runtime = "edge";

export default async function OpenGraphImage() {
	return renderOgImage({
		title: "x70 · Portal",
		description: "x70 Portal",
		siteName: SITE_NAME,
		domain: baseUrl.host,
	});
}
