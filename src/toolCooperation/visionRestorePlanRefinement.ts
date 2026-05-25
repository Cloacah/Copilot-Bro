import { clampProxyBBoxToImage } from "../visionProxyBBox";
import type { ProxyBBox, ProxyStructuredOutput, ProxyVisualElement } from "../visionProxyStructuredPlan";
import { elementCoversFullViewport } from "./visionRestoreWebPageHtml";

/** Large photographic regions cannot hit 99% SSIM via SVG trace — coerce to matting. */
const MAX_SVG_AREA_RATIO = 0.18;

/** Tiny flat controls are better as vector when the model chose image. */
const MIN_SVG_AREA_RATIO = 0.0008;

const ICON_LIKE = /\b(icon|glyph|logo|badge|chip|avatar|toolbar|activity|tab)\b/iu;

export interface RefineVisionRestorePlanResult {
	readonly plan: ProxyStructuredOutput;
	readonly adjustments: readonly string[];
}

/**
 * Post-process LLM structured plan: clamp bboxes, drop full-screen collapse,
 * coerce mode per region size/heuristics (LLM remains primary; this guards 99% gates).
 */
export function refineVisionRestorePlan(
	plan: ProxyStructuredOutput,
	imageWidth: number,
	imageHeight: number
): RefineVisionRestorePlanResult {
	const adjustments: string[] = [];
	const canvasArea = Math.max(1, imageWidth * imageHeight);

	let elements = plan.elements.filter((element) => element.mode !== "none");
	elements = scalePlanBboxesToCanvasIfNeeded(elements, imageWidth, imageHeight, adjustments);
	elements = elements
		.map((element) => normalizeElementGeometry(element, imageWidth, imageHeight, adjustments, true))
		.filter((element) => {
			const bbox = primaryBBox(element);
			if (!bbox) {
				adjustments.push(`dropped-missing-bbox:${element.elementId}`);
				return false;
			}
			if (elementCoversFullViewport(bbox, imageWidth, imageHeight)) {
				adjustments.push(`dropped-full-viewport:${element.elementId}`);
				return false;
			}
			return true;
		})
		.map((element) => coerceElementMode(element, canvasArea, adjustments))
		.map((element) => stripHighRasterThresholds(element, adjustments));

	if (elements.length < 2) {
		adjustments.push("plan:few-elements-after-refine-no-synthetic-decomposition");
	}

	return {
		plan: { ...plan, elements },
		adjustments
	};
}

function normalizeElementGeometry(
	element: ProxyVisualElement,
	imageWidth: number,
	imageHeight: number,
	adjustments: string[],
	denormalize01: boolean
): ProxyVisualElement {
	const raw = element.imageParams?.crop ?? element.regions[0]?.bbox;
	if (!raw) {
		return element;
	}
	let bbox = raw;
	if (denormalize01 && looksLikeNormalized01BBox(raw)) {
		bbox = {
			x: raw.x * imageWidth,
			y: raw.y * imageHeight,
			w: raw.w * imageWidth,
			h: raw.h * imageHeight
		};
		adjustments.push(`denormalized-bbox:${element.elementId}`);
	}
	bbox = clampProxyBBoxToImage(bbox, imageWidth, imageHeight);
	if (bbox.w !== raw.w || bbox.h !== raw.h || bbox.x !== raw.x || bbox.y !== raw.y) {
		adjustments.push(`clamped-bbox:${element.elementId}`);
	}
	const regions = element.regions.length > 0
		? element.regions.map((region, index) =>
			index === 0 ? { ...region, bbox } : { ...region, bbox: clampProxyBBoxToImage(region.bbox, imageWidth, imageHeight) }
		)
		: [
			{
				label: element.label || element.elementId,
				bbox,
				confidence: element.confidence,
				priority: 1,
				rationale: "refined-primary-region"
			}
		];
	return {
		...element,
		regions,
		imageParams: {
			...element.imageParams,
			crop: bbox
		}
	};
}

function coerceElementMode(
	element: ProxyVisualElement,
	canvasArea: number,
	adjustments: string[]
): ProxyVisualElement {
	const bbox = primaryBBox(element);
	if (!bbox) {
		return element;
	}
	const areaRatio = (bbox.w * bbox.h) / canvasArea;
	let mode = element.mode;
	if (mode === "svg" && areaRatio > MAX_SVG_AREA_RATIO) {
		mode = "image";
		adjustments.push(`coerced-svg-to-image:${element.elementId}`);
	} else if (mode === "image" && areaRatio < MIN_SVG_AREA_RATIO && ICON_LIKE.test(`${element.label} ${element.rationale}`)) {
		mode = "svg";
		adjustments.push(`coerced-image-to-svg:${element.elementId}`);
	}
	if (mode === element.mode) {
		return element;
	}
	return { ...element, mode };
}

/**
 * Models often emit `threshold: 255` as a mistaken "hard mask" hint; it binarizes photographic UI
 * and destroys both perceived quality and page-level SSIM vs the source screenshot.
 */
const HIGH_RASTER_THRESHOLD = 200;

function stripHighRasterThresholds(element: ProxyVisualElement, adjustments: string[]): ProxyVisualElement {
	const t = element.imageParams?.threshold;
	if (typeof t !== "number" || t < HIGH_RASTER_THRESHOLD) {
		return element;
	}
	adjustments.push(`stripped-high-raster-threshold:${element.elementId}:${t}`);
	return {
		...element,
		imageParams: {
			...element.imageParams,
			threshold: undefined
		}
	};
}

function primaryBBox(element: ProxyVisualElement) {
	return element.imageParams?.crop ?? element.regions[0]?.bbox;
}

function scalePlanBboxesToCanvasIfNeeded(
	elements: ProxyVisualElement[],
	imageWidth: number,
	imageHeight: number,
	adjustments: string[]
): ProxyVisualElement[] {
	let maxRight = 0;
	let maxBottom = 0;
	for (const element of elements) {
		const bbox = primaryBBox(element);
		if (!bbox) {
			continue;
		}
		maxRight = Math.max(maxRight, bbox.x + bbox.w);
		maxBottom = Math.max(maxBottom, bbox.y + bbox.h);
	}
	if (maxRight <= imageWidth && maxBottom <= imageHeight) {
		return elements;
	}
	if (maxRight <= 0 || maxBottom <= 0) {
		return elements;
	}
	const scaleX = imageWidth / maxRight;
	const scaleY = imageHeight / maxBottom;
	if (scaleX >= 1 || scaleY >= 1) {
		return elements;
	}
	adjustments.push(`scaled-bbox-to-canvas:${scaleX.toFixed(4)}x${scaleY.toFixed(4)}`);
	return elements.map((element) => {
		const bbox = primaryBBox(element);
		if (!bbox) {
			return element;
		}
		const scaled = {
			x: Math.round(bbox.x * scaleX),
			y: Math.round(bbox.y * scaleY),
			w: Math.max(1, Math.round(bbox.w * scaleX)),
			h: Math.max(1, Math.round(bbox.h * scaleY))
		};
		return normalizeElementGeometry(
			{ ...element, imageParams: { ...element.imageParams, crop: scaled } },
			imageWidth,
			imageHeight,
			adjustments,
			false
		);
	});
}

function looksLikeNormalized01BBox(bbox: ProxyBBox): boolean {
	return (
		bbox.x >= 0
		&& bbox.y >= 0
		&& bbox.w > 0
		&& bbox.h > 0
		&& bbox.x <= 1.05
		&& bbox.y <= 1.05
		&& bbox.x + bbox.w <= 1.05
		&& bbox.y + bbox.h <= 1.05
	);
}
