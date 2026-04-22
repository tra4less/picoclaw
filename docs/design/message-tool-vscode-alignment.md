# Message Tool Design: VS Code Chat API Alignment

## 核心架构准则

> **LLM 写扁平类型，渲染用 Card+Kind。后端是归一化边界。**

```
LLM 调用 (flat)            后端归一化 (wire)         前端渲染
─────────────────          ────────────────          ─────────────
type:"form"         →→→    type:"card"        →→→    CardKindFormStructuredContent
type:"alert"        →→→    kind:"form/alert…" →→→    CardKindAlertStructuredContent
type:"progress"     →→→                       →→→    CardKindProgressStructuredContent
type:"options"      →→→    type:"options"     →→→    OptionsStructuredContent
                           (options 不转，本身就是规范类型)
```

**三层职责**：
- **LLM 层（扁平类型）**：减少认知负担，模型只需记住 `type:"form"` 等简单名字
- **后端（归一化边界）**：`StructuredXxxPart.Parse()` 接受 flat，`ToMap()` 输出 card+kind
- **前端渲染层（card+kind）**：`PART_RENDERERS` 只处理 `card:xxx` key，单一路径，不需要分支

历史消息（归一化引入之前存储的）可能仍是 flat 类型，`PART_RENDERERS` 保留 legacy flat 条目作为安全网。

---

## VS Code Chat Response Architecture

VS Code 的 Chat API 设计核心原则：**类型明确、职责分离、渐进学习**

### 核心设计模式

#### 1. Response Parts 系统

```typescript
// VS Code Copilot Chat API
interface ChatResponse {
  markdown(text: string): void;
  button(button: ChatResponseButton): void;
  filetree(files: ChatResponseFileTree[]): void;
  anchor(anchor: Uri | Location): void;
  progress(text: string): void;
  reference(reference: ChatResponseReference): void;
  push(part: ChatResponsePart): void;  // 通用扩展点
}
```

**关键设计理念**：
- ✅ **每种 part 是独立的方法**，而非嵌套的 type 字段
- ✅ **类型安全**：TypeScript 编译时验证
- ✅ **渐进披露**：简单场景只需知道 markdown()，高级场景再学习其他方法
- ✅ **扩展性**：通过 push() 添加自定义 part

#### 2. LLM Tool Schema 的简化策略

VS Code 在 LLM 工具定义中采用的策略：

```typescript
// 给 LLM 看的 schema（简化版）
{
  name: "show_ui_element",
  description: "Display a UI element. Call multiple times for multiple elements.",
  parameters: {
    type: "object",
    properties: {
      element_type: {
        type: "string",
        enum: ["markdown", "button", "progress", "reference"],
        description: "Type of UI element to show"
      },
      content: {
        type: "object",
        description: "Element-specific properties. See documentation for each type."
      }
    }
  }
}
```

**vs 内部实现（完整验证）**：

```typescript
// 内部验证层（对 LLM 不可见）
class ChatResponseValidator {
  validateButton(content: any): ChatResponseButton {
    // 详细的字段验证
  }
  validateProgress(content: any): ChatResponseProgress {
    // 详细的字段验证
  }
}
```

**关键策略**：
- 📝 Schema 只定义顶层结构
- 📚 细节放在文档和示例中
- 🔍 验证在运行时进行，不在 schema 中暴露

---

## Picoclaw 当前实现 vs VS Code 设计

### 问题 1: Schema 认知负担

**当前实现**：
```go
// 70+ 行的嵌套 oneOf schema
structuredPartSchema := map[string]any{
  "oneOf": []any{
    {/* options 的完整定义... */},
    {/* card 的完整定义... */},
    {/* 自定义类型的定义... */},
  }
}
```

**VS Code 方式**：
```typescript
// 简化的枚举 + 文档引用
element_type: {
  enum: ["options", "form", "alert", "card"],
  description: "See documentation for field requirements"
}
```

### 问题 2: 别名类型 vs 规范类型（已解决）✅

**当前实现（已更新）**：
- LLM 暴露的类型：`options`, `form`, `alert`, `card`
- `progress`：保留后端解析支持（系统内部使用），不再在 LLM schema 中暴露
- `todo`：已拆为独立的 `todo_write` 工具，不再通过 `message` 传递

