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
import {
	buildCompactStructuredSnapshot,
	STRUCTURED_PROXY_CONTRACT_VERSION,
	type ProxyStructuredOutput
} from "./visionProxyStructuredPlan";
import { buildStructuredProxyProgressFromDescription } from "./visionProxyStructuredSnapshot";
import {
	countRequestImageParts,
	enumerateVisionImageOccurrences,
	resolveVisionSourceKind
} from "./visionProtocol/visionMessageScan";
import {
	resolveVisionHandoffIntentForTurn,
	type VisionHandoffIntent
} from "./visionProtocol/visionHandoffIntent";
import { Logger } from "./logger";
import { createVisionInputBindingSummary, errorMessages } from "./toolCooperation/outputSemantics";
import {
	createImagePathHydrationPolicy,
	type ImagePathHydrationPolicy,
	shouldHydrateTextPathsForMessage
} from "./toolCooperation/visionPathHydrationPolicy";
import { createVisionEvidenceId, upsertVisionEvidenceRecord } from "./visionProtocol/visionEvidenceStore";
import { createVisionTaskStack, getNextRunnableVisionTask, updateVisionTaskStatus } from "./visionProtocol/visionTaskStack";
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

export interface VisionProxyStructuredProgress {
	stage: "cache-hit" | "executed";
	contract: string;
	elementCount: number;
	snapshotJson: string;
	sourceKind?: string;
	toolName?: string;
	reused: boolean;
}

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
