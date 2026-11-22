import "./globals.css";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { Wrapper, WrapperWithQuery } from "@/components/wrapper";
import { brandAssets } from "@/lib/brand-assets";
import { baseUrl, createMetadata } from "@/lib/metadata";
import {
	PostHogAuthWrapper,
	PostHogPageView,
	PostHogProvider,
} from "../providers/posthog";

export const metadata = createMetadata({
	title: "revel8 · Control Room",
	description: "Authorized security-awareness simulation control room",
	metadataBase: baseUrl,
	icons: {
		icon: [{ url: brandAssets.icon, type: "image/png" }],
	},
});

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body className={`${GeistSans.variable} ${GeistMono.variable} font-sans`}>
				<PostHogProvider>
					<PostHogPageView />
					<PostHogAuthWrapper />
					<ThemeProvider attribute="class" defaultTheme="dark">
						<Wrapper>
							<WrapperWithQuery>{children}</WrapperWithQuery>
						</Wrapper>
						<Toaster richColors closeButton />
					</ThemeProvider>
				</PostHogProvider>
			</body>
		</html>
	);
}
