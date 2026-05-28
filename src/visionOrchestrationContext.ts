import { AsyncLocalStorage } from "node:async_hooks";

interface VisionOrchestrationStore {
	suppressVisionOrchestration: boolean;
}

const visionOrchestrationStorage = new AsyncLocalStorage<VisionOrchestrationStore>();

/** Process-wide depth: VS Code LM callbacks may not inherit AsyncLocalStorage. */
let visionOrchestrationSuppressDepth = 0;

/** True while a nested vision-proxy or native structured pass is calling the provider. */
export function isVisionOrchestrationSuppressed(): boolean {
	return visionOrchestrationSuppressDepth > 0
		|| visionOrchestrationStorage.getStore()?.suppressVisionOrchestration === true;
}

export function runWithSuppressedVisionOrchestration<T>(fn: () => Promise<T>): Promise<T> {
	visionOrchestrationSuppressDepth += 1;
	return visionOrchestrationStorage
		.run({ suppressVisionOrchestration: true }, fn)
		.finally(() => {
			visionOrchestrationSuppressDepth -= 1;
		});
}
