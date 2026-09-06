# 错题整理专家 — Trae Skill Pack

把 WorkBuddy「错题整理专家」SOP 移植到 Trae IDE 的完整包。

## 包含

| 文件 | 用途 |
|:--|:--|
| `.trae/skills/wrong-book-organizer/SKILL.md` | Trae Skill 定义（YAML frontmatter + 5 Phase SOP + 硬约束） |
| `wrongbook.py` | 双版本 xlsx 生成脚本（强制保证两份输出，缺一不可） |
| `SOP.md` | 完整 SOP 文档（外发版，可单独发给其他 AI agent 复刻） |
| `INSTALL.md` | Trae IDE 部署指引（含故障排查） |

## 一句话总结

> 错题 → 信号→结论 → cards.json → `wrongbook.py build` → 同时输出两份 xlsx（纯文本版 + LaTeX 公式版）

## 30 秒上手

```bash
# 1. 复制 Skill 到 Trae 项目
cp -r .trae/skills/wrong-book-organizer/ <your-project>/.trae/skills/
cp wrongbook.py <your-project>/

# 2. 安装依赖
pip install openpyxl

# 3. 在 Trae 对话中：「帮我把这 5 道错题整理为记忆卡」
#    Trae 自动加载 Skill → 调用 wrongbook.py → 输出双版本 xlsx
```

## 核心硬约束

**每次必须同时生成两个 xlsx**：
- `<name>_纯文本版.xlsx`（Unicode：`v²`、`√2`、`α`）
- `<name>_导入版_LaTeX公式.xlsx`（`$...$`：`$v^2$`、`$\sqrt{2}$`）

脚本 `wrongbook.py:build_both()` 内置 3 道断言：
```python
assert plain_path.exists()
assert latex_path.exists()
assert plain_path.stat().st_size > 1000
```

**任何 LLM 都不能跳过脚本**——这是物理保证。

## 跨模型横评

文件名含模型名，归档零摩擦：
```
错题本5题_记忆卡_物理_DeepSeek_纯文本版.xlsx
错题本5题_记忆卡_物理_Kimi-K3_导入版_LaTeX公式.xlsx
错题本5题_记忆卡_物理_GPT-4_纯文本版.xlsx
...
```

## 详细说明

- **Trae 部署**：见 `INSTALL.md`
- **完整 SOP**：见 `SOP.md`
- **Skill 内部规范**：见 `.trae/skills/wrong-book-organizer/SKILL.md`

---

由小宇（错题整理专家）生成，2026-09-06。
