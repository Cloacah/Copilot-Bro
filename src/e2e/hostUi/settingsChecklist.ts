/**
 * Per-setting Host UI / runtime acceptance checklist (phase 1 + workspace keys).
 * Each item maps a persisted key to an observable effect used by exhaustive / roundtrip smokes.
 */
import {
	getVisiblePhase1Sections,
	sanitizePhase1SectionValue,
	type Phase1ConfigSectionKey
} from "../../ui/phase1ConfigUi";
import type { ExtensionSettings } from "../../types";
import { HostUiSmokeLogEvent } from "../../visionProtocol/hostUiSmokeLogEvents";
import { ProviderLogEvent, VisionLogEvent } from "../../visionProtocol/visionLogEvents";

export interface SettingsChecklistItem {
	readonly section: string;
	readonly field: string;
	readonly kind: "boolean" | "string" | "number" | "select";
	readonly runtimeEffect: string;
	readonly logMarkers?: readonly string[];
}

export function buildPhase1SettingsChecklist(): readonly SettingsChecklistItem[] {
	const items: SettingsChecklistItem[] = [];
	for (const section of getVisiblePhase1Sections()) {
		for (const field of section.fields) {
			items.push({
				section: section.key,
				field: field.key,
				kind: field.kind,
				runtimeEffect: describePhase1FieldEffect(section.key, field.key),
				logMarkers: phase1FieldLogMarkers(section.key, field.key)
			});
		}
	}
	return items;
}

function describePhase1FieldEffect(section: Phase1ConfigSectionKey, field: string): string {
	const map: Record<string, Record<string, string>> = {
		visionAgent: {
			enabled: "Enables session batch orchestration before proxy/native routing.",
			keepAliveMs: "Controls in-session scheduling window duration.",
			maxBatchSize: "Caps images per vision batch.",
			maxConcurrentBatches: "Limits parallel batch execution.",
			resetContextPerBatch: "Isolates or carries batch context.",
			deduplicateImages: "Skips duplicate image hashes in a batch.",
			retryOnFailure: "When agent session orchestration is enabled, retries failed vision batches (see agentSession/retryStrategy; not used on direct chat LM path).",
			autoClosePolicy: "Defines when session orchestration closes."
		},
		visionIntegrity: {
			enabled: "Runs integrity pipeline on vision inputs.",
			strictIntegrity: "Blocks downstream on integrity failure (plan-only fallback).",
			certaintyThreshold: "ROI confidence gate threshold for destructive ops.",
			checkCount: "Validates image count consistency.",
			checkDimensions: "Validates dimension consistency.",
			checkDigest: "Validates digest/hash consistency.",
			trackResize: "Logs resize transforms.",
			trackByteSummary: "Logs byte summaries.",
			roiMode: "Selects full / roi-split / smart ROI handling.",
			tileMaxPixels: "Caps tile pixel budget.",
			detailPriority: "Balances detail vs cost in integrity path."
		},
		visionProcessing: {
			outputVerbosity: "Controls proxy description verbosity / token pressure.",
			chatDebugVisibility: "Shows [Vision] and debug blocks in Chat UI.",
			needVisionGate: "Gates whether vision pipeline runs.",
			spatialSchemaVersion: "Tags vision-prompt-contract geometry schema (default v1)."
		},
		requestAttribution: {
			enabled: "Adds requestId to vision.request logs.",
			includeSessionId: "Adds sessionId on batch paths.",
			includeBatchId: "Adds batchId on batch paths."
		}
	};
	return map[section]?.[field] ?? `${section}.${field} persisted and read by provider/vision pipeline.`;
}

export function getPhase1FieldLogMarkers(section: string, field: string): readonly string[] | undefined {
	if (section === "requestAttribution" && field === "enabled") {
		return [ProviderLogEvent.requestStart];
	}
	if (section === "visionProcessing" && field === "chatDebugVisibility") {
		return [HostUiSmokeLogEvent.visionProgressFlush];
	}
	return undefined;
}

function phase1FieldLogMarkers(section: string, field: string): readonly string[] | undefined {
	return getPhase1FieldLogMarkers(section, field);
}

/** Alternate value used for workspace roundtrip writes (restored after probe). */
export function buildPhase1FieldMutation(
	sectionKey: Phase1ConfigSectionKey,
	fieldKey: string,
	current: unknown
): unknown {
	switch (fieldKey) {
		case "enabled":
		case "strictIntegrity":
		case "checkCount":
		case "checkDimensions":
		case "checkDigest":
		case "trackResize":
		case "trackByteSummary":
		case "resetContextPerBatch":
		case "deduplicateImages":
		case "retryOnFailure":
		case "needVisionGate":
		case "chatDebugVisibility":
			return current !== true;
		case "keepAliveMs":
			return typeof current === "number" && current > 0 ? 0 : 30_000;
		case "maxBatchSize":
			return 2;
		case "maxConcurrentBatches":
			return 1;
		case "certaintyThreshold":
			return 0.5;
		case "tileMaxPixels":
			return 1_048_576;
		case "spatialSchemaVersion":
			return current === "v2" ? "v1" : "v2";
		case "autoClosePolicy":
			return current === "never" ? "afterMainTask" : "never";
		case "roiMode":
			return current === "smart" ? "full" : "smart";
		case "detailPriority":
			return current === "high" ? "balanced" : "high";
		case "outputVerbosity":
			return current === "verbose" ? "conservative" : "verbose";
		default:
			return current;
	}
}

export function applyPhase1SectionRoundtripMutation(
	settings: ExtensionSettings,
	sectionKey: Phase1ConfigSectionKey
): Record<string, unknown> {
	const section = getVisiblePhase1Sections().find((candidate) => candidate.key === sectionKey);
	const current = settings[sectionKey] as unknown as Record<string, unknown>;
	if (!section) {
		return { ...current };
	}
	const mutated: Record<string, unknown> = { ...current };
	for (const field of section.fields) {
		mutated[field.key] = buildPhase1FieldMutation(sectionKey, field.key, current[field.key]);
	}
	return sanitizePhase1SectionValue(sectionKey, mutated);
}

export const WORKSPACE_SETTINGS_CHECKLIST: readonly SettingsChecklistItem[] = [
	{
		section: "models",
		field: "custom overlay",
		kind: "string",
		runtimeEffect: "Config panel + chat integration select runtime model; request.start uses runtimeModelId.",
		logMarkers: [ProviderLogEvent.requestStart, ProviderLogEvent.requestEnd]
	},
	{
		section: "visionProxy",
		field: "enabled",
		kind: "boolean",
		runtimeEffect: "Enables extension vision proxy for non-vision models.",
		logMarkers: [VisionLogEvent.proxySelected, VisionLogEvent.routeSelected]
	},
	{
		section: "retry",
		field: "maxAttempts",
		kind: "number",
		runtimeEffect: "Caps proxy format retries and HTTP retries.",
		logMarkers: [ProviderLogEvent.requestRetry, "vision.proxy.format.invalid"]
	}
] as const;
