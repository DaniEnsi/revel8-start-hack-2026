"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
	BarChartIcon,
	BookUserIcon,
	ChevronDown,
	FolderIcon,
	LayoutDashboardIcon,
	SearchIcon,
	StarIcon,
	UsersRoundIcon,
	ZapIcon,
} from "lucide-react";
import Image from "next/image";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { OnboardingData } from "./types";

interface OnboardingPreviewProps {
	step: number;
	data: OnboardingData;
}

function Spotlight({
	active,
	children,
	className,
}: {
	active: boolean;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<motion.div
			animate={{
				scale: active ? 1.03 : 1,
				opacity: active ? 1 : 0.65,
			}}
			transition={{ type: "spring", stiffness: 300, damping: 25 }}
			className={cn(
				"rounded-xl border transition-all duration-300",
				active
					? "border-primary/25 bg-primary/[0.04] shadow-[0_0_15px_rgba(249,115,22,0.08)] z-10"
					: "border-transparent",
				className,
			)}
		>
			{children}
		</motion.div>
	);
}

export function OnboardingPreview({ step, data }: OnboardingPreviewProps) {
	const fullName =
		[data.firstName, data.lastName].filter(Boolean).join(" ") || "John Doe";
	const workspaceName = data.workspaceName || "Acme";
	const workspaceSlug = data.workspaceSlug || "acme";
	const filledInvites = data.invites.filter((i) => i.email.trim());

	return (
		<div className="relative hidden bg-muted/15 md:flex md:flex-col md:border-l select-none overflow-hidden min-h-[480px]">
			{/* Large, beautiful dashboard mockup hanging out of frame to the right - ZOOMED IN */}
			<motion.div
				key={step}
				initial={{ opacity: 0, x: 20 }}
				animate={{ opacity: 1, x: 0 }}
				transition={{ duration: 0.45, ease: "easeOut" }}
				className="absolute left-8 top-10 bottom-10 w-[720px] rounded-2xl border bg-background shadow-2xl flex flex-row overflow-hidden"
			>
				{/* Sidebar (Aside is wider now: w-52 shrink-0 for a more balanced layout) */}
				<aside className="w-52 shrink-0 flex flex-col border-r bg-background/50 p-3">
					{/* Sidebar Header: Workspace trigger (spotlighted in Step 2) */}
					<Spotlight active={step === 2} className="mb-4 p-1.5">
						<div className="flex items-center gap-2 justify-between">
							<div className="flex items-center gap-2 min-w-0">
								{data.workspaceLogo ? (
									<div className="relative size-8 overflow-hidden rounded-md shrink-0">
										<Image
											src={data.workspaceLogo}
											alt=""
											fill
											className="object-cover"
										/>
									</div>
								) : (
									<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-xs font-bold text-primary">
										{workspaceName.charAt(0).toUpperCase()}
									</div>
								)}
								<div className="min-w-0">
									<p className="truncate text-xs font-bold">{workspaceName}</p>
									<p className="truncate text-[10px] text-muted-foreground leading-none">
										/{workspaceSlug}
									</p>
								</div>
							</div>
							<ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
						</div>
					</Spotlight>

					{/* Sidebar Navigation Categories matching our actual Portal */}
					<div className="flex-1 space-y-4 overflow-y-auto no-scrollbar py-1">
						{/* Main Navigation */}
						<div className="space-y-1">
							{[
								{
									icon: LayoutDashboardIcon,
									label: "Dashboard",
									active: step === 3 || step === 4 || step === 5,
								},
								{ icon: FolderIcon, label: "Projects" },
								{ icon: UsersRoundIcon, label: "Team" },
							].map((item) => (
								<div
									key={item.label}
									className={cn(
										"flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
										item.active
											? "bg-primary/5 text-primary"
											: "text-muted-foreground",
									)}
								>
									<item.icon className="size-4 shrink-0" />
									<span>{item.label}</span>
								</div>
							))}
						</div>

						{/* MY TOOLS Section */}
						<div className="space-y-1">
							<p className="text-[9px] font-bold text-muted-foreground/60 px-2 uppercase tracking-wider">
								My Tools
							</p>
							<div className="space-y-1">
								{[
									{ icon: BookUserIcon, label: "Templates" },
									{ icon: SearchIcon, label: "Saved Searches" },
									{ icon: StarIcon, label: "Shortlisted" },
								].map((item) => (
									<div
										key={item.label}
										className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground"
									>
										<item.icon className="size-4 shrink-0" />
										<span>{item.label}</span>
									</div>
								))}
							</div>
						</div>

						{/* GROWTH & INSIGHTS Section */}
						<div className="space-y-1">
							<p className="text-[9px] font-bold text-muted-foreground/60 px-2 uppercase tracking-wider">
								Growth & Insights
							</p>
							<div className="space-y-1">
								{[
									{ icon: ZapIcon, label: "Promote" },
									{ icon: BarChartIcon, label: "Analytics" },
								].map((item) => (
									<div
										key={item.label}
										className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground"
									>
										<item.icon className="size-4 shrink-0" />
										<span>{item.label}</span>
									</div>
								))}
							</div>
						</div>
					</div>

					{/* User Avatar Footer without separator line or highlighting */}
					<div className="mt-auto">
						<div className="flex items-center gap-2 justify-between p-1">
							<div className="flex items-center gap-2 min-w-0">
								<Avatar className="size-8 shrink-0">
									{data.avatar ? (
										<AvatarImage src={data.avatar} alt={fullName} />
									) : null}
									<AvatarFallback className="text-xs">
										{data.firstName.charAt(0) || "?"}
										{data.lastName.charAt(0) || ""}
									</AvatarFallback>
								</Avatar>
								<div className="min-w-0">
									<p className="truncate text-xs font-bold leading-tight">
										{fullName}
									</p>
									<p className="truncate text-[10px] text-muted-foreground leading-none">
										{data.email || "you@company.com"}
									</p>
								</div>
							</div>
							<ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
						</div>
					</div>
				</aside>

				{/* Main dashboard content area - Stretching and clipped on the right */}
				<div className="flex-1 flex flex-col bg-muted/5 p-4 overflow-hidden">
					{/* App header mock */}
					<div className="flex items-center justify-between border-b border-border/30 pb-3 mb-4">
						<div className="h-4 w-14 rounded bg-muted/40" />
						<div className="flex gap-2">
							<div className="h-5 w-10 rounded bg-muted/40" />
							<div className="h-5 w-5 rounded-full bg-muted/40" />
						</div>
					</div>

					{/* Skeletons & active preview content */}
					<div className="space-y-4">
						{/* Mock run overview layout. */}
						<div className="rounded-xl border border-border/30 bg-background/50 p-3 space-y-2.5">
							<div className="flex items-center justify-between">
								<div className="h-4 w-20 rounded bg-muted/30" />
								<div className="h-5 w-12 rounded-full bg-primary/10" />
							</div>
							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<div className="size-3.5 rounded border border-border/60" />
									<div className="h-3 w-32 rounded bg-muted/20" />
								</div>
								<div className="flex items-center gap-2">
									<div className="size-3.5 rounded border border-border/60" />
									<div className="h-3 w-28 rounded bg-muted/20" />
								</div>
							</div>
						</div>

						{/* Step-specific cards sliding/animating in */}
						<div className="pt-3 border-t border-border/20">
							<AnimatePresence mode="wait">
								{step === 3 && (
									<motion.div
										key="preview-step3"
										initial={{ opacity: 0, y: 6 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0, y: -6 }}
										className="space-y-2"
									>
										<p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
											Connected Accounts
										</p>
										<div className="grid grid-cols-2 gap-2">
											<div
												className={cn(
													"rounded-lg border bg-background p-2.5 flex items-center justify-between",
													data.linkedGoogle &&
														"border-primary/20 bg-primary/[0.01]",
												)}
											>
												<span className="text-xs font-bold">Google</span>
												<Badge
													variant={data.linkedGoogle ? "default" : "secondary"}
													className="text-[9px] px-1.5 py-0 h-4"
												>
													{data.linkedGoogle ? "Yes" : "No"}
												</Badge>
											</div>
											<div
												className={cn(
													"rounded-lg border bg-background p-2.5 flex items-center justify-between",
													data.linkedGithub &&
														"border-primary/20 bg-primary/[0.01]",
												)}
											>
												<span className="text-xs font-bold">GitHub</span>
												<Badge
													variant={data.linkedGithub ? "default" : "secondary"}
													className="text-[9px] px-1.5 py-0 h-4"
												>
													{data.linkedGithub ? "Yes" : "No"}
												</Badge>
											</div>
										</div>
									</motion.div>
								)}

								{step === 4 && (
									<motion.div
										key="preview-step4"
										initial={{ opacity: 0, y: 6 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0, y: -6 }}
										className="rounded-lg border bg-background p-3 space-y-2"
									>
										<p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
											Pending Team Invites
										</p>
										{filledInvites.length === 0 ? (
											<p className="text-xs text-muted-foreground italic">
												Add invites in form to preview...
											</p>
										) : (
											<div className="space-y-1.5 max-h-[80px] overflow-y-auto pr-1">
												{filledInvites.map((invite) => (
													<div
														key={invite.id}
														className="flex items-center justify-between text-xs border-b border-border/20 pb-1 last:border-0 last:pb-0"
													>
														<span className="truncate max-w-[120px] font-mono text-[10px]">
															{invite.email}
														</span>
														<Badge
															variant="secondary"
															className="text-[9px] px-1 py-0 h-3.5"
														>
															{invite.role}
														</Badge>
													</div>
												))}
											</div>
										)}
									</motion.div>
								)}
							</AnimatePresence>
						</div>
					</div>
				</div>
			</motion.div>
		</div>
	);
}
