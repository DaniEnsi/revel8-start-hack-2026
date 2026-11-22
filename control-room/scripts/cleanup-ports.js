const { execSync } = require("child_process");

const ports = [3000, 3001];

console.log("🧹 Clearing dangling dev servers on ports:", ports.join(", "));

for (const port of ports) {
	try {
		// Find PIDs running on the port
		const stdout = execSync(`lsof -t -i :${port}`, { encoding: "utf8" }).trim();
		if (stdout) {
			const pids = stdout.split("\n").filter(Boolean);
			console.log(
				`👉 Port ${port} is occupied by PID(s): ${pids.join(", ")}. Killing...`,
			);
			for (const pid of pids) {
				try {
					// Attempt to kill gracefully, or with SIGKILL if needed
					process.kill(Number(pid), "SIGKILL");
					console.log(`✅ Killed PID ${pid} on port ${port}`);
				} catch (killErr) {
					// If process.kill fails, try shell command kill -9
					try {
						execSync(`kill -9 ${pid}`);
						console.log(`✅ Killed PID ${pid} via shell on port ${port}`);
					} catch (e) {
						console.warn(`⚠️ Failed to kill PID ${pid}: ${e.message}`);
					}
				}
			}
		}
	} catch (err) {
		// lsof returns exit status 1 if no process is found on that port, which is expected and totally fine
	}
}

console.log("✨ Port cleanup completed successfully!");
process.exit(0);
