"use client";

import { Activity, PanelLeft } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useSidebar } from "@/components/ui/sidebar";
import { getSidecarBase, health } from "@/lib/revel8/client";
import { activeRevel8NavItem } from "@/lib/revel8/nav";
import { cn } from "@/lib/utils";

function SidecarStatus() {
	const [state, setState] = useState<"checking" | "online" | "offline">(
		"checking",
	);
	const [base, setBase] = useState("");

	useEffect(() => {
		setBase(getSidecarBase());
		let alive = true;
		const ping = async () => {
			try {
				await health();
				if (alive) setState("online");
			} catch {
				if (alive) setState("offline");
			}
		};
		ping();
		const id = setInterval(ping, 5000);
		return () => {
			alive = false;
			clearInterval(id);
		};
	}, []);

	const dot =
		state === "online"
			? "bg-emerald-400"
			: state === "offline"
				? "bg-zinc-500"
				: "bg-amber-400 animate-pulse";
	const label =
		state === "online"
			? "sidecar online"
			: state === "offline"
				? "sidecar offline"
				: "…";

	return (
		<div
			className="flex items-center gap-2 text-xs text-muted-foreground"
			title={`sidecar: ${base}`}
		>
			<span className={cn("h-2 w-2 rounded-full", dot)} />
			<span className="hidden sm:inline">{label}</span>
		</div>
	);
}

function NavToggle() {
	const { isMobile, open, openMobile, toggleSidebar } = useSidebar();
	const expanded = isMobile ? openMobile : open;
	const label = isMobile
		? expanded
			? "Close navigation"
			: "Open navigation"
		: expanded
			? "Collapse sidebar"
			: "Expand sidebar";
	return (
		<Button
			type="button"
			data-sidebar-toggle=""
			variant="ghost"
			size="icon"
			className="-ml-1 h-8 w-8 shrink-0"
			aria-label={label}
			aria-expanded={expanded}
			title={`${label} (Ctrl/⌘ B)`}
			onClick={toggleSidebar}
		>
			<PanelLeft aria-hidden="true" className="h-4 w-4" />
		</Button>
	);
}

export function Revel8Shell({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();
	const title = activeRevel8NavItem(pathname)?.label ?? "Control room";
	return (
		<div className="min-h-screen min-w-0 bg-background text-foreground">
			<header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
				<div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-2 px-3 sm:px-4">
					<NavToggle />
					<Separator
						orientation="vertical"
						className="mx-1 data-[orientation=vertical]:h-4"
					/>
					<p className="min-w-0 truncate text-sm font-medium">{title}</p>
					<div className="ml-auto flex shrink-0 items-center gap-3">
						<span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
							<Activity aria-hidden="true" className="h-3.5 w-3.5" />
							authorized CTF · practice only
						</span>
						<SidecarStatus />
					</div>
				</div>
			</header>
			<main className="mx-auto w-full min-w-0 max-w-[1400px] px-3 py-6 sm:px-4">
				{children}
			</main>
		</div>
	);
}
