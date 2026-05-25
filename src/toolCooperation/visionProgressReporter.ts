import {
	createVisionDetailsText,
	isVisionStructuredThinkingText,
	isVisionProgressDetailsText,
	renderVisionThinkingDetails,
	statusMessages
} from "./outputSemantics";

export const VISION_PROGRESS_THINKING_ID = "vision-status";

export interface VisionProgressReporter {
	append(text: string): void;
	flush(
		progress: { report(part: unknown): void },
		visible: boolean,
		emit?: (displayText: string, progress: { report(part: unknown): void }) => VisionProgressFlushMeta
	): VisionProgressFlushMeta | undefined;
	readonly chunkCount: number;
}

export interface VisionProgressFlushMeta {
	chunkCount: number;
	combinedLength: number;
	usedThinkingPart: boolean;
	hasVisionDetailsMarker: boolean;
	containsVisionPrefix: boolean;
}

export function createVisionProgressReporter(): VisionProgressReporter {
	const chunks: string[] = [];
	return {
		get chunkCount() {
			return chunks.length;
		},
		append(text: string) {
			const trimmed = text.trim();
			if (!trimmed) {
				return;
			}
			chunks.push(trimmed);
		},
		flush(progress, visible, emit) {
			if (!visible || chunks.length === 0) {
				chunks.length = 0;
				return undefined;
			}
			const combined = chunks.join("\n\n");
			const displayText = formatVisionProgressForChat(combined);
			const meta = (emit ?? defaultVisionProgressEmit)(displayText, progress);
			meta.chunkCount = chunks.length;
			meta.combinedLength = combined.length;
			recordHostUiSmokeVisionProgressFlush(meta);
			chunks.length = 0;
			return meta;
		}
	};
}

export function formatVisionProgressForChat(text: string): string {
	return isVisionStructuredThinkingText(text) ? text.trim() : createVisionDetailsText(text);
}

export function buildVisionProgressFlushMeta(displayText: string, usedThinkingPart: boolean): VisionProgressFlushMeta {
	const trimmed = displayText.trim();
	return {
		chunkCount: 0,
		combinedLength: trimmed.length,
		usedThinkingPart,
		hasVisionDetailsMarker:
			isVisionProgressDetailsText(trimmed)
			|| trimmed.includes("data-extended-models-vision-structured"),
		containsVisionPrefix: trimmed.includes(statusMessages.visionPrefix)
	};
}

function defaultVisionProgressEmit(
	displayText: string,
	progress: { report(part: unknown): void }
): VisionProgressFlushMeta {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const vscode = require("vscode") as typeof import("vscode");
	const thinkingPart = (vscode as unknown as {
		LanguageModelThinkingPart?: new (value: string, id?: string) => unknown;
	}).LanguageModelThinkingPart;
	if (thinkingPart) {
		progress.report(new thinkingPart(displayText, VISION_PROGRESS_THINKING_ID));
		return buildVisionProgressFlushMeta(displayText, true);
	}
	progress.report(new vscode.LanguageModelTextPart(renderVisionThinkingDetails(displayText)));
	return buildVisionProgressFlushMeta(displayText, false);
}

export function flushVisionProgressToChat(
	progress: import("vscode").Progress<import("vscode").LanguageModelResponsePart>,
	combinedText: string,
	chunkCount: number
): VisionProgressFlushMeta {
	const displayText = formatVisionProgressForChat(combinedText.trim());
	const meta = defaultVisionProgressEmit(displayText, progress);
	meta.chunkCount = chunkCount;
	meta.combinedLength = combinedText.trim().length;
	return meta;
}

/** Host UI smoke: last vision progress flush metadata (in-process). */
let lastHostUiSmokeVisionProgressFlush: VisionProgressFlushMeta | undefined;

export function resetHostUiSmokeVisionProgressCapture(): void {
	lastHostUiSmokeVisionProgressFlush = undefined;
}

export function recordHostUiSmokeVisionProgressFlush(meta: VisionProgressFlushMeta): void {
	if (process.env.COPILOT_BRO_UI_SMOKE !== "1") {
		return;
	}
	lastHostUiSmokeVisionProgressFlush = meta;
}

export function getLastHostUiSmokeVisionProgressFlush(): VisionProgressFlushMeta | undefined {
	return lastHostUiSmokeVisionProgressFlush;
}
