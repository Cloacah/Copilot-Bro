import { AsyncLocalStorage } from "node:async_hooks";

interface VisionOrchestrationStore {
	suppressVisionOrchestration: boolean;
}

const visionOrchestrationStorage = new AsyncLocalStorage<VisionOrchestrationStore>();

/** True while a nested vision-proxy or native structured pass is calling the provider. */
export function isVisionOrchestrationSuppressed(): boolean {
	return visionOrchestrationStorage.getStore()?.suppressVisionOrchestration === true;
}

export function runWithSuppressedVisionOrchestration<T>(fn: () => Promise<T>): Promise<T> {
	return visionOrchestrationStorage.run({ suppressVisionOrchestration: true }, fn);
}
