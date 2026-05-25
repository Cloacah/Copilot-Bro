import * as vscode from "vscode";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { extname, isAbsolute, join, normalize } from "node:path";
import { constants as fsConstants } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionSettings, ModelConfig } from "./types";
import { getRuntimeModelId } from "./config/settings";
import {
	isCopilotAutoVisionModelId,
	resolveExtensionVisionProxyTarget
} from "./visionProxyModelSelection";
import { STRUCTURED_PROXY_CONTRACT_VERSION } from "./visionProxyStructuredPlan";
import { resolveImageMimeType } from "./toolCooperation/imageMime";
import { saveVisionArtifact } from "./toolCooperation/visionArtifactStore";
import { countRequestImageParts } from "./visionProtocol/visionMessageScan";
import {
	applyStructuredVisionToMessageBatch,
	type VisionStructuredProgress
} from "./visionProtocol/structuredVisionMessageBatch";
import type { VisionHandoffIntent } from "./visionProtocol/visionHandoffIntent";
import { Logger } from "./logger";
import { errorMessages } from "./toolCooperation/outputSemantics";
import {
	createImagePathHydrationPolicy,
	type ImagePathHydrationPolicy,
	shouldHydrateTextPathsForMessage
} from "./toolCooperation/visionPathHydrationPolicy";
import {
	createVisionEvidenceId,
	upsertVisionEvidenceRecord,
	type VisionEvidenceRoute
} from "./visionProtocol/visionEvidenceStore";
import {
	createVisionTaskStack,
	getNextRunnableVisionTask,
	updateVisionTaskStatus,
	type VisionTaskKind
} from "./visionProtocol/visionTaskStack";
import { resolveVisionProxyPolicy } from "./visionProxyPolicy";
import {
	resolveStructuredProxyDescription,
	resolveStructuredNativeDescription,
	type ProxyExecutionSummary
} from "./visionStructuredPass";

export interface VisionProxyResolution {
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	status: "not-needed" | "applied" | "unavailable" | "failed";
	error?: string;
	cacheHitCount?: number;
	cacheMissCount?: number;
}

export type VisionProxyStructuredProgress = VisionStructuredProgress;

export interface ResolveVisionProxyOptions {
	reportFailure?: boolean;
	onStructuredProgress?: (progress: VisionProxyStructuredProgress) => void;
	onVisionUiProgress?: (line: string) => void;
}

export type ResolveNativeVisionStructuredOptions = ResolveVisionProxyOptions;

export type NativeVisionStructuredResolution = VisionProxyResolution;

const VISION_PROXY_CACHE_LIMIT = 128;
const VISION_PROXY_EVIDENCE_MARKER = "[vision-proxy-evidence]";
const visionProxyDescriptionCache = new Map<string, string>();

