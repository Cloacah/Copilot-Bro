import type { VisionAgentConfig } from "../types";
import {
	selectCompatibilityMatrixStrategy,
	type CompatibilityModelCapabilities,
	type ToolSelectionFallbackStrategy,
	type ToolSelectionStrategy
} from "./compatibilityMatrix";

export interface ModelCapabilities extends CompatibilityModelCapabilities {}

export interface ToolSelection {
	strategy: ToolSelectionStrategy;
	reason: string;
	fallbackStrategy?: ToolSelectionFallbackStrategy;
	fallbackReason?: string;
	matrixKey?: string;
}

export function selectTool(
	visionNeeded: boolean,
	modelCaps: ModelCapabilities,
	config: Pick<VisionAgentConfig, "enabled">
): ToolSelection {
	return selectCompatibilityMatrixStrategy(visionNeeded, modelCaps, config);
}