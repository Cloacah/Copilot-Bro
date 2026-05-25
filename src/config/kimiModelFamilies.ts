import type { ModelFamilyDefinition } from "./modelFamilyCatalog";

/**
 * Kimi / Moonshot families (one picker row per series).
 * Source: https://platform.moonshot.ai/docs/models (2026-05; K2 preview/thinking series discontinued).
 */
export const KIMI_MODEL_FAMILIES: readonly ModelFamilyDefinition[] = [
	{
		familyKey: "kimi-k2.6",
		displayName: "Kimi K2.6",
		category: "Latest / Multimodal",
		defaultVersionId: "kimi-k2.6",
		versionIds: ["kimi-k2.6"],
		contextLength: 256000,
		maxOutputTokens: 32768,
		vision: true,
		temperature: 1,
		topP: 0.95,
		thinking: "enabled"
	},
	{
		familyKey: "kimi-k2.5",
		displayName: "Kimi K2.5",
		category: "Multimodal",
		defaultVersionId: "kimi-k2.5",
		versionIds: ["kimi-k2.5"],
		contextLength: 256000,
		maxOutputTokens: 32768,
		vision: true,
		temperature: 1,
		topP: 1,
		thinking: "enabled"
	},
	{
		familyKey: "moonshot-v1",
		displayName: "Moonshot V1",
		category: "Moonshot V1",
		defaultVersionId: "moonshot-v1-8k",
		versionIds: [
			"moonshot-v1-8k",
			"moonshot-v1-32k",
			"moonshot-v1-128k",
			"moonshot-v1-8k-vision-preview",
			"moonshot-v1-32k-vision-preview",
			"moonshot-v1-128k-vision-preview"
		],
		contextLength: 8192,
		maxOutputTokens: 4096,
		temperature: 0,
		topP: 1
	}
];