export async function resolveVisionProxyMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	model: ModelConfig,
	settings: ExtensionSettings,
	logger: Logger,
	token: vscode.CancellationToken,
	options: ResolveVisionProxyOptions = {}
): Promise<VisionProxyResolution> {
    const hydratedMessages = await hydrateImagePartsFromTextPaths(messages, logger, createImagePathHydrationPolicy(messages));
    if (countRequestImageParts(hydratedMessages) === 0) {
        return {
            messages: hydratedMessages,
            status: "not-needed"
        };
    }
    if (!isVisionProxyEnabledForModel(model, settings)) {
        return {
            messages: hydratedMessages,
            status: "not-needed"
        };
    }
    logger.debug("vision.proxy.resolving", {
        model: model.id,
        messageCount: hydratedMessages.length,
        visionProxyEnabled: settings.visionProxy.enabled,
        modelHasVision: model.vision
    });
    const proxyModel = await selectVisionProxyModel(model, settings, logger);
    if (!proxyModel) {
        logger.warn("vision.proxy.noModelFound", {
            model: model.id,
            enabled: settings.visionProxy.enabled,
            defaultModelId: settings.visionProxy.defaultModelId
        });
        if (options.reportFailure) {
            return {
                messages: hydratedMessages,
                status: "unavailable",
                error: errorMessages.visionProxyUnavailable
            };
        }
        return {
            messages: replaceImagesWithText(hydratedMessages, errorMessages.visionProxyUnavailable),
            status: "unavailable",
            error: errorMessages.visionProxyUnavailable
        };
    }
	const batch = await applyStructuredVisionToMessageBatch({
		hydratedMessages,
		fallbackMessages: messages,
		model,
		visionModelId: proxyModel.id,
		settings,
		logger,
		options,
		route: "proxy",
		buildFinalPrompt: () => {
			const highFidelityPrompt = settings.visionProcessing.highFidelityPrompt;
			const customPrompt = settings.visionProxy.customPrompt;
			return [highFidelityPrompt, customPrompt].filter(Boolean).join("\n\n");
		},
		buildCacheKeyModelId: () => proxyModel.id,
		resolveDescription: (imageParts, finalPrompt, handoffIntent) =>
			resolveStructuredProxyDescription(proxyModel, imageParts, finalPrompt, settings, logger, token, handoffIntent),
		getDescriptionFromCache: (cacheKey) => visionProxyDescriptionCache.get(cacheKey),
		setDescriptionInCache: (cacheKey, description) => setVisionProxyCachedDescription(cacheKey, description),
		buildVisionCacheKey: buildVisionProxyCacheKey,
		persistEvidence: (imageParts, description, execution, handoffIntent) =>
			persistStructuredVisionEvidence(imageParts, description, model.id, proxyModel.id, execution, handoffIntent, logger),
		appendDescription: appendProxyDescriptionToMessageParts,
		log: {
			cacheHit: "vision.proxy.cache.hit",
			cacheMiss: "vision.proxy.cache.miss",
			structured: "vision.proxy.structured",
			failed: "vision.proxy.failed",
			inputBoundModelField: "proxyModelId"
		},
		onCacheHit: ({ handoffIntent, reused }) => {
			logger.info("vision.handoff.resolved", {
				model: model.id,
				handoffIntent,
				proxyModelId: proxyModel.id,
				reused: true
			});
			if (handoffIntent === "describe-only") {
				logger.info("vision.restore.pipeline.skipped", {
					handoffIntent,
					reason: "describe-only",
					reused: true
				});
			}
		},
		onCacheMiss: ({ handoffIntent }) => {
			logger.info("vision.handoff.resolved", {
				model: model.id,
				handoffIntent,
				proxyModelId: proxyModel.id
			});
		},
		emitStructuredProgress: emitStructuredProxyProgress
	});
	return {
		messages: batch.messages,
		status: batch.status,
		error: batch.error,
		cacheHitCount: batch.cacheHitCount,
		cacheMissCount: batch.cacheMissCount
	};
}
export function isVisionProxyEnabledForModel(model: ModelConfig, settings: ExtensionSettings): boolean {
    return resolveVisionProxyPolicy(model, settings).enabled;
}
const IMAGE_EXTENSION_TO_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml"
};
const IMAGE_PATH_PATTERN = /(?:file:\/\/\/[^\s"'<>]+|[A-Za-z]:[\\/][^\s"'<>]+|(?:\.\.?[\\/])?[^\s"'<>]+\.(?:png|jpe?g|webp|gif|bmp|svg))/gi;
async function hydrateImagePartsFromTextPaths(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	logger: Logger,
	policy: ImagePathHydrationPolicy
): Promise<vscode.LanguageModelChatRequestMessage[]> {
    let hydratedCount = 0;
    const hydratedMessages = [];
    const seenPaths = new Set();
    for (const message of messages) {
        const canHydrateMessageText = shouldHydrateTextPathsForMessage(message, policy);
        const nextParts = [];
        for (const part of message.content) {
            nextParts.push(part);
            if (!canHydrateMessageText) {
                continue;
            }
            const text = extractTextPart(part);
            if (!text) {
                continue;
            }
            const candidatePaths = extractImagePathCandidates(text);
            for (const candidatePath of candidatePaths) {
                const resolvedPath = await resolveExistingImagePath(candidatePath);
                if (!resolvedPath) {
                    continue;
                }
                const normalizedPath = normalize(resolvedPath);
                if (seenPaths.has(normalizedPath)) {
                    continue;
                }
                const extension = extname(normalizedPath).toLowerCase();
                const extensionMimeType = IMAGE_EXTENSION_TO_MIME[extension as keyof typeof IMAGE_EXTENSION_TO_MIME];
                try {
                    const bytes = new Uint8Array(await readFile(normalizedPath));
                    if (bytes.length === 0) {
                        continue;
                    }
                    const { mimeType, detectedMimeType, corrected } = resolveImageMimeType(bytes, extensionMimeType);
                    if (!mimeType) {
                        continue;
                    }
                    if (corrected && detectedMimeType) {
                        logger.warn("vision.proxy.hydrated.imagePath.mime.corrected", {
                            extension,
                            configuredMimeType: extensionMimeType,
                            detectedMimeType
                        });
                    }
                    nextParts.push(vscode.LanguageModelDataPart.image(bytes, mimeType));
                    hydratedCount += 1;
                    seenPaths.add(normalizedPath);
                }
                catch {
                    // Ignore unreadable files and keep the original text untouched.
                }
            }
        }
        hydratedMessages.push({
            ...message,
            content: nextParts,
            name: message.name
        });
    }
    if (hydratedCount > 0) {
        logger.info("vision.proxy.hydrated.imagePaths", {
            hydratedCount
        });
    }
    return hydratedMessages;
}
/** Smoke/e2e: path hydration without entering full vision proxy. */
export async function hydrateImagePartsFromTextPathsForSmoke(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	logger: { info: (message: string, data?: unknown) => void; warn?: (message: string, data?: unknown) => void },
	policy: ImagePathHydrationPolicy
): Promise<vscode.LanguageModelChatRequestMessage[]> {
	return hydrateImagePartsFromTextPaths(messages, logger as Logger, policy);
}
function isUserRequestMessage(message: { role?: unknown }): boolean {
    return String(message.role).trim().toLowerCase() === "user";
}
function extractTextPart(part: unknown): string {
    if (!part || typeof part !== "object") {
        return "";
    }
    const record = part as Record<string, unknown>;
    if (typeof record.value === "string") {
        return record.value;
    }
    if (typeof record.text === "string") {
        return record.text;
    }
    if (typeof record.content === "string") {
        return record.content;
    }
    if (Array.isArray(record.content)) {
        return record.content
            .map((item: unknown) => extractTextPart(item))
            .filter((value: string) => value.length > 0)
            .join("\n");
    }
    return "";
}
function extractImagePathCandidates(text: string): string[] {
    const candidates = new Set<string>();
    for (const match of text.matchAll(IMAGE_PATH_PATTERN)) {
        const raw = (match[0] ?? "").trim();
        if (!raw || /^https?:\/\//i.test(raw)) {
            continue;
        }
        const cleaned = raw.replace(/^["'(]+|["'),.;:!?]+$/g, "");
        if (cleaned) {
            candidates.add(cleaned);
        }
    }
    return Array.from(candidates);
}
async function resolveExistingImagePath(candidate: string): Promise<string | undefined> {
    const normalizedCandidate = normalizeFilePathCandidate(candidate);
    if (!normalizedCandidate) {
        return undefined;
    }
    const resolutionCandidates = [];
    if (isAbsolute(normalizedCandidate)) {
        resolutionCandidates.push(normalizedCandidate);
    }
    else {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            resolutionCandidates.push(join(folder.uri.fsPath, normalizedCandidate));
        }
    }
    for (const filePath of resolutionCandidates) {
        try {
            await access(filePath, fsConstants.R_OK);
            return filePath;
        }
        catch {
            // Continue searching remaining candidates.
        }
    }
    return undefined;
}
function normalizeFilePathCandidate(candidate: string): string | undefined {
    const trimmed = candidate.trim();
    if (!trimmed) {
        return undefined;
    }
    if (/^file:\/\//i.test(trimmed)) {
        try {
            return normalize(fileURLToPath(trimmed));
        }
        catch {
            return undefined;
        }
    }
    return normalize(trimmed);
}
async function selectVisionProxyModel(
	model: ModelConfig,
	settings: ExtensionSettings,
	logger: Logger
): Promise<vscode.LanguageModelChat | undefined> {
    const configured = model.visionProxyModelId;
    const proxyPolicy = resolveVisionProxyPolicy(model, settings);
    if (!proxyPolicy.enabled) {
        logger.debug("vision.proxy.disabled", {
            model: model.id,
            configured,
            visionProxyEnabled: settings.visionProxy.enabled,
            reason: proxyPolicy.reason,
            requestedModelId: proxyPolicy.requestedModelId
        });
        return undefined;
    }
    const selfIds = new Set([model.id, getRuntimeModelId(model)]);
    const requestedId = proxyPolicy.requestedModelId;
    // Try configured or default model ID first (extension vision models must not fall through to Copilot auto).
    if (requestedId && !selfIds.has(requestedId)) {
        const extensionTarget = resolveExtensionVisionProxyTarget(requestedId, settings.models, selfIds);
        if (extensionTarget?.kind === "extended") {
            const extensionMatches = await vscode.lm.selectChatModels({
                vendor: "extendedModels",
                id: extensionTarget.runtimeId
            });
            const extensionMatch = extensionMatches.find((candidate) => candidate.id === extensionTarget.runtimeId);
            if (extensionMatch) {
                logger.info("vision.proxy.selected", {
                    modelId: extensionMatch.id,
                    configuredId: requestedId,
                    selection: "extension-configured",
                    vendor: extensionMatch.vendor
                });
                return extensionMatch;
            }
            logger.warn("vision.proxy.extensionModelUnavailable", {
                requestedId,
                runtimeId: extensionTarget.runtimeId,
                model: model.id
            });
        }
        const selected = await vscode.lm.selectChatModels({ id: requestedId });
        const match = selected.find((candidate) => !selfIds.has(candidate.id)
            && candidate.vendor !== "extendedModels"
            && !isCopilotAutoVisionModelId(candidate.id, candidate.vendor));
        if (match) {
            logger.info("vision.proxy.selected", {
                modelId: match.id,
                configuredId: requestedId,
                selection: "configured"
            });
            return match;
        }
        logger.warn("vision.proxy.configuredModelUnavailable", { requestedId, model: model.id });
    }
    // Auto-detect: prefer models with explicit imageInput capability
    const allModels = await vscode.lm.selectChatModels();
    const nonSelfModels = allModels.filter((candidate) => !selfIds.has(candidate.id));
    logger.debug("vision.proxy.candidates", {
        model: model.id,
        total: allModels.length,
        nonSelf: nonSelfModels.length,
        vendors: [...new Set(allModels.map((candidate) => candidate.vendor))],
        sample: allModels.slice(0, 8).map((candidate) => ({
            id: candidate.id,
            vendor: candidate.vendor,
            imageInput: Boolean((candidate as { capabilities?: { imageInput?: boolean } }).capabilities?.imageInput),
            self: selfIds.has(candidate.id)
        }))
    });
    if (allModels.length === 0) {
        logger.warn("vision.proxy.noModelsAvailable", { model: model.id });
        return undefined;
    }
    const explicitVisionModel = allModels.find((candidate) => !selfIds.has(candidate.id)
        && candidate.vendor !== "extendedModels"
        && Boolean((candidate as { capabilities?: { imageInput?: boolean } }).capabilities?.imageInput)
        && !isCopilotAutoVisionModelId(candidate.id, candidate.vendor));
    if (explicitVisionModel) {
        logger.info("vision.proxy.auto-selected", { modelId: explicitVisionModel.id });
        return explicitVisionModel;
    }
    const genericCopilotModel = allModels.find((candidate) => !selfIds.has(candidate.id)
        && candidate.vendor !== "extendedModels"
        && !isCopilotAutoVisionModelId(candidate.id, candidate.vendor));
    if (genericCopilotModel) {
        logger.info("vision.proxy.fallback-selected", { modelId: genericCopilotModel.id });
        return genericCopilotModel;
    }
    logger.warn("vision.proxy.noSuitableModel", {
        model: model.id,
        availableModels: allModels.length,
        nonSelfModels: nonSelfModels.length,
        nonExtendedModels: nonSelfModels.filter((candidate) => candidate.vendor !== "extendedModels").length,
        selfIds: Array.from(selfIds)
    });
    return undefined;
}
function isToolResultPart(part: unknown): part is vscode.LanguageModelToolResultPart {
    if (!part || typeof part !== "object") {
        return false;
    }
    const record = part as { callId?: unknown; content?: unknown };
    return typeof record.callId === "string" && Array.isArray(record.content);
}
function appendProxyDescriptionToMessageParts(parts: vscode.LanguageModelInputPart[], description: string): void {
    const evidenceText = formatVisionDescription(description);
    const toolResultIndex = parts.findIndex((part) => isToolResultPart(part));
    if (toolResultIndex >= 0) {
        const part = parts[toolResultIndex] as vscode.LanguageModelToolResultPart;
        parts[toolResultIndex] = {
            callId: part.callId,
            content: [...(part.content ?? []), new vscode.LanguageModelTextPart(evidenceText)]
        } as vscode.LanguageModelToolResultPart;
        return;
    }
    parts.push(new vscode.LanguageModelTextPart(evidenceText));
}
function replaceImagesWithText(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	text: string
): vscode.LanguageModelChatRequestMessage[] {
    return messages.map((message) => {
        if (countRequestImageParts([message]) === 0) {
            return message;
        }
        const content = [];
        for (const part of message.content) {
            if (isImagePart(part)) {
                continue;
            }
            if (isToolResultPart(part)) {
                const nestedKeep = (part.content ?? []).filter((nested) => !isImagePart(nested));
                content.push({
                    callId: part.callId,
                    content: nestedKeep
                });
                continue;
            }
            content.push(part);
        }
        return {
            role: message.role,
            content: [
                ...content,
                new vscode.LanguageModelTextPart(text)
            ]
        } as unknown as vscode.LanguageModelChatRequestMessage;
    });
}
function collectUserTurnTextFromParts(parts: readonly vscode.LanguageModelInputPart[]): string {
    const chunks = [];
    for (const part of parts) {
        if (part instanceof vscode.LanguageModelTextPart) {
            const value = part.value.trim();
            if (value) {
                chunks.push(value);
            }
        }
    }
    return chunks.join("\n");
}
function isImagePart(part: unknown): part is vscode.LanguageModelDataPart {
    if (!part || typeof part !== "object") {
        return false;
    }
    const record = part as { mimeType?: unknown; data?: unknown };
    if (typeof record.mimeType !== "string" || !record.mimeType.startsWith("image/")) {
        return false;
    }
    return toUint8Array(record.data) !== undefined;
}
function toUint8Array(value: unknown): Uint8Array | undefined {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
        const view = value;
        return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }
    if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
        return new Uint8Array(value);
    }
    return undefined;
}
function getImagePartHash(part: vscode.LanguageModelDataPart): string | undefined {
    const bytes = toUint8Array(part.data);
    return bytes ? createHash("sha256").update(Buffer.from(bytes)).digest("hex") : undefined;
}
async function persistStructuredVisionEvidence(
	imageParts: readonly vscode.LanguageModelDataPart[],
	description: string,
	modelId: string,
	proxyModelId: string,
	execution: ProxyExecutionSummary | undefined,
	handoffIntent: VisionHandoffIntent,
	logger: Logger,
	route: VisionEvidenceRoute = "proxy"
): Promise<{ evidenceIds: string[]; taskStackIds: string[]; artifactIds: string[] }> {
    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
        return { evidenceIds: [], taskStackIds: [], artifactIds: [] };
    }
    const ids = [];
    const taskStackIds = [];
    const artifactIds = [];
    for (const imagePart of imageParts) {
        const imageHash = getImagePartHash(imagePart);
        if (!imageHash) {
            continue;
        }
        const id = createVisionEvidenceId(imageHash);
        upsertVisionEvidenceRecord({
            id,
            imageHash,
            route,
            handoff: handoffIntent === "restore-artifact" ? "restoration" : "description",
            taskStatus: "completed",
            modelId,
            proxyModelId,
            description: trimmedDescription
        });
        ids.push(id);
        const taskResult = await persistStructuredVisionTaskArtifacts(id, imagePart, execution, logger);
        taskStackIds.push(...taskResult.taskStackIds);
        artifactIds.push(...taskResult.artifactIds);
    }
    return { evidenceIds: ids, taskStackIds, artifactIds };
}
async function persistStructuredVisionTaskArtifacts(
	evidenceId: string,
	imagePart: vscode.LanguageModelDataPart,
	execution: ProxyExecutionSummary | undefined,
	logger: Logger
): Promise<{ taskStackIds: string[]; artifactIds: string[] }> {
    const hasSvg = Boolean(execution?.svgOutputs.length);
    const hasImage = Boolean(execution?.processedImageParts?.length);
    const stack = createVisionTaskStack(evidenceId, [
        ...(hasImage ? (["extract-image"] as const) : []),
        ...(hasSvg ? (["restore-svg"] as const) : []),
        "verify-artifact",
        "complete"
    ] as VisionTaskKind[]);
    const artifactIds = [];
    let next = getNextRunnableVisionTask(stack.id);
    const rootDir = resolveVisionArtifactRootDir();
    while (next) {
        updateVisionTaskStatus(stack.id, next.id, "running");
        try {
            if (next.kind === "extract-image") {
                for (const processedPart of execution?.processedImageParts ?? [imagePart]) {
                    const bytes = toUint8Array(processedPart.data);
                    if (!bytes) {
                        continue;
                    }
                    const artifact = await saveVisionArtifact({
                        rootDir,
                        evidenceId,
                        taskId: next.id,
                        kind: "png",
                        bytes
                    });
                    artifactIds.push(artifact.id);
                }
            }
            if (next.kind === "restore-svg") {
                for (const svg of execution?.svgOutputs ?? []) {
                    const artifact = await saveVisionArtifact({
                        rootDir,
                        evidenceId,
                        taskId: next.id,
                        kind: "svg",
                        bytes: svg
                    });
                    artifactIds.push(artifact.id);
                }
            }
            updateVisionTaskStatus(stack.id, next.id, "completed", { artifactId: artifactIds.at(-1) });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            updateVisionTaskStatus(stack.id, next.id, "failed", { error: message });
            logger.warn("vision.artifact.persist.failed", {
                evidenceId,
                taskId: next.id,
                message
            });
            break;
        }
        next = getNextRunnableVisionTask(stack.id);
    }
    return { taskStackIds: [stack.id], artifactIds };
}
function resolveVisionArtifactRootDir() {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}
function buildVisionProxyCacheKey(
	imageParts: readonly vscode.LanguageModelDataPart[],
	prompt: string,
	proxyModelId: string
): string {
    const digest = createHash("sha256");
    digest.update("vision-proxy-structured-v2");
    digest.update("\n");
    digest.update(proxyModelId);
    digest.update("\n");
    digest.update(prompt);
    for (const part of imageParts) {
        digest.update("\n");
        digest.update(part.mimeType);
        digest.update("\n");
        const bytes = toUint8Array(part.data);
        if (!bytes) {
            continue;
        }
        digest.update(Buffer.from(bytes));
    }
    return digest.digest("hex");
}
function setVisionProxyCachedDescription(cacheKey: string, description: string): void {
    visionProxyDescriptionCache.set(cacheKey, description);
    if (visionProxyDescriptionCache.size <= VISION_PROXY_CACHE_LIMIT) {
        return;
    }
    const oldestKey = visionProxyDescriptionCache.keys().next().value;
    if (typeof oldestKey === "string") {
        visionProxyDescriptionCache.delete(oldestKey);
    }
}
function emitStructuredProxyProgress(
	logger: Logger,
	options: ResolveVisionProxyOptions,
	progress: VisionProxyStructuredProgress
): void {
    options.onStructuredProgress?.(progress);
    logger.debug("vision.proxy.structured.progress", {
        stage: progress.stage,
        contract: progress.contract,
        elementCount: progress.elementCount,
        sourceKind: progress.sourceKind,
        toolName: progress.toolName,
        reused: progress.reused,
        snapshotBytes: progress.snapshotJson.length
    });
}

