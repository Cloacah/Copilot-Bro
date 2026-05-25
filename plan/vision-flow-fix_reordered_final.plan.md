---
name: vision-flow-fix-reordered
overview: 以“先修阻塞 bug 与测试能力，再修路由/视觉/模型/记忆/文档/打包”的依赖顺序，完整修复 Copilot Bro 识图代理、高保真视觉、模型请求、Qwen 版本、长期记忆、token 节省、真实测试、README 生成与打包策略。
todos:
  - id: p0-scope-and-evidence
    content: 建立需求覆盖表、日志证据边界和任务树，先锁定不可误解的验收基线。
    status: completed
  - id: p1-fast-bugfix-and-test-gates
    content: 快速修复设置面板崩溃、测试游离断言、wrapped 模型缓存超时降级，并建立基础测试门禁。
    status: completed
  - id: p2-real-e2e-harness
    content: 建立唯一真实 VS Code 自动化测试入口，支持环境变量 API key、日志采集、失败收尾和只关闭测试 VS Code。
    status: completed
  - id: p3-vision-logging-cache
    content: 修复截图/工具图像日志绑定、proxy.cache.hit 去重语义、代理过程展示和 token 精简日志。
    status: completed
  - id: p4-route-contract
    content: 加固代理/native 路由契约、自指代理、raw image guard、模型切换和 wrapped 交接。
    status: completed
  - id: p5-model-profiles-qwen-ui
    content: 审计供应商请求格式，补全 Qwen 模型，增加通用模型版本选择器。
    status: completed
  - id: p6-evidence-task-handoff
    content: 统一代理和 native 的视觉证据、任务栈、两条交接路径和多轮一致性校验。
    status: completed
  - id: p7-artifacts-fidelity
    content: 实现真实 PNG/SVG 产物、图片转 SVG、抠图/mask/羽化/降噪/形变和保真验证。
    status: completed
  - id: p8-memory-token
    content: 参考 claude-mem 与 rtk，用 TypeScript 实现长期记忆和 token budgeter。
    status: pending
  - id: p9-readme-docs
    content: 建立 README 多语言 JSON 生成脚本，保证文档与代码/测试一致。
    status: completed
  - id: p10-packaging
    content: 优化 release/test VSIX 打包策略和包体内容检查。
    status: completed
  - id: p11-final-audit
    content: 逐条覆盖全部旧计划和本聊天新需求，确认无遗漏、无伪功能、无过时入口。
    status: pending
isProject: false
---

> **执行与状态以 [`VISION_FLOW_MASTER.plan.md`](VISION_FLOW_MASTER.plan.md) 为准。** 本文件为完整历史正文（不删内容），YAML 中 p8/p11 等待办以 MASTER 为准（均已 ✅）。

# Copilot Bro 识图与模型体系修复计划

## 执行原则

- 所有需求均为必须项：不得删减、弱化、误解或用“仅测试可达”的假功能替代运行时功能。
- 优先级：先修会阻断使用的 bug 和测试能力，再修视觉路由和日志，再修模型请求/Qwen/UI，再修视觉产物质量，再做记忆/token、README、打包和最终验收。
- 所有阶段都必须有：实施步骤、自动化测试、真实/交叉验证、多轮一致性校验。
- 任务树执行：`root -> bug/test gates -> logs/cache -> route -> models/ui -> vision evidence -> artifacts/fidelity -> memory/token -> docs -> packaging -> final audit`。
- 真实 API 测试环境变量固定为：`DEEPSEEK_API_KEY`、`ZHIPU_API_KEY`、`DASHSCOPE_API_KEY`、`MINIMAX_API_KEY`、`KIMI_API_KEY`。缺失时场景必须标记 skip，不能误报通过。

## 当前执行记录

- 已完成：Host UI smoke 的 Chat UI 路径改为真实 VS Code Chat/participant/provider 三段链路，并新增运行时强制证据校验；缺少 UI 提交、participant request/end、provider request.start/end、截图任一证据都会失败，禁止假通过。
- 已完成：视觉代理结构化结果接入 evidence store、task stack 和 artifact store；代理执行产生 SVG/处理后图片时会创建任务栈并落盘校验产物 hash。
- 已推进：native 视觉路径也写入同类 `vision.input.bound`、evidence record 和基础 task stack；后续还需继续把 native 模型输出解析为同等结构化产物。
- 已推进：release/test VSIX 包体规则收紧，release 排除测试与 automation，test 保留编译后的 `out/automation` 测试入口但排除源码、docs、scripts、分析文档和历史 VSIX。
- 已验证：`npm test`、`npm run readme:check`、`npm run package:test`、`npm run package:release`、mock provider 的真实 `npm run test:host-ui` 均通过；当前仍需继续推进 native 输出结构化产物接入、长期记忆/token budgeter 和最终逐项审计。
- 已记录：Qwen 目录与 Host UI / preset-catalog / config-panel 证据的期望值统一由 `src/config/qwenCatalogContract.ts`（`QWEN_HOST_UI_CONTRACT` + `validateQwenCatalogDataIntegrity`）推导，避免多处魔法数字漂移；相关单测已补强。
- 已验收：`npm run package:test` 生成 test VSIX 后 `npm run package:check` 通过；`src/test/vsixPackagePolicy.test.ts` 与 `scripts/check-vsix-contents.mjs` 的 deny 规则对齐。
- Host UI：`COPILOT_BRO_UI_SMOKE_E2E=all` 仅展开核心 7 套件；`vision-probe`、`phase1-settings-exhaustive`、`agent-smoke-budgeted` 为显式 opt-in，对应扩展命令与 `hostUiSmokeAssertions` 日志契约单测。
- **识图后处理暂停、结构化保留（2026-05-21）**：`HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED=true` 时仅关闭 raster/SVG/matting/vectorize **后处理执行**；**不**关闭 `vision-proxy-contract-v3` 结构化输出（`elements[]`、`bbox`、`imageParams`、`svgParams` 含 `fillColor`/`strokeWidth`）、`vision.proxy.structured`、`normalizedProxySnapshot` 与 evidence 落盘。缓存命中路径通过 `buildStructuredProxyProgressFromDescription` 恢复 `elementCount`，避免 Chat/智能体看到 `elementCount:0`。Host UI consistency 增加多轮与 `structured-params:*` 校验。
- 已调整：Host UI smoke 的 GitHub/Copilot 登录预检改为纯图像点击流；移除调色板「Trigger Chat Sign In」命令与扩展内自动 `triggerSetupForceSignIn`；.harness 在 `host-ui-smoke.log` 追加 `host-ui-smoke.github-auth.preflight.end` 作为可审计证据（含 `already-signed-in` / `image-flow-completed`）。

