"use client";

import type { LucideIcon } from "lucide-react";
import {
	BarChartIcon,
	BookUserIcon,
	FolderIcon,
	LayoutDashboardIcon,
	SearchIcon,
	StarIcon,
	UsersRoundIcon,
	ZapIcon,
} from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { OrganisationsSwitcher } from "@/components/team-switcher";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth-client";

interface NavItem {
	title: string;
	url: string;
	icon: LucideIcon;
}

const baseNavData = {
	navMain: [
		{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboardIcon },
		{ title: "Projects", url: "/dashboard/projects", icon: FolderIcon },
		{ title: "Team", url: "/dashboard/team", icon: UsersRoundIcon },
	] satisfies NavItem[],
	navMyTools: [
		{ title: "Templates", url: "/dashboard/templates", icon: BookUserIcon },
		{
			title: "Saved Searches",
			url: "/dashboard/saved-searches",
			icon: SearchIcon,
		},
		{ title: "Shortlisted", url: "/dashboard/shortlisted", icon: StarIcon },
	] satisfies NavItem[],
	navGrowthInsights: [
		{ title: "Promote", url: "/dashboard/promote", icon: ZapIcon },
		{ title: "Analytics", url: "/dashboard/analytics", icon: BarChartIcon },
	] satisfies NavItem[],
};

function NavUserSidebarSkeleton() {
	return (
		<div className="flex items-center gap-2 p-2">
			<Skeleton className="h-8 w-8 rounded-lg" />
			<div className="flex flex-col flex-1 gap-1">
				<Skeleton className="h-3 w-20 rounded" />
				<Skeleton className="h-2 w-28 rounded" />
			</div>
			<Skeleton className="ml-auto size-4 rounded" />
		</div>
	);
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
	const { data: session, isPending } = useSession();
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		setMounted(true);
	}, []);

	return (
		<Sidebar collapsible="offcanvas" {...props}>
			<SidebarHeader>
				<OrganisationsSwitcher />
			</SidebarHeader>
			<SidebarContent>
				<NavMain items={baseNavData.navMain} />
				<NavMain items={baseNavData.navMyTools} title="MY TOOLS" />
				<NavMain
					items={baseNavData.navGrowthInsights}
					title="GROWTH & INSIGHTS"
				/>
			</SidebarContent>
			<SidebarFooter>
				{mounted && !isPending && session ? (
					<NavUser
						user={{
							name: session.user.name || "",
							email: session.user.email,
							avatar: session.user.image || "",
						}}
					/>
				) : (
					<NavUserSidebarSkeleton />
				)}
			</SidebarFooter>
		</Sidebar>
	);
}
