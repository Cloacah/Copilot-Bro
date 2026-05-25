/**
 * Compose restored element layers onto a web-page-sized canvas (PNG).
 * HTML export is for human inspection; tests rasterize via sharp composite.
 */

import type { ProxyBBox } from "../visionProxyStructuredPlan";
import {
	buildClickableLayerMarkup,
	buildRestoreWebPageShell
} from "./visionRestoreWebPageHtml";

export interface VisionRestorePageLayer {
	readonly elementId: string;
	readonly bbox: ProxyBBox;
	readonly png?: Buffer;
	readonly svg?: string;
	readonly mode?: "image" | "svg";
}

export interface VisionRestorePageSpec {
	readonly width: number;
	readonly height: number;
	readonly background?: { r: number; g: number; b: number; alpha?: number };
	/**
	 * When set, composites layers on top of this image (same dimensions as width/height).
	 * Used for page-level SSIM vs the source screenshot; without it, a flat preview background is used.
	 */
	readonly baseImage?: Buffer;
	readonly layers: readonly VisionRestorePageLayer[];
}

export interface VisionRestoreWebPageArtifact {
	readonly html: string;
	readonly png: Buffer;
}

export async function composeVisionRestorePagePng(spec: VisionRestorePageSpec): Promise<Buffer> {
	const sharpModule = loadSharp();
	const bg = spec.background ?? { r: 248, g: 248, b: 248, alpha: 1 };
	const composites: { input: Buffer; left: number; top: number }[] = [];

	for (const layer of spec.layers) {
		const { bbox } = layer;
		const w = Math.max(1, Math.round(bbox.w));
		const h = Math.max(1, Math.round(bbox.h));
		const left = Math.max(0, Math.round(bbox.x));
		const top = Math.max(0, Math.round(bbox.y));

		if (layer.png?.length) {
			const resized = await sharpModule(layer.png)
				.resize(w, h, { fit: "fill" })
				.png()
				.toBuffer();
			composites.push({ input: resized, left, top });
			continue;
		}
		if (layer.svg?.trim()) {
			const raster = await sharpModule(Buffer.from(layer.svg, "utf8"))
				.resize(w, h, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
				.png()
				.toBuffer();
			composites.push({ input: raster, left, top });
		}
	}

	const targetW = Math.max(1, Math.round(spec.width));
	const targetH = Math.max(1, Math.round(spec.height));

	if (spec.baseImage?.length) {
		return sharpModule(spec.baseImage)
			.resize(targetW, targetH, { fit: "fill" })
			.ensureAlpha()
			.composite(composites)
			.png()
			.toBuffer();
	}

	return sharpModule({
		create: {
			width: targetW,
			height: targetH,
			channels: 4,
			background: bg
		}
	})
		.composite(composites)
		.png()
		.toBuffer();
}

export function buildVisionRestoreWebPageHtml(spec: VisionRestorePageSpec, layerDataUrls: ReadonlyMap<string, string>): string {
	const layerMarkup = spec.layers
		.map((layer) => {
			const mode = layer.mode ?? (layer.svg?.trim() ? "svg" : "image");
			return buildClickableLayerMarkup({
				elementId: layer.elementId,
				mode,
				bbox: layer.bbox,
				imgSrc: layerDataUrls.get(layer.elementId),
				svgMarkup: layer.svg?.trim() ? layer.svg : undefined
			});
		})
		.join("\n");

	return buildRestoreWebPageShell({
		width: spec.width,
		height: spec.height,
		layerMarkup,
		backgroundRgb: spec.background
			? { r: spec.background.r, g: spec.background.g, b: spec.background.b }
			: undefined
	});
}

export async function exportVisionRestoreWebPage(
	spec: VisionRestorePageSpec
): Promise<VisionRestoreWebPageArtifact> {
	const png = await composeVisionRestorePagePng(spec);
	const dataUrls = new Map<string, string>();
	for (const layer of spec.layers) {
		if (layer.png?.length) {
			dataUrls.set(layer.elementId, `data:image/png;base64,${layer.png.toString("base64")}`);
		}
	}
	const html = buildVisionRestoreWebPageHtml(spec, dataUrls);
	return { html, png };
}

type SharpFactory = typeof import("sharp");

function loadSharp(): SharpFactory {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return require("sharp") as SharpFactory;
}
