export type VisionTaskKind = "describe" | "extract-image" | "restore-svg" | "verify-artifact" | "complete";
export type VisionTaskStatus = "pending" | "running" | "completed" | "failed";

export interface VisionTask {
	id: string;
	evidenceId: string;
	kind: VisionTaskKind;
	status: VisionTaskStatus;
	dependsOn?: string;
	artifactId?: string;
	error?: string;
	createdAt: string;
	updatedAt: string;
}

export interface VisionTaskStack {
	id: string;
	evidenceId: string;
	tasks: VisionTask[];
	createdAt: string;
	updatedAt: string;
}

const taskStacks = new Map<string, VisionTaskStack>();

export function createVisionTaskStack(
	evidenceId: string,
	kinds: readonly VisionTaskKind[],
	now = new Date()
): VisionTaskStack {
	const normalizedEvidenceId = normalizeId(evidenceId);
	const timestamp = now.toISOString();
	const tasks = kinds.map((kind, index): VisionTask => {
		const previous = index > 0 ? `${normalizedEvidenceId}:task:${index - 1}:${kinds[index - 1]}` : undefined;
		return {
			id: `${normalizedEvidenceId}:task:${index}:${kind}`,
			evidenceId: normalizedEvidenceId,
			kind,
			status: index === 0 ? "pending" : "pending",
			dependsOn: previous,
			createdAt: timestamp,
			updatedAt: timestamp
		};
	});
	const stack: VisionTaskStack = {
		id: `${normalizedEvidenceId}:stack`,
		evidenceId: normalizedEvidenceId,
		tasks,
		createdAt: timestamp,
		updatedAt: timestamp
	};
	taskStacks.set(stack.id, stack);
	return cloneStack(stack);
}

export function getVisionTaskStack(stackId: string): VisionTaskStack | undefined {
	const stack = taskStacks.get(stackId.trim());
	return stack ? cloneStack(stack) : undefined;
}

export function getNextRunnableVisionTask(stackId: string): VisionTask | undefined {
	const stack = taskStacks.get(stackId.trim());
	if (!stack) {
		return undefined;
	}
	const task = stack.tasks.find((candidate) => isRunnableTask(candidate, stack));
	return task ? cloneTask(task) : undefined;
}

function isRunnableTask(task: VisionTask, stack: VisionTaskStack): boolean {
	if (task.status !== "pending") {
		return false;
	}
	if (!task.dependsOn) {
		return true;
	}
	return stack.tasks.some((dependency) => dependency.id === task.dependsOn && dependency.status === "completed");
}

export function updateVisionTaskStatus(
	stackId: string,
	taskId: string,
	status: VisionTaskStatus,
	options: { artifactId?: string; error?: string } = {},
	now = new Date()
): VisionTask {
	const stack = taskStacks.get(stackId.trim());
	if (!stack) {
		throw new Error(`Unknown vision task stack: ${stackId}`);
	}
	const task = stack.tasks.find((candidate) => candidate.id === taskId.trim());
	if (!task) {
		throw new Error(`Unknown vision task: ${taskId}`);
	}
	if (status === "running" && task.dependsOn) {
		const dependency = stack.tasks.find((candidate) => candidate.id === task.dependsOn);
		if (dependency?.status !== "completed") {
			throw new Error(`Vision task dependency is not completed: ${task.dependsOn}`);
		}
	}
	const timestamp = now.toISOString();
	task.status = status;
	task.artifactId = options.artifactId ?? task.artifactId;
	task.error = options.error;
	task.updatedAt = timestamp;
	stack.updatedAt = timestamp;
	return cloneTask(task);
}

export function isVisionTaskStackComplete(stackId: string): boolean {
	const stack = taskStacks.get(stackId.trim());
	return Boolean(stack && stack.tasks.length > 0 && stack.tasks.every((task) => task.status === "completed"));
}

export function clearVisionTaskStacksForTests(): void {
	taskStacks.clear();
}

function normalizeId(value: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new Error("Vision task stack requires a non-empty evidence id.");
	}
	return normalized;
}

function cloneStack(stack: VisionTaskStack): VisionTaskStack {
	return {
		...stack,
		tasks: stack.tasks.map(cloneTask)
	};
}

function cloneTask(task: VisionTask): VisionTask {
	return { ...task };
}
