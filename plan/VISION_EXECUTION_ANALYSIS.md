# 识图系统执行栈与高保真还原实现分析

**分析日期**：2026-05-11  
**分析范围**：Complete vision pipeline execution stack with fidelity guarantees  
**质量目标**：Identify and document all execution branches, guard conditions, and potential failure modes

---

## 📊 第一部分：主执行栈树状图

### 完整执行分支树

```
┌─ provideLanguageModelChatResponse()
│  ├─ [STAGE 1] 配置与验证
│  │  ├─ findModelConfig(modelInfo.id)
│  │  ├─ applyPickerConfiguration()
│  │  └─ validateModelConfig()
│  │
│  ├─ [STAGE 2] 模型能力分析
│  │  ├─ buildModelCapabilities(model, settings)
│  │  │  └─ imageInput = model.vision || canUseVisionProxy
│  │  │
│  │  ├─ needsVision(messages, capabilities)
│  │  │  ├─ Check: needVisionGate === true
│  │  │  ├─ Check: hasImages in messages
│  │  │  └─ Check: nativeVision || proxyVision || wrapperProxyAvailable
│  │  │
│  │  └─ ├─ FALSE ──→ 【跳过识图管道】──→ [STAGE 6] 发送请求
│  │     └─ TRUE ──→ 【进入识图管道】──→ [STAGE 3]
│  │
│  ├─ [STAGE 3] 识图管道 (visionNeeded === true)
│  │  │
│  │  ├─ [3.1] Preprocessing & Integrity Pipeline
│  │  │  ├─ applyVisionProcessingAndIntegrityPipeline()
│  │  │  │  │
│  │  │  │  ├─ For each image:
│  │  │  │  │  ├─ originalDigest = sha256(original)
│  │  │  │  │  ├─ runProcessingChain({image})
│  │  │  │  │  │  ├─ IF imagePreprocess:
│  │  │  │  │  │  │  ├─ crop()
│  │  │  │  │  │  │  └─ resize()
│  │  │  │  │  │  │
│  │  │  │  │  │  └─ IF mlSegment:
│  │  │  │  │  │     ├─ getMlSegmentAdapter()
│  │  │  │  │  │     ├─ executeRestorationPipeline()
│  │  │  │  │  │     └─ {maskQuality, styleConsistency, ...}
│  │  │  │  │  │
│  │  │  │  │  ├─ candidateDigest = sha256(candidate)
│  │  │  │  │  │
│  │  │  │  │  ├─ validateImageIntegrity()
│  │  │  │  │  │  ├─ CHECK 1: empty_image (count & digest)
│  │  │  │  │  │  ├─ CHECK 2: invalid_dimensions (w/h > 0)
│  │  │  │  │  │  ├─ CHECK 3: abnormal_dimension_growth (max 4x)
│  │  │  │  │  │  ├─ CHECK 4: abnormal_byte_growth (max 8x)
│  │  │  │  │  │  └─ CHECK 5: resize_metadata_drift (same hash, diff size)
│  │  │  │  │  │     └─ warnings[] (empty if all pass)
│  │  │  │  │  │
│  │  │  │  │  └─ finalImage = integrityWarnings.length > 0 ? original : candidate
│  │  │  │  │
│  │  │  │  └─ IF strictIntegrity && integrityFailCount > 0
│  │  │  │     └─ 【BLOCK】──→ buildFallbackPlan() ──→ return early
│  │  │  │
│  │  │  └─ Return {messages, summary?, blocked?, blockReason?}
│  │  │
│  │  ├─ [3.2] Pre-Route ROI Confidence Gate
│  │  │  ├─ evaluateRoiGateForMessages(resolvedMessages)
│  │  │  │  └─ analyzer.getMetadata() + confidence scoring
│  │  │  │
│  │  │  └─ IF blocked
│  │  │     └─ 【BLOCK】──→ buildFallbackPlan() ──→ return early
│  │  │
│  │  ├─ [3.3] Vision Tool Routing
│  │  │  ├─ selectTool(visionNeeded, modelCaps)
│  │  │  │  └─ selectCompatibilityMatrixStrategy()
│  │  │  │     ├─ Input: {modelType, visionCapability, toolsAvailable, agentEnabled}
│  │  │  │     │
│  │  │  │     ├─ Table lookup: 16 predefined strategies
│  │  │  │     │  ├─ "native" ─────→ Use model's native vision
│  │  │  │     │  ├─ "proxy" ──────→ Use vision proxy
│  │  │  │     │  ├─ "wrapper-proxy" ─→ Use VS Code wrapper
│  │  │  │     │  ├─ "text-fallback" ─→ Return text-only response
│  │  │  │     │  ├─ "plan-only" ───→ Return executable plan
│  │  │  │     │  └─ "disabled" ────→ Vision disabled message
│  │  │  │     │
│  │  │  │     └─ +fallbackStrategy if primary unavailable
│  │  │  │
│  │  │  ├─ Batch Planning (for image orchestration)
│  │  │  │  ├─ collectImageRefs(messages)
│  │  │  │  ├─ deduplicateRefs(refs, {deduplicateImages, dedupeByHash})
│  │  │  │  │  └─ Prevents duplicate processing
│  │  │  │  │
│  │  │  │  ├─ splitIntoBatches(dedupedRefs, maxBatchSize)
│  │  │  │  │  └─ Group images into batches
│  │  │  │  │
│  │  │  │  ├─ createSessionIfEnabled()
│  │  │  │  ├─ markSessionReady(sessionId)
│  │  │  │  └─ startBatch(sessionId, batch, index)
│  │  │  │
│  │  │  └─ Log: vision.route.selected {strategy, reason, matrixKey}
│  │  │
│  │  ├─ [3.4a] PROXY/WRAPPER-PROXY Branch
│  │  │  └─ resolveVisionProxyMessages(resolvedMessages, model, settings)
│  │  │     │
│  │  │     ├─ hydrateImagePartsFromTextPaths(messages)
│  │  │     │  ├─ Regex: Extract file:// URLs and local paths
│  │  │     │  ├─ Load image bytes from disk
│  │  │     │  └─ Convert to LanguageModelDataPart
│  │  │     │
│  │  │     ├─ hasImages()? ──NO──→ status="not-needed" ──→ return
│  │  │     │
│  │  │     ├─ selectVisionProxyModel(model, settings)
│  │  │     │  │
│  │  │     │  ├─ Decision Logic:
│  │  │     │  │  ├─ IF model.visionProxyModelId === null
│  │  │     │  │  │  └─ disabled (return undefined)
│  │  │     │  │  │
│  │  │     │  │  ├─ ELSE IF configured !== undefined || settings.visionProxy.enabled
│  │  │     │  │  │  └─ shouldProxy = true
│  │  │     │  │  │
│  │  │     │  │  └─ ELSE
│  │  │     │  │     └─ shouldProxy = false (return undefined)
│  │  │     │  │
│  │  │     │  ├─ Model Selection Priority (if shouldProxy):
│  │  │     │  │  ├─ [Priority 1] Configured model by ID
│  │  │     │  │  │  └─ vscode.lm.selectChatModels({id: requestedId})
│  │  │     │  │  │
│  │  │     │  │  ├─ [Priority 2] Models with imageInput && !extendedModels
│  │  │     │  │  │  └─ isUsableVisionModel(candidate, selfIds)
│  │  │     │  │  │
│  │  │     │  │  ├─ [Priority 3] Other non-extendedModels
│  │  │     │  │  │  └─ fallback for built-in Copilot models
│  │  │     │  │  │
│  │  │     │  │  └─ [Priority 4] Any available model (last resort)
│  │  │     │  │
│  │  │     │  └─ Log: vision.proxy.{selected|auto-selected|fallback-selected}
│  │  │     │
│  │  │     ├─ For each message with imageParts:
│  │  │     │  │
│  │  │     │  ├─ Cache Key = buildVisionProxyCacheKey(imageParts, prompt, proxyModelId)
│  │  │     │  │  └─ sha256(proxyModelId + "\n" + prompt + imageBytesHash)
│  │  │     │  │
│  │  │     │  ├─ visionProxyDescriptionCache.get(cacheKey)?
│  │  │     │  │  ├─ YES ──→ CACHE HIT ──→ reuse description
│  │  │     │  │  │         (log: vision.proxy.cache.hit)
│  │  │     │  │  │
│  │  │     │  │  └─ NO ──→ CACHE MISS ──→ proxyModel.sendRequest([imageParts + prompt])
│  │  │     │  │          ├─ Stream response into description
│  │  │     │  │          ├─ setVisionProxyCachedDescription(cacheKey, description)
│  │  │     │  │          │  └─ IF cache size > 128: FIFO evict oldest
│  │  │     │  │          │
│  │  │     │  │          └─ (log: vision.proxy.cache.miss)
│  │  │     │  │
│  │  │     │  └─ Replace imagePart with formatVisionDescription(description)
│  │  │     │
│  │  │     └─ Return {messages, status, cacheHitCount, cacheMissCount}
│  │  │
│  │  ├─ [3.4b] Proxy Result Handling
│  │  │  │
│  │  │  ├─ IF status === "not-needed" ──→ skip proxy result processing
│  │  │  │
│  │  │  ├─ IF status === "unavailable" || "failed"
│  │  │  │  ├─ failBatch(activeBatchId)
│  │  │  │  ├─ isolateFailedBatch(activeBatchId, error)
│  │  │  │  │
│  │  │  │  └─ Apply fallbackStrategy:
│  │  │  │     ├─ "text-fallback" ──→ buildTextFallback(reason) ──→ return
│  │  │  │     ├─ "plan-only" ────→ buildFallbackPlan(reason) ──→ return
│  │  │  │     └─ "disabled" ─────→ buildDisabledVisionMessage(reason) ──→ return
│  │  │  │
│  │  │  └─ IF status === "applied"
│  │  │     ├─ [3.4b-i] Post-Proxy ROI Confidence Gate
│  │  │     │  ├─ evaluateRoiGateForMessages(resolvedMessages)
│  │  │     │  │
│  │  │     │  └─ IF blocked
│  │  │     │     ├─ completeBatch()
│  │  │     │     └─ buildFallbackPlan() ──→ return early
│  │  │     │
│  │  │     └─ completeBatch()
│  │  │
│  │  ├─ [3.5a] NATIVE Branch
│  │  │  └─ resolvedMessages passes through to main model
│  │  │     (No proxy processing, model handles images natively)
│  │  │
│  │  ├─ [3.5b] PLAN-ONLY Branch
│  │  │  └─ buildFallbackPlan(reason, detectionMessages) ──→ return early
│  │  │
│  │  ├─ [3.5c] TEXT-FALLBACK Branch
│  │  │  └─ buildTextFallback(reason) ──→ return early
│  │  │
│  │  └─ [3.5d] DISABLED Branch
│  │     └─ buildDisabledVisionMessage(reason) ──→ return early
│  │
│  ├─ [STAGE 4] Vision Guard - 残留图像防护
│  │  ├─ countImagePartsInMessages(resolvedMessages)
│  │  │  └─ Count remaining image parts
│  │  │
│  │  ├─ IF !model.vision && residualImages > 0
│  │  │  ├─ 【ERROR】 Log: vision.guard.residual-images
│  │  │  │
│  │  │  ├─ stripImagePartsFromMessages(resolvedMessages, replacement)
│  │  │  │  └─ Replace all image parts with text placeholders
│  │  │  │
│  │  │  └─ Report: "[Vision] safety guard activated: stripped residual raw image payload..."
│  │  │
│  │  └─ This is a SAFETY BLOCKER, not a normal path!
│  │
│  └─ [STAGE 5] 向主模型发送请求
│     ├─ Wrapped Model Path:
│     │  └─ buildWrappedLanguageModelRequest()
│     │     └─ forwardWrappedLanguageModelRequest()
│     │
│     └─ Direct API Path:
│        ├─ convertMessages(resolvedMessages, model)
│        ├─ prependVisionPromptContract(openAiMessages)
│        ├─ buildRequestBody(model, openAiMessages)
│        ├─ sendChatCompletion({...}) with streaming
│        └─ Error handling + batch tracking

```

