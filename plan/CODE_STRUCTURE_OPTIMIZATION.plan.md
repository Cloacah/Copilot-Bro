# 代码结构简化与解耦计划

| 元数据 | 值 |
|--------|-----|
| 状态 | **结构优化闭环（C3/C6 已落地；extension 聊天体可续拆）** |
| 版本 | 1.7 |
| 日期 | 2026-05-21 |
| 关联 | `plan/VISION_FLOW_MASTER.plan.md`、`docs/PLAN_COVERAGE.md` |
| 前置 | 布局阶段 0–2 已落地（`src/e2e/`、`fixtures/host-ui/`）；`REPO_LAYOUT` 计划已删除 |

---

## 1. 现状概览

### 1.1 顶层目录角色

| 区域 | 路径 | 职责 |
|------|------|------|
| 扩展入口 | `src/extension.ts`（~970 行） | LM Provider、激活与 smoke 探针编排；Chat 环在 `e2e/hostUi/extensionSmokeChat.ts` |
| 主请求管线 | `src/provider.ts`（~960 行） | OpenAI 兼容流、工具/记忆/预设、包装模型转发 |
| 识图分支 | `src/providerVisionBranch.ts`（~625 行） | 事前预处理、策略路由（proxy/native）、ROI 门控、残余图安全守卫 |
| 识图路由 | `src/visionProxy.ts`（~1.0k 行） | 代理/native 路由、路径注水、缓存、证据持久化 |
| 结构化 pass | `src/visionStructuredPass.ts`（~1.1k 行） | `resolveStructured*Description`、执行链（smoke 下动态 `pageSsim`） |
| 结构化契约 | `src/visionProxyStructuredPlan.ts` | v3 解析、`buildMinimalStructuredVisionFallback` |
| 协议与证据 | `src/visionProtocol/` | ROI、证据库、任务栈、native handoff |
| 编排抑制 | `src/visionOrchestrationContext.ts` | 防嵌套识图套娃 |
| 工具协作 | `src/toolCooperation/` | 契约、适配器、产物存储 |
| E2E | `src/e2e/` | Host UI 驱动、`scripts/run-host-ui-chat-acceptance.mjs` |
| 单测 | `src/test/` | `out/test/**/*.test.js` |

### 1.2 已落地（2026-05-22，勿重复做）

- `chat-scenarios` 自动依赖 `github-chat-login`（`applyHostUiSmokeE2eSuiteDependencies`）
- Host UI：`scripts/run-host-ui-chat-acceptance.mjs`（登录 + Ask + auto-run chat + 无超时等待）
- 扩展：`maybeAutoRunHostUiSmokeChatSuiteAfterGithubPreflight`（严格 `] event` 日志匹配）
- 驱动：`hostUiSmokeFocus.ts`、palette 命令 ID、结构化日志 `hostUiSmokeLogTailHasEvent`
- 全量 Host UI：**17/17** integration `ok: true`（`host-ui-smoke-summary.json` `passed`）
- 纯色图：`vision.*.structured.format-fallback` + `vision.evidence.persisted`
- 用户文档：`docs/readme.sections.json` + `scripts/generate-readme.mjs`（暂停还原项不入配置表；强调 BYOK + native/proxy）

---

## 2. 功能执行路径（摘要）

### 2.1 主聊天（`provideLanguageModelChatResponse`）

1. API Key / 模型解析 → `visionNeeded`（编排抑制时跳过）  
2. 策略：**proxy** | **native** | wrapper-proxy | plan-only | text-fallback | disabled  
3. native / proxy：结构化 JSON → 证据文本替换图片 → `hasImageParts: false`  
4. `sendChatCompletion` → 可选 `finalizeNativeVisionStructuredHandoff`（事前 pass 成功后多为 no-op）

### 2.2 防套娃

- 代理子请求：`runWithSuppressedVisionOrchestration`  
- 矩阵：`proxyVision === false` 时 Bro vision 模型优先 **native**

### 2.3 暂停但保留（文档与 README **不写**为可用功能）

| 开关 | 行为 |
|------|------|
| `HIGH_FIDELITY_RESTORE_IMAGE_PIPELINE_SUSPENDED` | 矢量化/抠图/整页 SSIM 还原链跳过；结构化识图与证据仍执行 |

---

## 3. 待办简化项

