#!/usr/bin/env node
import { rmSync } from "node:fs";
import path from "node:path";

const outDir = path.join(process.cwd(), "out");
rmSync(outDir, { recursive: true, force: true });