---

## 🛡️ 第二部分：高保真还原保证机制

### 2.1 三层 Integrity 验证

```
┌─────────────────────────────────────────────────────────────┐
│           Vision Fidelity Assurance Architecture             │
└─────────────────────────────────────────────────────────────┘

Layer 1: INPUT VALIDATION
├─ Image Existence Check
│  ├─ checkCount: candidate.length === 0 ? "empty_image"
│  └─ checkDigest: empty hash ? "empty_image"
│
├─ Dimension Sanity Check
│  ├─ candidateMeta.width > 0 && candidateMeta.height > 0
│  └─ NO abnormal_dimension_growth
│     └─ max 4x enlargement allowed
│
└─ Byte Content Check
   ├─ trackByteSummary: max 8x growth
   └─ trackResize: same hash ≠ different size

Layer 2: PROCESSING VALIDATION
├─ SVG Optimization (if enabled)
│  ├─ validateSvgStructure()
│  ├─ evaluateSvgStyleFidelity()
│  └─ validateSvgGeometry()
│
└─ Image Preprocessing (if enabled)
   ├─ crop() operation
   ├─ resize() operation
   └─ mlSegment restoration pipeline

Layer 3: STRICT MODE BLOCKING
├─ IF strictIntegrity === true && integrityFailCount > 0
│  ├─ Return {blocked: true, blockReason: "..."}
│  ├─ buildFallbackPlan() to user
│  └─ 【EARLY RETURN】- No downstream processing
│
└─ IF strictIntegrity === false
   ├─ Fallback to original image
   ├─ Continue normally
   └─ Log fallback_to_original_count
```

