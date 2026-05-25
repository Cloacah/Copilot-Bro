import type { VisionAgentConfig } from "../types";

export type CompatibilityMatrixModelType = "builtin" | "bro";
export type CompatibilityMatrixVisionCapability = "vision" | "non-vision";
export type CompatibilityMatrixToolsAvailability = "tools-available" | "no-tools";
export type ToolSelectionStrategy = "native" | "proxy" | "wrapper-proxy" | "text-fallback" | "plan-only" | "disabled";
export type ToolSelectionFallbackStrategy = Extract<ToolSelectionStrategy, "text-fallback" | "plan-only" | "disabled">;

export interface CompatibilityModelCapabilities {
	modelType: CompatibilityMatrixModelType;
	nativeVision: boolean;
	proxyVision: boolean;
	wrapperProxyAvailable: boolean;
	textFallback: boolean;
	planOnly: boolean;
	toolCalling: boolean;
	proxyRequired?: boolean;
}

export interface CompatibilityMatrixInput {
	modelType: CompatibilityMatrixModelType;
	visionCapability: CompatibilityMatrixVisionCapability;
	toolsAvailable: CompatibilityMatrixToolsAvailability;
	agentEnabled: boolean;
}

export interface CompatibilityMatrixEntry {
	strategy: ToolSelectionStrategy;
	fallbackStrategy?: ToolSelectionFallbackStrategy;
	reason: string;
	fallbackReason?: string;
	matrixKey: string;
}

type CompatibilityMatrixTable = Record<string, Omit<CompatibilityMatrixEntry, "matrixKey">>;

const COMPATIBILITY_MATRIX: CompatibilityMatrixTable = {
	"builtin|vision|tools-available|agent-on": {
		strategy: "native",
		reason: "Built-in native vision remains on the host route when tools are available."
	},
	"builtin|vision|tools-available|agent-off": {
		strategy: "native",
		reason: "Built-in native vision stays native even when the agent is off."
	},
	"builtin|vision|no-tools|agent-on": {
		strategy: "native",
		fallbackStrategy: "plan-only",
		reason: "Built-in native vision remains the main path, with a plan-only fallback when tools are unavailable.",
		fallbackReason: "Native built-in vision is primary, but no-tools mode only allows an executable plan fallback if native processing cannot continue."
	},
	"builtin|vision|no-tools|agent-off": {
		strategy: "native",
		fallbackStrategy: "text-fallback",
		reason: "Built-in native vision stays primary while the agent is off.",
		fallbackReason: "With the agent off and no tools available, only a text fallback can remain as the controlled downgrade."
	},
	"builtin|non-vision|tools-available|agent-on": {
		strategy: "wrapper-proxy",
		reason: "Built-in non-vision models require the wrapper-proxy path when tools are available and the agent is on."
	},
	"builtin|non-vision|tools-available|agent-off": {
		strategy: "text-fallback",
		reason: "Built-in non-vision models cannot use wrapper-proxy when the agent is off."
	},
	"builtin|non-vision|no-tools|agent-on": {
		strategy: "plan-only",
		reason: "Built-in non-vision models without tools can only return an executable plan."
	},
	"builtin|non-vision|no-tools|agent-off": {
		strategy: "disabled",
		reason: "Built-in non-vision models without tools and with the agent off have no viable route."
	},
	"bro|vision|tools-available|agent-on": {
		strategy: "proxy",
		reason: "Bro vision models follow the proxy route when the agent is on and tools are available."
	},
	"bro|vision|tools-available|agent-off": {
		strategy: "native",
		reason: "Bro vision models use native vision when the vision agent is off."
	},
	"bro|vision|no-tools|agent-on": {
		strategy: "proxy",
		fallbackStrategy: "plan-only",
		reason: "Bro vision models still prefer proxy, with plan-only as the no-tools fallback.",
		fallbackReason: "When Bro vision routing lacks tools, only a plan-only fallback remains available."
	},
	"bro|vision|no-tools|agent-off": {
		strategy: "native",
		fallbackStrategy: "text-fallback",
		reason: "Bro vision models use native vision when the vision agent is off, with text fallback as the controlled downgrade.",
		fallbackReason: "With no tools and the agent off, only text guidance remains if native vision cannot continue."
	},
	"bro|non-vision|tools-available|agent-on": {
		strategy: "proxy",
		reason: "Bro non-vision models with tools available rely on the proxy route."
	},
	"bro|non-vision|tools-available|agent-off": {
		strategy: "text-fallback",
		reason: "Bro non-vision models fall back to text guidance when the agent is off."
	},
	"bro|non-vision|no-tools|agent-on": {
		strategy: "plan-only",
		reason: "Bro non-vision models without tools can only emit an executable plan."
	},
	"bro|non-vision|no-tools|agent-off": {
		strategy: "disabled",
		reason: "Bro non-vision models without tools and with the agent off have no compatible route."
	}
};