| ID | 项 | 优先级 | 状态 |
|----|-----|--------|------|
| S1 | 拆分 `visionProxy.ts` → `visionStructuredPass.ts` + 路由层 | P1 | ✅ |
| S2 | 拆分 `provider.ts` → `providerVisionBranch.ts` 等 | P1 | ✅ |
| S3 | smoke 命令迁 `src/e2e/hostUi/registerSmokeCommands.ts` | P1 | ✅ |
| S4 | 矩阵 native 优先（proxy 关） | P0 | ✅ |
| S5 | `VisionStructuredProgress` 重命名 | P2 | ✅（`VisionProxyStructuredProgress` 为别名） |
| S6 | `scripts/` 分子目录 | P3 | ✅（`build/`、`readme/`、`host-ui/`、`release/`、`catalog/`、`dev/`） |
| S7 | extension-only tsconfig | P3 | ✅（`tsconfig.extension.json` + `tsconfig.test.json`） |

---

## 4. 可复用 / 去重

| ID | 说明 | 状态 |
|----|------|------|
| R1 | proxy/native 消息循环共享 | ✅（`visionProtocol/structuredVisionMessageBatch.ts`） |
| R2 | `resolveStructuredVisionDescription` 统一 | ✅ |
| R3 | 契约 prompt 共用 | ✅ |
| R4 | `persistProxyEvidenceRecords` → `persistStructuredVisionEvidence` | ✅ |
| R5 | 事前 pass vs 事后 finalize 双通道 | 文档化 ✅ |
| R6 | ROI 门控合并 | ✅（`evaluateRoiGateWithTimeout` → `roiRuntimeGuard.ts`） |
| R7 | Host UI log markers 单源 | ✅（`visionLogEvents.ts` + `e2e/hostUi/logMarkers.ts`） |

---

## 5. 高耦合解耦

| ID | 方向 | 状态 |
|----|------|------|
| C1 | extension smoke 瘦化 / 动态 import | P1 | ✅（命令注册 + Chat 环迁 `extensionSmokeChat.ts`） |
| C2 | `visionProxy` 去掉对 `e2e/.../pageSsim` 静态 import | P1 | ✅（smoke 下动态 import） |
| C3 | logger ↔ smoke 证据 | ✅（`smokeLogBridge/smokeLogEvidence.ts` + Logger 桥接） |
| C4 | `visionProxy.ts` 体量 | P1 | ✅（~1.0k；结构化已迁出） |
| C5 | `provider.ts` 体量 | P1 | ✅（~960；识图分支已迁出） |
| C6 | 配置面板 ↔ smoke checklist | ✅（`getPhase1FieldLogMarkers` + 单测；workspace checklist 用 canonical events） |
| C7 | VSIX deny 三处 | 已有单测 ✅ |

---

## 6. 一致性校验（每阶段 PR）

| 检查 | 命令 |
|------|------|
| 单元测试 | `npm test` |
| README | `npm run readme:check` |
| VSIX | `npm run package:verify` |
| Plan 路径 | `planCoverageAudit.test.ts` |
| Host UI Chat | `npm run test:host-ui:chat-acceptance` |
| Native 高保真 | 关全局代理 + vision 模型 → `vision.native.structured.resolving` |
| 套娃 | 代理模型内层无二次 `vision.route.selected` |

---

## 7. 实施顺序（更新）

1. ~~P0：原生高保真 + 编排抑制 + Host UI 登录/chat .harness~~ ✅  
2. ~~P0：format-fallback + 全量 17 场景 Host UI~~ ✅  
3. ~~P1：C2 / S1 / S2~~ ✅  
4. ~~P1：S3 extension smoke 注册迁出~~ ✅  
5. ~~P2：R1 消息批处理共享、S5 进度类型别名~~ ✅  
6. ~~P2：R7 log markers 单源；R6 ROI 门控合并~~ ✅  
7. ~~P2：R4 证据持久化命名~~ ✅  
8. ~~P3：scripts 子目录 + extension/test tsconfig 分轨~~ ✅  
9. ~~C3 logger↔smoke、C6 checklist~~ ✅  
10. ~~`extensionSmokeChat.ts` 迁出 participant/集成环~~ ✅（`extensionSmokeRuntime.ts` + `extensionSmokeChat.ts`）  
11. **后续（可选）**：smoke 探针迁 `extensionSmokeProbes.ts`；`extension.ts` 再瘦 ~300 行  

---

## 8. 文档

- 用户文档：`docs/readme.sections.json` + `npm run readme:generate`（勿直接改 `README.md`）  
- 计划索引：`docs/PLAN_COVERAGE.md`  
- 识图主计划：`plan/VISION_FLOW_MASTER.plan.md`
