import { appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let registeredGlobalStoragePath: string | undefined;

/** Called from extension activate so runtime logs stay outside the workspace. */
export function registerCopilotBroLogStoragePath(fsPath: string): void {
	registeredGlobalStoragePath = fsPath?.trim() || undefined;
}

export type CopilotBroLogPathInput = {
	env?: NodeJS.ProcessEnv;
	automationLogFile?: string;
	globalStoragePath?: string;
	now?: Date;
};

/** Directory for mirrored automation logs and vision-proxy conversation JSONL. */
export function resolveCopilotBroLogDirectory(input: CopilotBroLogPathInput = {}): string {
	const env = input.env ?? process.env;
	const automation = input.automationLogFile?.trim() || env.COPILOT_BRO_LOG_FILE?.trim();
	if (automation) {
		return path.dirname(path.resolve(automation));
	}
	const storage = input.globalStoragePath?.trim() || registeredGlobalStoragePath?.trim();
	if (storage) {
		return path.join(storage, "logs");
	}
	const home = env.USERPROFILE?.trim() || env.HOME?.trim();
	if (home) {
		return path.join(home, ".copilot-bro", "logs");
	}
	return path.join(os.tmpdir(), "copilot-bro", "logs");
}

export function isVisionProxyConversationLogDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const flag = env.COPILOT_BRO_VISION_PROXY_CONVO_LOG?.trim().toLowerCase();
	return flag === "0" || flag === "false" || flag === "off";
}

export type VisionProxyConvoContentMode = "none" | "preview" | "full";

/**
 * Controls whether chunk-level streaming events are logged.
 * Default: disabled (reduce log volume + repeated lines).
 */
export function isVisionProxyConversationChunkLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const flag = env.COPILOT_BRO_VISION_PROXY_CONVO_LOG_CHUNKS?.trim().toLowerCase();
	return flag === "1" || flag === "true" || flag === "on";
}

/**
 * Controls whether we include the model's raw text in the conversation log.
 * Default: preview (enough to diagnose JSON/format issues without huge logs).
 */
export function resolveVisionProxyConversationContentMode(env: NodeJS.ProcessEnv = process.env): VisionProxyConvoContentMode {
	const raw = env.COPILOT_BRO_VISION_PROXY_CONVO_LOG_CONTENT?.trim().toLowerCase();
	if (!raw) {
		return "preview";
	}
	if (raw === "0" || raw === "false" || raw === "off" || raw === "none") {
		return "none";
	}
	if (raw === "full") {
		return "full";
	}
	return "preview";
}

export type VisionProxyConvoPreviewLimits = {
	headChars: number;
	tailChars: number;
	maxFullChars: number;
};

export function resolveVisionProxyConversationPreviewLimits(env: NodeJS.ProcessEnv = process.env): VisionProxyConvoPreviewLimits {
	const clampInt = (value: string | undefined, fallback: number, min: number, max: number): number => {
		const n = value ? Number.parseInt(value, 10) : Number.NaN;
		if (!Number.isFinite(n)) {
			return fallback;
		}
		return Math.min(max, Math.max(min, n));
	};
	return {
		headChars: clampInt(env.COPILOT_BRO_VISION_PROXY_CONVO_PREVIEW_HEAD_CHARS, 2000, 0, 50_000),
		tailChars: clampInt(env.COPILOT_BRO_VISION_PROXY_CONVO_PREVIEW_TAIL_CHARS, 1000, 0, 50_000),
		maxFullChars: clampInt(env.COPILOT_BRO_VISION_PROXY_CONVO_MAX_FULL_CHARS, 200_000, 0, 2_000_000)
	};
}

/**
 * Default-on JSONL path for vision proxy/native structured passes.
 * Honors COPILOT_BRO_VISION_PROXY_CONVO_LOG_FILE (absolute or relative to log dir).
 */
export function resolveVisionProxyConversationLogFilePath(input: CopilotBroLogPathInput = {}): string | undefined {
	const env = input.env ?? process.env;
	if (isVisionProxyConversationLogDisabled(env)) {
		return undefined;
	}
	const configured = env.COPILOT_BRO_VISION_PROXY_CONVO_LOG_FILE?.trim();
	if (configured) {
		return path.isAbsolute(configured)
			? configured
			: path.join(resolveCopilotBroLogDirectory(input), configured);
	}
	const now = input.now ?? new Date();
	return path.join(resolveCopilotBroLogDirectory(input), `vision-proxy-convo-${formatVisionConvoLogStamp(now)}.jsonl`);
}

export function appendVisionProxyConversationLog(filePath: string | undefined, obj: unknown): void {
	if (!filePath) {
		return;
	}
	try {
		mkdirSync(path.dirname(filePath), { recursive: true });
		appendFileSync(filePath, `${JSON.stringify(obj)}\n`, "utf8");
	} catch {
		// Best-effort: never break vision runtime.
	}
}

function formatVisionConvoLogStamp(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return [
		date.getUTCFullYear(),
		pad(date.getUTCMonth() + 1),
		pad(date.getUTCDate()),
		"-",
		pad(date.getUTCHours()),
		pad(date.getUTCMinutes()),
		pad(date.getUTCSeconds())
	].join("");
}
