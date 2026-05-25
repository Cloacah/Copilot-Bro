/**
 * Parses compact vision log lines for replay tests (plan stage 0 / 3 evidence contracts).
 */
import { ProviderLogEvent, VisionLogEvent } from "./visionLogEvents";

export interface VisionLogReplayFacts {
	readonly boundEvidenceIds: readonly string[];
	readonly cacheHitEvidenceIds: readonly string[];
	readonly cacheMissEvidenceIds: readonly string[];
	/** Parsed `strategy` values from `vision.route.selected` JSON logs (p0/p3 evidence). */
	readonly routeStrategies: readonly string[];
	/** True when any log line references Copilot Chat `screenshot_page` image parts (debug / prompt export). */
	readonly hasScreenshotPageReference: boolean;
	readonly requestHasImageParts: boolean | undefined;
}

function extractJsonPayload(line: string): Record<string, unknown> | undefined {
	const start = line.indexOf("{");
	if (start < 0) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(line.slice(start)) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: undefined;
	} catch {
		return undefined;
	}
}

function evidenceIdFromPayload(payload: Record<string, unknown> | undefined): string | undefined {
	const id = payload?.evidenceId;
	return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

export function parseVisionLogReplay(logText: string): VisionLogReplayFacts {
	const boundEvidenceIds: string[] = [];
	const cacheHitEvidenceIds: string[] = [];
	const cacheMissEvidenceIds: string[] = [];
	const routeStrategies: string[] = [];
	let hasScreenshotPageReference = false;
	let requestHasImageParts: boolean | undefined;

	for (const line of logText.split(/\r?\n/u)) {
		if (line.includes("screenshot_page")) {
			hasScreenshotPageReference = true;
		}
		if (line.includes(VisionLogEvent.inputBound)) {
			const id = evidenceIdFromPayload(extractJsonPayload(line));
			if (id) {
				boundEvidenceIds.push(id);
			}
		} else if (line.includes(VisionLogEvent.routeSelected)) {
			const payload = extractJsonPayload(line);
			const strategy = typeof payload?.strategy === "string" ? payload.strategy.trim() : "";
			if (strategy) {
				routeStrategies.push(strategy);
			}
		} else if (line.includes(VisionLogEvent.proxyCacheHit)) {
			const id = evidenceIdFromPayload(extractJsonPayload(line));
			if (id) {
				cacheHitEvidenceIds.push(id);
			}
		} else if (line.includes(VisionLogEvent.proxyCacheMiss)) {
			const id = evidenceIdFromPayload(extractJsonPayload(line));
			if (id) {
				cacheMissEvidenceIds.push(id);
			}
		} else if (line.includes(ProviderLogEvent.requestMessagesSummary) && line.includes("hasImageParts")) {
			const payload = extractJsonPayload(line);
			if (typeof payload?.hasImageParts === "boolean") {
				requestHasImageParts = payload.hasImageParts;
			}
		}
	}

	return {
		boundEvidenceIds,
		cacheHitEvidenceIds,
		cacheMissEvidenceIds,
		routeStrategies,
		hasScreenshotPageReference,
		requestHasImageParts
	};
}

/** Returns missing contract keys (empty = satisfied). */
export function validateVisionCacheHitEvidenceContract(facts: VisionLogReplayFacts): string[] {
	const missing: string[] = [];
	if (facts.boundEvidenceIds.length === 0) {
		missing.push("log.vision.input.bound");
	}
	if (facts.cacheHitEvidenceIds.length === 0) {
		missing.push("log.vision.proxy.cache.hit");
	}
	if (facts.requestHasImageParts !== false) {
		missing.push("log.request.hasImageParts-false-on-cache-hit");
	}
	const hitId = facts.cacheHitEvidenceIds[0];
	if (hitId && !facts.boundEvidenceIds.includes(hitId)) {
		missing.push("log.vision.cache-hit-matches-bound-evidence");
	}
	return missing;
}

export function validateVisionCacheMissEvidenceContract(facts: VisionLogReplayFacts): string[] {
	const missing: string[] = [];
	if (facts.boundEvidenceIds.length === 0) {
		missing.push("log.vision.input.bound");
	}
	if (facts.cacheMissEvidenceIds.length === 0) {
		missing.push("log.vision.proxy.cache.miss");
	}
	return missing;
}
