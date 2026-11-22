"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Plus, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { OnboardingPreview } from "@/components/onboarding/onboarding-preview";
import {
	initialOnboardingData,
	ONBOARDING_STEPS,
	type OnboardingData,
} from "@/components/onboarding/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	isPasswordStrong,
	PasswordStrengthInput,
} from "@/components/ui/password-strength-input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { organization, signIn, signUp } from "@/lib/auth-client";

async function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

export function OnboardingWizard() {
	const router = useRouter();
	const [step, setStep] = useState(1);

	// Synchronize step with browser history so Back/Forward buttons work seamlessly
	useEffect(() => {
		const searchParams = new URLSearchParams(window.location.search);
		const urlStep = Number(searchParams.get("step")) || 1;
		if (urlStep > 1 && urlStep <= ONBOARDING_STEPS.length) {
			setStep(urlStep);
			window.history.replaceState(
				{ step: urlStep },
				`Step ${urlStep}`,
				`?step=${urlStep}`,
			);
		} else {
			window.history.replaceState({ step: 1 }, "Step 1", "?step=1");
		}
	}, []);

	useEffect(() => {
		const currentHistoryStep = window.history.state?.step;
		if (currentHistoryStep !== step) {
			window.history.pushState({ step }, `Step ${step}`, `?step=${step}`);
		}
	}, [step]);

	useEffect(() => {
		const handlePopState = (event: PopStateEvent) => {
			if (event.state && typeof event.state.step === "number") {
				setStep(event.state.step);
			} else {
				setStep(1);
			}
		};

		window.addEventListener("popstate", handlePopState);
		return () => {
			window.removeEventListener("popstate", handlePopState);
		};
	}, []);

	const [data, setData] = useState<OnboardingData>(initialOnboardingData);
	const [loading, setLoading] = useState(false);
	const [accountCreated, setAccountCreated] = useState(false);
	const [isSlugEdited, setIsSlugEdited] = useState(false);
	const avatarInputRef = useRef<HTMLInputElement>(null);
	const logoInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!isSlugEdited && data.workspaceName) {
			setData((prev) => ({
				...prev,
				workspaceSlug: prev.workspaceName
					.trim()
					.toLowerCase()
					.replace(/\s+/g, "-")
					.replace(/[^a-z0-9-]/g, ""),
			}));
		}
	}, [data.workspaceName, isSlugEdited]);

	const update = <K extends keyof OnboardingData>(
		key: K,
		value: OnboardingData[K],
	) => {
		setData((prev) => ({ ...prev, [key]: value }));
	};

	const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			update("avatar", await fileToBase64(file));
		}
	};

	const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			update("workspaceLogo", await fileToBase64(file));
		}
	};

	const validateStep = (): boolean => {
		switch (step) {
			case 1: {
				if (
					!data.firstName ||
					!data.lastName ||
					!data.email ||
					!data.password
				) {
					toast.error("Please fill in all required fields");
					return false;
				}
				if (!isPasswordStrong(data.password)) {
					toast.error(
						"Password must be at least 8 characters and include uppercase, lowercase, and a number",
					);
					return false;
				}
				return true;
			}
			case 2: {
				if (!data.workspaceName || !data.workspaceSlug) {
					toast.error("Please enter a workspace name and URL");
					return false;
				}
				return true;
			}
			default:
				return true;
		}
	};

	const handleCreateAccount = async (): Promise<boolean> => {
		if (accountCreated) return true;

		return new Promise((resolve) => {
			signUp.email(
				{
					email: data.email,
					password: data.password,
					name: `${data.firstName} ${data.lastName}`.trim(),
					image: data.avatar || undefined,
				},
				{
					onRequest: () => setLoading(true),
					onResponse: () => setLoading(false),
					onError: (ctx) => {
						toast.error(ctx.error.message || "Failed to create account");
						resolve(false);
					},
					onSuccess: () => {
						setAccountCreated(true);
						toast.success("Account created");
						resolve(true);
					},
				},
			);
		});
	};

	const handleCreateWorkspace = async (): Promise<boolean> => {
		return new Promise((resolve) => {
			organization.create(
				{
					name: data.workspaceName,
					slug: data.workspaceSlug,
					logo: data.workspaceLogo || undefined,
				},
				{
					onRequest: () => setLoading(true),
					onResponse: () => setLoading(false),
					onSuccess: (ctx) => {
						const orgId = ctx.data?.id;
						if (orgId) {
							organization.setActive({ organizationId: orgId });
						}
						toast.success("Workspace created");
						resolve(true);
					},
					onError: (error) => {
						toast.error(error.error?.message || "Failed to create workspace");
						resolve(false);
					},
				},
			);
		});
	};

	const handleSendInvites = async () => {
		const validInvites = data.invites.filter((i) => i.email.trim());
		for (const invite of validInvites) {
			await organization.inviteMember({
				email: invite.email.trim(),
				role: invite.role,
			});
		}
		if (validInvites.length > 0) {
			toast.success(
				validInvites.length === 1
					? "Invitation sent"
					: `${validInvites.length} invitations sent`,
			);
		}
	};

	const handleNext = async () => {
		if (!validateStep()) return;

		if (step === 1) {
			const ok = await handleCreateAccount();
			if (!ok) return;
		}

		if (step === 2) {
			const ok = await handleCreateWorkspace();
			if (!ok) return;
		}

		if (step < ONBOARDING_STEPS.length) {
			setStep((s) => s + 1);
		}
	};

	const handleFinish = async () => {
		setLoading(true);
		try {
			await handleSendInvites();
			toast.success("Welcome to x70 Portal!");
			router.push("/dashboard");
		} finally {
			setLoading(false);
		}
	};

	const handleSocialLink = async (provider: "google" | "github") => {
		await signIn.social({
			provider,
			callbackURL: "/sign-up",
		});
		update(provider === "google" ? "linkedGoogle" : "linkedGithub", true);
	};

	const addInviteRow = () => {
		update("invites", [
			...data.invites,
			{ id: crypto.randomUUID(), email: "", role: "member" },
		]);
	};

	const removeInviteRow = (index: number) => {
		if (data.invites.length <= 1) return;
		update(
			"invites",
			data.invites.filter((_, i) => i !== index),
		);
	};

	const updateInvite = (
		index: number,
		field: "email" | "role",
		value: string,
	) => {
		const next = [...data.invites];
		next[index] = {
			...next[index],
			[field]: value,
		} as (typeof next)[number];
		update("invites", next);
	};

	const currentStep = ONBOARDING_STEPS[step - 1];

	return (
		<div className="flex min-h-svh flex-col items-center justify-center bg-muted/50 px-4 py-8 sm:px-6 md:px-8">
			<div className="w-full max-w-5xl overflow-hidden rounded-2xl border bg-card shadow-sm">
				<div className="grid md:grid-cols-2">
					<div className="flex min-h-[min(640px,85vh)] flex-col bg-background p-6 sm:p-8 md:p-10">
						<div className="flex-1">
							<h1 className="text-2xl font-semibold tracking-tight">
								{currentStep?.title}
							</h1>
							<p className="mt-2 text-sm text-muted-foreground">
								{currentStep?.description}
							</p>

							<AnimatePresence mode="wait">
								<motion.div
									key={step}
									initial={{ opacity: 0, x: -12 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: 12 }}
									transition={{ duration: 0.25 }}
									className="mt-8 space-y-5"
								>
									{step === 1 && (
										<>
											<div className="flex items-center gap-4">
												<button
													type="button"
													onClick={() => avatarInputRef.current?.click()}
													className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-muted-foreground/25 bg-muted/50 transition-colors hover:border-muted-foreground/40"
												>
													{data.avatar ? (
														<Image
															src={data.avatar}
															alt="Profile preview"
															fill
															className="object-cover"
														/>
													) : (
														<Plus className="size-5 text-muted-foreground" />
													)}
												</button>
												<div className="space-y-1.5">
													<p className="text-sm font-medium">Profile picture</p>
													<Button
														type="button"
														variant="outline"
														size="sm"
														onClick={() => avatarInputRef.current?.click()}
													>
														Upload image
													</Button>
													<p className="text-xs text-muted-foreground">
														*.png, *.jpeg files up to 10MB
													</p>
													<input
														ref={avatarInputRef}
														type="file"
														accept="image/*"
														className="sr-only"
														onChange={handleAvatarChange}
													/>
												</div>
											</div>
											<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
												<div className="grid gap-2">
													<Label htmlFor="firstName">First name</Label>
													<Input
														id="firstName"
														value={data.firstName}
														onChange={(e) =>
															update("firstName", e.target.value)
														}
														placeholder="Jane"
														required
													/>
												</div>
												<div className="grid gap-2">
													<Label htmlFor="lastName">Last name</Label>
													<Input
														id="lastName"
														value={data.lastName}
														onChange={(e) => update("lastName", e.target.value)}
														placeholder="Smith"
														required
													/>
												</div>
											</div>
											<div className="grid gap-2">
												<Label htmlFor="email">Email</Label>
												<Input
													id="email"
													type="email"
													value={data.email}
													onChange={(e) => update("email", e.target.value)}
													placeholder="you@company.com"
													required
												/>
											</div>
											<PasswordStrengthInput
												id="password"
												value={data.password}
												onChange={(value) => update("password", value)}
												placeholder="Create a strong password"
												required
											/>
										</>
									)}

									{step === 2 && (
										<>
											<div className="grid gap-2">
												<Label htmlFor="workspaceName">Business name</Label>
												<Input
													id="workspaceName"
													value={data.workspaceName}
													onChange={(e) =>
														update("workspaceName", e.target.value)
													}
													placeholder="Acme HVAC"
													required
												/>
											</div>
											<div className="grid gap-2">
												<Label htmlFor="workspaceSlug">Workspace URL</Label>
												<div className="flex items-center gap-2">
													<span className="shrink-0 text-sm text-muted-foreground">
														app.x70.one/
													</span>
													<Input
														id="workspaceSlug"
														value={data.workspaceSlug}
														onChange={(e) => {
															setIsSlugEdited(true);
															update("workspaceSlug", e.target.value);
														}}
														placeholder="acme-hvac"
														required
													/>
												</div>
											</div>
											<div className="grid gap-2">
												<Label htmlFor="workspaceLogo">Logo (optional)</Label>
												<div className="flex items-center gap-4">
													<button
														type="button"
														onClick={() => logoInputRef.current?.click()}
														className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/50"
													>
														{data.workspaceLogo ? (
															<Image
																src={data.workspaceLogo}
																alt="Logo preview"
																fill
																className="object-cover"
															/>
														) : (
															<Plus className="size-5 text-muted-foreground" />
														)}
													</button>
													<Button
														type="button"
														variant="outline"
														size="sm"
														onClick={() => logoInputRef.current?.click()}
													>
														Upload logo
													</Button>
													<input
														ref={logoInputRef}
														id="workspaceLogo"
														type="file"
														accept="image/*"
														className="sr-only"
														onChange={handleLogoChange}
													/>
												</div>
											</div>
										</>
									)}

									{step === 3 && (
										<div className="grid gap-3 sm:grid-cols-2">
											<Button
												type="button"
												variant="outline"
												className="gap-2"
												onClick={() => handleSocialLink("google")}
											>
												Connect Google
											</Button>
											<Button
												type="button"
												variant="outline"
												className="gap-2"
												onClick={() => handleSocialLink("github")}
											>
												Connect GitHub
											</Button>
										</div>
									)}

									{step === 4 && (
										<>
											{data.invites.map((invite, index) => (
												<div key={invite.id} className="flex gap-2">
													<Input
														type="email"
														placeholder="colleague@company.com"
														value={invite.email}
														onChange={(e) =>
															updateInvite(index, "email", e.target.value)
														}
														className="flex-1"
													/>
													<Select
														value={invite.role}
														onValueChange={(v) =>
															updateInvite(index, "role", v)
														}
													>
														<SelectTrigger className="w-28">
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															<SelectItem value="admin">Admin</SelectItem>
															<SelectItem value="member">Member</SelectItem>
														</SelectContent>
													</Select>
													{data.invites.length > 1 && (
														<Button
															type="button"
															variant="ghost"
															size="icon"
															onClick={() => removeInviteRow(index)}
														>
															<X className="size-4" />
														</Button>
													)}
												</div>
											))}
											<Button
												type="button"
												variant="outline"
												size="sm"
												className="gap-2"
												onClick={addInviteRow}
											>
												<Plus className="size-4" />
												Add another
											</Button>
										</>
									)}
								</motion.div>
							</AnimatePresence>
						</div>

						<div className="mt-8 flex items-center justify-between gap-4 border-t pt-6">
							<Button
								type="button"
								variant="ghost"
								disabled={loading}
								onClick={() => {
									if (step > 1) {
										window.history.back();
									} else {
										router.push("/sign-in");
									}
								}}
							>
								Back
							</Button>
							<div className="flex gap-2">
								{(step === 3 || step === 4) && (
									<Button
										type="button"
										variant="outline"
										disabled={loading}
										onClick={() => {
											if (step === 4) {
												handleFinish();
											} else {
												setStep((s) => s + 1);
											}
										}}
									>
										Skip
									</Button>
								)}
								{step < ONBOARDING_STEPS.length ? (
									<Button
										type="button"
										disabled={
											loading ||
											(step === 3 && !data.linkedGoogle && !data.linkedGithub)
										}
										onClick={handleNext}
									>
										{loading ? (
											<Loader2 className="size-4 animate-spin" />
										) : (
											"Continue"
										)}
									</Button>
								) : (
									<Button
										type="button"
										disabled={
											loading ||
											!data.invites.some((i) => i.email.trim().length > 0)
										}
										onClick={handleFinish}
									>
										{loading ? (
											<Loader2 className="size-4 animate-spin" />
										) : (
											"Finish setup"
										)}
									</Button>
								)}
							</div>
						</div>
					</div>

					<OnboardingPreview step={step} data={data} />
				</div>
			</div>

			<p className="mt-6 text-center text-sm text-muted-foreground">
				Already have an account?{" "}
				<Link
					href="/sign-in"
					className="underline underline-offset-4 hover:text-foreground"
				>
					Sign in
				</Link>
			</p>
		</div>
	);
}
