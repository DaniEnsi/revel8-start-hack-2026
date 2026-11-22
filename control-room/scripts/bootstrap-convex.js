const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const CONVEX_URL = "http://127.0.0.1:3210";

function updateEnv(envPath, adminKey) {
	if (!fs.existsSync(envPath)) return;
	let content = fs.readFileSync(envPath, "utf8");

	content = content
		.split("\n")
		.filter((line) => {
			const trimmed = line.trim();
			return (
				!trimmed.startsWith("CONVEX_SELF_HOSTED_URL") &&
				!trimmed.startsWith("CONVEX_SELF_HOSTED_ADMIN_KEY") &&
				!trimmed.startsWith("NEXT_PUBLIC_CONVEX_URL") &&
				!trimmed.startsWith("CONVEX_URL=")
			);
		})
		.join("\n");

	content += `\nCONVEX_SELF_HOSTED_URL=${CONVEX_URL}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}\nNEXT_PUBLIC_CONVEX_URL=${CONVEX_URL}\nCONVEX_URL=${CONVEX_URL}\n`;

	fs.writeFileSync(envPath, content, "utf8");
	console.log(`Updated ${envPath}`);
}

async function waitForConvex() {
	const maxAttempts = 120;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		try {
			const response = await fetch(`${CONVEX_URL}/version`);
			if (response.ok) {
				console.log("Convex backend is ready.");
				return;
			}
		} catch {
			// retry
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	throw new Error(
		`Convex backend did not become ready at ${CONVEX_URL} within ${maxAttempts}s.`,
	);
}

async function main() {
	console.log("Waiting for Convex backend...");
	await waitForConvex();

	console.log("Generating Convex admin key...");
	const adminKey = execSync(
		"docker compose exec -T convex ./generate_admin_key.sh",
		{ cwd: ROOT, encoding: "utf8" },
	).trim();

	if (!adminKey) {
		throw new Error("Failed to generate Convex admin key.");
	}

	updateEnv(path.join(ROOT, "apps/app/.env"), adminKey);
	updateEnv(path.join(ROOT, ".env"), adminKey);
	updateEnv(path.join(ROOT, ".env.local"), adminKey);

	const dbEnvPath = path.join(ROOT, "packages/database/.env");
	if (!fs.existsSync(dbEnvPath)) {
		fs.writeFileSync(dbEnvPath, "", "utf8");
	}
	updateEnv(dbEnvPath, adminKey);
}

main().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
