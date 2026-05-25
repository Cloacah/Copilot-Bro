import type { ImageSimilarityReport } from "./imageSimilarity";
import type { ProcessingChainResult } from "./resultAssembler";

export interface VisionRestoreElementBenchmarkMetrics {
	readonly elementId: string;
	readonly mode: "image" | "svg" | "none";
	readonly similarity: ImageSimilarityReport;
	readonly pathCount: number;
	readonly rasterPathCount: number;
	readonly warningCount: number;
	readonly fidelityPassed: boolean;
	readonly processingMs: number;
}

export interface VisionRestoreBenchmarkBudget {
	readonly maxVisionApiCalls: number;
	readonly maxVectorizePathCount: number;
	readonly maxProcessingMsPerElement: number;
	readonly minCompositeSimilarity: number;
}

export const DEFAULT_RESTORE_BENCHMARK_BUDGET: VisionRestoreBenchmarkBudget = {
	maxVisionApiCalls: 1,
	maxVectorizePathCount: 2048,
	maxProcessingMsPerElement: 30_000,
	minCompositeSimilarity: 0.99
};

export interface VisionRestoreBenchmarkAggregate {
	readonly pageSimilarity: ImageSimilarityReport;
	readonly elements: readonly VisionRestoreElementBenchmarkMetrics[];
	readonly budget: VisionRestoreBenchmarkBudget;
	readonly passed: boolean;
	readonly failureReasons: readonly string[];
}

export function buildElementBenchmarkMetrics(input: {
	elementId: string;
	mode: "image" | "svg" | "none";
	similarity: ImageSimilarityReport;
	chain: Pick<ProcessingChainResult, "warnings" | "rasterVectorize">;
	fidelityPassed: boolean;
	processingMs: number;
}): VisionRestoreElementBenchmarkMetrics {
	const svgPathCount = input.chain.rasterVectorize?.pathCount ?? 0;
	return {
		elementId: input.elementId,
		mode: input.mode,
		similarity: input.similarity,
		pathCount: svgPathCount,
		rasterPathCount: svgPathCount,
		warningCount: input.chain.warnings.length,
		fidelityPassed: input.fidelityPassed,
		processingMs: input.processingMs
	};
}

export function aggregateRestoreBenchmark(input: {
	pageSimilarity: ImageSimilarityReport;
	elements: readonly VisionRestoreElementBenchmarkMetrics[];
	budget?: Partial<VisionRestoreBenchmarkBudget>;
}): VisionRestoreBenchmarkAggregate {
	const budget: VisionRestoreBenchmarkBudget = {
		...DEFAULT_RESTORE_BENCHMARK_BUDGET,
		...input.budget
	};
	const failureReasons: string[] = [];
	if (!input.pageSimilarity.passed) {
		failureReasons.push(`page-similarity-below-${budget.minCompositeSimilarity}`);
	}
	for (const element of input.elements) {
		if (!element.similarity.passed) {
			failureReasons.push(`element-${element.elementId}-similarity`);
		}
		if (!element.fidelityPassed) {
			failureReasons.push(`element-${element.elementId}-fidelity`);
		}
		if (element.rasterPathCount > budget.maxVectorizePathCount) {
			failureReasons.push(`element-${element.elementId}-path-budget`);
		}
		if (element.processingMs > budget.maxProcessingMsPerElement) {
			failureReasons.push(`element-${element.elementId}-time-budget`);
		}
	}
	return {
		pageSimilarity: input.pageSimilarity,
		elements: input.elements,
		budget,
		passed: failureReasons.length === 0,
		failureReasons
	};
}
