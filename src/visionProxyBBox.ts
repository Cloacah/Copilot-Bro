import type { ProxyBBox } from "./visionProxyStructuredPlan";

/** Clamp proxy/LLM bbox to actual image pixels (avoids sharp extract_area failures). */
export function clampProxyBBoxToImage(
	bbox: ProxyBBox,
	imageWidth: number,
	imageHeight: number
): ProxyBBox {
	if (!Number.isFinite(imageWidth) || imageWidth <= 0 || !Number.isFinite(imageHeight) || imageHeight <= 0) {
		return bbox;
	}
	const left = clamp(bbox.x, 0, imageWidth);
	const top = clamp(bbox.y, 0, imageHeight);
	const right = clamp(bbox.x + Math.max(0, bbox.w), 0, imageWidth);
	const bottom = clamp(bbox.y + Math.max(0, bbox.h), 0, imageHeight);
	/** Integer pixel box so Sharp crops, HTML absolute layout, and Playwright agree (subpixel CSS blurs SSIM). */
	const x = Math.max(0, Math.min(imageWidth - 1, Math.round(left)));
	const y = Math.max(0, Math.min(imageHeight - 1, Math.round(top)));
	const rightI = Math.max(x + 1, Math.min(imageWidth, Math.round(right)));
	const bottomI = Math.max(y + 1, Math.min(imageHeight, Math.round(bottom)));
	const w = Math.max(1, rightI - x);
	const h = Math.max(1, bottomI - y);
	return { x, y, w, h };
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
