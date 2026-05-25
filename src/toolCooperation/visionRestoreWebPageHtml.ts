import type { ProxyBBox } from "../visionProxyStructuredPlan";

/** True when bbox covers ≥ratio of canvas (used to drop single full-viewport collapse plans). */
export function elementCoversFullViewport(bbox: ProxyBBox, width: number, height: number, ratio = 0.95): boolean {
	const canvasArea = Math.max(1, width * height);
	const area = Math.max(1, bbox.w * bbox.h);
	return area / canvasArea >= ratio;
}

export function countClickableRestoreLayers(html: string): string[] {
	const ids: string[] = [];
	const re = /<button[^>]*\sdata-element-id="([^"]+)"/giu;
	let match: RegExpExecArray | null;
	while ((match = re.exec(html)) !== null) {
		ids.push(match[1] ?? "");
	}
	return ids;
}

export function buildClickableLayerMarkup(input: {
	readonly elementId: string;
	readonly mode: "image" | "svg";
	readonly bbox: { x: number; y: number; w: number; h: number };
	readonly imgSrc?: string;
	readonly svgMarkup?: string;
}): string {
	const x = Math.round(input.bbox.x);
	const y = Math.round(input.bbox.y);
	const w = Math.max(1, Math.round(input.bbox.w));
	const h = Math.max(1, Math.round(input.bbox.h));
	const style = [
		"position:absolute",
		`left:${x}px`,
		`top:${y}px`,
		`width:${w}px`,
		`height:${h}px`,
		"padding:0",
		"margin:0",
		"border:none",
		"background:transparent",
		"cursor:pointer",
		"overflow:hidden"
	].join(";");
	const attrs = [
		'type="button"',
		`data-element-id="${escapeAttr(input.elementId)}"`,
		`data-restore-mode="${escapeAttr(input.mode)}"`,
		'class="restore-layer"',
		`aria-label="${escapeAttr(input.elementId)}"`,
		`style="${style}"`
	].join(" ");
	if (input.svgMarkup?.trim()) {
		return `<button ${attrs}>${input.svgMarkup}</button>`;
	}
	const src = input.imgSrc ?? "";
	return `<button ${attrs}><img alt="" src="${src}" style="width:100%;height:100%;object-fit:fill;display:block" /></button>`;
}

export function buildRestoreWebPageShell(input: {
	readonly width: number;
	readonly height: number;
	readonly layerMarkup: string;
	readonly backgroundRgb?: { r: number; g: number; b: number };
}): string {
	const bg = input.backgroundRgb ?? { r: 248, g: 248, b: 248 };
	return [
		"<!DOCTYPE html>",
		"<html lang=\"en\"><head><meta charset=\"utf-8\" />",
		"<title>Vision Restore — Chat Screenshot Benchmark</title>",
		"<style>",
		`html,body{margin:0;padding:0;background:rgb(${bg.r},${bg.g},${bg.b})}`,
		`#canvas{position:relative;width:${input.width}px;height:${input.height}px;overflow:hidden}`,
		"button.restore-layer:focus{outline:2px solid #0078d4;outline-offset:-2px}",
		"button.restore-layer[data-clicked=\"1\"]{box-shadow:inset 0 0 0 2px #0078d4}",
		"</style></head><body>",
		`<motionless-div id="canvas">${input.layerMarkup}</motionless-div>`.replace(/motionless-/gu, ""),
		"<script>",
		"document.querySelectorAll('button[data-element-id]').forEach(function(btn){",
		"btn.addEventListener('click',function(){btn.dataset.clicked='1';});",
		"});",
		"</script>",
		"</body></html>"
	].join("\n");
}

function escapeAttr(value: string): string {
	return value.replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;");
}