### 阶段 7 收尾（2026-05-19）— 三项缺口已闭合


| 计划缺口（此前「部分完成」）     | 实现                                                                                                                                                          | 测试 / 证据                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 真实栅格→矢量（Potrace 类） | `imagetracerjs`（Unlicense）经 `src/toolCooperation/rasterVectorizer.ts` 接入 `runProcessingChain`；配置 `extendedModels.visionProcessing.rasterVectorize`（默认 true） | `rasterVectorizer.test.ts`、`runProcessingChainRasterVectorize.test.ts`；日志 `vision.raster.vectorize`                             |
| 删除 bbox 占位 seed    | 移除 `visionProxy.ts` 内 `buildSvgFromRegion`；`visionRestoreSeed.ts` 仅保留 LLM `pathHint`；生产 SVG 来自矢量化链                                                          | `visionProxyRestoreSeed.test.ts`（无 hint 时 undefined）                                                                            |
| 结构化保真验收报告          | `src/toolCooperation/visionRestoreFidelityReport.ts`（contract `vision-restore-fidelity-v1`）                                                                 | `visionRestoreFidelityReport.test.ts`；日志 `vision.restore.fidelity.report`；Host UI `p7-restore-artifact-chat` 要求 `"passed":true` |


**说明**：`node-potrace` 仍在 `BLOCKED_ADAPTER_DEPENDENCIES`（许可证/原生风险）；生产路径使用 **imagetracerjs**（与 ImageTracer/Potrace 同类位图追踪思路）。抠图/形变/羽化等仍由 `restorationPipeline.ts` 在 `mlSegment: true` 时执行（默认 false，还原路径以矢量化为主）。

### 阶段 7.1 成功率提升与重复请求治理（2026-05-20）

#### 手工还原失败日志结论（`TestExtendedCopilot/20260520-0943/Copilot Bro.log`）


| 现象                                                        | 根因                                                                                      | 用户可见结果                                                                       |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 同一 `imageHash` 连续 3 次 `request.start`（Qwen native，~70s/次） | 代理执行失败（`svg-fidelity:svg-geometry-outside-viewbox`）后 **整轮重调视觉模型**，未复用已解析的 JSON plan     | 耗时 ~4min，仍失败                                                                 |
| `imagePreprocess:[sharp] crop failed: extract_area`       | LLM 返回 bbox（如 1920×45）**超出真实图像像素**（如 1229×768），裁剪失败后对 **整图** 做 imagetracer（10978 paths） | 保真校验失败 → 触发重试                                                                |
| `vision.proxy.format.invalid` 第 3 次                       | 视觉模型返回 **非 JSON**（长截图多元素时常见）                                                            | `vision.proxy.failed` → 主模型无有效证据；Chat 易显示 “Sorry, no response was returned.” |
| `vision.handoff.resolved: restore-artifact`               | 用户高保真还原意图 + `highFidelityPrompt` 含 restoration 关键词                                      | 正确；失败在 **后处理** 而非 handoff 误判                                                 |


**重复请求判定**：属 **同一 turn 内可避免的重复**（retry 不应再次 `request.start` 视觉模型）；`vision.proxy.cache.miss` 仅 1 次，说明不是 cache 问题，是 **plan 执行失败 → 重请求**。

#### 已落地修复（本仓库）

1. `**clampProxyBBoxToImage`**（`src/visionProxyBBox.ts`）：裁剪前将 bbox 钳制到真实宽高，避免 sharp extract 失败与整图矢量化。
2. `**vision.proxy.plan.replay**`：格式合法且已解析的 structured plan 在 **执行/保真失败重试时复用**，不再重复调用 Qwen（识图次数从 3 降为 1）。
3. **SVG 管线顺序**：矢量化后 **先 `ensureSvgViewBox` 再 `fitSvgPathsInSvg`/几何校验**，降低 `svg-geometry-outside-viewbox` 误杀。
4. `**npm run test:host-ui:full`** 已并入 `screenshot-page-vision-route` 套件。

#### 推荐方案对比（讨论用，按优先级）


