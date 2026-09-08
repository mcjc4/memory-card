# Trae 部署指引 — 错题整理专家 Skill

把本目录（`trae-wrongbook-pack/`）部署到 Trae IDE，让 Trae 在整理错题时也按「双版本强制」SOP 输出。

## 步骤 1：把 Skill 放到 Trae 项目里

Trae 的 Skill 加载规则（与 Claude/Cursor 风格类似）：

```
<项目根>/
└── .trae/
    └── skills/
        └── wrong-book-organizer/
            ├── SKILL.md       ← 本包已包含
            └── wrongbook.py   ← 本包已包含（脚本）
```

**两种用法**：

### 用法 A：把整个包复制到 Trae 项目根目录

```bash
# 把本目录 .trae/skills/wrong-book-organizer/ 复制到你的 Trae 项目根目录
cp -r trae-wrongbook-pack/.trae <your-trae-project>/

# 同时把 wrongbook.py 也复制到项目根（或任何 PYTHONPATH 可达的路径）
cp trae-wrongbook-pack/wrongbook.py <your-trae-project>/
```

最终结构：
```
<your-trae-project>/
├── .trae/
│   └── skills/
│       └── wrong-book-organizer/
│           └── SKILL.md
├── wrongbook.py
└── ...你的项目文件
```

### 用法 B：全局 Skill（所有 Trae 项目生效）

如果你用的是 Trae 全局 skill 目录（不同版本路径不同），把 SKILL.md 放到：
- **Cursor 风格**：`~/.trae/skills/wrong-book-organizer/SKILL.md`
- **Claude 风格**：`~/.config/trae/skills/wrong-book-organizer/SKILL.md`
- **Trae 内置面板**：打开 Trae → 「自定义 Skills」面板 → 粘贴 SKILL.md 内容

具体路径以你装的 Trae 版本为准。

## 步骤 2：安装 Python 依赖

```bash
pip install openpyxl
```

或：
```bash
python -m pip install openpyxl
```

## 步骤 3：在 Trae 中启用 Skill

1. 打开 Trae IDE
2. 进入你放了 Skill 的项目
3. **重启 IDE 或 Reload Skills**（不同版本操作不同）
4. 在对话窗口输入「整理错题」/「生成记忆卡」等触发词，Trae 应自动加载本 Skill

## 步骤 4：测试

在 Trae 对话中说：

> 帮我把这 5 道错题整理成记忆卡：
> 题1：质点做匀加速运动，v0=0, a=2m/s²，求第 3 秒末速度。
> ...

观察 Trae 是否：
1. ✅ 自动加载 `wrong-book-organizer` Skill
2. ✅ 提炼为「看到 X → 想到 Y；警惕 Z」格式
3. ✅ 调用 `wrongbook.py build cards.json ./output DeepSeek`
4. ✅ 同时生成两个 xlsx 文件（不是只生成一个）
5. ✅ 文件名含模型名（如 `错题本1题_记忆卡_物理_DeepSeek_纯文本版.xlsx`）

## 步骤 5：跨模型横评

把 `wrongbook.py` 也准备好，让其他模型（Kimi-K3、GPT-4 等）也用同一脚本生成 xlsx，最后用文件名后缀区分：

```
output/
├── 错题本5题_记忆卡_物理_DeepSeek_纯文本版.xlsx
├── 错题本5题_记忆卡_物理_DeepSeek_导入版_LaTeX公式.xlsx
├── 错题本5题_记忆卡_物理_Kimi-K3_纯文本版.xlsx
├── 错题本5题_记忆卡_物理_Kimi-K3_导入版_LaTeX公式.xlsx
├── 错题本5题_记忆卡_物理_GPT-4_纯文本版.xlsx
└── 错题本5题_记忆卡_物理_GPT-4_导入版_LaTeX公式.xlsx
```

## 验证脚本独立性

跑一遍确认 `wrongbook.py` 离线能跑：

```bash
# 1. 打印模板
python wrongbook.py template

# 2. 复制模板内容到 test.json

# 3. 构建
python wrongbook.py build test.json ./test_output DeepSeek

# 4. 检查两个文件都已生成
ls -la ./test_output/

# 应该看到：
# 错题本<题数>题_记忆卡_<科目>_DeepSeek_纯文本版.xlsx
# 错题本<题数>题_记忆卡_<科目>_DeepSeek_导入版_LaTeX公式.xlsx
```

## 故障排查

| 问题 | 原因 | 解决 |
|:--|:--|:--|
| Trae 没加载 Skill | SKILL.md 不在 `.trae/skills/` 目录 | 检查路径，重启 IDE |
| `ModuleNotFoundError: openpyxl` | 未安装依赖 | `pip install openpyxl` |
| 只生成一个文件 | Trae 跳过了脚本直接用 openpyxl | 检查 Skill 是否被加载、强调「必须调用 wrongbook.py」 |
| 文件名没模型名 | Trae 漏传了 model_name | 显式传：`build cards.json ./output DeepSeek` |
| 中文显示乱码 | 编码问题 | 确保 JSON 文件是 UTF-8、Excel 默认 utf-8 |
| `\$` 残留 | LaTeX 没被识别 | 确认公式确实用 `$...$` 包了 |

## 推送到 GitHub

如果你想把 Skill 也推到 GitHub `mcjc4/memory-card` 仓库：

```bash
cd <your-trae-project>
git add .trae/skills/wrong-book-organizer/ wrongbook.py SOP.md INSTALL.md
git commit -m "feat: 错题整理 Skill + 双版本生成脚本"
git push origin main
```

---

## 附：本包文件清单

```
trae-wrongbook-pack/
├── .trae/
│   └── skills/
│       └── wrong-book-organizer/
│           └── SKILL.md          # Trae Skill 定义（含 YAML frontmatter）
├── wrongbook.py                  # 双版本 xlsx 生成脚本（核心）
├── SOP.md                        # 完整 SOP 文档（外发版，给其他 AI agent）
├── INSTALL.md                    # 本文档：Trae 部署指引
└── README.md                     # 本包总览
```