### 2.2 结果一致性由以下保证

**📌 缓存一致性** (`visionProxy.ts`)
```
缓存键 = sha256(proxyModelId + "\n" + prompt + imageBytesHash)

保证:
├─ 同一张图像在同一会话中 → 生成相同的缓存键
├─ 不同代理模型 → 不同的缓存键
├─ 不同 prompt 配置 → 不同的缓存键
└─ 限制: 128 条（FIFO 驱逐）
```

**📌 模型能力隔离** (`provider.ts`)
```
imageInput = model.vision || canUseVisionProxy

保证:
├─ 原生视觉能力（model.vision）和代理能力（visionProxy）独立
├─ 两者不会相互干扰
└─ buildModelCapabilities() 正确计算
```

**📌 消息不变性** (`providerVisionPipeline.ts`)
```
originalMessages → applyVisionProcessingAndIntegrityPipeline() → finalMessages

保证:
├─ Integrity 校验前：使用原始图像的哈希
├─ Integrity 校验后：使用处理后图像的哈希
├─ 校验失败：使用原始图像
├─ 校验成功：使用处理后的图像
└─ 所有变换都被日志记录
```

**📌 ROI 双门控** (`provider.ts`)
```
Pre-route gate ────→ [Vision Processing] ────→ Post-proxy gate
   ↓                                                ↓
evaluateRoiGateForMessages()              evaluateRoiGateForMessages()
   ↓                                                ↓
IF blocked → buildFallbackPlan() → return    IF blocked → buildFallbackPlan() → return
```

