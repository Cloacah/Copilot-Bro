# 识图流程审查记忆（只读审计，未改业务代码）

> 生成日期：2026-05-27  
> 范围：配置页 → `settings` 归一化 → 策略/矩阵 → `provider.ts` 执行管线  
> SSOT 顺序：`docs/vision-route-order.md`、`src/visionProtocol/visionRoutePipeline.ts`

---

## 一、审查进度（逐步记录）

### Step 1 — 配置入口与持久化

| 环节 | 结论 |
| --- | --- |
| 模型保存 | `configPanel.ts` 写入 `visionProxyScope` / `visionProxyFixedModelId` / `visionProxyCustomModelIds`；五档：inherit / disabled / auto / fixed / custom-list |
| 全局保存 | `visionProxy.selectionMode`（auto / fixed / custom-list）、`defaultModelId`、`customModelIds`、重试参数 |
| 读取归一化 | `settings.ts` → `resolveModelVisionProxyFields()` 合并旧字段 `visionProxyModelId` / `vision_proxy_model_id` |
| 有效选择 | `resolveEffectiveModelVisionProxySelection()` 统一 inherit → 全局、model 级覆盖 |

**风险（低）**：仅 JSON 手改且 scope 与 legacy `visionProxyModelId` 冲突时，以显式 `visionProxyScope` 为准（`resolveModelVisionProxyFields` 优先 explicitScope）。

---

### Step 2 — 策略层 `visionProxyPolicy`

核心规则（与 README「两个开关」一致）：

1. **disabled** → `enabled: false`，走 native（若 `vision=true`）或后续矩阵降级。
2. **inherit + 全局** → 沿用 `settings.visionProxy` 的 mode / ids / enabled。
3. **fixed / custom-list** → `enabled: true`（列表为空时 enabled 仍 true，但候选链为空 → unavailable）。
4. **auto + 自带视觉** → `enabled: false`（`native-default`）——**关键**：避免「有 Vision Input 的模型」在 inherit/auto 下误走代理。
5. **auto + 无视觉** → `enabled: true`，`required: true`。
6. **固定代理指向自己** → `self-disabled`，与不启用代理等价。

**结论**：策略层与产品语义一致，且与 `buildModelCapabilities().proxyVision` 直接挂钩。

---

### Step 3 — 兼容矩阵 + 能力覆盖

| 输入 | 矩阵主策略 | 常见实际策略（经 `selectCompatibilityMatrixStrategy`） |
| --- | --- | --- |
| bro + vision + agent-on | proxy | **native**（因 `proxyVision=false` 时强制 native 覆盖） |
| bro + non-vision + agent-on | proxy | proxy（需 `proxyVision=true`） |
| bro + vision + agent-off | native | native |
| builtin + non-vision + agent-on | wrapper-proxy | 见 Step 4 |
| 无图 | text-fallback / disabled | 不进入识图管线 |

**结论**：Bro 视觉模型在 agent 开启时默认 **native 结构化**，与 README 一致；矩阵里的 `proxy` 行主要约束「若强制开启代理」时的回退链。

---

### Step 4 — 执行管线（`provider.ts`）

```
visionNeeded?
  ├─ 否 → 跳过 preRoute/branch，仅 residual guard
  └─ 是 → runVisionPreRoute
           ├─ integrity 阻断 → shouldStop（Chat 调试文案，不发主请求）
           ├─ pre-route ROI 阻断 → shouldStop
           └─ runVisionStrategyBranch
                ├─ proxy / wrapper-proxy → resolveVisionProxyMessages → post-proxy ROI
                ├─ native → resolveNativeVisionStructuredMessages（有 apiKey 且无 wrapped）
                ├─ plan-only / text-fallback / disabled → shouldStop
                └─ proxy 失败 → handleVisionStrategyFallback（用 matrix fallbackStrategy）
        → applyVisionResidualImageGuard（非 vision 模型剥图）
        → 主模型 HTTP / wrapped 转发
```

**结论**：阶段顺序与 `vision-route-order.md` 一致；`visionAgent.retryOnFailure` 仅影响 agentSession，**不**包 structured HTTP（文档已说明）。

---

### Step 5 — 代理子路径 `resolveVisionProxyMessages`

1. 文本路径补水（`hydrateImagePartsFromTextPaths`）
2. 无图 → `not-needed`
3. `isVisionProxyEnabledForModel` 假 → `not-needed`（**注意**：若矩阵选了 proxy 但 policy 关，会在此短路；当前设计下二者应一致）
4. `resolveVisionProxyCandidateChain`：fixed → 单候选；custom-list → 有序链；auto → `resolveVisionProxyChatModelAuto`
5. `runVisionProxyCandidateChain` + 结构化 batch + 429 重试（`customListMaxRetriesPerModel`）

**分支遗漏检查**：

