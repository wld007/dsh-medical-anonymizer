# 匿名化架构对比评测

在一份带标注的合成病历语料上，比较「规则」「单模型」与插件的三层架构（识别模型 + 规则替换 + 核验模型）。

```bash
node eval/bench/gen.mjs eval/bench/.work                    # 生成语料与标注（固定种子）
node eval/bench/run.mjs eval/bench/.work rules model rules+model full full-same
node eval/bench/score.mjs eval/bench/.work rules model rules+model full full-same
```

模型端点用环境变量 `DETECT_URL` / `DETECT_MODEL` / `VERIFY_URL` / `VERIFY_MODEL` 指定，默认是本机配置的 qwen3.6-35b-a3b 和 gemma-4-26b-a4b-it。配置名后加 `@2`（如 `full@2`）表示重复跑一次，结果另存。

| 配置 | 含义 |
|---|---|
| `rules` | 只用规则（不配模型时插件的行为） |
| `model` | 只用识别模型：分块调用识别提示词，按原文片段全文替换，不经规则和核验 |
| `rules+model` | 规则 + 识别模型，核验关闭，1 轮 |
| `full` | 三层架构：规则 + qwen 识别 + gemma 盲审，最多 3 轮 |
| `full-same` | 同上，但由识别模型自己核验 |

## 语料

39 个文件，含 623 处标识符和 227 个诱饵。文件包括入院记录、病程、出院小结、知情同意书、电话随访、转院信、检验单（txt），检验结果表（csv），区域平台导出（`PTT_NM` 等编码字段）和 `ITM_NM/ITM_VLU` 病历条目（json）。

- 难例：叙述中的家属、配偶、查房医生姓名，外院名称，带空格或连字符的手机号，分组书写的身份证号，社保卡号，门诊号。
- 诱饵：人名命名的病名（帕金森病、桥本甲状腺炎）、姓氏打头的词（张力性气胸、白细胞）、中药名（王不留行、白芍）、病区、ICD 编码、批号、床号。

## 计分

原文与输出按行做字符级 LCS 对齐，然后统计：

- 泄漏：一处标识符有超过一半的字符原样保留，记为泄漏。
- 误改：标识符以外被改动的字符，计为误改字符和误改片段。
- 诱饵丢失：输出中某个诱饵的出现次数少于原文。

「部分残留」一列会把假名里的十六进制数字与原数字的偶然重合算进去，噪声较大，仅供参考。