---

## 🔄 第三部分：GeometryProtocol 与结构化还原

### 3.1 识图输出结构化流程

```
Vision AI Model Output (JSON)
│
├─ VisionBatchResult
│  ├─ batchId: string
│  ├─ sessionId: string
│  ├─ results: VisionResult[]
│  │  ├─ imageRef: string
│  │  ├─ imageHash: string
│  │  └─ objects: DetectedObject[]
│  │     └─ {
│  │        label: string
│  │        geometry: {
│  │          bbox: {x, y, w, h},
│  │          polygon?: Point[],
│  │          mask?: Uint8Array
│  │        },
│  │        attributes?: Record<string, any>,
│  │        rationale?: string
│  │     }
│  │
│  └─ failedRefs: string[]
│
└─→ assembleResult(batchResult, originalMessages, verbosity)
    │
    ├─ verbosity === "conservative"
    │  └─ "- label"
    │
    ├─ verbosity === "balanced" (default)
    │  └─ "- label @ (x,y,w,h) reason=..."
    │
    └─ verbosity === "verbose"
       └─ "- label geometry={...} attributes={...}"

Output: OpenAIMessage[]
├─ [...originalMessages,
│  {
│    role: "assistant",
│    content: "[BatchHeader]\n[FormatVisionOutput]\n[FailedRefs]"
│  }]
```

### 3.2 resultAssembler 的消息回填机制

```
Step 1: createVisionBatchHeader(batchId, sessionId)
        └─ "[Vision] batch={batchId} session={sessionId}"

Step 2: batchResult.results.map(r => formatVisionOutput(r, verbosity))
        └─ 按详细度格式化每个检测到的对象

Step 3: 处理失败的图像引用
        └─ "failedRefs={ref1,ref2,...}"

Step 4: 将上述内容作为单个 assistant message 追加
        └─ [...originalMessages, {role: "assistant", content: "..."}]
```

