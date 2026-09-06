---
name: "wrong-book-organizer"
user-invocable: true
description: "把零散错题整理为「信号→结论」记忆卡，自动产出双版本 xlsx（纯文本版 + LaTeX 版，缺一不可）。适用：错题本 Excel/截图/链接、组卷网题目（zujuan.xkw.com）、课堂纪要（docx/txt）、单题手动输入。触发词：整理错题、生成记忆卡、错题本、错题整理、错题卡、信号→结论、提炼错题、错题记忆卡、错题 Excel、错题 xlsx、组卷网、zujuan.xkw.com、物理/数学/化学/英语/语文/高考 错题。"
---

# 错题整理专家（双版本记忆卡）

## 🚨 核心硬约束（违反任一条视为任务失败）

1. **每次必须同时生成两个文件**：
   - `<name>_纯文本版.xlsx`（公式用 Unicode：`v²`、`√2`、`α`）
   - `<name>_导入版_LaTeX公式.xlsx`（公式用 `$...$`：`$v^2$`、`$\sqrt{2}$`）
2. **物理上不可能只出一个**：调用同目录下的 `wrongbook.py` 中的 `build_both()`，函数会强制断言两个文件都生成且 > 1KB。
3. **命名必须含模型名**：`<base>_<model>.xlsx`，便于跨模型横评归档（如 `DeepSeek` / `Kimi-K3` / `GPT-4`）。
4. **不依赖官方答案解析**：自行推导答案；公式为图无法确认数字时用题型通法呈现并标注「公式见图」，**禁止编造数字**。

## Trae 对话框中的触发方式

**自动触发**（推荐）：在 Trae 对话中直接说「帮我整理这 5 道错题」「生成记忆卡」等包含关键词的话，Trae 会自动加载本 Skill。

**手动触发**：在 Trae 对话框输入框中输入：

```
@wrong-book-organizer 帮我整理这 5 道错题
```

或（如果 Trae 支持斜杠命令）：

```
/wrong-book-organizer
```

触发成功后 Trae 会显示 Skill 已加载的提示，此时按下方 Phase 1-5 执行即可。

## 工作流程（5 个 Phase）

### Phase 1 — 题目获取
- 错题本 Excel / 文本 / 截图 → 提取「题目 + 详情链接」清单
- 组卷网链接形如 `https://zujuan.xkw.com/<ID>q<数字>.html`
- 若用户只发截图，用 Read 工具读图，OCR 出题干与选项

### Phase 2 — 答案推导
- 自行分析计算，写入每条结论的「本题答案」部分
- 公式图片无法确认数字时用通法呈现，不编造

### Phase 3 — 记忆卡提炼（信号→结论）
**7 列结构**：

| 列 | 字段 | 填写规则 |
|:--:|:--|:--|
| A | 科目 | 物理/化学/英语/政治/数学/语文 |
| B | 章节知识点 | 如「运动学·连接体」 |
| C | 原题题干 | 「题N（来源）：…」 |
| D | 题干信号 | 「看到【X字眼/描述】」 |
| E | 结论/易错点 | 「想到【Y方法/模式】；警惕【Z误区】」 |
| F | 出处 | 试卷/教材/年份 |
| G | 题目链接 | 详情页 URL（如有） |

**一行 = 一条独立信号**：每题拆 2-4 条卡片，**同题多行共用 A/B/F/G 四列**。

**结论必须通用化**（三步）：
1. 剥离具体数字与对象
2. 提取题型结构与方法名（分离参数 / 同构 / 错位相减 / 凑角 / 设 $x=my-c$...）
3. 模式化表达：「看到 X → 想到 Y；警惕 Z」

**自检**：把结论里的具体数字遮掉仍成立 → 达标；残留本题数字 →「就题论题」，必须重写。

### Phase 4 — 调用脚本生成双版本 xlsx（绝对不能跳过！）

**【这是核心步骤，物理保证双版本】**

```bash
# 方式 A：CLI（推荐）
python wrongbook.py template                 # 打印空 JSON 模板
python wrongbook.py build cards.json ./output DeepSeek
```

