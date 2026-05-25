import type { VisionAgentConfig } from "../types";

const isolatedBatchErrors = new Map<string, string>();

export function splitIntoBatches(imageRefs: string[], maxBatchSize: number): string[][] {
	const size = Math.max(1, Math.floor(maxBatchSize) || 1);
	const out: string[][] = [];
	for (let index = 0; index < imageRefs.length; index += size) {
		out.push(imageRefs.slice(index, index + size));
	}
	return out;
}

export function deduplicateRefs(
	refs: string[],
	config: Pick<VisionAgentConfig, "deduplicateImages" | "dedupeByHash">
): string[] {
	if (!config.deduplicateImages && !config.dedupeByHash) {
		return [...refs];
	}
	const seen = new Set<string>();
	const out: string[] = [];
	for (const ref of refs) {
		const key = extractImageHash(ref);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(ref);
	}
	return out;
}

export function isolateFailedBatch(batchId: string, error: Error): void {
	isolatedBatchErrors.set(batchId, error.message);
}

export function getIsolatedBatchError(batchId: string): string | undefined {
	return isolatedBatchErrors.get(batchId);
}

export function resetBatchPlannerForTests(): void {
	isolatedBatchErrors.clear();
}

function extractImageHash(ref: string): string {
	const hashPattern = /(?:\bhash=|\|hash:|#hash=)([^&#|]+)/i.exec(ref);
	if (hashPattern?.[1]) {
		return hashPattern[1];
	}
	if (ref.startsWith("sha256:")) {
		return ref.slice("sha256:".length);
	}
	return ref;
}