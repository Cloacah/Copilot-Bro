/**
 * Rasterize the exported vision-restore HTML in a real browser (Chromium via Playwright),
 * then compare that PNG to the source screenshot — no “underlay source image” in the composite.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type Rgb = { readonly r: number; readonly g: number; readonly b: number };

/**
 * Average RGB from the four corners (small k×k samples) so the HTML shell background matches
 * letterboxing / margins of the screenshot without pasting the full source as a layer.
 */
export async function sampleCornerBackgroundRgb(image: Buffer, samplePx = 12): Promise<Rgb> {
	const sharpModule = loadSharp();
	const meta = await sharpModule(image).metadata();
	const w = Math.max(1, meta.width ?? 1);
	const h = Math.max(1, meta.height ?? 1);
	const k = Math.max(1, Math.min(samplePx, Math.floor(Math.min(w, h) / 6)));
	const corners = [
		{ left: 0, top: 0 },
		{ left: w - k, top: 0 },
		{ left: 0, top: h - k },
		{ left: w - k, top: h - k }
	];
	let sr = 0;
	let sg = 0;
	let sb = 0;
	let n = 0;
	for (const c of corners) {
		const left = Math.max(0, c.left);
		const top = Math.max(0, c.top);
		const { data, info } = await sharpModule(image)
			.extract({ left, top, width: k, height: k })
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		const ch = info.channels;
		for (let i = 0; i < data.length; i += ch) {
			sr += data[i] ?? 0;
			sg += data[i + 1] ?? 0;
			sb += data[i + 2] ?? 0;
			n += 1;
		}
	}
	if (n === 0) {
		return { r: 248, g: 248, b: 248 };
	}
	return {
		r: Math.round(sr / n),
		g: Math.round(sg / n),
		b: Math.round(sb / n)
	};
}

/**
 * Mean RGB over pixels **outside** the union of layer bboxes (plus a small halo).
 * Uses only gutter/letterbox pixels from the same screenshot — not a full-source underlay.
 */
export async function sampleUncoveredBackgroundRgb(
	image: Buffer,
	boxes: readonly { readonly x: number; readonly y: number; readonly w: number; readonly h: number }[],
	options?: { readonly haloPx?: number; readonly minSamples?: number }
): Promise<Rgb> {
	const sharpModule = loadSharp();
	const meta = await sharpModule(image).metadata();
	const w = Math.max(1, meta.width ?? 1);
	const h = Math.max(1, meta.height ?? 1);
	const halo = Math.max(0, Math.min(options?.haloPx ?? 2, 8));
	const minSamples = Math.max(16, options?.minSamples ?? 80);
	const { data, info } = await sharpModule(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	const ch = info.channels;
	const covered = new Uint8Array(w * h);
	for (const b of boxes) {
		const x0 = Math.max(0, Math.floor(b.x) - halo);
		const y0 = Math.max(0, Math.floor(b.y) - halo);
		const x1 = Math.min(w, Math.ceil(b.x + b.w) + halo);
		const y1 = Math.min(h, Math.ceil(b.y + b.h) + halo);
		for (let y = y0; y < y1; y++) {
			const row = y * w;
			for (let x = x0; x < x1; x++) {
				covered[row + x] = 1;
			}
		}
	}
	let sr = 0;
	let sg = 0;
	let sb = 0;
	let n = 0;
	for (let y = 0; y < h; y++) {
		const row = y * w;
		for (let x = 0; x < w; x++) {
			if (covered[row + x]) {
				continue;
			}
			const o = (row + x) * ch;
			sr += data[o] ?? 0;
			sg += data[o + 1] ?? 0;
			sb += data[o + 2] ?? 0;
			n += 1;
		}
	}
	if (n < minSamples) {
		return sampleCornerBackgroundRgb(image);
	}
	return {
		r: Math.round(sr / n),
		g: Math.round(sg / n),
		b: Math.round(sb / n)
	};
}

export function loadPlaywrightFromRepoRoots(roots: readonly string[]): typeof import("playwright") {
	for (const root of roots) {
		const trimmed = root.trim();
		if (!trimmed) {
			continue;
		}
		try {
			const req = createRequire(path.join(trimmed, "package.json"));
			return req("playwright") as typeof import("playwright");
		} catch {
			/* try next root */
		}
	}
	throw new Error(
		[
			"playwright is required for web-screenshot benchmark (Chromium).",
			"From the repo root: npm i -D playwright && npx playwright install chromium",
			`Tried: ${roots.filter((r) => r.trim()).join(", ") || "(none)"}`
		].join(" ")
	);
}

export async function screenshotHtmlFileToPng(input: {
	readonly htmlPath: string;
	readonly width: number;
	readonly height: number;
	readonly playwrightRoots: readonly string[];
}): Promise<Buffer> {
	const playwright = loadPlaywrightFromRepoRoots(input.playwrightRoots);
	const browser = await playwright.chromium.launch({ headless: true });
	try {
		const context = await browser.newContext({
			viewport: { width: input.width, height: input.height },
			deviceScaleFactor: 1
		});
		try {
			const page = await context.newPage();
			const href = pathToFileURL(input.htmlPath).href;
			await page.goto(href, { waitUntil: "load", timeout: 120_000 });
			await page.evaluate(async () => {
				await Promise.all(
					Array.from(document.images).map(
						(img) =>
							img.complete
								? Promise.resolve()
								: new Promise<void>((resolve) => {
									img.addEventListener("load", () => resolve(), { once: true });
									img.addEventListener("error", () => resolve(), { once: true });
								})
					)
				);
				try {
					await document.fonts?.ready;
				} catch {
					/* ignore */
				}
				await new Promise<void>((resolve) => {
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
				});
			});
			const shot = await page.screenshot({
				type: "png",
				clip: { x: 0, y: 0, width: input.width, height: input.height }
			});
			return Buffer.from(shot);
		} finally {
			await context.close();
		}
	} finally {
		await browser.close();
	}
}

type SharpFactory = typeof import("sharp");

function loadSharp(): SharpFactory {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return require("sharp") as SharpFactory;
}
