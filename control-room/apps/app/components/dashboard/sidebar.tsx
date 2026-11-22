"use client";

import type { LucideIcon } from "lucide-react";
import {
	BarChart3,
	Home,
	KeyRound,
	Play,
	Radio,
	ShieldCheck,
	UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NavUser } from "@/components/nav-user";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth-client";
import {
	isRevel8NavActive,
	REVEL8_NAV,
	type Revel8NavKey,
} from "@/lib/revel8/nav";

const NAV_ICONS: Record<Revel8NavKey, LucideIcon> = {
	overview: Home,
	runs: Play,
	control: Radio,
	analytics: BarChart3,
	account: UserRound,
	"api-keys": KeyRound,
};

const WORKSPACE_KEYS: Revel8NavKey[] = [
	"overview",
	"runs",
	"control",
	"analytics",
];
const SETTINGS_KEYS: Revel8NavKey[] = ["account", "api-keys"];

function SidebarUser() {
	const { data: session, isPending } = useSession();
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	if (!mounted || isPending || !session) {
		return (
			<div className="flex items-center gap-2 p-2">
				<Skeleton className="h-8 w-8 rounded-lg" />
				<div className="flex flex-1 flex-col gap-1 group-data-[collapsible=icon]:hidden">
					<Skeleton className="h-3 w-20 rounded" />
					<Skeleton className="h-2 w-28 rounded" />
				</div>
			</div>
		);
	}
	return (
		<NavUser
			user={{
				name: session.user.name || "",
				email: session.user.email,
				avatar: session.user.image || "",
			}}
		/>
	);
}

function NavGroup({ label, keys }: { label: string; keys: Revel8NavKey[] }) {
	const pathname = usePathname();
	const { isMobile, setOpenMobile } = useSidebar();
	const items = REVEL8_NAV.filter((item) => keys.includes(item.key));

	return (
		<SidebarGroup>
			<SidebarGroupLabel>{label}</SidebarGroupLabel>
			<SidebarGroupContent>
				<SidebarMenu>
					{items.map((item) => {
						const active = isRevel8NavActive(pathname, item);
						const Icon = NAV_ICONS[item.key];
						return (
							<SidebarMenuItem key={item.href}>
								<SidebarMenuButton
									asChild
									isActive={active}
									tooltip={item.label}
								>
									<Link
										href={item.href}
										aria-current={active ? "page" : undefined}
										onClick={() => {
											if (isMobile) setOpenMobile(false);
										}}
									>
										<Icon aria-hidden="true" />
										<span>{item.label}</span>
									</Link>
								</SidebarMenuButton>
							</SidebarMenuItem>
						);
					})}
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	);
}

export function Revel8Sidebar() {
	const { isMobile, setOpenMobile } = useSidebar();

	return (
		<Sidebar collapsible="icon">
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton asChild size="lg" tooltip="revel8 control room">
							<Link
								href="/dashboard"
								onClick={() => {
									if (isMobile) setOpenMobile(false);
								}}
							>
								<span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
									r8
								</span>
								<span className="grid flex-1 text-left leading-tight">
									<span className="truncate font-semibold tracking-tight">
										revel8
									</span>
									<span className="truncate text-xs text-muted-foreground">
										control room
									</span>
								</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				<nav aria-label="Dashboard navigation" className="flex flex-col">
					<NavGroup label="Dashboard" keys={WORKSPACE_KEYS} />
					<NavGroup label="Settings" keys={SETTINGS_KEYS} />
				</nav>
			</SidebarContent>
			<SidebarFooter>
				<p
					data-testid="practice-only"
					className="flex items-center gap-2 px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
					title="Authorized CTF · practice only"
				>
					<ShieldCheck aria-hidden="true" className="size-3.5 shrink-0" />
					<span className="group-data-[collapsible=icon]:sr-only">
						Authorized CTF · practice only
					</span>
				</p>
				<SidebarUser />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
