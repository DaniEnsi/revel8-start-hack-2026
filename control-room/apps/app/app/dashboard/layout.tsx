import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Revel8Sidebar } from "@/components/dashboard/sidebar";
import { Revel8Shell } from "@/components/revel8/shell";
import { SidebarProvider } from "@/components/ui/sidebar";

export const metadata: Metadata = {
	title: "revel8 · Control Room",
	description:
		"Launch, monitor, and replay the revel8 Agentic Social Engineer (authorized security-awareness CTF).",
};

export default async function Revel8Layout({
	children,
}: {
	children: React.ReactNode;
}) {
	// Desktop sidebar is visible by default; a collapse persists via the
	// sidebar_state cookie written by SidebarProvider.
	const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";
	return (
		<SidebarProvider defaultOpen={sidebarOpen}>
			<Revel8Sidebar />
			<div className="min-w-0 flex-1">
				<Revel8Shell>{children}</Revel8Shell>
			</div>
		</SidebarProvider>
	);
}