| 方案                                     | 做法                                                        | 优点                        | 缺点                   | 落地性                                      |
| -------------------------------------- | --------------------------------------------------------- | ------------------------- | -------------------- | ---------------------------------------- |
| **A. 单次视觉 + 本地重试（已做）**                 | 缓存 structured JSON；仅重跑矢量化/裁剪/保真                           | 识图次数最少；延迟大幅下降             | JSON 本身错误时仍需重调视觉     | ✅ 已实现                                    |
| **B. ROI 先裁剪再矢量化**                     | bbox clamp + 可选缩放到 max 512px 再 imagetracer                | 路径数从 1e4 降到可控；保真更稳        | 极小 ROI 可能丢细节         | ✅ clamp 已实现；**待做**：`maxVectorizeEdge` 配置 |
| **C. 分级 handoff（describe vs restore）** | 用户句优先于 global prompt（`resolveVisionHandoffIntentForTurn`） | 避免 describe 误走 restore 管线 | 需 Host UI 覆盖两条路径     | ✅ 已实现                                    |
| **D. 软降级而非硬失败**                        | 保真失败时输出 **带警告的 SVG + 文本证据**，主模型继续                         | 极少出现 “无响应”；用户可迭代          | 严格“100% 矢量合格”场景需人工复核 | 🔜 建议：仅 `restore-artifact` 且三次本地重试仍失败时启用 |
| **E. JSON 修复层**                        | `jsonrepair` / 提取首个 `{...}` / 降 `max_elements` prompt     | 降低 format.invalid         | 仍消耗 1 次视觉            | 🔜 下一迭代                                  |
| **F. 专用 UI 截图模型**                      | 大 UI 走 `qwen-vl` 一次；小图标才 svg 模式                           | 结构化更稳                     | 多一套路由                | 已有 p5/p7 Host UI，可扩展 screenshot-page     |


**不建议**：每次保真失败都再调视觉（当前手工日志的失败模式）；**不建议**未 clamp 就对全图 imagetracer。

#### 自动化测试门禁（禁止再靠手工截图返工）


| 路径                           | 单测                                                                                                   | Host UI                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 高保真 **仅识图**（describe-only）   | `visionHandoffIntent.test.ts`、`nativeVisionStructuredHandoff`                                        | `p7-describe-only-evidence`、`p3-global-qwen-proxy-chat`                                                   |
| 高保真 **还原**（restore-artifact） | `visionRestoreFidelityReport`、`rasterVectorizer`、`runProcessingChainRasterVectorize`                 | `p7-restore-artifact-chat`、`p6-p7-real-assets`、`**screenshot-page-vision-route`**（并入 `test:host-ui:full`） |
| 重复识图回归                       | 新增 `visionProxyBBox.test.ts`；日志契约 `vision.proxy.plan.replay`（执行失败重试时必须有、且无额外 `request.start` 同 hash） | 全量 `npm run test:host-ui:full`                                                                            |


#### 待办（任务树下一层）

- `visionProcessing.maxVectorizeEdgePx`（默认 512）+ 单测
- 保真软降级模式（`restoreDegradeOnFidelityFail`）+ Host UI 断言仍有 `request.end` 与非空 assistant
- JSON 提取/修复中间层 + `vision.proxy.format.repaired` 日志
- 日志回放测试：`20260520-0943` fixture 断言重试不产生第 2 次同 hash `request.start`

### 阶段 7.2 精确还原基准（2026-05-20）— 可点击 Web 页 + 99% SSIM

#### 基准图与尺寸

- **来源**：`%APPDATA%/Code/User/workspaceStorage/vscode-chat-images/` 最新 PNG（当前基准：`image-1779241034630.png`，原图 1280×800）。
- **落盘**：`src/test/fixtures/chat-screenshot-benchmark.png`（**1024×640**，文字仍可识别，体积较原图略减）。
- **刷新命令**：`npm run prepare:benchmark-screenshot`（`scripts/prepare-benchmark-screenshot.mjs`）。

#### Canonical 还原验收用例（必须先写测试再实现）

**目标**：将 `src/test/fixtures/chat-screenshot-benchmark.png` **精确还原到一个 Web 页面**中；页面上 **每个 UI 元素可点击**（`<button data-element-id>` + click 标记 `data-clicked`）；**不要求**还原真实业务功能。

**禁止**：把整个屏幕作为 **单个** `mode=image` 全视口元素还原（`plan.v1` 仅作反模式回归；`isAntiPatternFullViewportPlan` 必须为 true）。

**门禁（传统 CV，不用 LLM 验图）**：


| 断言                                  | 门槛                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| 每元素 ROI：`productionPng` vs 原图同 bbox | SSIM **≥ 0.99**                                                                        |
| 整页合成 PNG vs 原图                      | SSIM **≥ 0.99**                                                                        |
| 导出 Web 页 PNG vs 原图                  | SSIM **≥ 0.99**                                                                        |
| 可点击层数量                              | = `elements.length`（active）                                                            |
| 高保真管线覆盖                             | 每元素：`rasterPreprocess` + `integrity`；`mode=svg` 另需 `rasterVectorize` + `productionSvg` |


**实现入口**：`runChatScreenshotWebRestoreAcceptance()`（`visionRestoreWebBenchmarkContract.ts`）。

**自动化（测试先行）**：


| 层级           | 文件 / 命令                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| 单测（验收）       | `src/test/visionRestoreWebBenchmark.test.ts` — `ACCEPTANCE: chat-screenshot-benchmark.png → clickable web page ≥99%` |
| 单测（HTML）     | `src/test/visionRestorePageComposer.test.ts`                                                                         |
| 单测（反模式）      | v1 全视口 plan 必须被 `isAntiPatternFullViewportPlan` 拒绝                                                                   |
| 跑批           | `npm run test:benchmark-restore`                                                                                     |
| Host UI 离线探针 | `runHostUiSmokeP7ChatScreenshotPartitionProbe` → 日志 `host-ui-smoke.p7.chat-screenshot.web-restore.end`               |
| Host UI 在线   | `p7-restore-artifact-chat` + `screenshot-page-vision-route`（`test:host-ui:full`）                                     |


#### 验收哲学（不用 LLM 看最终图）


