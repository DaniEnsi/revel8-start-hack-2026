import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";

test("dashboard HTML requires the Better Auth session cookie", async () => {
	const response = await proxy(
		new NextRequest("http://localhost/dashboard/runs/example"),
	);
	assert.equal(response.status, 307);
	const location = new URL(response.headers.get("location") ?? "");
	assert.equal(location.pathname, "/sign-in");
	assert.equal(location.searchParams.get("from"), "/dashboard/runs/example");
});

test("launcher APIs reject unauthenticated requests before reaching a route", async () => {
	const response = await proxy(
		new NextRequest("http://localhost/api/revel8/runs", { method: "POST" }),
	);
	assert.equal(response.status, 401);
	assert.deepEqual(await response.json(), {
		detail: "authentication required",
	});
});

