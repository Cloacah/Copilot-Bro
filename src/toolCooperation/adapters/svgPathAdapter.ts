import { ProviderError, normalizeUnknownError } from "../../errors";
import type { SvgPathAdapter } from "./types";

interface SvgPathBBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface SvgPathCommanderLike {
	normalize(): SvgPathCommanderLike;
	toString(): string;
	getBBox(): SvgPathBBox;
}

interface SvgPathCommanderConstructor {
	new(pathData: string): SvgPathCommanderLike;
}

let loadedSvgPathCommander: SvgPathCommanderConstructor | null | undefined;

function getSvgPathCommander(): SvgPathCommanderConstructor | null {
	if (loadedSvgPathCommander !== undefined) {
		return loadedSvgPathCommander;
	}
	try {
		const svgPathModule = require("svg-path-commander") as SvgPathCommanderConstructor | { default?: SvgPathCommanderConstructor };
		loadedSvgPathCommander = typeof svgPathModule === "function" ? svgPathModule : svgPathModule.default ?? null;
	} catch {
		loadedSvgPathCommander = null;
	}
	return loadedSvgPathCommander;
}

function toSvgPathError(operation: string, error: unknown): ProviderError {
	const normalized = normalizeUnknownError(error);
	return new ProviderError(`[svg-path-commander] ${operation} failed: ${normalized.message}`, {
		status: normalized.status,
		code: normalized.code ?? "SVG_PATH_ADAPTER",
		body: normalized.body,
		url: normalized.url,
		retryable: normalized.retryable
	});
}

function createCommander(pathData: string): SvgPathCommanderLike {
	const SvgPathCommander = getSvgPathCommander();
	if (!SvgPathCommander) {
		throw toSvgPathError("load", new Error("svg-path-commander is unavailable"));
	}
	return new SvgPathCommander(pathData);
}

export const svgPathAdapter: SvgPathAdapter = {
	capability: {
		name: "svg-path-commander",
		license: "MIT",
		runtimeRequirement: "none",
		performanceTier: "A"
	},
	normalize(pathData: string): string {
		try {
			return createCommander(pathData)
				.normalize()
				.toString();
		} catch (error) {
			throw toSvgPathError("normalize", error);
		}
	},
	getBBox(pathData: string): { x: number; y: number; w: number; h: number } {
		try {
			const bbox = createCommander(pathData).getBBox();
			return {
				x: bbox.x,
				y: bbox.y,
				w: bbox.width,
				h: bbox.height
			};
		} catch (error) {
			throw toSvgPathError("getBBox", error);
		}
	}
};