---

## ⚙️ 第四部分：SVG 与图像预处理触发点

### 4.1 预处理决策树 (decideVectorizationRoute)

```
Input:
├─ hasSvgInput: boolean (SVG 源文本是否存在)
├─ hasRasterImage: boolean (光栅图是否存在)
├─ svgOptimizeEnabled: boolean (配置)
├─ mlSegmentEnabled: boolean (配置)
├─ svgDecisionPolicy: "prefer-svg" | "prefer-raster" | "hybrid"
└─ rasterPolicy: "preserve" | "optimize" | "disable"

Output:
├─ shouldOptimizeSvg: boolean
└─ shouldRunMlSegment: boolean

Logic:
├─ IF svgOptimizeEnabled && hasSvgInput
│  └─ shouldOptimizeSvg = true
│
├─ IF mlSegmentEnabled && hasRasterImage
│  └─ shouldRunMlSegment = true
│
└─ Final decision influenced by svgDecisionPolicy & rasterPolicy
```

### 4.2 SVG 优化流程

```
SVG Input
  │
  ├─→ getSvgOptimizeAdapter().optimize(svg)
  │    └─ Minimize, remove redundancy, optimize paths
  │
  ├─→ fitSvgPathsInSvg(svg)
  │    └─ Adjust path fitting parameters
  │       └─ Return {svg, summary: {warnings[]}}
  │
  ├─→ evaluateSvgStyleFidelity(original, optimized)
  │    └─ Compare style preservation
  │       └─ Return {warnings: ["style:degradation" | ...]}
  │
  ├─→ validateSvgStructure(svg)
  │    └─ Check XML well-formedness
  │       └─ Return {warnings: ["structure:malformed" | ...]}
  │
  └─→ validateSvgGeometry(svg, svgPathFit)
       └─ Check geometric validity
          └─ Return {warnings: ["geometry:invalid" | ...]}

Warnings Collected:
└─ All warnings aggregated and returned
```

### 4.3 图像预处理流程

```
Image Input
  │
  ├─ IF imagePreprocess === true
  │  │
  │  ├─→ getImagePreprocessAdapter()
  │  │
  │  ├─→ IF crop specified
  │  │   └─ crop(image, x, y, w, h)
  │  │
  │  └─→ IF resizeTo specified
  │      └─ resize(image, width, height)
  │
  ├─ IF mlSegment === true
  │  │
  │  ├─→ getMlSegmentAdapter({mlSegment: true})
  │  │
  │  ├─→ executeRestorationPipeline({image, mlSegmentAdapter, ...})
  │  │    ├─ ML-based segmentation
  │  │    ├─ Quality assessment
  │  │    ├─ Style consistency check
  │  │    └─ Return {image, mlSegments[], warnings[]}
  │  │
  │  └─ Collect: maskQuality, styleConsistency, artifactScore
  │
  └─ Return {image, warnings[]}
```

---

## 🎯 第五部分：完整漏洞候选清单

### 🔴 高风险漏洞 (Critical)

#### 漏洞 #1：selectVisionProxyModel 中的模型判断逻辑

**文件**：src/visionProxy.ts, line 397-401

**代码**：
```typescript
function isUsableVisionModel(model: vscode.LanguageModelChat, selfIds: Set<string>): boolean {
  const capabilities = (model as unknown as { capabilities?: { imageInput?: boolean } }).capabilities;
  return !selfIds.has(model.id) && Boolean(capabilities?.imageInput);
}
```

**风险分析**：
- ✅ **类型转换安全**：使用 `as unknown as {...}` 进行类型转换（标准模式）
- ✅ **selfIds 检查**：正确防止自引用
- ✅ **imageInput 检查**：使用 `Boolean()` 进行安全的真值转换
- ✅ **降级处理**：Priority 2 失败会尝试 Priority 3/4

**结论**：✅ 无漏洞，实现正确

---

#### 漏洞 #2：缓存键生成的稳定性

**文件**：src/visionProxy.ts, line 454-472

