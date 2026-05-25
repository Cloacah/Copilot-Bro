/**
 * Shared defaults for Zhipu GLM model families (used by build-zhipu-model-families.mjs).
 * Mirrors runtime rules in createModelFromFamily (vision proxy off for native vision).
 */

/** @param {string} name */
export function normalizeZhipuModelId(name) {
	return name
		.trim()
		.replace(/^GLM[-\s]*/i, "glm-")
		.replace(/\s+/g, "-")
		.replace(/_/g, "-")
		.toLowerCase();
}

/**
 * @param {{ familyKey: string, displayName?: string, kind?: string, thinking?: string }} card
 * @param {string} familyKey
 */
export function shouldEnableZhipuThinking(card, familyKey) {
	if (card.thinking === "enabled") {
		return true;
	}
	if (card.thinking === "disabled") {
		return false;
	}
	if (/thinking/i.test(familyKey) || /thinking/i.test(card.displayName ?? "")) {
		return true;
	}
	if (/^glm-(5\.1|5-turbo|5|4\.7|4\.6|4\.5-air|4\.5)$/.test(familyKey)) {
		return true;
	}
	if (familyKey === "glm-4.7-flash" || familyKey === "glm-4.5-flash" || familyKey === "glm-4.6v-flash" || familyKey === "glm-4.6v-flashx") {
		return true;
	}
	return false;
}

/**
 * @param {object} family
 * @param {{ kind?: string, contextLength?: number, maxOutputTokens?: number, temperature?: number, topP?: number, thinking?: string }} card
 */
export function applyZhipuFamilyDefaults(family, card) {
	const out = { ...family };
	if (card.kind === "vision" || out.vision) {
		out.vision = true;
	}
	out.temperature = out.temperature ?? card.temperature ?? 0.6;
	out.topP = out.topP ?? card.topP ?? 1;
	if (card.contextLength) {
		out.contextLength = card.contextLength;
	}
	if (card.maxOutputTokens) {
		out.maxOutputTokens = card.maxOutputTokens;
	}
	const thinkingEnabled = shouldEnableZhipuThinking(card, out.familyKey);
	out.thinking = thinkingEnabled ? "enabled" : "disabled";
	return out;
}
