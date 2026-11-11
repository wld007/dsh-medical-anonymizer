# dsh-medical-anonymizer

**简体中文** | [English](README.en.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：批量匿名化病历文本、表格和 DICOM 元数据。
发现直接标识符，用稳定假名替换，文件结构不变，输出审计报告和可还原的映射库。

> 这是数据处理工具，不是合规认证。发布任何输出之前，请对照适用法律和本机构的政策进行审查。

![处理流水线](https://raw.githubusercontent.com/wld007/dsh-medical-anonymizer/main/assets/dashboard.png)

<sub>截图使用合成数据，不含真实患者信息。</sub>

## 特点

- **结构不变**：模型只标注文本，插件定位并替换精确片段；行数、CSV 列、JSON 键、Excel 非文本单元格都不动。
- **规则优先，模型可选**：身份证校验位、电话、邮箱、带标签字段、列名/键名策略不需要模型；模型用于提高自由文本召回并复核。
- **双模型交叉核验**：独立盲审 + 复判，有界修复循环；解决不了的进入人工复核，不静默放过。
- **本地优先**：无遥测，只访问你配置的 OpenAI 兼容端点。
- **可审计**：逐文件统计、结构校验、复核清单；报告不打印原值，原值只在映射库里。

| 方面 | 说明 |
| --- | --- |
| 格式 | `.txt` `.md` `.csv` `.json` `.xlsx`、`.zip`（含嵌套）、DICOM（只处理元数据）；字段里的 base64 / HTML / 嵌套 JSON 等编码内容逐层拆开检查 |
| 标识符 | 姓名、医生/职工、身份证、电话、邮箱、地址、病历号/住院号/就诊号、社保号、银行卡、医院；文件名和目录名里的同样替换 |
| 处理方式 | 每类可选稳定假名（如 `化名-9F3A2C`，默认）、部分遮盖、类型标签或保留；可选处理日期、年龄、性别 |

## 安装

要求 DSH `>= 0.2.1`、Node.js `>= 20`。

```bash
dsh plugin --profile <profile> add github:wld007/dsh-medical-anonymizer
```

安装后重启 DSH。配置在 **设置 → 医疗数据匿名化**，看板在左侧栏 **医疗数据匿名化**。

## 模型

在 **设置 → 医疗数据匿名化 → 模型连接** 填写 OpenAI 兼容的 `/v1` 端点、模型名和 API Key（可选），用「测试连接」检查。

- **识别模型**：发现标识符，并复判核验模型报出的问题。
- **核验模型**（可选）：做独立盲审，可以用另一个端点和 API Key；留空时由识别模型兼做。两个模型各有并发额度，默认按实测吞吐自动调整。
- **关闭思考模式**（默认开）：请求里带 `chat_template_kwargs: {enable_thinking: false}`；服务器拒绝这个字段时自动去掉重试。
- 模型名留空时只运行规则层（身份证校验位、电话、邮箱、带标签字段、列名/键名策略），自由文本里的姓名、地址等会漏掉很多。
- 文本会发送到你配置的端点。处理患者数据请使用本机或机构内网的服务。

开发和测试中使用的组合：vLLM 部署的 `qwen3.6-35b-a3b`（识别）和 `gemma-4-26b-a4b-it`（核验）。

## 使用

**看板。** 点「＋ 新批次」选择文件夹、文件或 `.zip` 开始处理：

- **产线**：10 个环节的 2.5D 产线，点环节看详情；右侧批次概览（送审用量、模型表现、并发调度、交叉核验），右上待办告警。
- **复核**：逐份比对原文与结果（原值红、假名绿、可疑橙），在页面上直接决定替换、不是标识符或保留；误报可一键还原，漏报选中即可补替换。
- **报告**：带目录的 Markdown 报告；另有文件、模型调用、交叉核验、日志、提示、改进建议等标签页。

![结果比对与复核](https://raw.githubusercontent.com/wld007/dsh-medical-anonymizer/main/assets/review.png)

**命令。**

```text
/anonymize /path/to/records [--output DIR] [--rounds N] [--model M --endpoint URL] [--no-think]
```

**Agent 工具。** `anonymize_start`、`anonymize_status`、`anonymize_report`、`anonymize_runs`、`anonymize_cancel`、`anonymize_undo_mappings`。
Agent 不能指定端点、模型或 API Key，始终使用已保存的设置。

## 输出

```text
<输出根>/                     # 默认：输入旁边的 _medical-anonymizer
  <输入名>/                   # 交付数据：结构与输入相同，可整个拿走
  _records/
    vault.json               # 原值 ↔ 假名（可用口令加密），妥善保管
    runs/<批次>/report.md    # 报告，以及比对、复核、模型调用等记录
```

源文件只读，绝不修改；有待复核项时交付数据暂扣，处理完后才放到输出根目录。

## 隐私与安全

- 唯一的出站请求是你配置的模型端点；端点在远程时文本会离开本机。
- 报告不含原值但含路径，报告和映射库都应按受保护健康信息对待。
- 默认不处理日期、年龄、性别等准标识符，它们的组合仍可能重新识别个人；`mask` 和 `keep` 会保留部分或全部原值。
- 与正文粘连、没有分隔符的文件名（如 `张三病历.md`）不会识别，发布前请检查。

## 更多

[使用详解](docs/guide.md)：设置页、工作原理、匿名化规则与排除误判、DICOM、输出结构、压缩包、文件名、配置项、格式与限制、故障排查。
更新记录见 [CHANGELOG](CHANGELOG.md)。

## 开发

```bash
npm test                      # 使用确定性的模拟模型，不需要网络或真实数据
node scripts/build.mjs 0.9.0  # 为本地 profile 构建带版本号的 dist/
```

## 许可证

MIT，见 [LICENSE](LICENSE)。内置 SheetJS Community Edition 0.20.3（Apache-2.0），见 [NOTICE](NOTICE)。