| 指标             | 技术                              | 门槛                                             |
| -------------- | ------------------------------- | ---------------------------------------------- |
| **SSIM**       | Wang SSIM（`imageSimilarity.ts`） | **≥ 0.99**（元素 ROI + 整页 + Web 导出 PNG）           |
| **双路径**        | `produceRestoreElementOutputs`  | `image` 仅抠图；`svg` 先抠图再矢量化；合成/Web **一律用 PNG 层** |
| **pathCount**  | imagetracerjs                   | ≤ 4096/元素（预算）                                  |
| **vision API** | 日志                              | ≤ 1 / turn（在线路径；离线基准 0）                        |


#### 方案矩阵（可行性）


| 方案                      | 描述                                                | 状态                                |
| ----------------------- | ------------------------------------------------- | --------------------------------- |
| **R1 多元素 SSIM**         | 分区 ROI，禁止全屏单元素                                    | ✅                                 |
| **R2 可点击 Web**          | `<button.restore-layer data-element-id>` + 合成 PNG | ✅ `visionRestoreWebPageHtml.ts`   |
| **R3 双路径 svg**          | 像素层 99% + SVG 结构产物                                | ✅ `visionRestoreElementOutput.ts` |
| **R4 maxVectorizeEdge** | 512px 再追踪                                         | ✅                                 |
| **R5 plan.replay**      | 失败不重复识图                                           | ✅                                 |
| **R6 软降级**              | 结构失败仍输出 PNG+警告                                    | ✅ restore 管线                      |
| **R7 在线 VL**            | proxy 产出 plan.json                                | Host UI                           |


#### 实现与测试


| 模块             | 路径                                                                |
| -------------- | ----------------------------------------------------------------- |
| 验收契约           | `src/toolCooperation/visionRestoreWebBenchmarkContract.ts`        |
| 可点击 HTML       | `src/toolCooperation/visionRestoreWebPageHtml.ts`                 |
| 相似度            | `src/toolCooperation/imageSimilarity.ts`                          |
| 网页合成           | `src/toolCooperation/visionRestorePageComposer.ts`                |
| 元素跑批           | `src/toolCooperation/visionRestoreBenchmarkRunner.ts`             |
| canonical plan | `src/test/fixtures/chat-screenshot-benchmark.plan.json`           |
| 反模式 plan       | `src/test/fixtures/chat-screenshot-benchmark.plan.v1.json`（禁止作验收） |


#### 消耗指标目标


| 指标                    | 目标                  |
| --------------------- | ------------------- |
| 视觉 API / 离线基准图        | 0（基准）；在线 ≤ 1        |
| 单元素 pathCount         | ≤ 4096              |
| 元素 + 页 + Web PNG SSIM | ≥ **0.99**          |
| 可点击元素数                | = plan 中 active 元素数 |


## 阶段 0：需求覆盖与日志证据基线

目标：先锁定“不误解需求”的验收基线，避免后续实现方向漂移。

实施：

- 建立需求覆盖表，逐条映射旧计划全部内容、本聊天新增要求、README/CHANGELOG/测试/代码改动位置。
- 用 `Copilot Bro.log`、`copilot_all_prompts`、Copilot Chat debug log `main.jsonl/models.json/tools_0.json` 建立证据边界：哪些日志能证明代理识图，哪些只能证明最终主模型请求无 raw image。
- 记录现有关键事实：`proxy.cache.hit` 表示同一 image bytes + final prompt + proxy model id 的缓存命中，避免再次请求代理；问题是外层视觉检测、路由和证据注入仍可能每轮重复。
- 明确截图链路：Copilot Chat debug log 只记录 `screenshot_page` 为 `[image/jpeg: ... bytes]`，Bro 当前缺少 `imageHash/evidenceId` 绑定日志。

测试：

- 新增日志回放测试 fixture，验证 `screenshot_page`、`vision.route.selected`、`vision.proxy.cache.hit/miss`、`request.messages.summary.hasImageParts=false` 的可证明关系。
- 测试 cache hit 只复用证据，不重复发送完整视觉描述。

交叉验证：

- 用 Bro 日志、Copilot debug log、导出的 prompts 三方校验同一 turn。
- 如果日志缺失，结论必须标记为“不可证明”，不能写成已完成。

## 阶段 1：快修阻塞 bug 与基础测试门禁

目标：先让设置和测试系统可靠运行，避免后续测试无效。

实施：

- 修复设置面板崩溃：`Cannot read properties of undefined (reading 'replace')`。优先修 [src/ui/configPanelShared.ts](src/ui/configPanelShared.ts) 的 `escapeHtml`、本地化字段、provider/model option 渲染，所有 UI 文本先 `String(value ?? "")` 归一化。
- 修复 `wrapper.models.cache.refresh.timeout` 降级：内置模型列表刷新超时只能显示“暂不可用/使用缓存”，不能导致设置面板失败。
- 修复 [src/test/outputSemantics.test.ts](src/test/outputSemantics.test.ts) 游离断言，确保测试套件实际执行。
- 建立基础门禁：`npm test` 必须稳定；新增 focused test 脚本只作为开发便利，不新增过时正式入口。

测试：

- 设置面板渲染单测：空字段、undefined label/tip/provider、wrapped 缓存超时、Qwen 大量模型选项。
- UI persistence 测试：保存模型、代理、版本 id、wrapped model 不破坏配置。
- 输出语义测试：Vision Evidence details 断言必须在 test block 内执行。

交叉验证：

- 打开设置页不报错，日志有降级 warning 但 UI 可用。
- README/配置 schema/UI 默认值一致。

## 阶段 2：真实 VS Code 自动化测试能力

