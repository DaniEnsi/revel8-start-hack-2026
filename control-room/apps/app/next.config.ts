import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	async redirects() {
		return [
			{
				source: "/revel8",
				destination: "/dashboard",
				permanent: false,
			},
			{
				source: "/revel8/:path*",
				destination: "/dashboard/:path*",
				permanent: false,
			},
		];
	},

	images: {
		remotePatterns: [
			{ hostname: "design.x70.one", protocol: "https" },
			{ hostname: "localhost", port: "3000", protocol: "http" },
		],
	},

	async rewrites() {
		return [
			{
				source: "/api/app-data/static/:path*",
				destination: "https://us-assets.i.posthog.com/static/:path*",
			},
			{
				source: "/api/app-data/array/:path*",
				destination: "https://us-assets.i.posthog.com/array/:path*",
			},
			{
				source: "/api/app-data/:path*",
				destination: "https://us.i.posthog.com/:path*",
			},
		];
	},
};

export default nextConfig;
