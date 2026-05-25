import * as vscode from "vscode";
import { formatSmokeLogEvidenceLine, recordHostUiSmokeLogLine } from "./smokeLogBridge/smokeLogEvidence";
import { appendMirroredLogLine, resolveMirroredLogFilePath } from "./loggerMirror";
import type { LogLevel } from "./types";

const LEVELS: Record<Exclude<LogLevel, "off">, number> = {
	error: 1,
	warn: 2,
	info: 3,
	debug: 4
};

export class Logger {
	private readonly channel = vscode.window.createOutputChannel("Copilot Bro");
	private level: LogLevel = "info";

	setLevel(level: LogLevel): void {
		this.level = level;
	}

	show(): void {
		this.channel.show(true);
	}

	error(message: string, data?: unknown): void {
		this.write("error", message, data);
	}

	warn(message: string, data?: unknown): void {
		this.write("warn", message, data);
	}

	info(message: string, data?: unknown): void {
		this.write("info", message, data);
	}

	debug(message: string, data?: unknown): void {
		this.write("debug", message, data);
	}

	dispose(): void {
		this.channel.dispose();
	}

	private write(level: Exclude<LogLevel, "off">, message: string, data?: unknown): void {
		if (this.level === "off" || LEVELS[level] > LEVELS[this.level]) {
			return;
		}
		const timestamp = new Date().toISOString();
		const suffix = data === undefined ? "" : ` ${JSON.stringify(redact(data))}`;
		const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${suffix}`;
		if (process.env.COPILOT_BRO_UI_SMOKE === "1") {
			recordHostUiSmokeLogLine(formatSmokeLogEvidenceLine(message, data, redact));
		}
		this.channel.appendLine(line);
		try {
			const mirroredLogFilePath = resolveMirroredLogFilePath(
				process.env,
				vscode.workspace.getConfiguration("extendedModels").get<string>("automationLogFile")
			);
			appendMirroredLogLine(mirroredLogFilePath, line);
		} catch {
			// File mirroring is best-effort and must not break runtime logging.
		}
	}
}

export function redact(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => redact(item));
	}
	if (!value || typeof value !== "object") {
		return value;
	}

	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (isSensitiveKey(key)) {
			out[key] = "[REDACTED]";
		} else {
			out[key] = redact(item);
		}
	}
	return out;
}

function isSensitiveKey(key: string): boolean {
	const normalized = key.toLowerCase();
	return normalized.includes("authorization")
		|| normalized.includes("api-key")
		|| normalized.includes("apikey")
		|| normalized.includes("token")
		|| normalized.includes("secret")
		|| normalized.includes("password");
}