export function getCompatibilityMatrixEntry(input: CompatibilityMatrixInput): CompatibilityMatrixEntry {
	const matrixKey = buildCompatibilityMatrixKey(input);
	const entry = COMPATIBILITY_MATRIX[matrixKey];
	if (!entry) {
		return {
			strategy: "disabled",
			reason: `No matrix entry exists for ${matrixKey}.`,
			matrixKey
		};
	}
	return {
		...entry,
		matrixKey
	};
}

export function selectCompatibilityMatrixStrategy(
	visionNeeded: boolean,
	modelCaps: CompatibilityModelCapabilities,
	config: Pick<VisionAgentConfig, "enabled">
): CompatibilityMatrixEntry {
	if (!visionNeeded) {
		return {
			strategy: modelCaps.textFallback ? "text-fallback" : "disabled",
			reason: modelCaps.textFallback ? "Vision is not needed for this message." : "Vision is not needed and no text fallback is available.",
			matrixKey: "no-vision-needed"
		};
	}

	const entry = getCompatibilityMatrixEntry({
		modelType: modelCaps.modelType,
		visionCapability: modelCaps.nativeVision ? "vision" : "non-vision",
		toolsAvailable: modelCaps.toolCalling ? "tools-available" : "no-tools",
		agentEnabled: config.enabled
	});
	if (modelCaps.nativeVision && !modelCaps.proxyVision && !modelCaps.proxyRequired) {
		return {
			strategy: "native",
			reason: "Native vision model with vision proxy disabled; using on-model high-fidelity structured path.",
			fallbackStrategy: entry.fallbackStrategy,
			fallbackReason: entry.fallbackReason,
			matrixKey: entry.matrixKey
		};
	}
	if (isStrategyAvailable(entry.strategy, modelCaps)) {
		return entry;
	}
	if (modelCaps.nativeVision && entry.strategy !== "native" && !modelCaps.proxyRequired) {
		return {
			strategy: "native",
			reason: `Matrix primary route ${entry.strategy} is unavailable; falling back to native vision.`,
			fallbackStrategy: entry.fallbackStrategy,
			fallbackReason: entry.fallbackReason,
			matrixKey: entry.matrixKey
		};
	}
	if (entry.fallbackStrategy && isStrategyAvailable(entry.fallbackStrategy, modelCaps)) {
		return {
			strategy: entry.fallbackStrategy,
			reason: entry.fallbackReason ?? `Matrix fallback from ${entry.strategy}.`,
			fallbackStrategy: entry.fallbackStrategy,
			fallbackReason: entry.fallbackReason,
			matrixKey: entry.matrixKey
		};
	}
	if (modelCaps.planOnly) {
		return {
			strategy: "plan-only",
			reason: `Matrix primary route ${entry.strategy} is unavailable; falling back to plan-only.`,
			fallbackStrategy: entry.fallbackStrategy,
			fallbackReason: entry.fallbackReason,
			matrixKey: entry.matrixKey
		};
	}
	if (modelCaps.textFallback) {
		return {
			strategy: "text-fallback",
			reason: `Matrix primary route ${entry.strategy} is unavailable; falling back to text guidance.`,
			fallbackStrategy: entry.fallbackStrategy,
			fallbackReason: entry.fallbackReason,
			matrixKey: entry.matrixKey
		};
	}
	return {
		strategy: "disabled",
		reason: `Matrix primary route ${entry.strategy} is unavailable and no controlled fallback remains.`,
		fallbackStrategy: entry.fallbackStrategy,
		fallbackReason: entry.fallbackReason,
		matrixKey: entry.matrixKey
	};
}

export function buildCompatibilityMatrixKey(input: CompatibilityMatrixInput): string {
	return [
		input.modelType,
		input.visionCapability,
		input.toolsAvailable,
		input.agentEnabled ? "agent-on" : "agent-off"
	].join("|");
}

function isStrategyAvailable(strategy: ToolSelectionStrategy, modelCaps: CompatibilityModelCapabilities): boolean {
	switch (strategy) {
		case "native":
			return modelCaps.nativeVision;
		case "proxy":
			return modelCaps.proxyVision;
		case "wrapper-proxy":
			return modelCaps.wrapperProxyAvailable && modelCaps.toolCalling;
		case "text-fallback":
			return modelCaps.textFallback;
		case "plan-only":
			return modelCaps.planOnly;
		case "disabled":
			return true;
	}
	}