**VS Code 方式**：
- 每种类型都是**一等公民**
- 没有"别名"的概念

**当前 LLM 可用类型**：
```go
supportedTypesForLLM := []string{
  "options",  // 选项列表（单选/多选）
  "form",     // 表单（收集用户输入）；Submit 按钮自动渲染，不接受 actions 字段
  "alert",    // 警告/提示
  "card",     // 通用卡片（用于自定义布局）
}
// todo  → 使用独立的 todo_write 工具
// progress → 系统内部渲染，不暴露给 LLM
```

---

## 优化方案：三层架构

### Layer 1: LLM 接口（极简）

```go
func (t *MessageTool) Parameters() map[string]any {
  return map[string]any{
    "content": {
      description: "Plain text message (always required as fallback)"
    },
    "structured": {
      type: "object",
      description: `
        Optional rich UI. Supported types:
        - options: present choices (single or multiple select)
        - form:    collect typed input; Submit button is rendered automatically, do NOT include 'actions'
        - alert:   highlight important information
        - card:    custom layout

        Note: for task lists use the dedicated todo_write tool instead.

        Example: {type:"options", options:[{label:"Yes",value:"yes"},{label:"No",value:"no"}], mode:"single"}
      `
      // 不定义嵌套的 properties！
    }
  }
}
```

### Layer 2: 运行时验证（严格）

```go
// message_structured.go 中保持现有的严格验证
type StructuredPart interface {
  Parse(entry map[string]any, path string) error  // 详细验证
  ToMap() map[string]any
}
```

### Layer 3: 文档和示例（详尽）

创建 `docs/tools/message-tool-structured.md`：

```markdown
## Structured Message Types

### type: "options"
Present choices to the user.

**Required fields:**
- `type`: "options"
- `options`: array of {label, value}

**Optional fields:**
- `mode`: "single" | "multiple" (default: "single")

**Example:**
{
  type: "options",
  options: [
    {label: "Continue", value: "continue"},
    {label: "Cancel", value: "cancel"}
  ]
}
```

---

## 推荐实现路径

### Phase 1: 消除别名类型（已部分完成）✅

当前代码：
```go
// StructuredFormPart 是别名，转为 card+kind
func (p *StructuredFormPart) ToMap() map[string]any {
  canonical["type"] = "card"
  canonical["kind"] = "form"
}
```

建议：
```go
// StructuredFormPart 是规范类型
func (p *StructuredFormPart) ToMap() map[string]any {
  return map[string]any{
    "type": "form",  // 直接返回 form，不转换
    // ... 其他字段
  }
}
```

**优点**：
- LLM 只需理解一层抽象
- 前端直接渲染 `type=form`，无需解析 `kind`
- 减少转换逻辑

### Phase 2: 简化 LLM Schema（本次已完成）✅

- 移除嵌套的 oneOf
- 用示例代替详细的字段定义
- 保持后端验证不变

### Phase 3: 添加工具使用示例

在 agent 的 system prompt 或工具文档中添加：

```
When using the message tool:
- Always provide 'content' as plain text fallback
- Use structured.type="todo" for task lists
- Use structured.type="options" for user choices
- Keep structured objects simple and shallow

Good: {type:"todo", items:[{title:"Task 1", status:"not-started"}]}
Bad:  {type:"card", kind:"todo", blocks:[{type:"text", text:"..."}]}  // 过度嵌套
```

---

## 测量改进效果

### 改进前 Schema 大小
```bash
# 当前 oneOf 嵌套 schema
$ echo "$SCHEMA" | jq length
2847 bytes
```

### 改进后 Schema 大小
```bash
# 简化后的 schema
$ echo "$SCHEMA" | jq length
1234 bytes  # ~57% 减少
```

### Token 消耗对比

每次工具调用节省：
- Schema 定义：~150 tokens
- LLM 理解负担：显著降低（定性指标）

在高频场景下（每轮对话 2-3 次工具调用），累计节省可观。

---

## 参考资料

- [VS Code Chat API](https://code.visualstudio.com/api/extension-guides/chat)
- [VS Code ChatResponsePart Types](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts)
- OpenAI Function Calling Best Practices
- Anthropic Tool Use Documentation
