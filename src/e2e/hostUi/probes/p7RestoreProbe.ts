import { readFile } from "node:fs/promises";

import { HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED } from "../../../config/highFidelityRestoreImagePipelineSuspended";
import { getImageAnalyzeAdapter } from "../../../toolCooperation/adapters/registry";
import { saveVisionArtifact } from "../../../toolCooperation/visionArtifactStore";
import { compareImageBuffers } from "../../../toolCooperation/imageSimilarity";
import {
	defaultRestoreBenchmarkSettings,
	isRestoreElementOutputAcceptable,
	produceRestoreElementOutputs
} from "../../../toolCooperation/visionRestoreElementOutput";
import type { ProxyVisualElement } from "../../../visionProxyStructuredPlan";
import {
	assertHostUiSmokeTestButtonExists,
	resolveHostUiSmokeRepoRoot
} from "../fixtures/vision";

export interface HostUiSmokeP7RestoreArtifactProbeResult {
	ok: boolean;
	assetPath: string;
	svgBytes: number;
	rejectedPlaceholder: boolean;
	artifactFilePath?: string;
	artifactSha256?: string;
	warningCount: number;
	usedPlaceholder: boolean;
	rasterEngine?: string;
	rasterPathCount?: number;
	fidelityPassed?: boolean;
	restoreSsim?: number;
	restoreSimilarityPassed?: boolean;
	/** When true, offline probe skipped raster/SVG restore (see `HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED`). */
	imagePipelineSuspended?: boolean;
}

export async function runHostUiSmokeP7RestoreArtifactProbe(
	logger: { info: (message: string, data?: unknown) => void; warn?: (message: string, data?: unknown) => void }
): Promise<HostUiSmokeP7RestoreArtifactProbeResult> {
	const assetPath = await assertHostUiSmokeTestButtonExists();
	if (HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED) {
		logger.info("host-ui-smoke.p7.restore-artifact.probe.end", {
			ok: true,
			skipped: true,
			skipReason: "image-pipeline-suspended",
			imagePipelineSuspended: true,
			assetPath,
			svgBytes: 0,
			rejectedPlaceholder: false,
			warningCount: 0,
			usedPlaceholder: false
		});
		return {
			ok: true,
			assetPath,
			svgBytes: 0,
			rejectedPlaceholder: false,
			warningCount: 0,
			usedPlaceholder: false,
			imagePipelineSuspended: true
		};
	}
	const bytes = await readFile(assetPath);
	const analyzer = getImageAnalyzeAdapter();
	const meta = await analyzer.getMetadata(Buffer.from(bytes));
	const crop = { x: 0, y: 0, w: Math.max(1, meta.width), h: Math.max(1, meta.height) };

	const element: ProxyVisualElement = {
		elementId: "host-ui-p7-restore-probe",
		label: "button",
		mode: "svg",
		confidence: 1,
		rationale: "Host UI P7 restore probe — dual raster+svg path",
		observations: [],
		recognizedText: [],
		layout: [],
		regions: [{ label: "button", bbox: crop, confidence: 1, priority: 1, rationale: "full asset" }],
		svgParams: { mode: "path-guided" }
	};

	const outputs = await produceRestoreElementOutputs({
		original: Buffer.from(bytes),
		element,
		imageWidth: meta.width,
		imageHeight: meta.height,
		settings: defaultRestoreBenchmarkSettings()
	});

	if (outputs.svgChain?.rasterVectorize) {
		logger.info("host-ui-smoke.p7.raster.vectorize", {
			engine: outputs.svgChain.rasterVectorize.engine,
			pathCount: outputs.svgChain.rasterVectorize.pathCount
		});
	}
	if (outputs.fidelityReport) {
		logger.info("host-ui-smoke.p7.restore.fidelity.report", outputs.fidelityReport);
	}

	const productionSvg = outputs.productionSvg ?? "";
	const rejectedPlaceholder = !productionSvg || outputs.usedPlaceholder;

	const sharp = (await import("sharp")).default;
	const referenceCrop = await sharp(Buffer.from(bytes))
		.extract({ left: 0, top: 0, width: crop.w, height: crop.h })
		.png()
		.toBuffer();
	const similarity = await compareImageBuffers(referenceCrop, outputs.productionPng, {
		threshold: 0.99,
		gate: "ssim"
	});
	const restoreSsim = similarity.ssim;
	const restoreSimilarityPassed = similarity.passed;
	logger.info("host-ui-smoke.p7.restore.similarity", {
		ssim: similarity.ssim,
		compositeSimilarity: similarity.compositeSimilarity,
		passed: similarity.passed,
		threshold: similarity.threshold,
		mode: "raster-layer"
	});

	const ok =
		isRestoreElementOutputAcceptable(outputs, { requireSvgStructural: false })
		&& restoreSimilarityPassed
		&& Boolean(productionSvg)
		&& !rejectedPlaceholder;

	let artifactFilePath: string | undefined;
	let artifactSha256: string | undefined;

	if (ok && productionSvg) {
		const rootDir = resolveHostUiSmokeRepoRoot();
		const artifact = await saveVisionArtifact({
			rootDir,
			evidenceId: "host-ui-smoke-p7-restore",
			taskId: "restore-svg-probe",
			kind: "svg",
			bytes: productionSvg
		});
		artifactFilePath = artifact.filePath;
		artifactSha256 = artifact.sha256;
	}

	logger.info("host-ui-smoke.p7.restore-artifact.probe.end", {
		ok,
		assetPath,
		svgBytes: productionSvg.length,
		rejectedPlaceholder,
		artifactFilePath,
		artifactSha256,
		warningCount: outputs.warnings.length,
		usedPlaceholder: outputs.usedPlaceholder,
		rasterEngine: outputs.svgChain?.rasterVectorize?.engine,
		rasterPathCount: outputs.svgChain?.rasterVectorize?.pathCount,
		fidelityPassed: outputs.fidelityReport?.passed,
		restoreSsim,
		restoreSimilarityPassed,
		svgStructuralPassed: outputs.svgStructuralPassed
	});

	if (!ok) {
		logger.warn?.("host-ui-smoke.p7.restore-artifact.probe.weak", {
			rejectedPlaceholder,
			usedPlaceholder: outputs.usedPlaceholder,
			fidelityFailureReasons: outputs.fidelityReport?.failureReasons,
			warnings: outputs.warnings.slice(0, 8)
		});
	}

	return {
		ok,
		assetPath,
		svgBytes: productionSvg.length,
		rejectedPlaceholder,
		artifactFilePath,
		artifactSha256,
		warningCount: outputs.warnings.length,
		usedPlaceholder: outputs.usedPlaceholder,
		rasterEngine: outputs.svgChain?.rasterVectorize?.engine,
		rasterPathCount: outputs.svgChain?.rasterVectorize?.pathCount,
		fidelityPassed: outputs.fidelityReport?.passed,
		restoreSsim,
		restoreSimilarityPassed
	};
}
