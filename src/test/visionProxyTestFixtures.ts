import type { VisionProxySettings } from "../types";

export function visionProxyFixture(overrides: Partial<VisionProxySettings> = {}): VisionProxySettings {
	return {
		enabled: true,
		selectionMode: "auto",
		defaultModelId: "",
		customModelIds: [],
		customListMaxRetriesPerModel: 3,
		customListMaxDelayMs: 60_000,
		customPrompt: "",
		...overrides
	};
}
