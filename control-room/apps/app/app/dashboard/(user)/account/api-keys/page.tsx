"use client";

import {
	type UseMutationResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
	CheckCircle2,
	Clock,
	Edit,
	KeyRound,
	Loader2,
	MessageSquare,
	Trash2,
	X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CreateApiKeyDialog } from "@/components/dashboard/api-keys/create-api-key-dialog";
import { UpdateApiKeyDialog } from "@/components/dashboard/api-keys/update-api-key-dialog";
import { SiteHeader } from "@/components/site-header";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import CopyButton from "@/components/ui/copy-button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth-client";

// Define types explicitly to avoid dependency/export issues
type ApiKeyListItem = {
	id: string;
	name: string | null;
	enabled: boolean;
	prefix: string | null;
	start: string;
	createdAt: string;
	expiresAt: string | null;
	metadata?: Record<string, any> | null;
};

function ApiKeyCardSkeleton() {
	return (
		<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 gap-4">
			<div className="flex-grow space-y-2.5 min-w-0 w-full">
				<div className="flex items-center gap-2 flex-wrap">
					<Skeleton className="h-5 w-1/4" />
					<Skeleton className="h-4 w-12 rounded-full" />
				</div>
				<div className="flex items-center gap-1.5">
					<Skeleton className="h-3.5 w-1/3" />
				</div>
				<div className="flex items-center gap-1.5">
					<Skeleton className="h-3.5 w-1/2" />
				</div>
				<div className="flex items-center gap-4 pt-1 flex-wrap">
					<Skeleton className="h-3 w-24" />
				</div>
			</div>
			<div className="flex space-x-1 items-center shrink-0 self-center sm:self-auto">
				<Skeleton className="h-8 w-8 rounded-md" />
				<Skeleton className="h-8 w-8 rounded-md" />
			</div>
		</div>
	);
}

