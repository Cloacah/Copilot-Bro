/**
 * Host UI smoke: after a **live** vision-proxy restore, re-compose the page from the same structured plan
 * and require composite SSIM ≥ 0.99 vs the source PNG. No fixed fixture plan JSON — regions come from the model.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "../../../logger";
import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "../../../config/highFidelityRestoreImagePipelineSuspended";
import type { ProxyStructuredOutput } from "../../../visionProxyStructuredPlan";
import { getImageAnalyzeAdapter } from "../../../toolCooperation/adapters/registry";
import { runPageRestoreBenchmark } from "../../../toolCooperation/visionRestoreBenchmarkRunner";

interface CapturedBenchmarkSnapshot {
	readonly source: Buffer;
	readonly plan: ProxyStructuredOutput;
	readonly width: number;
	readonly height: number;
}

let captured: CapturedBenchmarkSnapshot | undefined;

export function resetHostUiSmokeBenchmarkPageSsimCapture(): void {
	captured = undefined;
}

export async function captureHostUiSmokeBenchmarkPageSsimInputIfSmokeRestore(
	sourcePng: Buffer,
	plan: ProxyStructuredOutput,
	logger: Logger | undefined
): Promise<void> {
	if (HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED) {
		return;
	}
	if (process.env.COPILOT_BRO_UI_SMOKE !== "1") {
		return;
	}
	const adapter = getImageAnalyzeAdapter();
	const meta = await adapter.getMetadata(sourcePng);
	captured = {
		source: Buffer.from(sourcePng),
		plan: JSON.parse(JSON.stringify(plan)) as ProxyStructuredOutput,
		width: Math.max(1, meta.width ?? 1),
		height: Math.max(1, meta.height ?? 1)
	};
	logger?.info("host-ui-smoke.chat.benchmark.page-ssim.capture", {
		width: captured.width,
		height: captured.height,
		elementCount: plan.elements.filter((e) => e.mode !== "none").length
	});
}

export async function evaluateCapturedHostUiSmokeBenchmarkPageSsim(
	logger: Logger | undefined,
	options: { readonly skip?: boolean } = {}
): Promise<{ passed: boolean; ssim?: number; failure?: string }> {
	if (options.skip === true || HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED) {
		logger?.info("host-ui-smoke.chat.benchmark.page-ssim", {
			passed: true,
			skipped: true,
			reason:
				options.skip === true
					? "COPILOT_BRO_UI_SMOKE_BENCHMARK_PAGE_SSIM=0"
					: "image-pipeline-suspended"
		});
		return { passed: true };
	}
	if (!captured) {
		logger?.info("host-ui-smoke.chat.benchmark.page-ssim", {
			passed: false,
			reason: "no-capture"
		});
		return { passed: false, failure: "no-capture" };
	}
	const { source, plan, width, height } = captured;
	try {
		const result = await runPageRestoreBenchmark({
			sourceImage: source,
			plan,
			imageWidth: width,
			imageHeight: height,
			budget: { minCompositeSimilarity: 0.99, maxVectorizePathCount: 8192 },
			playwrightResolveRoot: process.env.COPILOT_BRO_UI_SMOKE_REPO_ROOT?.trim() || process.cwd()
		});
		const passed = result.pageSimilarity.passed === true;
		logger?.info("host-ui-smoke.chat.benchmark.page-ssim", {
			passed,
			gate: "web-screenshot-vs-source",
			ssim: result.pageSimilarity.ssim,
			threshold: result.pageSimilarity.threshold,
			elementCount: result.elementResults.length,
			compositeSimilarity: result.pageSimilarity.compositeSimilarity
		});
		if (process.env.COPILOT_BRO_UI_SMOKE === "1") {
			const repoRoot = process.env.COPILOT_BRO_UI_SMOKE_REPO_ROOT?.trim() || process.cwd();
			try {
				const artifactDir = await writeChatScreenshotBenchmarkWebArtifacts(repoRoot, {
					source,
					width,
					height,
					result,
					gatePassed: passed,
					gateFailure: passed ? undefined : `page-ssim-below-99:${result.pageSimilarity.ssim}`
				});
				logger?.info("host-ui-smoke.chat.benchmark.web-restore-artifacts", {
					directory: artifactDir,
					gatePassed: passed
				});
			} catch (artifactError) {
				const message = artifactError instanceof Error ? artifactError.message : String(artifactError);
				logger?.warn("host-ui-smoke.chat.benchmark.web-restore-artifacts.failed", { message });
			}
		}
		return {
			passed,
			ssim: result.pageSimilarity.ssim,
			failure: passed ? undefined : `page-ssim-below-99:${result.pageSimilarity.ssim}`
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger?.info("host-ui-smoke.chat.benchmark.page-ssim", {
			passed: false,
			reason: "exception",
			message
		});
		return { passed: false, failure: message };
	}
}

/** Same folder name as historical smoke exports; under `artifacts/host-ui/` (uses `COPILOT_BRO_UI_SMOKE_REPO_ROOT` or cwd). */
const CHAT_SCREENSHOT_WEB_RESTORE_RELATIVE = path.join("artifacts", "host-ui", "chat-screenshot-web-restore");

async function writeChatScreenshotBenchmarkWebArtifacts(
	repoRoot: string,
	input: {
		readonly source: Buffer;
		readonly width: number;
		readonly height: number;
		readonly result: Awaited<ReturnType<typeof runPageRestoreBenchmark>>;
		readonly gatePassed: boolean;
		readonly gateFailure?: string;
	}
): Promise<string> {
	const outDir = path.join(repoRoot, CHAT_SCREENSHOT_WEB_RESTORE_RELATIVE);
	await mkdir(outDir, { recursive: true });
	await writeFile(path.join(outDir, "index.html"), input.result.pageHtml, "utf8");
	await writeFile(path.join(outDir, "web-screenshot.png"), input.result.pagePng);
	await writeFile(path.join(outDir, "page.png"), input.result.pagePng);
	await writeFile(path.join(outDir, "composite.png"), input.result.pagePng);
	await writeFile(path.join(outDir, "source.png"), Buffer.from(input.source));
	const acceptance: Record<string, unknown> = {
		schema: "host-ui-smoke.p7-chat-benchmark-web-restore",
		passed: input.gatePassed,
		ssim: input.result.pageSimilarity.ssim,
		threshold: input.result.pageSimilarity.threshold,
		compositeSimilarity: input.result.pageSimilarity.compositeSimilarity,
		elementCount: input.result.elementResults.length,
		gate: "web-screenshot-vs-source",
		generatedAt: new Date().toISOString(),
		directory: outDir
	};
	if (!input.gatePassed && input.gateFailure) {
		acceptance.failure = input.gateFailure;
	}
	await writeFile(path.join(outDir, "acceptance.json"), `${JSON.stringify(acceptance, null, 2)}\n`, "utf8");
	const readmeIntro = input.gatePassed
		? "Generated by Copilot Bro Host UI smoke: p7 page SSIM gate passed."
		: "Generated by Copilot Bro Host UI smoke: p7 page SSIM gate did not pass — files are still written for manual review.";
	await writeFile(
		path.join(outDir, "README.txt"),
		[
			readmeIntro,
			"SSIM compares the Chromium screenshot of index.html (web-screenshot.png) to source.png — no full source image is pasted as a canvas underlay.",
			"Background RGB of the HTML shell is sampled from source corners only (letterboxing), not the full bitmap.",
			"Open index.html in a browser to inspect layers. See acceptance.json for measured SSIM and gate outcome.",
			""
		].join("\n"),
		"utf8"
	);
	return outDir;
}
