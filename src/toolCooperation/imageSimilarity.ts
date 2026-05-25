/**
 * Traditional image similarity (no LLM): SSIM + PSNR + MAE composite.
 * Used for vision-restore benchmark gates (target ≥ 0.99 composite on element ROIs).
 */

export interface ImageSimilarityReport {
	readonly width: number;
	readonly height: number;
	/** Structural Similarity Index Measure ∈ [0, 1]. */
	readonly ssim: number;
	/** Peak signal-to-noise ratio (dB); higher is better. */
	readonly psnr: number;
	/** Mean absolute error on [0, 255] grayscale. */
	readonly mae: number;
	/** Weighted score ∈ [0, 1] for pass/fail gates. */
	readonly compositeSimilarity: number;
	readonly passed: boolean;
	readonly threshold: number;
}

export interface CompareImageSimilarityOptions {
	readonly maxEdge?: number;
	readonly threshold?: number;
	/** SSIM window size (odd, default 11). */
	readonly windowSize?: number;
	/** `ssim` (default for restore benchmarks) or weighted `composite`. */
	readonly gate?: "ssim" | "composite";
}

const DEFAULT_THRESHOLD = 0.99;
const DEFAULT_MAX_EDGE = 512;

export async function compareImageBuffers(
	reference: Buffer,
	candidate: Buffer,
	options: CompareImageSimilarityOptions = {}
): Promise<ImageSimilarityReport> {
	const sharpModule = loadSharp();
	const threshold = options.threshold ?? DEFAULT_THRESHOLD;
	const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE;

	const refMeta = await sharpModule(reference).metadata();
	const refW = refMeta.width ?? 1;
	const refH = refMeta.height ?? 1;
	const scale = Math.min(1, maxEdge / Math.max(refW, refH));
	const w = Math.max(1, Math.round(refW * scale));
	const h = Math.max(1, Math.round(refH * scale));

	const refGray = await toGrayscaleRaw(sharpModule, reference, w, h);
	const candGray = await toGrayscaleRaw(sharpModule, candidate, w, h);

	const ssim = computeSsim(refGray, candGray, w, h, options.windowSize ?? 11);
	const { psnr, mae } = computePsnrMae(refGray, candGray);
	const compositeSimilarity = compositeScore(ssim, psnr, mae);
	const gate = options.gate ?? "ssim";
	const passed = gate === "composite" ? compositeSimilarity >= threshold : ssim >= threshold;

	return {
		width: w,
		height: h,
		ssim,
		psnr,
		mae,
		compositeSimilarity,
		passed,
		threshold
	};
}

export function compositeScore(ssim: number, psnr: number, mae: number): number {
	const psnrNorm = Math.min(1, Math.max(0, (psnr - 20) / 30));
	const maeNorm = Math.max(0, 1 - mae / 32);
	return clamp01(0.55 * ssim + 0.25 * psnrNorm + 0.2 * maeNorm);
}

async function toGrayscaleRaw(
	sharpModule: SharpFactory,
	input: Buffer,
	width: number,
	height: number
): Promise<Float32Array> {
	const { data } = await sharpModule(input)
		.resize(width, height, { fit: "fill" })
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const out = new Float32Array(width * height);
	for (let i = 0; i < out.length; i += 1) {
		out[i] = data[i] ?? 0;
	}
	return out;
}

function computePsnrMae(a: Float32Array, b: Float32Array): { psnr: number; mae: number } {
	let mse = 0;
	let mae = 0;
	const n = a.length;
	for (let i = 0; i < n; i += 1) {
		const d = a[i]! - b[i]!;
		mse += d * d;
		mae += Math.abs(d);
	}
	mse /= n;
	mae /= n;
	const psnr = mse <= 1e-10 ? 100 : 10 * Math.log10((255 * 255) / mse);
	return { psnr, mae };
}

/** Windowed SSIM (Wang et al.); grayscale, single scale. */
function computeSsim(
	a: Float32Array,
	b: Float32Array,
	width: number,
	height: number,
	windowSize: number
): number {
	const half = Math.floor(windowSize / 2);
	const c1 = (0.01 * 255) ** 2;
	const c2 = (0.03 * 255) ** 2;
	let sum = 0;
	let count = 0;

	for (let y = half; y < height - half; y += 1) {
		for (let x = half; x < width - half; x += 1) {
			let meanA = 0;
			let meanB = 0;
			for (let dy = -half; dy <= half; dy += 1) {
				for (let dx = -half; dx <= half; dx += 1) {
					const idx = (y + dy) * width + (x + dx);
					meanA += a[idx]!;
					meanB += b[idx]!;
				}
			}
			const nWin = windowSize * windowSize;
			meanA /= nWin;
			meanB /= nWin;

			let varA = 0;
			let varB = 0;
			let cov = 0;
			for (let dy = -half; dy <= half; dy += 1) {
				for (let dx = -half; dx <= half; dx += 1) {
					const idx = (y + dy) * width + (x + dx);
					const da = a[idx]! - meanA;
					const db = b[idx]! - meanB;
					varA += da * da;
					varB += db * db;
					cov += da * db;
				}
			}
			varA /= nWin - 1;
			varB /= nWin - 1;
			cov /= nWin - 1;

			const num = (2 * meanA * meanB + c1) * (2 * cov + c2);
			const den = (meanA * meanA + meanB * meanB + c1) * (varA + varB + c2);
			sum += den > 0 ? num / den : 1;
			count += 1;
		}
	}
	return count > 0 ? sum / count : 1;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

type SharpFactory = typeof import("sharp");

function loadSharp(): SharpFactory {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return require("sharp") as SharpFactory;
}
