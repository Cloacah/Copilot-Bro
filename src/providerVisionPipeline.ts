import type { LanguageModelChatRequestMessage, LanguageModelInputPart } from "vscode";
import type { ExtensionSettings } from "./types";
import type { Logger } from "./logger";
import { getImageAnalyzeAdapter } from "./toolCooperation/adapters/registry";
import { createVisionPreprocessSummary } from "./toolCooperation/outputSemantics";
import { runProcessingChain } from "./toolCooperation/resultAssembler";
import { isImageInputPart, replaceImageInputPartData, validateImageIntegrity } from "./providerVisionIntegrity";
import { createHash } from "node:crypto";

export type VisionPipelineResult = {
	messages: readonly LanguageModelChatRequestMessage[];
	summary?: string;
	blocked?: boolean;
	blockReason?: string;
};

export async function applyVisionProcessingAndIntegrityPipeline(
	messages: readonly LanguageModelChatRequestMessage[],
	settings: Pick<ExtensionSettings, "visionIntegrity" | "visionProcessing">,
	logger: Logger
): Promise<VisionPipelineResult> {
	const shouldProcess = settings.visionProcessing.imagePreprocess || settings.visionProcessing.mlSegment;
	const shouldValidate = settings.visionIntegrity.enabled;
	if (!shouldProcess && !shouldValidate) {
		return { messages };
	}

	const analyzer = getImageAnalyzeAdapter();
	let processedCount = 0;
	let integrityPassCount = 0;
	let integrityFailCount = 0;
	let fallbackToOriginalCount = 0;
	let warningsCount = 0;
	const warningSamples: string[] = [];
	const rewrittenMessages: LanguageModelChatRequestMessage[] = [];

	for (const message of messages) {
		const nextParts: LanguageModelInputPart[] = [];
		let changed = false;
		for (const part of message.content ?? []) {
			if (!isImageInputPart(part)) {
				nextParts.push(part as LanguageModelInputPart);
				continue;
			}

			const original = Buffer.from(part.data);
			const originalDigest = sha256(original);
			const originalMeta = settings.visionIntegrity.checkDimensions
				? await safeReadMetadata(analyzer, original)
				: undefined;

			const chainResult = await runProcessingChain({ image: original }, settings.visionProcessing);
			const candidate = chainResult.image ?? original;
			const candidateDigest = sha256(candidate);
			const candidateMeta = settings.visionIntegrity.checkDimensions
				? await safeReadMetadata(analyzer, candidate)
				: undefined;

			const integrityWarnings = validateImageIntegrity(
				settings,
				original,
				candidate,
				originalDigest,
				candidateDigest,
				originalMeta,
				candidateMeta
			);
			const runtimeWarnings = [...chainResult.warnings, ...integrityWarnings];
			if (runtimeWarnings.length > 0) {
				warningsCount += runtimeWarnings.length;
				warningSamples.push(...runtimeWarnings.slice(0, 2));
			}
			if (integrityWarnings.length > 0) {
				integrityFailCount += 1;
			} else {
				integrityPassCount += 1;
			}

			const finalImage = integrityWarnings.length > 0 ? original : candidate;
			if (integrityWarnings.length > 0 && !settings.visionIntegrity.strictIntegrity) {
				fallbackToOriginalCount += 1;
			}
			nextParts.push(replaceImageInputPartData(part, finalImage));

			if (!finalImage.equals(original)) {
				changed = true;
			}
			processedCount += 1;
		}

		if (changed) {
			rewrittenMessages.push({
				...message,
				content: nextParts,
				name: message.name
			} as LanguageModelChatRequestMessage);
		} else {
			rewrittenMessages.push(message);
		}
	}

	if (processedCount === 0) {
		return { messages };
	}

	logger.info("vision.pipeline.processed", {
		preprocessed_count: processedCount,
		integrity_pass_count: integrityPassCount,
		integrity_fail_count: integrityFailCount,
		fallback_to_original_count: fallbackToOriginalCount,
		warnings_count: warningsCount,
		strict_integrity: settings.visionIntegrity.strictIntegrity,
		warnings: warningSamples.slice(0, 4)
	});

	const summary = createVisionPreprocessSummary({
		processedCount,
		integrityPassCount,
		integrityFailCount,
		fallbackToOriginalCount,
		warningsCount
	});
	if (settings.visionIntegrity.strictIntegrity && integrityFailCount > 0) {
		return {
			messages,
			summary,
			blocked: true,
			blockReason: `Vision integrity strict mode blocked downstream processing (integrity_fail_count=${integrityFailCount}).`
		};
	}
	return {
		messages: rewrittenMessages,
		summary
	};
}

async function safeReadMetadata(
	analyzer: ReturnType<typeof getImageAnalyzeAdapter>,
	input: Buffer
): Promise<{ width: number; height: number } | undefined> {
	try {
		const metadata = await analyzer.getMetadata(input);
		return {
			width: metadata.width,
			height: metadata.height
		};
	} catch {
		return undefined;
	}
}

function sha256(input: Buffer): string {
	if (input.length === 0) {
		return "";
	}
	return createHash("sha256").update(input).digest("hex");
}