目标：尽早建立可执行、真实、可靠的 e2e，后续所有功能都必须被实际验证。

实施：

- 基于 [src/automation/hostUiSmoke.ts](src/automation/hostUiSmoke.ts) 建立唯一正式 e2e 入口，避免多余和过时测试入口。
- 使用独立 user-data-dir、extensions-dir、临时 workspace、测试进程标记和 `finally` 清理，保证只关闭测试 VS Code。
- 自动像人类聊天：打开 Chat、选模型、输入 prompt、附图/截图、切换模型、打开设置、保存 Qwen 版本 id、触发 wrapped、触发 vision proxy/native、检查产物。
- 从环境变量读取 `DEEPSEEK_API_KEY`、`ZHIPU_API_KEY`、`DASHSCOPE_API_KEY`、`MINIMAX_API_KEY`、`KIMI_API_KEY`；缺失则 skip 对应 provider，不能伪造成功。

测试：

- e2e smoke：设置页可打开、模型可保存、Chat 可发送、日志可采集、测试 VS Code 可关闭。
- provider e2e：每个有 API key 的供应商至少一条文本请求；视觉能力另按阶段 3/4/6/7 增量加入。

交叉验证：

- 每个场景保存 summary JSON、截图、Bro log、Copilot debug log 摘要、退出码。
- 失败报告必须定位阶段、模型、requestId、产物路径或缺失环境变量。

## 阶段 3：截图、cache hit、代理过程展示与精简日志

目标：准确回答“截图到底由谁识图”，并让代理识图过程像子任务一样可见但不浪费 token。

实施：

- 新增 `vision.input.bound`、`vision.evidence.saved`、`vision.evidence.reused`、`vision.proxy.cache.hit/miss` 精简字段：`sourceKind`、`toolName`、`imageHashPrefix`、`evidenceId`、`route`、`proxyModelId`、`reused`、`rawImageForwarded`。
- 对 `screenshot_page`、工具生成图片、用户附图、本地路径图片统一绑定 `imageHash/evidenceId`。
- cache miss 时展示代理开始/结束、代理模型、图片数量、证据 id；cache hit 时只展示“复用证据”，不重复输出完整结构化视觉描述。
- 研究 VS Code `LanguageModelChatProvider` 和 Copilot Chat 源码能力：Chat Participant 有 `stream.progress`，当前 provider 用 `progress.report(LanguageModelTextPart)`、可折叠 markdown、状态栏和 Agent Debug Log 事件实现“代理子任务视图”，不伪装成宿主原生子智能体。

测试：

- 日志回放：截图结果必须绑定到 evidence id；主模型请求必须显示 `rawImageForwarded=false`。
- cache 测试：同图同 prompt 命中 cache，只复用 compact evidence reference；不同图、不同 prompt、不同代理模型必须 miss。

交叉验证：

- Bro output、Copilot debug log、主模型 request summary 三方一致。
- token 对比：cache hit 后不重复插入完整视觉证据。

## 阶段 4：视觉路由契约与模型切换安全

目标：保证配置要求代理时必须代理，不允许 raw image 绕回主模型。

实施：

- 对齐 [src/providerOrchestration.ts](src/providerOrchestration.ts) 与 [src/visionProxy.ts](src/visionProxy.ts) 的代理启用语义。
- 规则：模型 `vision=false` 时即使底层 API 支持视觉，也禁止接收 raw image；显式代理必须走代理；自指代理等价无代理但仍走统一高保真前后处理；`null`、`"null"`、`__vision_proxy_disabled__` 为显式禁用。
- 调整 [src/toolCooperation/compatibilityMatrix.ts](src/toolCooperation/compatibilityMatrix.ts)：用户明确代理路径不可用时，不静默 fallback native，必须可观测 fallback/错误。
- 在 [src/provider.ts](src/provider.ts) 增加最终 raw-image guard；切换 remote、wrapped、native vision、proxy 模型时历史消息和工具结果必须修复为目标模型可接受格式。

测试：

- Bro 非视觉、Bro 真实支持视觉但 `vision=false`、Bro vision+显式代理、显式禁用、自指代理、代理不可用、wrapped 内置模型切换。
- `messages.test` 验证不该带图时 OpenAI body 没有 `image_url`，该 native 时格式正确。

交叉验证：

- `strategy/proxyModelId/imagePartCount/rawImageForwarded/residualImagePartCount` 日志一致。
- 中途切换模型不报 orphan tool、reasoning replay 或 image part 格式错误。

## 阶段 5：供应商请求格式、Qwen 模型和模型版本选择器

目标：保证所有预设、自定义和 wrapped 模型请求格式正确，Qwen 模型全面且可维护。

实施：

- 建立 provider request profile：DeepSeek、Zhipu/GLM、MiniMax、Kimi、Qwen/DashScope、OpenAI-compatible 自定义、wrapped Copilot 内置模型分别定义 endpoint、headers、stream、usage、tools、tool result、reasoning/thinking、vision content、extraBody 规则。
- 明确 Chat Completions 与 Responses 差异：当前主路径仍是 `/chat/completions`；Responses API 的 `input/instructions/input_image/previous_response_id/prompt_cache_key` 作为 provider profile 后续可选，不混用 body。
- Qwen：基于官方 Chat、Responses、DashScope OpenAI compatibility、Qwen-VL 文档和上传资料更新商业版、开源版、VL/QVQ/Omni/Coder/Math/Long、地区和快照模型；核对 `qwen3.5-120b-a10b` 与文档 `122b` 差异。
- 通用模型版本选择器：模型 picker 只暴露稳定名称，设置页在同一模型配置内提供 model id combobox；内置候选可选，用户可新增、修改、删除自定义 id；保存仍只改 `ModelConfig.id`，不破坏 displayName/category/provider/runtimeId。

