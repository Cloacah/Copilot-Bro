import { readFile, stat } from "node:fs/promises";

export type HostUiSmokeChatWaitFailure = {
	kind: "participant-failed" | "submit-failed" | "scenario-failed" | "integration-failed" | "request-failed" | "lm-error" | "wrong-participant";
	message: string;
	logLine?: string;
};

/** Copilot default agent answered instead of @bro-smoke (Ask mode / mention routing). */
const WRONG_CHAT_PARTICIPANT_OUTPUT_PATTERNS = [
	/can't execute those extension-specific commands/i,
	/cannot execute those extension-specific commands/i,
	/sent to me \(GitHub Copilot\)/i,
	/switch the chat participant to/i,
	/select \*\*@bro-smoke\*\* from the chat participant/i
] as const;

export function detectWrongChatParticipantRouting(preview: string | undefined): string | undefined {
	if (!preview?.trim()) {
		return undefined;
	}
	for (const pattern of WRONG_CHAT_PARTICIPANT_OUTPUT_PATTERNS) {
		if (pattern.test(preview)) {
			return `Chat routed to GitHub Copilot instead of @bro-smoke (matched ${pattern}).`;
		}
	}
	return undefined;
}

export type HostUiSmokeChatSubmitOutcome =
	| { status: "submitted" }
	| { status: "failed"; failure: HostUiSmokeChatWaitFailure };

export type HostUiSmokeChatParticipantOutcome =
	| { status: "completed"; responsePreview?: string }
	| { status: "failed"; failure: HostUiSmokeChatWaitFailure };

export type HostUiSmokeLogWaitOptions = {
	/** Called on each poll (e.g. periodic VS Code refocus while waiting for extension logs). */
	onPoll?: () => void | Promise<void>;
};

export type ChatParticipantWaitOptions = HostUiSmokeLogWaitOptions & {
	/** Wait for integration suite terminal markers, not an early participant.end. */
	requireIntegrationSuite?: boolean;
	/** After terminal success, keep polling for late failures (Copilot UI / async logs). */
	postFinishedGraceMs?: number;
};

/** Log lines that prove the submit command reached the extension (palette or auto-submit). */
export const CHAT_OPEN_ACK_MARKERS = [
	"host-ui-smoke.command.run-chat-suite.invoked",
	"host-ui-smoke.chat.open.start",
	"host-ui-smoke.chat.open.end"
] as const;

export const CHAT_SUBMIT_ACK_MARKERS = [
	"host-ui-smoke.command.submit-chat-request.invoked",
	"host-ui-smoke.command.run-chat-suite.invoked",
	"host-ui-smoke.chat.submit.start",
	"host-ui-smoke.chat.open.auto-submit.scheduled"
] as const;

/** True when a log line emits `event` (avoids matching the event name inside JSON payloads). */
export function hostUiSmokeLogTailHasEvent(logTail: string, event: string): boolean {
	const needle = `] ${event}`;
	return logTail.split(/\r?\n/).some((line) => line.includes(needle));
}

export function logTailIncludesChatOpenAck(logTail: string): boolean {
	return CHAT_OPEN_ACK_MARKERS.some((marker) => hostUiSmokeLogTailHasEvent(logTail, marker));
}

export function logTailIncludesChatSubmitAck(logTail: string): boolean {
	return CHAT_SUBMIT_ACK_MARKERS.some((marker) => hostUiSmokeLogTailHasEvent(logTail, marker))
		|| hostUiSmokeLogTailHasEvent(logTail, "host-ui-smoke.chat.submit.end");
}

const MARKER_COUNTS = [
	["host-ui-smoke.chat.integration.scenario.start", "host-ui-smoke.chat.integration.scenario.end"],
	["host-ui-smoke.chat.scenario.start", "host-ui-smoke.chat.scenario.end"]
] as const;

