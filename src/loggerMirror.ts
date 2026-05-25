import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export function resolveMirroredLogFilePath(env: NodeJS.ProcessEnv = process.env, configuredPath?: string): string | undefined {
	const raw = configuredPath?.trim() || env.COPILOT_BRO_LOG_FILE?.trim();
	if (!raw) {
		return undefined;
	}
	return path.resolve(raw);
}

export function appendMirroredLogLine(filePath: string | undefined, line: string): void {
	if (!filePath) {
		return;
	}
	mkdirSync(path.dirname(filePath), { recursive: true });
	appendFileSync(filePath, `${line}\n`, "utf8");
}