export default function ApiKeysPage() {
	const queryClient = useQueryClient();
	const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
	// Fetch API keys.
	const { data: apiKeys = [], isLoading: isLoadingApiKeys } = useQuery<
		ApiKeyListItem[],
		Error
	>({
		queryKey: ["apiKeys"],
		queryFn: async (): Promise<ApiKeyListItem[]> => {
			const { data, error } = await authClient.apiKey.list();
			if (error) {
				console.error("Error fetching API keys:", error);
				const errorMessage =
					(error as any)?.message || "Failed to load API keys.";
				toast.error(errorMessage);
				throw new Error(errorMessage);
			}
			const keys = (Array.isArray(data) ? data : (data?.apiKeys ?? [])).map(
				(key: any): ApiKeyListItem => ({
					id: key.id,
					name: key.name ?? null,
					enabled: key.enabled,
					prefix: key.prefix ?? null,
					start: key.start,
					createdAt: key.createdAt,
					expiresAt: key.expiresAt ?? null,
					metadata: key.metadata ?? null,
				}),
			);
			return keys;
		},
		refetchOnWindowFocus: false,
	});

	// Delete Mutation
	const deleteMutation: UseMutationResult<any, Error, string> = useMutation<
		any,
		Error,
		string
	>({
		mutationFn: (keyId: string) => authClient.apiKey.delete({ keyId }),
		onSuccess: (_, _deletedKeyId) => {
			toast.success("API Key deleted successfully.");
			queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
		},
		onError: (error) => {
			toast.error(error?.message || "Failed to delete API key.");
		},
	});

	const handleKeyCreated = (key: string) => {
		setNewlyCreatedKey(key);
		queryClient.invalidateQueries({ queryKey: ["apiKeys"] });
	};

	const createButtonDisabled = isLoadingApiKeys;

	return (
		<TooltipProvider>
			<SiteHeader title="API Keys" />
			<div className="flex w-full min-w-0 max-w-full flex-col space-y-6 p-3 sm:p-6">
				<div className="flex justify-between items-center gap-4 flex-wrap">
					<div className="flex items-center gap-2">
						<h2 className="text-2xl font-semibold tracking-tight">
							Manage API Keys
						</h2>
					</div>

					<CreateApiKeyDialog onKeyCreated={handleKeyCreated}>
						<Button disabled={createButtonDisabled}>
							<KeyRound className="mr-2 h-4 w-4" /> Create New Key
						</Button>
					</CreateApiKeyDialog>
				</div>

				{newlyCreatedKey && (
					<Card className="group relative min-w-0 border-sky-300 bg-sky-50 p-4 dark:border-sky-700 dark:bg-sky-900/30">
						<CardHeader className="p-0 pb-2 flex flex-row items-start">
							<div className="flex-shrink-0 mr-3 pt-0.5">
								<CheckCircle2 className="h-5 w-5 text-sky-600 dark:text-sky-400" />
							</div>
							<div>
								<CardTitle className="text-base font-medium text-sky-700 dark:text-sky-300">
									New API Key Created
								</CardTitle>
								<CardDescription className="text-xs text-sky-600 dark:text-sky-400 mt-0.5">
									Please copy your new API key now. You won't be able to see it
									again!
								</CardDescription>
							</div>
						</CardHeader>
						<CardContent className="flex flex-wrap items-center gap-3 p-0 pt-2 sm:pl-8">
							<pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-sky-200 bg-background p-2 text-sm shadow-inner dark:border-sky-800 dark:bg-muted/50">
								<code>{newlyCreatedKey}</code>
							</pre>
							<CopyButton textToCopy={newlyCreatedKey || ""} />
							<Button
								variant="ghost"
								size="icon"
								onClick={() => setNewlyCreatedKey(null)}
								className="h-8 w-8 text-muted-foreground hover:bg-muted/50"
								aria-label="Dismiss new key banner"
							>
								<X className="h-4 w-4" />
							</Button>
						</CardContent>
					</Card>
				)}

				<Card className="min-w-0 overflow-hidden border dark:bg-transparent">
					<CardHeader className="bg-muted/30 dark:bg-muted/20 border-b">
						<CardTitle className="text-lg">Your API Keys</CardTitle>
						<CardDescription>
							Manage API keys used to authenticate requests.
						</CardDescription>
					</CardHeader>
					<CardContent className="p-0">
						{isLoadingApiKeys ? (
							<div className="divide-y">
								{["first", "second", "third"].map((key) => (
									<ApiKeyCardSkeleton key={key} />
								))}
							</div>
						) : apiKeys.length === 0 ? (
							<div className="text-center p-10 text-muted-foreground">
								<KeyRound className="mx-auto h-10 w-10 mb-3 text-muted-foreground/50" />
								<p className="font-medium">No API keys found.</p>
								<p className="text-sm">Get started by creating a new key.</p>
							</div>
						) : (
							<div className="divide-y">
								{apiKeys.map((key) => (
									<div
										key={key.id}
										className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 gap-4 hover:bg-muted/10 transition-colors"
									>
										<div className="flex-grow space-y-1.5 min-w-0">
											<div className="flex items-center gap-2 flex-wrap">
												<p
													className="font-medium text-base truncate"
													title={key.name ?? "Untitled Key"}
												>
													{key.name || (
														<span className="italic text-muted-foreground">
															Untitled Key
														</span>
													)}
												</p>
												<Badge
													variant={key.enabled ? "default" : "destructive"}
													className={`text-xs whitespace-nowrap ${key.enabled ? "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200 border-green-300" : ""}`}
												>
													{key.enabled ? "Active" : "Inactive"}
												</Badge>
											</div>
											<p
												className="text-sm text-muted-foreground font-mono flex items-center gap-1.5 truncate"
												title={key.id}
											>
												<span className="text-xs font-sans text-muted-foreground/80 shrink-0">
													ID:
												</span>{" "}
												<span className="truncate">{key.id}</span>
											</p>
											<p className="text-sm text-muted-foreground font-mono flex items-center gap-1.5">
												<span className="text-xs font-sans text-muted-foreground/80 shrink-0">
													Key:
												</span>
												{key.prefix ? `${key.prefix}_` : ""}
												{key.start}...
											</p>
											{key.metadata?.comment && (
												<p
													className="text-xs text-muted-foreground italic flex items-center gap-1.5 pt-1 truncate"
													title={
														typeof key.metadata.comment === "string"
															? key.metadata.comment
															: ""
													}
												>
													<MessageSquare className="h-3 w-3 shrink-0" />
													<span className="truncate">
														{typeof key.metadata.comment === "string"
															? key.metadata.comment
															: JSON.stringify(key.metadata.comment)}
													</span>
												</p>
											)}
											<div className="flex items-center gap-4 text-xs text-muted-foreground pt-1 flex-wrap">
												<span className="flex items-center gap-1 whitespace-nowrap">
													<Clock className="h-3 w-3" />
													Created{" "}
													{formatDistanceToNow(new Date(key.createdAt), {
														addSuffix: true,
													})}
												</span>
												{key.expiresAt && (
													<span className="flex items-center gap-1 whitespace-nowrap">
														<Clock className="h-3 w-3" />
														Expires{" "}
														{formatDistanceToNow(new Date(key.expiresAt), {
															addSuffix: true,
														})}
													</span>
												)}
											</div>
										</div>
										<div className="flex space-x-1 items-center shrink-0 self-center sm:self-auto">
											<UpdateApiKeyDialog apiKeyId={key.id} initialData={key}>
												<Button
													variant="ghost"
													size="icon"
													aria-label="Edit Key"
													className="h-8 w-8 text-muted-foreground"
												>
													<Edit className="h-4 w-4" />
												</Button>
											</UpdateApiKeyDialog>
											<AlertDialog>
												<Tooltip>
													<TooltipTrigger asChild>
														<AlertDialogTrigger asChild>
															<Button
																variant="ghost"
																size="icon"
																disabled={
																	deleteMutation.isPending &&
																	deleteMutation.variables === key.id
																}
																aria-label="Delete Key"
																className="h-8 w-8 text-red-600 hover:text-red-700"
															>
																{deleteMutation.isPending &&
																deleteMutation.variables === key.id ? (
																	<Loader2 className="h-4 w-4 animate-spin" />
																) : (
																	<Trash2 className="h-4 w-4" />
																)}
															</Button>
														</AlertDialogTrigger>
													</TooltipTrigger>
													<TooltipContent>Delete Key</TooltipContent>
												</Tooltip>
												<AlertDialogContent>
													<AlertDialogHeader>
														<AlertDialogTitle>
															Are you absolutely sure?
														</AlertDialogTitle>
														<AlertDialogDescription>
															This action cannot be undone. This will
															permanently delete the API key
															<span className="font-medium mx-1">
																{key.name || key.id}
															</span>
															and revoke its access.
														</AlertDialogDescription>
													</AlertDialogHeader>
													<AlertDialogFooter>
														<AlertDialogCancel>Cancel</AlertDialogCancel>
														<AlertDialogAction
															onClick={() => deleteMutation.mutate(key.id)}
															className="bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800"
															disabled={deleteMutation.isPending}
														>
															{deleteMutation.isPending ? (
																<Loader2 className="mr-2 h-4 w-4 animate-spin" />
															) : null}
															Yes, delete key
														</AlertDialogAction>
													</AlertDialogFooter>
												</AlertDialogContent>
											</AlertDialog>
										</div>
									</div>
								))}
							</div>
						)}
					</CardContent>
				</Card>
			</div>
		</TooltipProvider>
	);
}