**代码**：
```typescript
function buildVisionProxyCacheKey(
  imageParts: readonly vscode.LanguageModelDataPart[],
  prompt: string,
  proxyModelId: string
): string {
  const digest = createHash("sha256");
  digest.update(proxyModelId);
  digest.update("\n");
  digest.update(prompt);
  for (const part of imageParts) {
    digest.update("\n");
    digest.update(part.mimeType);
    digest.update("\n");
    const bytes = toUint8Array(part.data);
    if (!bytes) continue;
    digest.update(Buffer.from(bytes));
  }
  return digest.digest("hex");
}
```

**风险分析**：
- ✅ **顺序稳定性**：使用循环遍历 imageParts，顺序由消息 parts 数组决定
- ✅ **完整性**：包含 proxyModelId, prompt, 和所有图像字节
- ⚠️ **风险**：imageParts 的顺序必须一致
  - **当前保证**：在同一消息对象中，parts 的顺序是固定的
  - **潜在问题**：如果某个处理阶段改变了 parts 的顺序，会导致键不同
  - **验证**：需要检查是否有任何地方对 imageParts 进行了排序或重新组织

**当前状况**：✅ **已验证**（见 /memories/repo/vision-proxy-repeat-in-tool-loop-2026-05-11.md）

---

#### 漏洞 #3：evaluateRoiGateForMessages() 的超时

**文件**：src/provider.ts, line 200-210

**代码片段**：
```typescript
const initialRoiGate = await evaluateRoiGateForMessages({
  messages: resolvedMessages,
  certaintyThreshold: settings.visionIntegrity.certaintyThreshold,
  analyzer
});
if (initialRoiGate.blocked) {
  const fallback = buildFallbackPlan(
    initialRoiGate.reason ?? "ROI confidence gate blocked...",
    detectionMessages
  );
  progress.report(new vscode.LanguageModelTextPart(String(fallback.content ?? "")));
  return;
}
```

**风险分析**：
- ⚠️ **无超时保护**：`await evaluateRoiGateForMessages()` 无显式超时
- ⚠️ **可能无限等待**：如果 roiRuntimeGuard.ts 中的分析器卡住，会阻塞整个请求
- ✅ **有降级**：返回 fallback plan 而不是崩溃

**建议修复**：
```typescript
const initialRoiGate = await Promise.race([
  evaluateRoiGateForMessages({...}),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error("ROI gate timeout")), 5000)
  )
]).catch(err => ({
  blocked: false,  // 降级：超时时不阻断
  reason: "ROI gate timeout, continuing without gate"
}));
```

---

### 🟡 中等风险漏洞 (Medium)

#### 漏洞 #4：缓存溢出时的替换策略

**文件**：src/visionProxy.ts, line 478-485

**代码**：
```typescript
function setVisionProxyCachedDescription(cacheKey: string, description: string): void {
  visionProxyDescriptionCache.set(cacheKey, description);
  if (visionProxyDescriptionCache.size <= VISION_PROXY_CACHE_LIMIT) {
    return;
  }
  const oldestKey = visionProxyDescriptionCache.keys().next().value;
  if (typeof oldestKey === "string") {
    visionProxyDescriptionCache.delete(oldestKey);
  }
}
```

**风险分析**：
- 🟡 **FIFO 驱逐**：当达到 128 条上限时，删除最老的条目
- 🟡 **重复调用风险**：同时处理 150 张不同的图像时：
  - 前 128 张：缓存命中率 = 0%（都是新的）
  - 第 129-150 张：缓存命中率 = 0%（前 22 张被驱逐）
  - 后续请求相同的图像：缓存命中率 = 0%（已被驱逐）
- ✅ **可接受**：这是 memory vs API calls 的 trade-off

**监控指标**：
```
vision.proxy.cache.hit 的频率
期望：工具循环中 hit 率 > 95%
告警：连续 5 轮都是 miss → 可能有问题
```

---

#### 漏洞 #5：needVisionDetector 的正则表达式覆盖范围

**文件**：src/toolCooperation/needVisionDetector.ts, line 26-28

**代码**：
```typescript
function containsImageReference(text: string): boolean {
  return /(data:image\/|https?:\/\/\S+\.(png|jpe?g|gif|webp|bmp|svg)|file:\/\/\/[^\s"'<>]+\.(png|jpe?g|gif|webp|bmp|svg)|[A-Za-z]:[\\/][^\s"'<>]+\.(png|jpe?g|gif|webp|bmp|svg)|(?:\.\.?[\\/])?[^\s"'<>]+\.(png|jpe?g|gif|webp|bmp|svg))/i.test(text);
}
```

