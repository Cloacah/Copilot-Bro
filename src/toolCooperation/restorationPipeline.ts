import type { MlSegmentAdapter, MlSegmentResult } from "./adapters/types";
import { evaluateArtifactScore, type ArtifactScoreSummary } from "./artifactScore";
import { blendMlSegmentMasks, type BlendOptions } from "./blending";
import { deformMlSegmentMasks, type DeformationOptions } from "./deformation";
import { evaluateMaskQuality, type MaskQualitySummary } from "./maskQuality";
import { applyStyleConstraintsToSegments, type StyleConsistencyOptions, type StyleConsistencySummary } from "./styleConsistency";
import {
	DEFAULT_DECONTAMINATION_OPTIONS,
	DEFAULT_FEATHER_OPTIONS,
	DEFAULT_MORPHOLOGY_OPTIONS,
	decontaminateMlSegmentMasks,
	featherMlSegmentMasks,
	refineMlSegmentMasks,
	type DecontaminationOptions,
	type MorphologyOptions
} from "./morphology";

export type RestorationStage =
	| "segmentation"
	| "mask-refine"
	| "edge-cleanup"
	| "anti-halo"
	| "alpha-consistency";

export const RESTORATION_PIPELINE_STAGE_ORDER: readonly RestorationStage[] = [
	"segmentation",
	"mask-refine",
	"edge-cleanup",
	"anti-halo",
	"alpha-consistency"
] as const;

export interface ExecuteRestorationPipelineInput {
	image: Buffer;
	mlSegmentAdapter: MlSegmentAdapter | null;
	maskRefine?: Partial<MorphologyOptions>;
	edgeCleanup?: {
		featherRadius?: number;
	};
	antiHalo?: Partial<DecontaminationOptions>;
	deformation?: Partial<DeformationOptions>;
	blend?: Partial<BlendOptions>;
	style?: Partial<StyleConsistencyOptions>;
	artifact?: {
		threshold?: number;
	};
}

export interface ExecuteRestorationPipelineResult {
	mlSegments?: MlSegmentResult[];
	maskQuality?: MaskQualitySummary;
	styleConsistency?: StyleConsistencySummary;
	artifactScore?: ArtifactScoreSummary;
	warnings: string[];
}

export function getRestorationPipelineStages(): readonly RestorationStage[] {
	return RESTORATION_PIPELINE_STAGE_ORDER;
}

export async function executeRestorationPipeline(
	input: ExecuteRestorationPipelineInput
): Promise<ExecuteRestorationPipelineResult> {
	let mlSegments: MlSegmentResult[] | undefined;
	let maskQuality: MaskQualitySummary | undefined;
	let styleConsistency: StyleConsistencySummary | undefined;
	let artifactScore: ArtifactScoreSummary | undefined;
	const warnings: string[] = [];
	let abortedByStageFailure = false;
	let styleReferenceSegments: MlSegmentResult[] | undefined;

	for (const stage of RESTORATION_PIPELINE_STAGE_ORDER) {
		if (abortedByStageFailure) {
			break;
		}
		const rollbackSegments = cloneMlSegments(mlSegments);
		try {
			switch (stage) {
				case "segmentation": {
					if (!input.mlSegmentAdapter) {
						warnings.push("restoration:segmentation_adapter_unavailable");
						break;
					}
					mlSegments = await input.mlSegmentAdapter.segment(input.image);
					break;
				}
				case "mask-refine":
					if (mlSegments && mlSegments.length > 0) {
						const refined = refineMlSegmentMasks(mlSegments, input.maskRefine ?? DEFAULT_MORPHOLOGY_OPTIONS);
						mlSegments = refined.segments;
						warnings.push(...refined.warnings);
					}
					break;
				case "edge-cleanup":
					if (mlSegments && mlSegments.length > 0) {
						const feathered = featherMlSegmentMasks(mlSegments, {
							radius: input.edgeCleanup?.featherRadius ?? DEFAULT_FEATHER_OPTIONS.radius
						});
						mlSegments = feathered.segments;
						warnings.push(...feathered.warnings);
					}
					break;
				case "anti-halo":
					if (mlSegments && mlSegments.length > 0) {
						const cleaned = decontaminateMlSegmentMasks(mlSegments, {
							threshold: input.antiHalo?.threshold ?? DEFAULT_DECONTAMINATION_OPTIONS.threshold,
							strength: input.antiHalo?.strength ?? DEFAULT_DECONTAMINATION_OPTIONS.strength
						});
						mlSegments = cleaned.segments;
						warnings.push(...cleaned.warnings);
					}
					break;
				case "alpha-consistency":
					if (mlSegments && mlSegments.length > 0) {
						maskQuality = evaluateMaskQuality(mlSegments);
						warnings.push(...maskQuality.warnings);
					}
					break;
			}
		} catch (error) {
			warnings.push(`restoration:${stage}:${toStageWarningMessage(error)}`);
			mlSegments = rollbackSegments;
			abortedByStageFailure = true;
		}
	}

	if (!abortedByStageFailure && mlSegments && mlSegments.length > 0 && input.deformation) {
		styleReferenceSegments = cloneMlSegments(mlSegments);
		const deformed = deformMlSegmentMasks(mlSegments, input.deformation);
		mlSegments = deformed.segments;
		warnings.push(...deformed.warnings);
	}

	if (!abortedByStageFailure && mlSegments && mlSegments.length > 0 && input.blend) {
		if (!styleReferenceSegments) {
			styleReferenceSegments = cloneMlSegments(mlSegments);
		}
		const blended = blendMlSegmentMasks(mlSegments, input.blend);
		mlSegments = blended.segments;
		warnings.push(...blended.warnings);
	}

	if (!abortedByStageFailure && mlSegments && mlSegments.length > 0 && input.style && styleReferenceSegments && styleReferenceSegments.length > 0) {
		const styled = applyStyleConstraintsToSegments(styleReferenceSegments, mlSegments, input.style);
		mlSegments = styled.segments;
		styleConsistency = styled.styleConsistency;
		warnings.push(...styled.warnings);
	}

	if (!abortedByStageFailure && mlSegments && mlSegments.length > 0) {
		maskQuality = evaluateMaskQuality(mlSegments);
		warnings.push(...maskQuality.warnings);
		artifactScore = evaluateArtifactScore(mlSegments, input.artifact?.threshold);
		warnings.push(...artifactScore.warnings);
		if (artifactScore.exceeded) {
			warnings.push(`artifact:score_above_threshold:${artifactScore.aggregateScore.toFixed(4)}`);
		}
	}

	return {
		mlSegments,
		maskQuality,
		styleConsistency,
		artifactScore,
		warnings
	};
}

function cloneMlSegments(segments: MlSegmentResult[] | undefined): MlSegmentResult[] | undefined {
	if (!segments) {
		return undefined;
	}
	return segments.map((segment) => ({
		...segment,
		mask: Buffer.from(segment.mask)
	}));
}

function toStageWarningMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