```python
# 方式 B：作为 Python 模块
from wrongbook import build_both
from pathlib import Path

cards = [...]  # list of dicts with 7 fields: subject/chapter/question/signal/conclusion/source/link
result = build_both(
    cards,
    Path('./output/错题本5题_记忆卡_物理_DeepSeek'),
    model_name='DeepSeek',
)
# 自动断言两个文件都已生成：
# - result['plain']  →  错题本5题_记忆卡_物理_DeepSeek_纯文本版.xlsx
# - result['latex']  →  错题本5题_记忆卡_物理_DeepSeek_导入版_LaTeX公式.xlsx
```

**脚本位置**：与本 SKILL.md 同目录的 `wrongbook.py`（已包含，无需额外下载）。

### Phase 5 — 校验交付
- ✅ 行数 = 信号卡条数（不含表头）
- ✅ 抽查 2-3 行，确认「看到 X → 想到 Y；警惕 Z」格式
- ✅ 链接列完整、同题多行共用链接
- ✅ 两个文件都已生成、都能用 openpyxl 打开
- ✅ 报告：题数 / 信号卡条数 / 每题答案

## 输入输出契约

### 输入（cards.json）
```json
[
  {
    "subject": "物理",
    "chapter": "运动学·连接体",
    "question": "题1（2013·新课标I）：...",
    "signal": "看到【连接体上的标记点，且题设\"伸长均匀\"】",
    "conclusion": "想到【标记点始终按原长比例分割两端点连线，可用相似三角形建立几何约束】；警惕【把\"伸长均匀\"误解为长度不变】",
    "source": "2013·新课标I",
    "link": "https://zujuan.xkw.com/13q1685290.html"
  }
]
```

### 输出
```
<out_dir>/
├── 错题本N题_记忆卡_<科目>_<模型名>_纯文本版.xlsx
└── 错题本N题_记忆卡_<科目>_<模型名>_导入版_LaTeX公式.xlsx
```

### 两版本差异（仅在公式形态）
| 字段 | 纯文本版 | LaTeX 版 |
|:--|:--|:--|
| `v²` | `v²` (Unicode) | `$v^2$` (KaTeX) |
| `√2` | `√2` | `$\sqrt{2}$` |
| `α` | `α` | `$\alpha$` |
| `Δx=aT²` | `Δx=aT²` | `$\Delta x=aT^2$` |

## 失败模式（必须避免）

| 失败模式 | 后果 | 正确做法 |
|:--|:--|:--|
| 只生成 LaTeX 版 | 用户拿不到纯文本版 | 必须 `build_both()` |
| 只生成纯文本版 | 导入应用时公式不渲染 | 必须 `build_both()` |
| 文件名不带模型名 | 横评时无法归类 | `<base>_<model>.xlsx` |
| 跳过 `wrongbook.py` 直接写 openpyxl | 失去双版本强制保证 | 必须用 `build_both()` |
| 答案写「略」「见解析」 | 信号卡没有可迁移价值 | 写公式推导结果或题型通法 |
| 就题论题（结论含本题具体数字） | 无法迁移到同类题 | 通用化三步 |

## 与配套技能的关系

- **`memory-card-generator`**：处理单道题 → 提炼为信号→结论（本次任务的 Phase 1-3 部分）
- **`wrong-book-organizer`**（本 Skill）：补充双版本 xlsx 物理保证（Phase 4 强制脚本）

两者可配合使用：本 Skill 自动调用 `wrongbook.py` 完成最终输出。

## 预装要求

```bash
pip install openpyxl
```

或：
```bash
python -m pip install openpyxl
```

## 触发词（用于 Trae 自动识别）

- 「整理错题」「错题整理」「错题本」
- 「生成记忆卡」「记忆卡」「错题卡」
- 「题目整理成记忆卡」「错题→记忆卡」
- 「信号→结论」「提炼错题」
- 「组卷网」「zujuan.xkw.com」「错题 xlsx」
- 「物理/数学/化学/英语/语文/高考 错题」
- 「课堂错题」「错题 Excel」「错题 Excel 整理」