/** Byte offset in the mirrored smoke log — only scan content appended after this point. */
export async function getLogByteOffset(logFilePath: string): Promise<number> {
	try {
		const fileStat = await stat(logFilePath);
		return fileStat.size;
	} catch {
		return 0;
	}
}

export async function readLogFromOffset(logFilePath: string, byteOffset: number): Promise<string> {
	const content = await readFile(logFilePath, "utf8").catch(() => "");
	if (byteOffset <= 0) {
		return content;
	}
	if (byteOffset >= content.length) {
		return "";
	}
	return content.slice(byteOffset);
}

export function extractLogPayloadFromLines<T>(lines: readonly string[], message: string): T | undefined {
	for (const line of lines) {
		const index = line.indexOf(message);
		if (index < 0) {
			continue;
		}
		const payloadText = line.slice(index + message.length).trim();
		if (!payloadText.startsWith("{") && !payloadText.startsWith("[")) {
			continue;
		}
		try {
			return JSON.parse(payloadText) as T;
		} catch {
			continue;
		}
	}
	return undefined;
}

function parseJsonPayloadAfterMarker(line: string, marker: string): Record<string, unknown> | undefined {
	const index = line.indexOf(marker);
	if (index < 0) {
		return undefined;
	}
	const payloadText = line.slice(index + marker.length).trim();
	if (!payloadText.startsWith("{")) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(payloadText) as unknown;
		return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

function isExplicitLogOkFalse(payload: Record<string, unknown> | undefined): boolean {
	return payload?.ok === false;
}

function previewFromPayload(payload: Record<string, unknown> | undefined): string | undefined {
	const message = typeof payload?.message === "string" ? payload.message : undefined;
	const responseText = typeof payload?.responseText === "string" ? payload.responseText : undefined;
	const preview = typeof payload?.preview === "string" ? payload.preview : undefined;
	return message ?? preview ?? (responseText ? responseText.slice(0, 240) : undefined);
}

/**
 * Scan new log tail for chat failures (fail fast) or terminal success markers.
 */
export function scanChatLogTail(logTail: string): {
	failure?: HostUiSmokeChatWaitFailure;
	submitEnd?: boolean;
	participantEnd?: HostUiSmokeChatParticipantOutcome;
	participantFinished?: HostUiSmokeChatParticipantOutcome;
	lastOutputPreview?: string;
} {
	const lines = logTail.split(/\r?\n/).filter((line) => line.trim().length > 0);
	let lastOutputPreview: string | undefined;

	for (const line of lines) {
		if (line.includes("host-ui-smoke.chat.output")) {
			const payload = parseJsonPayloadAfterMarker(line, "host-ui-smoke.chat.output");
			const preview = previewFromPayload(payload);
			if (preview) {
				lastOutputPreview = preview;
				const wrongParticipant = detectWrongChatParticipantRouting(preview);
				if (wrongParticipant) {
					return {
						failure: {
							kind: "wrong-participant",
							message: wrongParticipant,
							logLine: line
						},
						lastOutputPreview
					};
				}
			}
		}
		if (line.includes("host-ui-smoke.chat.lm.error")) {
			const payload = parseJsonPayloadAfterMarker(line, "host-ui-smoke.chat.lm.error");
			return {
				failure: {
					kind: "lm-error",
					message: previewFromPayload(payload) ?? "Language model request failed during host UI smoke chat.",
					logLine: line
				},
				lastOutputPreview
			};
		}
		if (line.includes("host-ui-smoke.chat.submit.failed")) {
			const payload = parseJsonPayloadAfterMarker(line, "host-ui-smoke.chat.submit.failed");
			return {
				failure: {
					kind: "submit-failed",
					message: previewFromPayload(payload) ?? "Host UI smoke chat submit failed.",
					logLine: line
				},
				lastOutputPreview
			};
		}
		if (line.includes("host-ui-smoke.chat.participant.failed")) {
			const payload = parseJsonPayloadAfterMarker(line, "host-ui-smoke.chat.participant.failed");
			return {
				failure: {
					kind: "participant-failed",
					message: previewFromPayload(payload) ?? "Host UI smoke chat participant reported failure.",
					logLine: line
				},
				lastOutputPreview
			};
		}
		if (line.includes("host-ui-smoke.chat.scenario.end")) {
			const payload = parseJsonPayloadAfterMarker(line, "host-ui-smoke.chat.scenario.end");
			if (isExplicitLogOkFalse(payload)) {
				return {
					failure: {
						kind: "scenario-failed",
						message: `Chat scenario ${String(payload?.scenarioId ?? "?")} failed: ${String(payload?.received ?? previewFromPayload(payload) ?? "unknown")}`,
						logLine: line
					},
					lastOutputPreview
				};
			}
		}
		if (line.includes("host-ui-smoke.chat.integration.scenario.end")) {
			const payload = parseJsonPayloadAfterMarker(line, "host-ui-smoke.chat.integration.scenario.end");
			if (isExplicitLogOkFalse(payload) && payload?.skipped !== true) {
				return {
					failure: {
						kind: "integration-failed",
						message: `Chat integration scenario ${String(payload?.scenarioId ?? "?")} failed: ${previewFromPayload(payload) ?? JSON.stringify(payload)}`,
						logLine: line
					},
					lastOutputPreview
				};
			}
		}
		if (line.includes("host-ui-smoke.chat.integration.scenario.failed")) {
			const payload = parseJsonPayloadAfterMarker(line, "host-ui-smoke.chat.integration.scenario.failed");
			return {
				failure: {
					kind: "integration-failed",
					message: previewFromPayload(payload) ?? "Chat integration scenario failed.",
					logLine: line
				},
				lastOutputPreview
			};
		}
		if (line.includes("host-ui-smoke.chat.consistency.end")) {
			const payload = parseJsonPayloadAfterMarker(line, "host-ui-smoke.chat.consistency.end");
			if (isExplicitLogOkFalse(payload)) {
				const failedChecks = Array.isArray(payload?.checks)
					? payload.checks.filter((c) => c && typeof c === "object" && (c as { ok?: boolean }).ok === false)
					: [];
				const detail = failedChecks.length > 0
					? failedChecks.map((c) => (c as { id?: string }).id).filter(Boolean).join(", ")
					: "consistency checks failed";
				return {
					failure: {
						kind: "integration-failed",
						message: `Chat integration consistency checks failed: ${detail}`,
						logLine: line
					},
					lastOutputPreview
				};
			}
		}
		if (line.includes("host-ui-smoke.chat.integration.suite.summary")) {
			const payload = parseJsonPayloadAfterMarker(line, "host-ui-smoke.chat.integration.suite.summary");
			if (isExplicitLogOkFalse(payload)) {
				return {
					failure: {
						kind: "integration-failed",
						message: "Chat integration suite summary reported ok:false.",
						logLine: line
					},
					lastOutputPreview
				};
			}
		}
		if (line.includes("host-ui-smoke.request.run.failed")) {
			const payload = parseJsonPayloadAfterMarker(line, "host-ui-smoke.request.run.failed");
			return {
				failure: {
					kind: "request-failed",
					message: previewFromPayload(payload) ?? "Host UI smoke request command failed.",
					logLine: line
				},
				lastOutputPreview
			};
		}
	}

	let submitEnd = false;
	let participantEnd: HostUiSmokeChatParticipantOutcome | undefined;
	let participantFinished: HostUiSmokeChatParticipantOutcome | undefined;
	for (const line of lines) {
		if (line.includes("host-ui-smoke.chat.submit.end")) {
			submitEnd = true;
		}
		if (line.includes("host-ui-smoke.chat.participant.finished")) {
			const payload = parseJsonPayloadAfterMarker(line, "host-ui-smoke.chat.participant.finished");
			if (isExplicitLogOkFalse(payload)) {
				participantFinished = {
					status: "failed",
					failure: {
						kind: "participant-failed",
						message: previewFromPayload(payload) ?? "Chat participant finished with ok:false",
						logLine: line
					}
				};
			} else {
				participantFinished = {
					status: "completed",
					responsePreview: previewFromPayload(payload)
				};
			}
		}
		if (line.includes("host-ui-smoke.chat.participant.end")) {
			const payload = parseJsonPayloadAfterMarker(line, "host-ui-smoke.chat.participant.end");
			if (isExplicitLogOkFalse(payload)) {
				participantEnd = {
					status: "failed",
					failure: {
						kind: "participant-failed",
						message: previewFromPayload(payload) ?? String(payload?.reason ?? "participant ended with ok:false"),
						logLine: line
					}
				};
			}
		}
	}

	return { submitEnd, participantEnd, participantFinished, lastOutputPreview };
}

export function isChatParticipantWorkInProgress(
	logTail: string,
	options: Pick<ChatParticipantWaitOptions, "requireIntegrationSuite">
): boolean {
	if (!logTail.includes("host-ui-smoke.chat.participant.request")) {
		const wrongPreview = detectWrongChatParticipantRouting(scanChatLogTail(logTail).lastOutputPreview);
		if (wrongPreview) {
			return false;
		}
		return logTail.includes("host-ui-smoke.chat.submit.end")
			|| logTail.includes("host-ui-smoke.command.submit-chat-request.invoked");
	}
	for (const [startMarker, endMarker] of MARKER_COUNTS) {
		const starts = countMarker(logTail, startMarker);
		const ends = countMarker(logTail, endMarker);
		if (starts > ends) {
			return true;
		}
	}
	if (options.requireIntegrationSuite) {
		if (!logTail.includes("host-ui-smoke.chat.consistency.end")) {
			return true;
		}
		if (!logTail.includes("host-ui-smoke.chat.integration.suite.summary")) {
			return true;
		}
	}
	return false;
}

function countMarker(text: string, marker: string): number {
	let count = 0;
	let index = 0;
	while ((index = text.indexOf(marker, index)) >= 0) {
		count += 1;
		index += marker.length;
	}
	return count;
}

function extractLastPayload(text: string, marker: string): Record<string, unknown> | undefined {
	const lines = text.split(/\r?\n/);
	for (let i = lines.length - 1; i >= 0; i -= 1) {
		const payload = parseJsonPayloadAfterMarker(lines[i] ?? "", marker);
		if (payload) {
			return payload;
		}
	}
	return undefined;
}

function resolveTerminalParticipantOutcome(
	scan: ReturnType<typeof scanChatLogTail>,
	options: ChatParticipantWaitOptions
): HostUiSmokeChatParticipantOutcome | undefined {
	if (scan.failure) {
		return { status: "failed", failure: scan.failure };
	}
	if (scan.participantEnd?.status === "failed") {
		return scan.participantEnd;
	}
	const finished = scan.participantFinished;
	if (finished?.status === "failed") {
		return finished;
	}
	if (finished?.status === "completed") {
		return finished;
	}
	return undefined;
}

export function formatChatWaitProgress(lastOutputPreview: string | undefined, logTail: string): string {
	const tailLines = logTail.split(/\r?\n/).filter((line) => line.includes("host-ui-smoke.chat"));
	const recent = tailLines.slice(-3).map((line) => line.slice(0, 220));
	const parts = [
		lastOutputPreview ? `chatOutput=${JSON.stringify(lastOutputPreview.slice(0, 160))}` : undefined,
		recent.length > 0 ? `recentLog=${JSON.stringify(recent)}` : undefined
	].filter(Boolean);
	return parts.join(" ");
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForChatSubmitOutcome(
	logFilePath: string,
	byteOffset: number,
	timeoutMs: number,
	onProgress?: (detail: string) => void,
	options: HostUiSmokeLogWaitOptions = {}
): Promise<HostUiSmokeChatSubmitOutcome> {
	const deadline = Date.now() + timeoutMs;
	let lastProgressAt = 0;
	while (Date.now() < deadline) {
		await options.onPoll?.();
		const tail = await readLogFromOffset(logFilePath, byteOffset);
		const scan = scanChatLogTail(tail);
		if (scan.failure) {
			throw new Error(`Host UI smoke chat submit failed (${scan.failure.kind}): ${scan.failure.message}`);
		}
		if (scan.submitEnd) {
			return { status: "submitted" };
		}
		if (onProgress && Date.now() - lastProgressAt >= 5_000) {
			onProgress(formatChatWaitProgress(scan.lastOutputPreview, tail) || "waiting for chat.submit.end");
			lastProgressAt = Date.now();
		}
		await delay(200);
	}
	const tail = await readLogFromOffset(logFilePath, byteOffset);
	throw new Error(
		`Timed out waiting for host-ui-smoke.chat.submit.end. ${formatChatWaitProgress(scanChatLogTail(tail).lastOutputPreview, tail)}`
	);
}

export async function waitForChatParticipantOutcome(
	logFilePath: string,
	byteOffset: number,
	timeoutMs: number,
	onProgress?: (detail: string) => void,
	options: ChatParticipantWaitOptions = {}
): Promise<HostUiSmokeChatParticipantOutcome> {
	const deadline = Date.now() + timeoutMs;
	let lastProgressAt = 0;
	let lastReportedPreview = "";
	let finishedAt = 0;
	while (Date.now() < deadline) {
		await options.onPoll?.();
		const tail = await readLogFromOffset(logFilePath, byteOffset);
		const scan = scanChatLogTail(tail);
		const terminal = resolveTerminalParticipantOutcome(scan, options);
		if (terminal?.status === "failed") {
			return terminal;
		}
		if (terminal?.status === "completed") {
			if (isChatParticipantWorkInProgress(tail, options)) {
				if (onProgress && Date.now() - lastProgressAt >= 5_000) {
					onProgress("participant.finished seen but integration/scenario work still in progress");
					lastProgressAt = Date.now();
				}
			} else if (finishedAt === 0) {
				finishedAt = Date.now();
			} else if (Date.now() - finishedAt >= (options.postFinishedGraceMs ?? 12_000)) {
				const lateScan = scanChatLogTail(await readLogFromOffset(logFilePath, byteOffset));
				const late = resolveTerminalParticipantOutcome(lateScan, options);
				if (late?.status === "failed") {
					return late;
				}
				return terminal;
			}
		} else if (onProgress) {
			const preview = scan.lastOutputPreview ?? "";
			const inProgress = isChatParticipantWorkInProgress(tail, options);
			const shouldReport = Date.now() - lastProgressAt >= 5_000
				|| (preview.length > 0 && preview !== lastReportedPreview);
			if (shouldReport) {
				const phase = inProgress ? "in-progress" : "waiting for chat.participant.finished";
				onProgress(formatChatWaitProgress(preview, tail) || phase);
				lastProgressAt = Date.now();
				lastReportedPreview = preview;
			}
		}
		await delay(250);
	}
	const tail = await readLogFromOffset(logFilePath, byteOffset);
	const scan = scanChatLogTail(tail);
	const terminal = resolveTerminalParticipantOutcome(scan, options);
	if (terminal?.status === "failed") {
		return terminal;
	}
	return {
		status: "failed",
		failure: {
			kind: "participant-failed",
			message: `Timed out waiting for host-ui-smoke.chat.participant.finished. ${formatChatWaitProgress(scan.lastOutputPreview, tail)} inProgress=${isChatParticipantWorkInProgress(tail, options)}`
		}
	};
}
