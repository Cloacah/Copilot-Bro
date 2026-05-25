import type { Logger } from "../../logger";

let extensionSmokeLoggerRef: Logger | undefined;

export function bindExtensionSmokeLogger(logger: Logger | undefined): void {
	extensionSmokeLoggerRef = logger;
}

export function extensionSmokeLogger(): Logger | undefined {
	return extensionSmokeLoggerRef;
}
