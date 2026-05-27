import type { LanguageModelResponsePart } from "vscode";
import type { Logger } from "../logger";
import {
	createChatDebugDetailsText,
	formatVisionProgressForChatCollapsible,
	renderVisionCollapsibleBlock,
	type VisionCollapsibleCategory
} from "../toolCooperation/outputSemantics";
import {
	buildVisionProgressFlushMeta,
	type VisionProgressFlushMeta
} from "../toolCooperation/visionProgressReporter";
export type VisionChatProgress = { report(part: LanguageModelResponsePart): void };

export interface VisionRouteReporter {
	appendProgress(text: string): void;
	flushProgress(): void;
	reportChatDebug(text: string): void;
}

/** Single Chat UI exit for collapsible vision/debug blocks (always TextPart + details HTML). */
export function emitVisionChatProgress(progress: VisionChatProgress, visible: boolean, collapsibleHtml: string): void {
	if (!visible) {
		return;
	}
	const trimmed = collapsibleHtml.trim();
	if (!trimmed) {
		return;
	}
	progress.report({ value: trimmed } as LanguageModelResponsePart);
}

export interface VisionChatSurface {
	appendRawLine(line: string): void;
	emitCollapsible(progress: VisionChatProgress, visible: boolean, category: VisionCollapsibleCategory, summary: string, body: string, options?: { structured?: boolean }): void;
	emitCompatDebug(progress: VisionChatProgress, visible: boolean, text: string): void;
	flush(progress: VisionChatProgress, visible: boolean): VisionProgressFlushMeta | undefined;
	readonly chunkCount: number;
}

export function createVisionChatSurface(logger?: Logger): VisionChatSurface {
	const chunks: string[] = [];
	return {
		get chunkCount() {
			return chunks.length;
		},
		appendRawLine(line: string) {
			const trimmed = line.trim();
			if (!trimmed) {
				return;
			}
			chunks.push(trimmed);
		},
		emitCollapsible(progress, visible, category, summary, body, options) {
			const html = renderVisionCollapsibleBlock(category, summary, body, options);
			emitVisionChatProgress(progress, visible, html);
			logger?.debug("vision.chat.surface.emit", { category, visible, structured: Boolean(options?.structured) });
		},
		emitCompatDebug(progress, visible, text) {
			if (!visible) {
				return;
			}
			const detailsText = createChatDebugDetailsText(text);
			if (!detailsText) {
				return;
			}
			const html = renderVisionCollapsibleBlock("debug", "识图 · 调试", detailsText);
			emitVisionChatProgress(progress, visible, html);
		},
		flush(progress, visible) {
			if (!visible || chunks.length === 0) {
				chunks.length = 0;
				return undefined;
			}
			const combined = chunks.join("\n\n");
			const html = formatVisionProgressForChatCollapsible(combined);
			emitVisionChatProgress(progress, visible, html);
			const meta = buildVisionProgressFlushMeta(html, false);
			meta.chunkCount = chunks.length;
			meta.combinedLength = combined.length;
			logger?.debug("vision.chat.surface.flush", {
				category: "batch-progress",
				visible,
				chunkCount: meta.chunkCount,
				hasVisionDetailsMarker: meta.hasVisionDetailsMarker
			});
			chunks.length = 0;
			return meta;
		}
	};
}

export function createVisionRouteReporter(
	surface: VisionChatSurface,
	progress: VisionChatProgress,
	chatDebugVisible: boolean,
	onFlushMeta?: (meta: VisionProgressFlushMeta) => void
): VisionRouteReporter {
	return {
		appendProgress: (text) => {
			surface.appendRawLine(text);
		},
		flushProgress: () => {
			const meta = surface.flush(progress, chatDebugVisible);
			if (meta && onFlushMeta) {
				onFlushMeta(meta);
			}
		},
		reportChatDebug: (text) => {
			surface.emitCompatDebug(progress, chatDebugVisible, text);
		}
	};
}

/** One-shot route status line (replaces legacy reportVisionProgress). */
export function emitVisionRouteStatusProgress(
	progress: VisionChatProgress,
	statusLine: string,
	visible: boolean,
	logger?: Logger
): void {
	const surface = createVisionChatSurface(logger);
	surface.appendRawLine(statusLine);
	surface.flush(progress, visible);
}