| 场景 | 处理 | 评价 |
| --- | --- | --- |
| 选了 proxy 但无 actionable 图 | `vision.proxy.skipped` + break，消息可能仍含图 | 依赖 residual guard；非 vision 会剥图 |
| proxy unavailable + reportFailure | fallback 或 stop | OK |
| custom-list 全失败 | unavailable | OK |
| 代理成功但主模型 non-vision | 消息应已替换为文字 | structured batch 负责 |

---

### Step 6 — Native 路径

- 非 wrapped 且有 apiKey → `resolveNativeVisionStructuredMessages`
- 否则 → `persistNativeVisionInputEvidence`，主请求可能仍带原图（wrapped / 无 key）
- 主请求完成后 → `appendNativeVisionPostCompletionProgress` 解析 assistant 结构化

**风险（中）**：wrapped 内置模型走 native 分支时不会做 structured pass，仅靠证据哈希；与 Path B 文档需用户知晓。

---

## 二、发现的问题与风险（汇总）

### P1 — 文档对齐（本轮已修复）

- `docs/readme.sections.json`：`visible-settings-guide`、`vision-proxy` 已改为 `visionProxyScope` 三字段 + 全局 `selectionMode` / `customModelIds` / 重试字段。
- 已执行 `npm run readme:generate` 与 `readme:check`（通过）。

### P2 — `wrapperProxyAvailable`（已修复 2026-05-27）

- `buildModelCapabilities()`：`wrapperProxyAvailable = isWrapped && proxyPolicy.enabled`。
- 测试：`providerOrchestration.test.ts`（wrapped + proxy on → `wrapper-proxy` 矩阵选型）。

### P3 — proxy 路由与 `not-needed`（已修复 2026-05-27）

- `not-needed` 时记录 `vision.proxy.routeMismatch` 并走 `handleVisionStrategyFallback`（不再静默 break）。
- 失败批：`failBatch` / `isolateFailedBatch` 与 unavailable 路径一致。

### P4 — 全局 `visionProxy.enabled = false`

- 无视觉模型：`proxyVision=false` → 矩阵降级，符合 README。
- 视觉模型 + inherit：仍 `native-default`，可 native → **正确**。

### P5 — 模型级 `auto` + 原生视觉（已修复 2026-05-27）

- `scope === "auto" && model.vision` 时 `effective.enabled = false`，与 `visionProxyPolicy` 的 `native-default` 一致。
- 测试：`modelVisionProxy.test.ts`。

### P6 — 解耦与简洁性

| 模块 | 评价 |
| --- | --- |
| `modelVisionProxy` / `visionProxyPolicy` / `visionProxyCandidateChain` | 职责清晰，可单测 |
| `compatibilityMatrix` vs `visionProxyPolicy` | 双层决策：矩阵定「意图」，policy 定「能否代理」；略冗余但 Bro-native 覆盖必要 |
| `providerVisionBranch` | 单文件承载分支，体积偏大但阶段函数已拆 |
| `visionProxy.ts` | 代理执行+缓存+补水，与 branch 边界清楚 |

**总体**：解耦足够支撑演进；P2/P3/P5 已按审计建议最小修复。

---

## 三、配置 → 运行时对照表（通俗）

| 你想达到的效果 | 模型 Vision Input | 模型 Vision Proxy | 全局 visionProxy |
| --- | --- | --- | --- |
| 自己有眼睛，自己识图 | 开 | 继承 或 禁用 | 任意 |
| 自己没眼睛，让别人识图 | 关 | 继承/auto + 全局 enabled | enabled + auto/fixed/list |
| 自己有眼睛，仍强制别人识图 | 开 | fixed / custom-list（指向别模型） | — |
| 完全不要代理 | — | disabled | — |
| 列表容错 | — | custom-list | custom-list + 重试字段 |

---

## 四、一致性检验清单

| 对照项 | 状态 |
| --- | --- |
| `vision-route-order.md` ↔ `providerVisionBranch.ts` | 一致 |
| `vision-proxy` README ↔ `visionProxyPolicy` | 一致（全局表补全后） |
| `visible-settings-guide` ↔ 配置页 UI | 已对齐（2026-05-27） |
| 测试 `visionProxyPolicy` / `modelVisionProxy` / `compatibilityMatrix` | 558 测通过（会话前基线） |
| 矩阵 wrapper-proxy ↔ 生产 `buildModelCapabilities` | 已一致（P2 已修复） |

---

## 五、修复记录（2026-05-27）

| 项 | 改动文件 |
| --- | --- |
| P2 wrapper-proxy | `src/providerOrchestration.ts` |
| P3 not-needed fallback | `src/providerVisionBranch.ts` |
| P5 auto+vision enabled | `src/config/modelVisionProxy.ts` |

---

## 六、审查结论（一句话）

**Bro 主路径与 Wrapped 模型的 wrapper-proxy 矩阵选型已对齐；proxy 路由与执行不一致时会显式降级，不再依赖残余图 guard 沉默兜底。**