**风险分析**：
- ✅ **PNG**: `.png` ✓
- ✅ **JPG/JPEG**: `.jpe?g` ✓
- ✅ **GIF**: `.gif` ✓
- ✅ **WebP**: `.webp` ✓
- ✅ **BMP**: `.bmp` ✓
- ✅ **SVG**: `.svg` ✓
- 🟡 **遗漏 HEIC, TIFF, AVIF** 等新格式

**建议**：定期更新正则表达式以支持新的图像格式

---

### ✅ 低风险漏洞 (Low)

#### 漏洞 #6：非视觉模型的残留图像防护

**文件**：src/provider.ts, line 327-340

**代码**：
```typescript
const residualImages = countImagePartsInMessages(resolvedMessages);
if (!model.vision && residualImages > 0) {
  this.logger.error("vision.guard.residual-images", {
    model: model.id,
    ...trace,
    residualImagePartCount: residualImages,
    strategy: strategySelection?.strategy ?? "unknown"
  });
  progress.report(new vscode.LanguageModelTextPart("[Vision] safety guard activated: stripped residual raw image payload from a non-vision model request.\n"));
  resolvedMessages = stripImagePartsFromMessages(
    resolvedMessages,
    "[Image omitted by safety guard: raw image payload was blocked for a non-vision model.]"
  );
}
```

**风险分析**：
- ✅ **全面防护**：在所有识图路由后的最后防线
- ✅ **清晰的日志**：ERROR 级别日志便于审计
- ✅ **用户通知**：progress.report 告知用户
- ✅ **完整的剥离**：stripImagePartsFromMessages 确保没有图像数据

**结论**：✅ 无漏洞，防护完整

---

#### 漏洞 #7：Integrity 校验的阻断分支

**文件**：src/providerVisionPipeline.ts, line 101-110

**代码**：
```typescript
const summary = `[Vision] preprocessed=${processedCount} integrity_pass=${integrityPassCount} integrity_fail=${integrityFailCount} fallback_to_original=${fallbackToOriginalCount} warnings=${warningsCount}`;
if (settings.visionIntegrity.strictIntegrity && integrityFailCount > 0) {
  return {
    messages,
    summary,
    blocked: true,
    blockReason: `Vision integrity strict mode blocked downstream processing (integrity_fail_count=${integrityFailCount}).`
  };
}
```

**风险分析**：
- ✅ **明确的条件**：`strictIntegrity && integrityFailCount > 0`
- ✅ **返回原始消息**：不修改 messages
- ✅ **详细的日志**：summary 包含所有统计数据
- ✅ **可配置的行为**：strictIntegrity 可由用户配置

**结论**：✅ 无漏洞，实现正确

---

#### 漏洞 #8：配置禁用的完整降级链

**场景 1**：visionAgent.enabled = false

```
selectCompatibilityMatrixStrategy(visionNeeded=true)
  → matrixKey = "bro|non-vision|tools-available|agent-off"
  → COMPATIBILITY_MATRIX[key] = {strategy: "text-fallback"}
  → provider.ts case "text-fallback"
  → buildTextFallback() → return early
```

✅ **完整性检查**：无漏洞

**场景 2**：visionProxy.enabled = false

```
selectVisionProxyModel()
  → configured = undefined
  → shouldProxy = undefined !== null && (false || false) = false
  → logger.debug("vision.proxy.disabled")
  → return undefined
  → proxyResolution.status = "unavailable"
  → apply fallbackStrategy
```

✅ **完整性检查**：无漏洞

**场景 3**：visionIntegrity.strictIntegrity = true + fail

```
applyVisionProcessingAndIntegrityPipeline()
  → integrityFailCount > 0
  → return {blocked: true}
  → provider.ts if (preprocessed.blocked)
  → buildFallbackPlan() → return early
```

✅ **完整性检查**：无漏洞

---

## 📋 第六部分：执行栈验证检查清单

### 需求判定阶段
- [ ] needsVision 的三个条件是否都被正确评估？
- [ ] needVisionGate 配置为 false 时是否正确跳过识图？
- [ ] hasImages 检查是否覆盖所有图像格式？

