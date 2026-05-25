#!/usr/bin/env node
/**
 * Inspect latest Host UI smoke chat session + extension log tail (no waiting).
 * Usage: node scripts/analyze-host-ui-smoke-chat.mjs [artifacts/host-ui]
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const artifactsDir = path.resolve(root, process.argv[2] ?? "artifacts/host-ui");
const userData = path.join(artifactsDir, "HostUiSmokeUserData");
const logPath = path.join(artifactsDir, "host-ui-smoke.log");

async function newestFile(dir, filter) {
	const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
	const files = [];
	for (const entry of entries) {
		if (!entry.isFile()) {
			continue;
		}
		const full = path.join(entry.path ?? dir, entry.name);
		if (!filter(full)) {
			continue;
		}
		const st = await stat(full);
		files.push({ full, mtime: st.mtimeMs });
	}
	files.sort((a, b) => b.mtime - a.mtime);
	return files[0]?.full;
}

async function readJsonlUserTurns(jsonlPath) {
	const raw = await readFile(jsonlPath, "utf8");
	const turns = [];
	for (const line of raw.split(/\r?\n/).filter(Boolean)) {
		let row;
		try {
			row = JSON.parse(line);
		} catch {
			continue;
		}
		const requests = row?.v?.requests ?? [];
		for (const req of requests) {
			const agentId = req?.agent?.id ?? req?.result?.metadata?.agentId;
			const modelId = req?.agent?.modelId ?? req?.result?.metadata?.resolvedModel;
			const text = req?.message?.text ?? req?.message?.parts?.map((p) => p.text).join("") ?? "";
			const preview = req?.result?.metadata?.toolCallRounds?.[0]?.response?.slice?.(0, 200)
				?? req?.response?.[req.response.length - 1]?.value?.slice?.(0, 200);
			turns.push({ agentId, modelId, userText: text.slice(0, 120), responsePreview: preview });
		}
	}
	return turns;
}

async function main() {
	console.log("artifacts:", artifactsDir);
	const session = await newestFile(
		path.join(userData, "User", "workspaceStorage"),
		(p) => p.includes(`${path.sep}chatSessions${path.sep}`) && p.endsWith(".jsonl")
	);
	if (session) {
		console.log("\n=== Latest chat session ===");
		console.log(session);
		const turns = await readJsonlUserTurns(session);
		for (const [i, turn] of turns.entries()) {
			console.log(`\n--- turn ${i + 1} ---`);
			console.log("agent:", turn.agentId ?? "(unknown)");
			console.log("model:", turn.modelId ?? "(unknown)");
			console.log("user:", turn.userText);
			if (turn.responsePreview) {
				console.log("response:", turn.responsePreview);
			}
		}
	} else {
		console.log("\n(no chatSessions/*.jsonl found)");
	}

	try {
		const log = await readFile(logPath, "utf8");
		const lines = log.split(/\r?\n/).filter((l) => l.includes("host-ui-smoke.chat"));
		console.log("\n=== Copilot Bro smoke log (chat-related, last 25 lines) ===");
		for (const line of lines.slice(-25)) {
			console.log(line.slice(0, 280));
		}
		const markers = [
			"host-ui-smoke.chat.participant.request",
			"vision.native.structured.resolving",
			"vision.native.structured.completed",
			"host-ui-smoke.chat.integration.scenario.end"
		];
		console.log("\n=== Marker hits (full log) ===");
		for (const marker of markers) {
			console.log(`${marker}: ${log.includes(marker) ? "yes" : "no"}`);
		}
	} catch (error) {
		console.log("\n(log missing)", error.message);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
