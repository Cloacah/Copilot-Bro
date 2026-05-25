import { ProviderError, normalizeUnknownError } from "../../errors";
import type { SvgOptimizeAdapter, SvgOptimizeOptions } from "./types";

interface SvgoOptimizeResult {
	data?: string;
}

interface SvgoModule {
	optimize(svgString: string, options?: SvgOptimizeOptions): SvgoOptimizeResult;
}

let loadedSvgoModule: SvgoModule | null | undefined;

function getSvgoModule(): SvgoModule | null {
	if (loadedSvgoModule !== undefined) {
		return loadedSvgoModule;
	}
	try {
		loadedSvgoModule = require("svgo") as SvgoModule;
	} catch {
		loadedSvgoModule = null;
	}
	return loadedSvgoModule;
}

function toSvgoError(operation: string, error: unknown): ProviderError {
	const normalized = normalizeUnknownError(error);
	return new ProviderError(`[svgo] ${operation} failed: ${normalized.message}`, {
		status: normalized.status,
		code: normalized.code ?? "SVGO_ADAPTER",
		body: normalized.body,
		url: normalized.url,
		retryable: normalized.retryable
	});
}

export const svgoAdapter: SvgOptimizeAdapter = {
	capability: {
		name: "svgo",
		license: "MIT",
		runtimeRequirement: "none",
		performanceTier: "A"
	},
	async optimize(svgString: string, options: SvgOptimizeOptions = {}): Promise<string> {
		try {
			const svgoModule = getSvgoModule();
			if (!svgoModule) {
				throw new Error("svgo is unavailable");
			}
			const result = svgoModule.optimize(svgString, options);
			return typeof result.data === "string" && result.data.length > 0 ? result.data : svgString;
		} catch (error) {
			void toSvgoError("optimize", error);
			return svgString;
		}
	}
};