### 路由选择阶段
- [ ] selectTool() 是否正确选择了策略？
- [ ] 兼容矩阵的 16 个条目是否都被正确定义？
- [ ] fallbackStrategy 是否在主策略不可用时正确应用？

### 代理执行阶段
- [ ] selectVisionProxyModel 的 4 层优先级是否完整？
- [ ] 缓存键生成是否稳定（同一图像总是产生相同的键）？
- [ ] FIFO 驱逐是否在达到 128 条时正确执行？

### 结果一致性阶段
- [ ] Integrity 校验的 5 个检查点是否都被触发？
- [ ] Strict mode 时 blocked 分支是否真的返回了 early？
- [ ] 非严格模式时是否正确回退到原始图像？

### 防护阶段
- [ ] Vision Guard 是否能捕获所有类型的 ImagePart？
- [ ] ROI Gate 是否在 proxy 前后都被触发？
- [ ] 残留图像日志是否以 ERROR 级别记录？

### 降级阶段
- [ ] text-fallback, plan-only, disabled 这 3 条路径是否都能正确执行？
- [ ] 降级时是否真的不发送请求到主模型？
- [ ] 用户是否能清楚地看到降级原因？

### 工具循环阶段
- [ ] 工具循环中缓存命中率是否达到预期（> 95%）？
- [ ] 同一图像在不同轮中是否复用同一描述？
- [ ] 是否有日志能证明缓存的有效性？

### 最终安全检查
- [ ] 非视觉模型的请求中是否真的没有 image_url part？
- [ ] 是否所有图像都被处理或被明确替换为文本？
- [ ] 是否有任何代码路径能绕过 Vision Guard？

---

## 🎯 第七部分：执行风险矩阵

| # | 漏洞场景 | 当前状态 | 风险等级 | 影响范围 | 建议行动 |
|---|---------|--------|--------|--------|--------|
| 1 | Proxy 模型选择逻辑 | ✅ 正确实现 | 低 | selectVisionProxyModel | 定期审计 |
| 2 | 缓存键稳定性 | ✅ 已验证 | 低 | resolveVisionProxyMessages | 监控命中率 |
| 3 | ROI Gate 超时 | ⚠️ 无超时 | 中 | evaluateRoiGateForMessages | 添加 5s 超时 |
| 4 | 缓存溢出驱逐 | ✅ FIFO | 中 | visionProxy 缓存 | 监控驱逐频率 |
| 5 | 图像格式覆盖 | 🟡 遗漏新格式 | 低 | needVisionDetector | 定期更新正则 |
| 6 | 残留图像防护 | ✅ Guard 完整 | 极低 | vision.guard | 监控错误日志 |
| 7 | Integrity 阻断 | ✅ 正确 | 低 | visionPipeline | 可配置 |
| 8 | 配置禁用降级 | ✅ 完整链路 | 极低 | 全路由 | 定期测试 |
| 9 | 工具循环重复 | ✅ 缓存保护 | 低 | proxy 循环 | 监控 miss 频率 |
| 10 | 双门控 ROI | ✅ Pre & Post | 低 | ROI 管道 | 监控阻断率 |

---

## 💡 结论与建议

### 整体评估

✅ **高度安全**：识图系统的执行栈设计完整，多层防护到位

**核心优势**：
1. **三层 Integrity 验证**：输入、处理、输出都有检查
2. **缓存一致性**：工具循环中 API 调用最小化
3. **多路由降级**：任何阶段失败都有清晰的回退
4. **Vision Guard**：最后防线捕获任何残留图像
5. **双 ROI 门控**：处理前后都验证置信度

### 立即行动项

🔴 **高优先级**（1-2 周内）：
- 为 `evaluateRoiGateForMessages()` 添加 5 秒超时保护
- 验证 imageParts 的顺序在所有处理阶段是否保持一致

🟡 **中优先级**（1 个月内）：
- 建立工具循环缓存命中率的监控告警（目标 > 95%）
- 扩展 containsImageReference() 正则以支持 HEIC, AVIF, TIFF
- 添加缓存驱逐频率的监控日志

✅ **长期维护**：
- 定期审计 Vision Guard 的日志，确保无漏网之鱼
- 监控 vision.pipeline.processed 日志中的 integrity_fail_count 趋势