测试：

- provider profile 单测：请求 body、headers、stream parser、usage、tools、vision、reasoning 字段。
- Qwen catalog 测试：模型 id、版本候选、vision 标记、Chat/Responses 支持差异。
- UI combobox/persistence 测试：新增/改删自定义版本 id 后仍属同一模型配置。

交叉验证：

- 用官方文档、上传资料、代码预设、README 生成数据四方对齐。
- 真实 API smoke 使用对应环境变量验证可调用。

## 阶段 6：统一视觉证据、任务栈和交接路径

目标：无论代理还是 native，都执行完全一致的高保真视觉前后流程。

实施：

- 新增 [src/visionProtocol/visionEvidenceStore.ts](src/visionProtocol/visionEvidenceStore.ts)：统一保存 `evidenceId/imageHash/sourceKind/sourceRef/route/mode/regions/imageParams/svgParams/sceneSummary/recognizedText/styleFacts`。
- 新增 [src/visionProtocol/visionTaskStack.ts](src/visionProtocol/visionTaskStack.ts)：生成 `describe/extract-image/restore-svg/verify-artifact/complete` 任务，一个视觉任务未完成前不开始下一个还原任务。
- 代理和 native 都必须产出同形结构化对象；只有“识别动作由谁执行”不同。
- 主模型只有两条交接路径：`describe-only` 只读结构化证据；`restore-artifact` 必须等产物完成并验证通过后再继续。

测试：

- 用户附图、工具截图/生图、本地路径三类输入。
- 代理/native 同图结构一致性；描述请求不生成无意义产物；还原请求必须等待 artifact。

交叉验证：

- evidence store、主模型摘要、日志三者的 `evidenceId/imageHash/route/mode/regionCount` 一致。
- 无关图片路径不得抢占当前视觉任务。

## 阶段 7：视觉产物、真实矢量化、抠图和保真验证

目标：把“粗略模仿”修成可执行的高保真产物流程。

实施：

- 新增 artifact store：PNG/SVG 落盘，文件名含 `evidenceId/taskId/hash`，不使用 base64 做上下文或文件名。
- 删除或运行时禁用 `buildSvgFromRegion` 这类 bbox 占位 SVG；改为真实 raster-to-vector：ROI crop、颜色量化、边缘/轮廓提取、Potrace/Imagetracer/VTracer 类适配器、路径拟合、SVGO 优化、路径简化、相近颜色合并、冗余节点/路径去除。
- 抠图能力：ROI 裁切、颜色范围、透明度、边缘、连通域、洪泛、显著性或 ML segmentation 生成 mask；形态学开闭、羽化、去噪、去背景色溢出、抗 halo、alpha 一致性、resize/rotate/perspective/基础形变和多步组合。
- 大模型只规划和选择参数，确定性工具实际执行；结果不足时任务栈追加下一步，不让主模型凭描述粗略模仿。

测试：

- PNG 保存、SVG 保存、真实矢量化、SVGO 降噪合并、mask 抠图、羽化去噪、形变、多步处理、校验失败重试。
- 保真指标：bbox、mask 覆盖率、边缘质量、主色/渐变 stop、透明度、halo/noise、SVG viewBox、路径数量、颜色数量、视觉差异。

交叉验证：

- 产物文件存在、hash 匹配、验证日志存在。
- SVG 必须来自真实矢量化而非矩形占位。

## 阶段 8：长期记忆和 token 节省

目标：在不破坏各模型请求格式的前提下降低 token 消耗并提供可靠长期记忆。

实施：

