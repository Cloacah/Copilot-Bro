import type { ModelConfig } from "./types";

export function getDeclaredImageInputCapability(
	model: Pick<ModelConfig, "vision">,
	options: { proxyAvailable?: boolean } = {}
): boolean {
	return model.vision || Boolean(options.proxyAvailable);
}
