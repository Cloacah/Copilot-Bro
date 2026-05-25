import {
	buildCompactStructuredSnapshot,
	normalizeStructuredProxyOutput,
	STRUCTURED_PROXY_CONTRACT_VERSION,
	type ProxyStructuredOutput
} from "./visionProxyStructuredPlan";

export type StructuredProxyProgressPayload = {
	readonly stage: string;
	readonly contract: string;
	readonly elementCount: number;
	readonly snapshotJson: string;
};

const SNAPSHOT_MARKER = "normalizedProxySnapshot:";

export function extractNormalizedProxySnapshotJson(description: string): string {
	const index = description.indexOf(SNAPSHOT_MARKER);
	if (index < 0) {
		return "";
	}
	return description.slice(index + SNAPSHOT_MARKER.length).trim();
}

/** Build chat/log progress payload from a persisted proxy description (cache-hit safe). */
export function buildStructuredProxyProgressFromDescription(
	description: string,
	meta: { stage: string }
): StructuredProxyProgressPayload | undefined {
	const plan = parseStructuredPlanFromProxyDescription(description);
	if (!plan || plan.elements.length === 0) {
		return undefined;
	}
	return {
		stage: meta.stage,
		contract: plan.contract || STRUCTURED_PROXY_CONTRACT_VERSION,
		elementCount: plan.elements.length,
		snapshotJson: JSON.stringify(buildCompactStructuredSnapshot(plan), null, 2)
	};
}

export function parseStructuredPlanFromProxyDescription(description: string): ProxyStructuredOutput | undefined {
	const jsonText = extractNormalizedProxySnapshotJson(description);
	if (!jsonText) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(jsonText) as unknown;
		const normalized = normalizeStructuredProxyOutput(parsed);
		return normalized.ok ? normalized.value : undefined;
	} catch {
		return undefined;
	}
}

export function findVisionProxyDescriptionInMessages(
	messages: readonly { content?: readonly unknown[] }[]
): string | undefined {
	for (const message of messages) {
		for (const part of message.content ?? []) {
			const text = extractTextFromPart(part);
			if (text?.includes(SNAPSHOT_MARKER)) {
				return text;
			}
		}
	}
	return undefined;
}

function extractTextFromPart(part: unknown): string | undefined {
	if (!part || typeof part !== "object") {
		return undefined;
	}
	const record = part as Record<string, unknown>;
	if (typeof record.value === "string") {
		return record.value;
	}
	return undefined;
}
