import { spawn } from "node:child_process";
import { mkdirSync, rmdirSync } from "node:fs";
import { createConnection } from "node:net";
import { z } from "zod";

const sessionId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/);
export const launcherSchema = z.object({
	id: z.string().uuid(),
	pid: z.number().int().positive(),
	args: z.array(z.string()),
	target: z.string(),
	started: z.number(),
	sessionId: sessionId.nullable(),
	models: z.object({ planner: z.string(), writer: z.string() }),
	status: z.enum(["starting", "running", "stopped", "completed", "failed"]),
});
export type Launcher = z.infer<typeof launcherSchema>;

export const launcherStateSchema = launcherSchema.pick({
	sessionId: true,
	status: true,
});

function socketDirectory(id: string) {
	return `/tmp/revel8-${id}`;
}

function socketPath(id: string) {
	return `${socketDirectory(id)}/s`;
}

// The supervisor owns the Python child and its output even if Next exits.
// It is the only process that can signal the child, through its own Popen handle.
const supervisor = String.raw`
import json, os, re, socket, subprocess, sys, threading, time

endpoint, folder, launch_id, target, *args = sys.argv[1:]
pid = os.getpid()
state = {"status": "starting", "sessionId": None}
server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
os.umask(0o077)
server.bind(endpoint)
server.listen(8)
server.settimeout(0.1)
child = None
reader = None
stop_requested = False

def save():
    temporary = os.path.join(folder, "state.tmp")
    with open(temporary, "w") as output:
        json.dump(state, output)
    os.replace(temporary, os.path.join(folder, "state.json"))

def read_session():
    for line in child.stdout:
        match = re.match(r"^\[\d\d:\d\d:\d\d\] session ([A-Za-z0-9][A-Za-z0-9_.:-]{0,199}) started — target=([^ ]+) ", line)
        if match and match[2] == target and state["sessionId"] is None:
            state["sessionId"] = match[1]
            save()

deadline = time.monotonic() + 30
try:
    while True:
        if child is None:
            if os.path.exists(os.path.join(folder, "go")):
                child = subprocess.Popen(
                    [sys.executable, *args], stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
                )
                state["status"] = "running"
                save()
                reader = threading.Thread(target=read_session, daemon=True)
                reader.start()
            elif time.monotonic() >= deadline:
                break
        elif child.poll() is not None:
            break
        try:
            connection, _ = server.accept()
        except socket.timeout:
            continue
        with connection:
            connection.settimeout(0.2)
            try:
                with connection.makefile("rb") as request:
                    command = json.loads(request.readline(65536))
                if command.get("identity") != [launch_id, pid, args]:
                    continue
                if command.get("stop"):
                    if child is None or child.poll() is not None:
                        continue
                    child.terminate()
                    stop_requested = True
                connection.sendall(b"ok\n")
            except (OSError, ValueError, AttributeError):
                continue
finally:
    if reader is not None:
        reader.join(timeout=1)
    state["status"] = ("stopped" if stop_requested else
                       "completed" if child is not None and child.returncode == 0 else "failed")
    try:
        save()
    finally:
        server.close()
        os.unlink(endpoint)
        os.rmdir(os.path.dirname(endpoint))
`;

export function spawnLauncher(
	launcher: Pick<Launcher, "id" | "target" | "args" | "models">,
	root: string,
	folder: string,
) {
	mkdirSync(socketDirectory(launcher.id), { mode: 0o700 });
	const child = spawn(
		process.env.REVEL8_PYTHON || "python3",
		[
			"-c",
			supervisor,
			socketPath(launcher.id),
			folder,
			launcher.id,
			launcher.target,
			...launcher.args,
		],
		{
			cwd: root,
			env: {
				...process.env,
				PLANNER_MODEL: launcher.models.planner,
				WRITER_MODEL: launcher.models.writer,
			},
			detached: true,
			stdio: "ignore",
		},
	);
	child.on("error", (error) => {
		rmdirSync(socketDirectory(launcher.id), { recursive: false });
		console.error("[revel8] launcher error", error.message);
	});
	child.unref();
	return child.pid;
}

export async function contactLauncher(
	launcher: Launcher,
	stop = false,
): Promise<"match" | "missing" | "unknown"> {
	return new Promise((resolve) => {
		const socket = createConnection(socketPath(launcher.id));
		const finish = (result: "match" | "missing" | "unknown") => {
			socket.destroy();
			resolve(result);
		};
		socket.setTimeout(750, () => finish("unknown"));
		socket.once("error", (error: NodeJS.ErrnoException) =>
			finish(
				error.code === "ENOENT" || error.code === "ECONNREFUSED"
					? "missing"
					: "unknown",
			),
		);
		socket.once("close", () => resolve("missing"));
		socket.once("connect", () =>
			socket.write(
				`${JSON.stringify({ identity: [launcher.id, launcher.pid, launcher.args], stop })}\n`,
			),
		);
		let reply = "";
		socket.on("data", (data: Buffer) => {
			reply += data.toString("utf8");
			if (reply.length >= 3) finish(reply === "ok\n" ? "match" : "missing");
		});
	});
}