- 按 provider profile 统计 system、vision contract、evidence、tool schema、reasoning replay、history、memory、artifact metadata 的 token 占比。
- 参考 [claude-mem](https://github.com/thedotmack/claude-mem) 的长期记忆/检索/摘要思想和 [rtk](https://github.com/rtk-ai/rtk) 的上下文压缩/token 节省思想；用 TypeScript 重写，文档标明设计参考来源，不复制许可证不明或不兼容代码。
- 新增 memory store：项目事实、用户偏好、视觉 evidence/artifact 身份、长期任务、模型能力结论；支持检索、摘要、去重、过期、导入导出、workspace 隔离。
- token budgeter：按模型上下文、工具 schema、视觉证据和当前任务选择最小必要记忆；默认不传 base64、完整日志或重复证据。
- 性能：TTL、LRU、上限、增量写入、取消令牌、并发锁、异常恢复、关闭释放。

测试：

- memory 检索/摘要/去重/过期/导入导出/损坏索引/并发写入。
- token budget 快照：不同模型上下文长度下选择内容稳定且不破坏请求格式。
- 泄漏测试：文件句柄、内存增长、缓存上限、GC。

交叉验证：

- 请求 token 下降但回答所需证据不丢失。
- 文档标明来源和实现边界。

## 阶段 9：README 生成与文档一致性

目标：README 成为功能验收基准，且只能由脚本生成。

实施：

- 新增 README 生成脚本，多语言内容来自 JSON；README 顶部声明自动生成，不允许手改。
- 迁移当前 README 内容，不丢失已写功能；结合视觉、模型版本、Qwen、长期记忆、token、e2e、打包、设置 UI、wrapped 能力重组。
- 配置表来自 package schema/defaults；模型表来自 preset/catalog；视觉流程和日志字段来自代码常量。

测试：

- README 生成结果与工作区 README 完全一致。
- 中英文 JSON schema 校验，所有关键章节都有双语内容。
- README 与 CHANGELOG、测试名、配置默认值一致。

交叉验证：

- 每个功能都有 README 说明、代码路径、测试或 e2e 证据。
- 删除过时文档必须有代码/测试依据。

## 阶段 10：VSIX 打包策略

目标：正式包和测试包都尽可能小，且内容正确。**正式包必须可独立安装运行；测试/自动化入口绝不可混入正式包。**

实施：

- 优化 [scripts/package-vsix.mjs](scripts/package-vsix.mjs)、[.vscodeignore](.vscodeignore)、[.vscodeignore.test](.vscodeignore.test)。
- **release（`package:release` / `package:vsix`）**：仅 `out/` 运行时（**禁止** `out/test/`、`out/automation/`）、禁止 `src/`、`test/`、`scripts/`、`docs/`、`plan/`、分析文档与历史 `*.vsix`。
- **test（`package:test`）**：允许编译后的 `out/automation/`（Host UI smoke 入口 `require('./out/automation/hostUiSmoke.js')`），仍禁止 `src/`、`docs/`、`scripts/`；单测与 `node --test out/test/*` 留在仓库本地，不要求打进 VSIX。
- 门禁脚本：[scripts/check-vsix-contents.mjs](scripts/check-vsix-contents.mjs) + **`npm run package:verify`**（[scripts/verify-vsix-packages.mjs](scripts/verify-vsix-packages.mjs)：依次打 release/test 包并各跑一遍 deny 扫描）。
- 单测 [src/test/vsixPackagePolicy.test.ts](src/test/vsixPackagePolicy.test.ts) 与 `check-vsix-contents.mjs` **deny 规则必须同步**。
- Host UI / npm `test:host-ui:*` 脚本仅引用 **test VSIX**（`package:test`），禁止复用 release 产物做 E2E。
- `HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED` 与后处理相关能力：**正式包仍保留结构化识图与配置读写**；仅后处理执行与 restore 专测在 release 中处于关闭/跳过态，不得因打包误删结构化契约代码。

测试：

- `npm run package:verify`：release + test 双包 contents deny 全绿。
- release/test 包 contents allowlist/denylist（`vsce ls`）。
- 正式包不含 `out/test`、`out/automation`、`测试 fixtures`、源 ts、临时文档、plan 目录。
- 测试包含 `out/automation`，可跑 Host UI E2E；正式包安装后：设置面板、Chat、LM 请求、结构化识图（无后处理执行）可用。

交叉验证：

- 包体大小变化有记录。
- 不因缩包删除必要运行时能力（尤其结构化 proxy 与 provider 路径）。
- **发布前必跑**：`npm test` + `npm run package:verify`；有 API key 时再跑 `npm run test:host-ui:chat-acceptance`（test 包）。

## 阶段 11：最终覆盖审计与发布前验收

目标：确认所有新旧需求完整、可达、可测、可文档化。

实施：

- 建立最终覆盖表，逐项对应旧计划和本聊天全部需求：日志根因、代理过程展示、模型请求、Qwen、设置报错、token/记忆、真实测试、打包、README、任务树、视觉高保真。
- 每阶段结束前做三向交叉验证：代码路径可达、测试真实覆盖、README/CHANGELOG 准确描述。
- 对内置模型做不到的限制必须明确写 wrapped/替代路径和用户可见 fallback。

测试：

- 全量 `npm test`。
- 真实 e2e 按可用 API key 跑 provider、wrapped、vision、设置、打包场景。
- 日志回放和包体检查必须通过。

交叉验证：

- 无过时入口、无临时代码、无测试-only 功能冒充正式功能。
- 新旧 README、CHANGELOG、配置 schema、预设模型、运行日志字段和测试断言一致。

## （增补）Chat UI 与单元测试计划 — 2026-05-15 追加

以下为本轮在**不改动上文既有段落**的前提下追加的测试设计与执行约定，用于「多场景 Chat UI 真跑 + 证据链无假通过」。

### 任务树（执行顺序）

1. 定义 canonical 场景清单与 `COPILOT_BRO_UI_SMOKE_CHAT_SCENARIOS` 解析规则（单元测试锁定）。
2. 扩展 `@bro-smoke` participant：单次 Chat 打开内顺序跑完所有场景（避免多轮 `chat.open` 与 participant 异步竞态）。
3. 扩展 Host UI smoke 子进程环境变量与 summary，对齐场景 id 列表。
4. 扩展 `assertHostUiSmokeEvidence`：在 `chat-ui` 路径下校验 `host-ui-smoke.chat.scenario.end`（每 id 一条且 `ok:true`）与 `host-ui-smoke.chat.suite.summary`。
5. 全量 `npm test`；在 Windows 上按需执行 `npm run test:host-ui`（mock 或真实 key）。

### Chat UI 自动化覆盖矩阵（默认 mock 下全跑）


| 场景 id          | 意图                           | 期望模型输出（trim）            |
| -------------- | ---------------------------- | ----------------------- |
| baseline       | 回归旧有英文精确回复指令                 | `BRO_SMOKE_OK_20260506` |
| unicode-prompt | 中文指令 + 多字节                   | 同上                      |
| markdown-wrap  | 指令含 markdown 围栏（模型仍只吐 token） | 同上                      |


可选扩展场景（逗号分隔启用）：`whitespace-padding`、`empty-lines`（空白与换行边缘）。

环境变量：`COPILOT_BRO_UI_SMOKE_CHAT_SCENARIOS`（逗号分隔 id）；未设置时默认 `baseline,unicode-prompt,markdown-wrap`。未知 id 必须失败（解析阶段抛错），禁止静默跳过。

### 单元测试计划（必须无假通过）

- `src/hostUiSmokeChatScenarios.ts`：默认 id 列表、分隔解析、未知 id 报错、`[host-ui-smoke-run-suite]` 与 `buildHostUiSmokeSuiteChatQuery()` 行为。
- `src/automation/hostUiSmokeAssertions.ts`：`validateHostUiSmokeChatSuiteEvidence` 全通过、缺一条 `scenario.end` 时报缺失、存在 `ok:false` 行时报 `has-failure`。
- 与现有 `hostUiSmokeFlow`、`hostUiSmokeEnv` 测试并存，不删减既有用例。

### 证据与防假通过

- 仍保留：`host-ui-smoke.chat.participant.request/end`、`request.start`/`request.end`、截图非空。
- 新增：与 summary 中 `chatScenarioIds` 等长的、带 `"scenarioId":"<id>"` 且 `"ok":true` 的 `host-ui-smoke.chat.scenario.end` 日志；以及至少一条 `host-ui-smoke.chat.suite.summary`。

### （增补）Chat UI 后 LM API 与多轮 request 证据 — 2026-05-15 追加

- 任务树：先 `host-ui-smoke.chat.participant.end`（确保多场景套件完成）→ 再按场景数等待 `request.end`（或 mock HTTP 计数）→ 可选「Chat 后 LM API」调色板命令 → 再 +1 次 provider 往返。
- 环境变量：`COPILOT_BRO_UI_SMOKE_POST_CHAT_LM_API`（`1`/`0`/`true`/`false`）；**默认**：`wrapped` 关闭；`provider` 在 **mock 服务器** 时开启（零额外 key 消耗），真实 API 默认关闭除非显式 `1`。
- 证据：`postChatLmApiPhase=true` 时 summary 允许出现 `requestCommandStart/End`，日志必须含 `host-ui-smoke.request.run.start/end`。

### （增补）P8 前置与 P10 包体检查 — 2026-05-15 追加

- `src/tokenBudget.ts`：`computeEffectiveInputTokenBudget`、`promptToContextPressure`、当估算 prompt 接近上下文预算时 `request.prompt.tokenPressure` 告警（不截断消息，避免误伤）。
- `scripts/check-vsix-contents.mjs` + `npm run package:check`：`vsce ls` 扫描 VSIX，release 禁止 `out/test`、`out/automation`、`extension/src`、`extension/docs`、分析文档路径；test 包允许 `out/test`/`out/automation` 但禁止源码与 docs 混入。
- 长期记忆与自动截断仍属后续迭代，本段仅锁定 token 压力可观测性与包体门禁。

### （增补）Host UI 全链路 E2E 套件与名词 — 2026-05-15 追加

**本地 mock LM**：`test:host-ui` 在子进程内可选启动的 **临时 OpenAI 兼容 HTTP 服务**，对 `v1/chat/completions` 返回固定 `BRO_SMOKE_OK_20260506`，**不访问公网、不计供应商配额**。条件：`COPILOT_BRO_UI_SMOKE_ALLOW_MOCK=1` 且子进程无有效 `DEEPSEEK_API_KEY`（见 `hostUiSmoke.ts`）。与 **真实 LM**（各 `*_API_KEY` 走官方 baseUrl）相对。

`**COPILOT_BRO_UI_SMOKE_E2E`**：`all` 或逗号分隔套件 id。当前内置：`github-chat-login`（调色板「Trigger Chat Sign In」+ 既有图像 OAuth 流）、`config-panel`（设置页 smoke，默认随 `all` 开启，可用 `COPILOT_BRO_UI_SMOKE_CONFIG_PANEL=0` 关闭）、`chat-scenarios`（`@bro-smoke` 多场景 Chat）、`provider-probe`（内置代表性模型 id 每供应商一次 `sendRequest` 文本 ping）、`preset-catalog`（日志枚举预设）、`post-chat-lm`（Chat 后「Run Host UI Smoke Request」；`shouldRunPostChatLmApiAfterChat` 对 provider 默认开启，`COPILOT_BRO_UI_SMOKE_POST_CHAT_LM_API=0` 可关）。`chat-ui` 路径**不得**从套件列表中移除 `chat-scenarios`。

**仍缺口（相对「完整真实」）**：`provider-probe` 仅为文本；高保真识图全路径、每供应商 **vision** 多模态、Phase1 **全部**设置项 UI 改存、无界智能体长任务 — 需后续独立套件 id（如 `vision-probe`、`phase1-settings-exhaustive`、`agent-smoke-budgeted`）+ 扩展命令与证据后再入 `all`。

### （执行记录）Host UI smoke 修复与全绿 — 2026-05-15

- **根因**：配置页 HTML 缺少 `#temperature`、`#category` 与脚本不同步；`hostUiSmokeSaveModel` 在 `saveModel` 抛错时未回传 `hostUiSmokeSaved` 导致 webview 挂起；`window.message` 监听器注册晚于 `refreshModels` 时若初始化抛错则收不到 `hostUiSmokeRun`；`waitForLogPayload` 在无新日志时误触发 stall；`triggerSetupForceSignIn` 可能永不 resolve；`provider-probe` 用 `process.env` 误判有密钥（实际仅读 SecretStorage）。
- **已做**：补全 DOM；扩展端始终 ack smoke 保存（`withTimeout` + 错误载荷）；监听器前移 + `try/finally` 发 `hostUiSmokeReady`；`waitForLogPayload(..., { disableStallDetection: true })`；Sign-in 命令 `Promise.race` 12s；探测仅当 `extendedModels.apiKey.<provider>` 存在时执行。
- `**npm run test:host-ui`**（默认 E2E=all）与 `**npm test`** 已通过。
- **下一步（任务树）**：按 YAML 继续 p0→p11；每项先测后改；缺口套件（如 `vision-probe`）见上文「仍缺口」段。

