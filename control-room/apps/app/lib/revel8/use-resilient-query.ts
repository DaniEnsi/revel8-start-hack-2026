import { useQuery_experimental } from "convex/react";
import type {
	FunctionArgs,
	FunctionReference,
	FunctionReturnType,
} from "convex/server";

/** A realtime Convex query whose errors can render the legacy data fallback. */
export function useResilientQuery<Query extends FunctionReference<"query">>(
	query: Query,
	args: FunctionArgs<Query> | "skip",
): {
	value: FunctionReturnType<Query> | undefined;
	error: Error | null;
} {
	const result = useQuery_experimental({ query, args });
	if (result.status === "error")
		return { value: undefined, error: result.error };
	if (result.status === "pending") return { value: undefined, error: null };
	return { value: result.data, error: null };
}
