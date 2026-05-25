import type { ProxyBBox } from "../visionProxyStructuredPlan";

/**
 * Paints a restored ROI patch onto a full-size screenshot, preserving canvas dimensions.
 * Used by the vision proxy restore-artifact path so multi-element plans accumulate on one frame
 * (instead of replacing the whole attachment with a tiny crop).
 */
export async function compositeRasterPatchOntoImage(
	fullImage: Buffer,
	patch: Buffer,
	bbox: ProxyBBox
): Promise<Buffer> {
	const sharpModule = loadSharp();
	const w = Math.max(1, Math.round(bbox.w));
	const h = Math.max(1, Math.round(bbox.h));
	const left = Math.max(0, Math.round(bbox.x));
	const top = Math.max(0, Math.round(bbox.y));
	const resized = await sharpModule(patch).resize(w, h, { fit: "fill" }).png().toBuffer();
	return sharpModule(fullImage).ensureAlpha().composite([{ input: resized, left, top }]).png().toBuffer();
}

type SharpFactory = typeof import("sharp");

function loadSharp(): SharpFactory {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return require("sharp") as SharpFactory;
}
