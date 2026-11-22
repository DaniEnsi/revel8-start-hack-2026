const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

if (
	process.env.VERCEL === "1" ||
	process.env.VERCEL === "true" ||
	process.env.CI === "true" ||
	process.env.CI === "1"
) {
	console.log("Skipping db:generate in Vercel/CI environment.");
	process.exit(0);
}

try {
	execSync("node ../../scripts/bootstrap-convex.js && convex dev --once", {
		stdio: "inherit",
	});

	const hasInitFile = fs.existsSync(
		path.join(__dirname, "../packages/database/convex/init.ts"),
	);
	if (hasInitFile) {
		console.log("Running local admin user seeding...");
		execSync("npx convex run init:seedUser", { stdio: "inherit" });
	} else {
		console.log("No init.ts file found, skipping seedUser step.");
	}
} catch (error) {
	console.error("db:generate failed:", error.message);
	process.exit(1);
}
