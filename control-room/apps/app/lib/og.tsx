import { ImageResponse } from "next/og";
import type { ReactElement } from "react";
import { brandAssets } from "@/lib/brand-assets";

export const ogSize = { width: 1200, height: 630 } as const;
export const ogContentType = "image/png";

export interface OgImageParams {
	title: string;
	description: string;
	siteName: string;
	domain: string;
	footer?: string;
}

function headlineFromTitle(title: string, siteName: string): string {
	if (title.startsWith("x70 · ")) {
		return title.slice("x70 · ".length).trim() || title;
	}
	const suffixes = [` · ${siteName}`, ` · x70 ${siteName}`, " · x70"];
	for (const suffix of suffixes) {
		if (title.endsWith(suffix)) {
			return title.slice(0, -suffix.length).trim() || title;
		}
	}
	return title;
}

/**
 * Drafting grid via positioned divs (reliable in ImageResponse).
 * Larger mesh, thicker strokes; line segments stop short of junction crosses.
 */
function OgConstructionGrid(): ReactElement {
	const width = 1200;
	const height = 630;
	const step = 56;
	const stroke = 2;
	const cross = 8;
	const gap = 11;
	const lineColor = "#242424";
	const crossColor = "#363636";

	const marks: ReactElement[] = [];
	let key = 0;

	for (let x = 0; x <= width; x += step) {
		for (let y = 0; y <= height; y += step) {
			marks.push(
				<div
					key={`ch-${key++}`}
					style={{
						background: crossColor,
						height: stroke,
						left: x - cross,
						position: "absolute",
						top: y - stroke / 2,
						width: cross * 2,
					}}
				/>,
				<div
					key={`cv-${key++}`}
					style={{
						background: crossColor,
						height: cross * 2,
						left: x - stroke / 2,
						position: "absolute",
						top: y - cross,
						width: stroke,
					}}
				/>,
			);
		}
	}

	for (let y = 0; y <= height; y += step) {
		for (let x = 0; x < width; x += step) {
			const left = x + cross + gap;
			const seg = step - (cross + gap) * 2;
			if (seg <= 0) {
				continue;
			}
			marks.push(
				<div
					key={`lh-${key++}`}
					style={{
						background: lineColor,
						height: stroke,
						left,
						position: "absolute",
						top: y - stroke / 2,
						width: seg,
					}}
				/>,
			);
		}
	}

	for (let x = 0; x <= width; x += step) {
		for (let y = 0; y < height; y += step) {
			const top = y + cross + gap;
			const seg = step - (cross + gap) * 2;
			if (seg <= 0) {
				continue;
			}
			marks.push(
				<div
					key={`lv-${key++}`}
					style={{
						background: lineColor,
						height: seg,
						left: x - stroke / 2,
						position: "absolute",
						top,
						width: stroke,
					}}
				/>,
			);
		}
	}

	return (
		<div
			style={{
				background: "#0a0a0a",
				display: "flex",
				height: "100%",
				left: 0,
				overflow: "hidden",
				position: "absolute",
				top: 0,
				width: "100%",
			}}
		>
			{marks}
		</div>
	);
}

export function renderOgImage({
	title,
	description,
	siteName,
	domain,
	footer,
}: OgImageParams): ImageResponse {
	const headline = headlineFromTitle(title, siteName);
	const logoSrc = brandAssets.company.headerForDarkBg;

	return new ImageResponse(
		<div
			style={{
				display: "flex",
				height: "100%",
				position: "relative",
				width: "100%",
			}}
		>
			<OgConstructionGrid />
			<div
				style={{
					alignItems: "stretch",
					color: "#fafafa",
					display: "flex",
					flexDirection: "column",
					fontFamily: "ui-sans-serif, system-ui, sans-serif",
					height: "100%",
					justifyContent: "space-between",
					padding: "56px 64px 56px 48px",
					position: "relative",
					width: "100%",
				}}
			>
				<div
					style={{
						alignItems: "center",
						display: "flex",
						justifyContent: "space-between",
						width: "100%",
					}}
				>
					{/* biome-ignore lint/performance/noImgElement: ImageResponse requires img */}
					<img
						alt="x70"
						height={44}
						src={logoSrc}
						style={{ height: 44, objectFit: "contain", width: 120 }}
						width={120}
					/>
					<span
						style={{
							color: "#a3a3a3",
							fontSize: 24,
							fontWeight: 500,
							letterSpacing: 0.5,
						}}
					>
						{siteName}
					</span>
				</div>

				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 20,
						maxWidth: 1000,
					}}
				>
					<span
						style={{
							fontSize: headline.length > 42 ? 56 : 68,
							fontWeight: 600,
							letterSpacing: -2.5,
							lineHeight: 1.1,
						}}
					>
						{headline}
					</span>
					<span
						style={{
							color: "#a3a3a3",
							fontSize: 28,
							lineHeight: 1.35,
							maxWidth: 920,
						}}
					>
						{description}
					</span>
				</div>

				<div
					style={{
						alignItems: "center",
						borderTop: "1px solid #333333",
						color: "#737373",
						display: "flex",
						fontSize: 22,
						justifyContent: "space-between",
						paddingTop: 28,
						width: "100%",
					}}
				>
					<span>{footer ?? `x70 · ${siteName}`}</span>
					<span>{domain}</span>
				</div>
			</div>
		</div>,
		ogSize,
	);
}

export function buildOgImagePath({
	title,
	description,
}: {
	title: string;
	description: string;
}): string {
	const params = new URLSearchParams({
		title,
		description,
	});
	return `/og?${params.toString()}`;
}
