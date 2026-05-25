import type {
	ImageDataLike,
	RasterVectorizeAdapter,
	RasterVectorizeOptions,
	RasterVectorizeResult
} from "./adapters/types";

export type { RasterVectorizeOptions, RasterVectorizeResult } from "./adapters/types";

export async function rasterBufferToImageData(
	buffer: Buffer,
	width?: number,
	height?: number
): Promise<ImageDataLike> {
	const sharpModule = loadSharpFactory();
	if (!sharpModule) {
		throw new Error("[raster-vectorize] sharp is unavailable for raster conversion");
	}
	let pipeline: SharpPipelineLike = sharpModule(buffer).ensureAlpha();
	if (width !== undefined && height !== undefined && width > 0 && height > 0) {
		pipeline = pipeline.resize(Math.round(width), Math.round(height), { fit: "fill" });
	}
	const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
	return {
		width: info.width,
		height: info.height,
		data: new Uint8ClampedArray(data)
	};
}

export async function vectorizeRasterBuffer(
	buffer: Buffer,
	options: RasterVectorizeOptions = {},
	adapter?: RasterVectorizeAdapter
): Promise<RasterVectorizeResult> {
	const impl = adapter ?? getDefaultRasterVectorizeAdapter();
	return impl.vectorize(buffer, options);
}

function getDefaultRasterVectorizeAdapter(): RasterVectorizeAdapter {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const tracer = require("imagetracerjs") as {
		imagedataToSVG: (imgd: ImageDataLike, options?: Record<string, unknown>) => string;
	};
	return {
		capability: {
			name: "imagetracerjs",
			license: "Unlicense",
			runtimeRequirement: "none",
			performanceTier: "B"
		},
		async vectorize(buffer: Buffer, options: RasterVectorizeOptions): Promise<RasterVectorizeResult> {
			const meta = await rasterBufferToImageData(buffer);
			const svg = tracer.imagedataToSVG(meta, {
				ltres: options.ltres ?? 1,
				qtres: options.qtres ?? 1,
				numberofcolors: options.numberofcolors ?? 16,
				pathomit: options.pathomit ?? 8,
				scale: 1,
				strokewidth: 0,
				linefilter: true,
				roundcoords: 1
			});
			const trimmed = svg?.trim() ?? "";
			if (!trimmed || !/<svg[\s>]/iu.test(trimmed)) {
				throw new Error("[raster-vectorize] imagetracerjs produced empty or invalid SVG");
			}
			const pathCount = (trimmed.match(/<path\b/giu) ?? []).length;
			return {
				svg: trimmed,
				engine: "imagetracerjs",
				pathCount,
				width: meta.width,
				height: meta.height
			};
		}
	};
}

type SharpPipelineLike = {
	ensureAlpha(): SharpPipelineLike;
	resize(w: number, h: number, opts: { fit: string }): SharpPipelineLike;
	raw(): { toBuffer: (opts: { resolveWithObject: true }) => Promise<{ data: Buffer; info: { width: number; height: number } }> };
};

type SharpFactoryLike = (input: Buffer) => SharpPipelineLike;

function loadSharpFactory(): SharpFactoryLike | null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const sharpModule = require("sharp") as SharpFactoryLike | { default?: SharpFactoryLike };
		return typeof sharpModule === "function" ? sharpModule : sharpModule.default ?? null;
	} catch {
		return null;
	}
}