function formatVisionDescription(description: string): string {
    const trimmed = description.trim();
    return trimmed
        ? [
            VISION_PROXY_EVIDENCE_MARKER,
            "scope=current-user-image",
            "authoritative=true",
            "persisted=true",
            "instruction=Treat this as the durable proxy record for the current user-provided image. Continue directly from this evidence, reuse it in later turns, and do not scan the workspace, call view_image, or switch image sources unless the user explicitly asks for a different image.",
            trimmed
        ].join("\n")
        : errorMessages.visionProxyEmpty;
}

export async function resolveNativeVisionStructuredMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	model: ModelConfig,
	apiKey: string,
	settings: ExtensionSettings,
	logger: Logger,
	token: vscode.CancellationToken,
	options: ResolveNativeVisionStructuredOptions = {}
): Promise<NativeVisionStructuredResolution> {
	const hydratedMessages = await hydrateImagePartsFromTextPaths(messages, logger, createImagePathHydrationPolicy(messages));
	if (countRequestImageParts(hydratedMessages) === 0) {
		return {
			messages: hydratedMessages,
			status: "not-needed"
		};
	}
	if (!model.vision) {
		return {
			messages: hydratedMessages,
			status: "not-needed"
		};
	}

	logger.info("vision.native.structured.resolving", {
		model: model.id,
		messageCount: hydratedMessages.length
	});

	const batch = await applyStructuredVisionToMessageBatch({
		hydratedMessages,
		fallbackMessages: messages,
		model,
		visionModelId: model.id,
		settings,
		logger,
		options,
		route: "native",
		buildFinalPrompt: () => settings.visionProcessing.highFidelityPrompt,
		buildCacheKeyModelId: () => `native:${model.id}`,
		resolveDescription: (imageParts, finalPrompt, handoffIntent) =>
			resolveStructuredNativeDescription(model, apiKey, imageParts, finalPrompt, settings, logger, token, handoffIntent),
		getDescriptionFromCache: (cacheKey) => visionProxyDescriptionCache.get(cacheKey),
		setDescriptionInCache: (cacheKey, description) => setVisionProxyCachedDescription(cacheKey, description),
		buildVisionCacheKey: buildVisionProxyCacheKey,
		persistEvidence: (imageParts, description, execution, handoffIntent) =>
			persistStructuredVisionEvidence(imageParts, description, model.id, model.id, execution, handoffIntent, logger, "native"),
		appendDescription: appendProxyDescriptionToMessageParts,
		log: {
			cacheHit: "vision.native.cache.hit",
			cacheMiss: "vision.native.cache.miss",
			structured: "vision.native.structured",
			failed: "vision.native.structured.failed",
			inputBoundModelField: "visionModelId"
		},
		onEvidencePersisted: ({ evidenceIds, handoffIntent }) => {
			logger.info("vision.native.structured.completed", {
				modelId: model.id,
				evidenceIds,
				handoff: handoffIntent,
				contract: STRUCTURED_PROXY_CONTRACT_VERSION
			});
		},
		emitStructuredProgress: emitStructuredProxyProgress
	});
	return {
		messages: batch.messages,
		status: batch.status,
		error: batch.error,
		cacheHitCount: batch.cacheHitCount,
		cacheMissCount: batch.cacheMissCount
	};
}
