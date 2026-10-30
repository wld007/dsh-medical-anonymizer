window.__ModuleLoader__.load({
  id: 'dsh-medical-anonymizer',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const CHANNEL = '/medical-anonymizer'
    const PANEL_ID = 'medical-anonymizer'
    const services = { ctx: null, t: (key) => key }

    const ZH = {
      nav: '医疗数据匿名化',
      panel: '医疗数据匿名化',
      'settings.title': '医疗数据匿名化',
      'settings.intro': '这里只放配置。运行批次、查看记录和报告，请到左侧栏的「医疗数据匿名化」，或在聊天框使用 /anonymize。',
      'guide.title': '使用说明与处理流程',
      'tab.model': '模型连接',
      'tab.rules': '匿名化规则',
      'tab.batch': '批次与界面',
      'tab.guide': '使用说明',
      'tab.unsaved': '有未保存的修改',
      'settings.short': '配置模型、匿名化规则和批次默认值。运行批次请到左侧栏「医疗数据匿名化」或使用 /anonymize。',
      'rules.title': '匿名化规则',
      'rules.reset': '恢复默认规则',
      'rules.idTitle': '标识符（能直接识别个人身份的信息）',
      'rules.idHint': '默认全部替换为稳定假名：同一个值在所有文件中得到同一个假名，可以用映射库还原。',
      'rules.setAll': '全部设为…',
      'rules.type': '类型',
      'rules.strategy': '处理方式',
      'rules.example': '示例',
      'rules.quasiTitle': '准标识符（单独不能识别个人，组合起来可能识别）',
      'rules.quasiToggle': '同时处理准标识符（日期、年龄、性别、邮编）',
      'rules.quasiHint': '默认关闭，即只处理标识符。开启后按下表处理；只处理文本值，Excel 数值/日期单元格和 JSON 数字不改动。',
      'strategy.pseudonym': '稳定假名',
      'strategy.mask': '部分遮盖',
      'strategy.redact': '替换为类型标签',
      'strategy.keep': '保留不处理',
      'strategy.shift': '整体平移（保持间隔）',
      'strategy.month': '只保留年月',
      'strategy.year': '只保留年份',
      'strategy.band10': '10 岁分段',
      'strategy.band5': '5 岁分段',
      'strategy.prefix3': '只保留前 3 位',
      'field.rules': '匿名化规则',
      'page.rulesQuasiOn': '准标识符：已处理',
      'page.rulesQuasiOff': '准标识符：未处理',
      'ui.title': '界面',
      'ui.sidebar': '在左侧栏显示「医疗数据匿名化」入口',
      'ui.sidebarHint': '隐藏后仍可通过 /anonymize 命令和 Agent 工具使用。',
      'field.showSidebarEntry': '左侧栏入口',
      'model.title': '本地模型',
      'model.endpoint': '端点（OpenAI 兼容）',
      'model.name': '模型名称',
      'model.namePlaceholder': '留空则只跑规则层',
      'model.key': 'API Key（可选）',
      'model.keySaved': '已保存，留空表示不修改',
      'model.keyClear': '清除已保存的 API Key',
      'model.test': '测试连接',
      'model.testing': '测试中…',
      'model.ok': '连接成功，可用模型：{models}',
      'model.okEmpty': '连接成功，但端点没有返回模型列表。',
      'model.fail': '连接失败：{error}',
      'model.missing': '端点上没有名为 {model} 的模型。',
      'model.thinking': '关闭思考模式（推理模型更快：enable_thinking=false）',
      'run.title': '批次默认值',
      'run.output': '输出根目录',
      'run.outputDefault': '留空：输入目录旁的 .medical-anonymizer',
      'run.rounds': '最大轮次',
      'run.dry': '默认使用演练模式（只检测与校验，不写出数据和映射库）',
      'save.clean': '所有配置已保存。',
      'save.dirty': '未保存：{fields}',
      'save.save': '保存',
      'save.saving': '正在保存…',
      'save.revert': '还原',
      'save.saved': '已保存。医疗数据匿名化页面、/anonymize 和 Agent 工具都会使用这些配置。',
      'save.keyNote': 'API Key 会写入本机 profile 配置文件（权限 600）。',
      'field.baseURL': '端点',
      'field.model': '模型',
      'field.apiKey': 'API Key',
      'field.disableThinking': '思考模式',
      'field.outputRoot': '输出根目录',
      'field.maxRounds': '最大轮次',
      'field.dryRun': '演练模式',
      'page.title': '医疗数据匿名化',
      'page.model': '模型：{model} · {endpoint}',
      'page.noModel': '未配置模型，只跑规则层',
      'page.settingsHint': '在 设置 → 医疗数据匿名化 中修改',
      'form.title': '新建批次',
      'form.input': '输入目录',
      'form.inputPlaceholder': '/path/to/records',
      'form.browse': '浏览…',
      'form.output': '输出根目录',
      'form.dry': '演练模式（只检测与校验，不写出数据和映射库）',
      'form.start': '开始匿名化',
      'form.starting': '正在启动…',
      'form.inputRequired': '请先选择输入目录。',
      'runs.title': '批次记录',
      'runs.refresh': '刷新',
      'runs.empty': '还没有批次。',
      'runs.files': '文件',
      'runs.entities': '实体',
      'runs.unresolved': '待复核',
      'runs.time': '时间',
      'runs.status': '状态',
      'runs.input': '输入',
      'runs.file': '文件',
      'runs.rounds': '轮次',
      'detail.title': '批次详情',
      'detail.close': '收起',
      'detail.report': '报告',
      'detail.copy': '复制输出路径',
      'detail.copied': '已复制',
      'detail.loading': '加载中…',
      'detail.noReport': '批次尚未结束，报告将在完成后生成。',
      'detail.files': '文件明细',
      'detail.noFiles': '暂无文件记录。',
      'detail.dry': '演练',
      'run.cancel': '取消批次',
      'run.cancelling': '正在取消…',
      'status.running': '运行中',
      'status.completed': '完成',
      'status.review': '待复核',
      'status.failed': '失败',
      'status.cancelled': '已取消',
      'status.clean': '通过',
      'file.clean': '通过',
      'file.review': '待复核',
      'file.failed': '失败',
      'file.running': '处理中',
      'file.cancelled': '已取消',
      'error.title': '操作失败',
      'notice.started': '批次已启动。',
      'notice.cancelled': '已请求取消。',
    }

    const EN = {
      nav: 'Medical Data Anonymization',
      panel: 'Medical Anonymization',
      'settings.title': 'Medical Data Anonymization',
      'settings.intro': 'Configuration only. Run batches and read reports from Medical Anonymization in the left sidebar, or use /anonymize in the composer.',
      'guide.title': 'How it works',
      'tab.model': 'Model',
      'tab.rules': 'Rules',
      'tab.batch': 'Batches & UI',
      'tab.guide': 'How it works',
      'tab.unsaved': 'Unsaved changes',
      'settings.short': 'Configure the model, anonymization rules, and batch defaults. Run batches from Medical Anonymization in the sidebar or with /anonymize.',
      'rules.title': 'Anonymization rules',
      'rules.reset': 'Restore default rules',
      'rules.idTitle': 'Identifiers (directly identify a person)',
      'rules.idHint': 'By default every identifier becomes a stable pseudonym: the same value gets the same token in every file, and the vault can restore it.',
      'rules.setAll': 'Set all to…',
      'rules.type': 'Type',
      'rules.strategy': 'Treatment',
      'rules.example': 'Example',
      'rules.quasiTitle': 'Quasi-identifiers (identify a person only in combination)',
      'rules.quasiToggle': 'Also process quasi-identifiers (date, age, sex, postal code)',
      'rules.quasiHint': 'Off by default, so only identifiers are processed. When on, text values are handled as below; Excel numeric/date cells and JSON numbers are not changed.',
      'strategy.pseudonym': 'Stable pseudonym',
      'strategy.mask': 'Partial mask',
      'strategy.redact': 'Type label',
      'strategy.keep': 'Keep as-is',
      'strategy.shift': 'Shift (keeps intervals)',
      'strategy.month': 'Year and month only',
      'strategy.year': 'Year only',
      'strategy.band10': '10-year bands',
      'strategy.band5': '5-year bands',
      'strategy.prefix3': 'First 3 digits only',
      'field.rules': 'anonymization rules',
      'page.rulesQuasiOn': 'Quasi-identifiers: processed',
      'page.rulesQuasiOff': 'Quasi-identifiers: not processed',
      'ui.title': 'Interface',
      'ui.sidebar': 'Show the Medical Anonymization entry in the left sidebar',
      'ui.sidebarHint': 'When hidden, /anonymize and the agent tools still work.',
      'field.showSidebarEntry': 'sidebar entry',
      'model.title': 'Local model',
      'model.endpoint': 'Endpoint (OpenAI-compatible)',
      'model.name': 'Model',
      'model.namePlaceholder': 'Empty runs the rule layer only',
      'model.key': 'API key (optional)',
      'model.keySaved': 'Saved; leave empty to keep it',
      'model.keyClear': 'Clear the saved API key',
      'model.test': 'Test connection',
      'model.testing': 'Testing…',
      'model.ok': 'Connected. Models: {models}',
      'model.okEmpty': 'Connected, but the endpoint listed no models.',
      'model.fail': 'Connection failed: {error}',
      'model.missing': 'The endpoint has no model named {model}.',
      'model.thinking': 'Disable thinking (faster on reasoning models: enable_thinking=false)',
      'run.title': 'Batch defaults',
      'run.output': 'Output root',
      'run.outputDefault': 'Empty: .medical-anonymizer beside the input',
      'run.rounds': 'Max rounds',
      'run.dry': 'Start batches in dry-run mode (detect and verify only; writes no data and no vault)',
      'save.clean': 'All settings are saved.',
      'save.dirty': 'Unsaved: {fields}',
      'save.save': 'Save',
      'save.saving': 'Saving…',
      'save.revert': 'Revert',
      'save.saved': 'Saved. The Medical Anonymization page, /anonymize, and the agent tools now use these settings.',
      'save.keyNote': 'The API key is written to this profile\'s config file (mode 600).',
      'field.baseURL': 'endpoint',
      'field.model': 'model',
      'field.apiKey': 'API key',
      'field.disableThinking': 'thinking mode',
      'field.outputRoot': 'output root',
      'field.maxRounds': 'max rounds',
      'field.dryRun': 'dry run',
      'page.title': 'Medical Data Anonymization',
      'page.model': 'Model: {model} · {endpoint}',
      'page.noModel': 'No model configured; rule layer only',
      'page.settingsHint': 'Change it in Settings → Medical Data Anonymization',
      'form.title': 'New batch',
      'form.input': 'Input directory',
      'form.inputPlaceholder': '/path/to/records',
      'form.browse': 'Browse…',
      'form.output': 'Output root',
      'form.dry': 'Dry run (detect and verify only; writes no data and no vault)',
      'form.start': 'Start anonymization',
      'form.starting': 'Starting…',
      'form.inputRequired': 'Choose an input directory first.',
      'runs.title': 'Batches',
      'runs.refresh': 'Refresh',
      'runs.empty': 'No batches yet.',
      'runs.files': 'Files',
      'runs.entities': 'Entities',
      'runs.unresolved': 'To review',
      'runs.time': 'Time',
      'runs.status': 'Status',
      'runs.input': 'Input',
      'runs.file': 'File',
      'runs.rounds': 'Rounds',
      'detail.title': 'Batch detail',
      'detail.close': 'Close',
      'detail.report': 'Report',
      'detail.copy': 'Copy output path',
      'detail.copied': 'Copied',
      'detail.loading': 'Loading…',
      'detail.noReport': 'The batch is still running; the report appears when it finishes.',
      'detail.files': 'Files',
      'detail.noFiles': 'No file records.',
      'detail.dry': 'Dry run',
      'run.cancel': 'Cancel batch',
      'run.cancelling': 'Cancelling…',
      'status.running': 'Running',
      'status.completed': 'Completed',
      'status.review': 'Needs review',
      'status.failed': 'Failed',
      'status.cancelled': 'Cancelled',
      'status.clean': 'Clean',
      'file.clean': 'Clean',
      'file.review': 'Review',
      'file.failed': 'Failed',
      'file.running': 'Running',
      'file.cancelled': 'Cancelled',
      'error.title': 'Operation failed',
      'notice.started': 'Batch started.',
      'notice.cancelled': 'Cancellation requested.',
    }

    // Usage guide shown in Settings. Keep it in step with lib/pipeline.js.
    const GUIDE = {
      zh: [
        { title: '它做什么', items: [
          '批量处理目录中的 txt、md、csv、json、xlsx 文件，找出能直接识别个人身份的信息，替换成稳定假名，并生成审计报告。',
          '处理的标识符：姓名、医生/医护姓名、身份证号、电话、邮箱、地址、病历号、住院号、就诊号、社保号、银行卡号、医院名称。',
          '假名形如「化名-9F3A2C」「证件-1F0B67」：同一个原值在所有文件、所有批次（同一输出根目录）中得到同一个假名，便于关联分析。',
          '文件结构保持不变：文本行数、CSV/Excel 的行列与表头、JSON 的键和类型都不变，只替换命中的那一段文字。',
          '处理方式可在下方「匿名化规则」中逐类配置：标识符可选稳定假名、部分遮盖、类型标签或保留；准标识符（日期、年龄、性别、邮编）默认不处理，开启后可选平移、泛化或标签。',
        ] },
        { title: '怎么用', ordered: true, items: [
          '在本页填写模型端点和模型名称，点「测试连接」，确认后点「保存」。模型留空则只用规则识别。',
          '打开左侧栏「医疗数据匿名化」，选择输入目录，保持「演练模式」先跑一遍：只检测和校验，不写出任何数据。',
          '在批次详情里查看报告。确认没有问题后取消演练模式再跑一次，才会写出匿名化文件。',
          '也可以在聊天框输入 /anonymize <目录>（加 --apply 正式输出），或让 Agent 调用 anonymize_start 等工具。',
        ] },
        { title: '每个文件的处理流程', ordered: true, items: [
          '字段策略：表头或键名是姓名、身份证号、电话、地址等的列整格替换，包括 PTT_NM、ID_CRD_NO、CTCT_TEL_NO、MDC_ORG_NM 等常见医院导出字段。',
          '规则扫描：身份证号（校验位验证）、手机/座机、邮箱、银行卡号（Luhn 校验）、病历号，以及「姓名：」「住址：」这类带标签的字段。',
          '模型发现（第 1 次调用模型）：模型只回答「哪一段、什么类型、原文是什么」，插件再到原文里逐字定位；不使用模型给出的位置，避免改错。',
          '假名替换：按 类型+原值 计算稳定假名，只替换命中的区间，其余内容一个字节都不动。',
          '复核（第 2 次调用模型）：模型检查替换后的文本是否还有残留，同时做规则复扫、原值是否已清除、结构是否一致的检查。',
          '定向修复：复核发现的残留会在下一轮直接替换，最多重复「最大轮次」次；仍解决不了的标为「待复核」，写进报告的人工复核清单。',
          '准标识符（开启时）：在标识符处理完后，按规则确定性地处理日期、年龄、性别、邮编，不经过模型。日期平移对同一输出根目录使用同一个偏移量，日期之间的间隔保持不变。',
        ] },
        { title: '输出在哪里', items: [
          '输出根目录/runs/<批次号>/output/：匿名化后的文件，目录结构与输入相同。',
          '输出根目录/runs/<批次号>/report.md：报告，包括每个文件的实体统计、结构校验、残留问题和人工复核清单；报告里不出现原值。',
          '输出根目录/vault.json：映射库（原值 ↔ 假名），权限 600。它是还原钥匙，泄露等同原文泄露，请与输出数据分开保管。',
          '不设置输出根目录时，写到输入目录旁的隐藏目录 .medical-anonymizer；演练模式不写数据，也不写映射库。',
        ] },
        { title: '注意事项', items: [
          '模型会看到原文。请使用本机或可信内网的模型端点，不要用公网云服务处理患者数据。',
          '默认只处理直接标识符。开启准标识符后也只覆盖日期、年龄、性别、邮编的文本值；科室、机构代码等不处理，文件名和目录名原样保留。',
          '部分遮盖会保留一部分原值，且不可还原；需要能还原时请用稳定假名。日期平移后不要对输出再跑一遍，否则会被平移两次。',
          '不支持 Word、PDF、图片、DICOM；跳过的文件和超出单批上限的文件会在报告的「注意」里列出。',
          '状态为「待复核」的批次请先人工确认报告中的问题，再对外发布数据。本工具不等于合规认证。',
        ] },
      ],
      en: [
        { title: 'What it does', items: [
          'Processes txt, md, csv, json, and xlsx files in a directory, finds direct identifiers, replaces them with stable pseudonyms, and writes an audit report.',
          'Identifiers: name, doctor/staff name, Chinese ID, phone, email, address, medical-record number, admission number, visit number, social-security number, bank card, hospital.',
          'Pseudonyms look like 化名-9F3A2C or 证件-1F0B67. The same value gets the same token in every file and batch that shares an output root.',
          'Structure is preserved: line counts, CSV/Excel rows, columns and headers, and JSON keys and types stay the same; only matched text changes.',
          'Treatment is configurable per type under Anonymization rules: identifiers can be pseudonymized, partially masked, labelled, or kept; quasi-identifiers (date, age, sex, postal code) are off by default and can be shifted, generalized, or labelled.',
        ] },
        { title: 'How to use', ordered: true, items: [
          'Enter the model endpoint and name here, press Test connection, then Save. Leave the model empty to use rules only.',
          'Open Medical Anonymization in the left sidebar, choose the input directory, and keep Dry run on for the first pass: it detects and verifies but writes nothing.',
          'Read the report in the batch detail. When it looks right, run again without Dry run to write anonymized files.',
          'You can also type /anonymize <dir> in the composer (add --apply to write output) or ask the agent to use anonymize_start and the related tools.',
        ] },
        { title: 'Per-file pipeline', ordered: true, items: [
          'Field policy: columns or keys such as name, ID, phone, and address are replaced as a whole, including hospital export fields like PTT_NM, ID_CRD_NO, CTCT_TEL_NO, and MDC_ORG_NM.',
          'Rule scan: Chinese ID (checksum), mobile/landline, email, bank card (Luhn), record numbers, and labeled fields such as 姓名： or 住址：.',
          'Model discovery (model call 1): the model only says which segment, which type, and the exact text; the plugin locates that text itself and never trusts model offsets.',
          'Pseudonymization: a stable token per type and value; only the matched span is replaced.',
          'Verification (model call 2): the model checks the result for leftovers, alongside a rule re-scan, an original-value absence check, and a structure check.',
          'Repair: confirmed leftovers are replaced in the next round, up to Max rounds; anything still unresolved is marked Needs review and listed in the report.',
          'Quasi-identifiers (when on): after identifiers, dates, ages, sex, and postal codes are handled deterministically, without the model. Date shifting uses one offset per output root, so intervals between dates are preserved.',
        ] },
        { title: 'Where output goes', items: [
          '<output root>/runs/<batch>/output/: anonymized files with the input\'s layout.',
          '<output root>/runs/<batch>/report.md: per-file counts, structure checks, leftovers, and the manual-review list; no original values.',
          '<output root>/vault.json: original ↔ pseudonym map, mode 600. It is the re-identification key; store it apart from the output.',
          'With no output root set, output goes to a hidden .medical-anonymizer folder beside the input. Dry runs write neither data nor the vault.',
        ] },
        { title: 'Cautions', items: [
          'The model sees the original text. Use a local or trusted internal endpoint, never a public cloud service, for patient data.',
          'By default only direct identifiers are processed. Quasi-identifier handling covers text values of date, age, sex, and postal code only; department and institution codes are not touched, and file and folder names are kept as-is.',
          'Partial masks keep part of the original and cannot be reversed; use pseudonyms when you need restoration. Do not re-run date shifting on its own output, or dates shift twice.',
          'Word, PDF, images, and DICOM are not supported; skipped files and files over the batch limit are listed in the report.',
          'Review every Needs review item before publishing. This tool is not a compliance certification.',
        ] },
      ],
    }

    const CSS = `
      .ma-section{max-width:820px;display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary)}
      .ma-section.ma-settings{max-width:none;box-sizing:border-box;min-height:calc(min(800px, calc(100vh - 2 * max(24px, var(--dsh-frame-overlay-top,24px)))) - 78px)}
      .ma-settings>[role=tabpanel]{flex:1}
      .ma-page{height:100%;overflow:auto;box-sizing:border-box;padding:28px 32px 40px;color:var(--dsw-alias-label-primary)}
      .ma-page-inner{max-width:980px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
      .ma-heading{margin:0;font-size:18px;font-weight:600}
      .ma-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
      .ma-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-1)}
      .ma-card h3,.ma-card h4{margin:0;font-size:14px;font-weight:600}
      .ma-card-head{display:flex;align-items:center;gap:10px}
      .ma-card-head h3{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ma-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .ma-field{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--dsw-alias-label-secondary);min-width:0}
      .ma-field.ma-wide{grid-column:1 / -1}
      .ma-input{height:30px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:0 9px;font:inherit;font-size:13px;min-width:0}
      .ma-input:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-alias-brand-primary);outline-offset:1px}
      .ma-inline{display:flex;gap:8px}
      .ma-inline .ma-input{flex:1}
      .ma-check{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--dsw-alias-label-primary)}
      .ma-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      .ma-btn{height:30px;padding:0 12px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
      .ma-btn:hover{background:var(--dsw-alias-bg-overlay)}
      .ma-btn:disabled{opacity:.5;cursor:default}
      .ma-btn.ma-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
      .ma-btn.ma-small{height:26px;padding:0 9px;font-size:12px}
      .ma-link{background:none;border:0;padding:0;font:inherit;font-size:12px;color:var(--dsw-alias-brand-primary);cursor:pointer}
      .ma-hint{font-size:12px;color:var(--dsw-alias-label-secondary);min-height:16px;line-height:16px}
      .ma-hint.ma-error{color:var(--dsw-alias-state-error-primary)}
      .ma-hint.ma-ok{color:var(--dsw-alias-state-success-primary)}
      .ma-hint.ma-warn{color:var(--dsw-alias-state-warn-primary)}
      p.ma-hint{margin:0}
      .ma-savebar{position:sticky;bottom:calc(-1 * var(--ma-shell-pad,24px));z-index:2;display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 calc(-1 * var(--ma-shell-pad,24px)) calc(-1 * var(--ma-shell-pad,24px));padding:12px var(--ma-shell-pad,24px) 16px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
      .ma-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l2);overflow-x:auto}
      .ma-tab{position:relative;display:inline-flex;align-items:center;gap:6px;background:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;padding:8px 12px;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
      .ma-tab:hover{color:var(--dsw-alias-label-primary)}
      .ma-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary);font-weight:600;border-bottom-color:var(--dsw-alias-brand-primary)}
      .ma-tab:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-alias-brand-primary);outline-offset:-2px;border-radius:6px}
      .ma-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary)}
      .ma-panel{display:flex;flex-direction:column;gap:12px;min-height:240px}
      .ma-block-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
      .ma-block-head>div:first-child{flex:1;min-width:220px;display:flex;flex-direction:column;gap:3px}
      .ma-block-head h3{margin:0;font-size:14px;font-weight:600}
      .ma-rules{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px}
      .ma-rule{display:grid;grid-template-columns:64px minmax(0,1fr);align-items:center;gap:4px 10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base)}
      .ma-rule-name{font-size:13px;font-weight:500}
      .ma-rule .ma-select{width:100%}
      .ma-rule .ma-mono{grid-column:2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ma-rule.ma-off{opacity:.45}
      .ma-divider{border:0;border-top:1px solid var(--dsw-alias-border-l1);margin:4px 0}
      .ma-savebar .ma-hint{flex:1;min-width:160px}
      .ma-summary{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .ma-table{width:100%;border-collapse:collapse;font-size:13px}
      .ma-table th{text-align:left;font-weight:500;font-size:12px;color:var(--dsw-alias-label-secondary);padding:5px 8px;border-bottom:1px solid var(--dsw-alias-border-l2)}
      .ma-table td{padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top}
      .ma-table tr.ma-click{cursor:pointer}
      .ma-table tr.ma-click:hover td{background:var(--dsw-alias-bg-layer-2)}
      .ma-table tr.ma-selected td{background:var(--dsw-alias-bg-layer-2)}
      .ma-chip{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;font-size:11px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap}
      .ma-chip.ma-running{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
      .ma-chip.ma-ok{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
      .ma-chip.ma-bad{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
      .ma-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
      .ma-stat{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:2px;background:var(--dsw-alias-bg-base)}
      .ma-stat b{font-size:16px;font-weight:600}
      .ma-stat span{font-size:11px;color:var(--dsw-alias-label-secondary)}
      .ma-pre{margin:0;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word;max-height:480px;overflow:auto}
      .ma-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}
      .ma-empty{font-size:13px;color:var(--dsw-alias-label-secondary);margin:0}
      .ma-banner{border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;padding:9px 12px;font-size:12px;color:var(--dsw-alias-state-error-primary)}
      .ma-path{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .ma-select{height:28px;padding:0 6px}
      .ma-table tr.ma-off td{opacity:.45}
      .ma-subhead{margin:6px 0 0;font-size:13px;font-weight:600}
      .ma-guide{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
      .ma-guide>summary{cursor:pointer;padding:12px 16px;font-size:14px;font-weight:600;list-style-position:inside}
      .ma-guide[open]>summary{border-bottom:1px solid var(--dsw-alias-border-l1)}
      .ma-guide-body{padding:4px 16px 14px;display:flex;flex-direction:column;gap:4px}
      .ma-guide-body h4{margin:10px 0 2px;font-size:13px;font-weight:600}
      .ma-guide-body ol,.ma-guide-body ul{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px}
      .ma-guide-body li{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
    `

    function tFactory(ctx) {
      return (key, vars) => {
        const dict = ctx.locale?.getLocale?.().active === 'zh' ? ZH : EN
        const template = dict[key] ?? key
        if (!vars) return template
        return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''))
      }
    }

    function call(endpoint, payload, signal) {
      const connection = services.ctx?.get('connection')
      if (!connection?.rpc) return Promise.reject(new Error('connection unavailable'))
      return connection.rpc.call(CHANNEL, endpoint, payload, signal).then((response) => {
        if (!response || response.ok !== true) {
          throw new Error(response?.error?.message ?? 'RPC failed')
        }
        return response.value
      })
    }

    function message(cause) {
      return String(cause?.message ?? cause)
    }

    function statusClass(status) {
      if (status === 'completed' || status === 'clean') return 'ma-chip ma-ok'
      if (status === 'review' || status === 'running') return 'ma-chip ma-running'
      return 'ma-chip ma-bad'
    }

    function formatTime(value) {
      if (!value) return '—'
      try { return new Date(value).toLocaleString() } catch { return String(value) }
    }

    function baseName(path) {
      const parts = String(path ?? '').split(/[\\/]/).filter(Boolean)
      return parts[parts.length - 1] ?? ''
    }

    function stat(label, value) {
      return h('div', { className: 'ma-stat' }, h('b', {}, String(value)), h('span', {}, label))
    }

    function GuideBody() {
      const sections = services.ctx?.locale?.getLocale?.().active === 'zh' ? GUIDE.zh : GUIDE.en
      return h('div', { className: 'ma-guide-body ma-card' },
        ...sections.map((section, index) => h(React.Fragment, { key: index },
          h('h4', {}, section.title),
          h(section.ordered ? 'ol' : 'ul', {}, ...section.items.map((item, itemIndex) => h('li', { key: itemIndex }, item))),
        )))
    }

    // ── Settings → Medical Data Anonymization: configuration only ──────────

    function SettingsSection() {
      const t = services.t
      const [config, setConfig] = React.useState(null)
      const [endpoint, setEndpoint] = React.useState('')
      const [model, setModel] = React.useState('')
      const [apiKey, setApiKey] = React.useState('')
      const [clearKey, setClearKey] = React.useState(false)
      const [disableThinking, setDisableThinking] = React.useState(true)
      const [outputRoot, setOutputRoot] = React.useState('')
      const [maxRounds, setMaxRounds] = React.useState(3)
      const [dryRun, setDryRun] = React.useState(true)
      const [showSidebar, setShowSidebar] = React.useState(true)
      const [identifierPolicy, setIdentifierPolicy] = React.useState({})
      const [quasiOn, setQuasiOn] = React.useState(false)
      const [quasiPolicy, setQuasiPolicy] = React.useState({})
      const [testing, setTesting] = React.useState(false)
      const [ping, setPing] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [tab, setTab] = React.useState('model')

      function applyConfig(info) {
        setConfig(info)
        setEndpoint(info.baseURL ?? '')
        setModel(info.model ?? '')
        setApiKey('')
        setClearKey(false)
        setDisableThinking(info.disableThinking === true)
        setOutputRoot(info.outputRoot ?? '')
        setMaxRounds(Number(info.maxRounds ?? 3))
        setDryRun(info.dryRun !== false)
        setShowSidebar(info.showSidebarEntry !== false)
        setIdentifierPolicy({ ...(info.identifierPolicy ?? {}) })
        setQuasiOn(info.quasiIdentifiers === true)
        setQuasiPolicy({ ...(info.quasiPolicy ?? {}) })
      }

      const schema = config?.policySchema ?? { identifiers: [], quasi: [] }
      const sameMap = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort())
      function resetRules() {
        setIdentifierPolicy(Object.fromEntries(schema.identifiers.map((item) => [item.id, 'pseudonym'])))
        setQuasiOn(false)
        setQuasiPolicy(Object.fromEntries(schema.quasi.map((item) => [item.id, item.default])))
      }

      React.useEffect(() => {
        let alive = true
        call('config').then((info) => { if (alive) applyConfig(info) }, (cause) => { if (alive) setError(message(cause)) })
        return () => { alive = false }
      }, [])

      const dirty = config ? [
        ['baseURL', endpoint.trim().replace(/\/+$/, '') !== String(config.baseURL ?? '').replace(/\/+$/, '')],
        ['model', model.trim() !== String(config.model ?? '')],
        ['apiKey', apiKey.length > 0 || clearKey],
        ['disableThinking', disableThinking !== (config.disableThinking === true)],
        ['outputRoot', outputRoot.trim() !== String(config.outputRoot ?? '')],
        ['maxRounds', Number(maxRounds) !== Number(config.maxRounds ?? 3)],
        ['dryRun', dryRun !== (config.dryRun !== false)],
        ['showSidebarEntry', showSidebar !== (config.showSidebarEntry !== false)],
        ['rules', !sameMap(identifierPolicy, config.identifierPolicy) || quasiOn !== (config.quasiIdentifiers === true)
          || !sameMap(quasiPolicy, config.quasiPolicy)],
      ].filter(([, changed]) => changed).map(([key]) => key) : []

      async function testConnection() {
        setTesting(true)
        setPing(null)
        try {
          setPing(await call('ping', { baseURL: endpoint.trim(), model: model.trim(), apiKey }))
        } catch (cause) {
          setPing({ ok: false, error: message(cause) })
        } finally {
          setTesting(false)
        }
      }

      async function save() {
        setError('')
        setNotice('')
        setSaving(true)
        try {
          const request = {
            baseURL: endpoint.trim(),
            model: model.trim(),
            disableThinking,
            outputRoot: outputRoot.trim(),
            maxRounds: Number(maxRounds),
            dryRun,
            showSidebarEntry: showSidebar,
            identifierPolicy,
            quasiIdentifiers: quasiOn,
            quasiPolicy,
          }
          if (apiKey.length > 0) request.apiKey = apiKey
          else if (clearKey) request.apiKey = ''
          await call('saveDefaults', request)
          // Saving re-applies the host plugin; wait until it answers again.
          let info = null
          for (let attempt = 0; attempt < 20 && !info; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 250))
            try { info = await call('config') } catch { /* reloading */ }
          }
          if (info) applyConfig(info)
          services.setSidebarVisible?.(info ? info.showSidebarEntry !== false : showSidebar)
          setNotice(t('save.saved'))
        } catch (cause) {
          setError(message(cause))
        } finally {
          setSaving(false)
        }
      }

      function pingText() {
        if (!ping) return ''
        if (!ping.ok) return t('model.fail', { error: ping.error })
        const models = ping.models ?? []
        if (models.length === 0) return t('model.okEmpty')
        const listed = t('model.ok', { models: models.slice(0, 6).join('、') })
        return model.trim() && !models.includes(model.trim()) ? `${listed} ${t('model.missing', { model: model.trim() })}` : listed
      }
      const pingClass = !ping ? 'ma-hint'
        : !ping.ok || (model.trim() && ping.models?.length && !ping.models.includes(model.trim())) ? 'ma-hint ma-error' : 'ma-hint ma-ok'

      const saveHint = notice || (dirty.length > 0
        ? t('save.dirty', { fields: dirty.map((key) => t(`field.${key}`)).join('、') })
        : t('save.clean'))

      const tabFields = {
        model: ['baseURL', 'model', 'apiKey', 'disableThinking'],
        rules: ['rules'],
        batch: ['outputRoot', 'maxRounds', 'dryRun', 'showSidebarEntry'],
        guide: [],
      }
      const tabs = ['model', 'rules', 'batch', 'guide']
      const strategySelect = (value, options, onChange, disabled = false) => h('select', {
        className: 'ma-input ma-select', value, disabled, onChange: (event) => onChange(event.target.value),
      }, ...options.map((option) => h('option', { key: option, value: option }, t(`strategy.${option}`))))

      const modelPanel = () => h('div', { className: 'ma-panel' },
        h('div', { className: 'ma-card' },
          h('div', { className: 'ma-grid' },
            h('label', { className: 'ma-field' }, t('model.endpoint'),
              h('input', {
                className: 'ma-input', value: endpoint,
                onChange: (event) => setEndpoint(event.target.value),
                placeholder: 'http://127.0.0.1:11434/v1',
              })),
            h('label', { className: 'ma-field' }, t('model.name'),
              h('input', {
                className: 'ma-input', value: model,
                onChange: (event) => setModel(event.target.value),
                placeholder: t('model.namePlaceholder'),
              })),
            h('label', { className: 'ma-field ma-wide' }, t('model.key'),
              h('input', {
                className: 'ma-input', value: apiKey, type: 'password', autoComplete: 'off',
                onChange: (event) => { setApiKey(event.target.value); setClearKey(false) },
                placeholder: config?.hasApiKey && !clearKey ? t('model.keySaved') : '',
              })),
          ),
          config?.hasApiKey
            ? h('label', { className: 'ma-check' },
              h('input', { type: 'checkbox', checked: clearKey, onChange: (event) => { setClearKey(event.target.checked); if (event.target.checked) setApiKey('') } }),
              t('model.keyClear'))
            : null,
          dirty.includes('apiKey') ? h('p', { className: 'ma-hint' }, t('save.keyNote')) : null,
          h('label', { className: 'ma-check' },
            h('input', { type: 'checkbox', checked: disableThinking, onChange: (event) => setDisableThinking(event.target.checked) }),
            t('model.thinking')),
          h('div', { className: 'ma-actions' },
            h('button', { className: 'ma-btn ma-small', onClick: testConnection, disabled: testing },
              testing ? t('model.testing') : t('model.test')),
            h('span', { className: pingClass }, pingText()),
          ),
        ),
      )

      const rulesPanel = () => h('div', { className: 'ma-panel' },
        h('div', { className: 'ma-card' },
          h('div', { className: 'ma-block-head' },
            h('div', {},
              h('h3', {}, t('rules.idTitle')),
              h('p', { className: 'ma-hint' }, t('rules.idHint'))),
            h('div', { className: 'ma-actions' },
              h('select', {
                className: 'ma-input ma-select', value: '',
                onChange: (event) => {
                  const value = event.target.value
                  if (value) setIdentifierPolicy(Object.fromEntries(schema.identifiers.map((item) => [item.id, value])))
                },
              },
              h('option', { value: '' }, t('rules.setAll')),
              ...['pseudonym', 'mask', 'redact', 'keep'].map((value) => h('option', { key: value, value }, t(`strategy.${value}`)))),
              h('button', { className: 'ma-btn ma-small', onClick: resetRules, disabled: !config }, t('rules.reset')),
            ),
          ),
          h('div', { className: 'ma-rules' }, ...schema.identifiers.map((item) => {
            const strategy = identifierPolicy[item.id] ?? 'pseudonym'
            const example = `${item.sample} → ${item.examples?.[strategy] ?? ''}`
            return h('div', { key: item.id, className: 'ma-rule' },
              h('span', { className: 'ma-rule-name' }, item.type),
              strategySelect(strategy, ['pseudonym', 'mask', 'redact', 'keep'],
                (value) => setIdentifierPolicy({ ...identifierPolicy, [item.id]: value })),
              h('span', { className: 'ma-mono', title: example }, example))
          })),
        ),
        h('div', { className: 'ma-card' },
          h('div', { className: 'ma-block-head' },
            h('div', {},
              h('h3', {}, t('rules.quasiTitle')),
              h('p', { className: 'ma-hint' }, t('rules.quasiHint'))),
          ),
          h('label', { className: 'ma-check' },
            h('input', { type: 'checkbox', checked: quasiOn, onChange: (event) => setQuasiOn(event.target.checked) }),
            t('rules.quasiToggle')),
          h('div', { className: 'ma-rules' }, ...schema.quasi.map((item) => {
            const strategy = quasiPolicy[item.id] ?? item.default
            const example = `${item.sample} → ${item.examples?.[strategy] ?? ''}`
            return h('div', { key: item.id, className: `ma-rule${quasiOn ? '' : ' ma-off'}` },
              h('span', { className: 'ma-rule-name' }, item.type),
              strategySelect(strategy, item.strategies,
                (value) => setQuasiPolicy({ ...quasiPolicy, [item.id]: value }), !quasiOn),
              h('span', { className: 'ma-mono', title: example }, example))
          })),
        ),
      )

      const batchPanel = () => h('div', { className: 'ma-panel' },
        h('div', { className: 'ma-card' },
          h('h3', {}, t('run.title')),
          h('div', { className: 'ma-grid' },
            h('label', { className: 'ma-field' }, t('run.output'),
              h('input', {
                className: 'ma-input', value: outputRoot,
                onChange: (event) => setOutputRoot(event.target.value),
                placeholder: t('run.outputDefault'),
              })),
            h('label', { className: 'ma-field' }, t('run.rounds'),
              h('input', {
                className: 'ma-input', type: 'number', min: 1, max: 6, value: maxRounds,
                onChange: (event) => setMaxRounds(Number(event.target.value)),
              })),
          ),
          h('label', { className: 'ma-check' },
            h('input', { type: 'checkbox', checked: dryRun, onChange: (event) => setDryRun(event.target.checked) }),
            t('run.dry')),
          h('hr', { className: 'ma-divider' }),
          h('h3', {}, t('ui.title')),
          h('label', { className: 'ma-check' },
            h('input', { type: 'checkbox', checked: showSidebar, onChange: (event) => setShowSidebar(event.target.checked) }),
            t('ui.sidebar')),
          h('p', { className: 'ma-hint' }, t('ui.sidebarHint')),
        ),
      )

      const panels = { model: modelPanel, rules: rulesPanel, batch: batchPanel, guide: () => h('div', { className: 'ma-panel' }, h(GuideBody)) }

      return h('section', { className: 'ma-section ma-settings' },
        h('style', { key: 'ma-style' }, CSS),
        h('h2', { className: 'ma-heading' }, t('settings.title')),
        h('p', { className: 'ma-intro' }, t('settings.short')),
        error ? h('div', { className: 'ma-banner' }, `${t('error.title')}: ${error}`) : null,
        h('div', { className: 'ma-tabs', role: 'tablist' }, ...tabs.map((id) => {
          const unsaved = tabFields[id].some((field) => dirty.includes(field))
          return h('button', {
            key: id, type: 'button', role: 'tab', className: 'ma-tab',
            'aria-selected': tab === id ? 'true' : 'false',
            onClick: () => setTab(id),
          }, t(`tab.${id}`), unsaved ? h('span', { className: 'ma-dot', title: t('tab.unsaved'), 'aria-label': t('tab.unsaved') }) : null)
        })),
        h('div', { role: 'tabpanel' }, panels[tab]()),
        h('div', { className: 'ma-savebar' },
          h('span', { className: notice ? 'ma-hint ma-ok' : (dirty.length > 0 ? 'ma-hint ma-warn' : 'ma-hint') }, saveHint),
          h('button', { className: 'ma-btn', onClick: () => { if (config) applyConfig(config); setNotice('') }, disabled: saving || dirty.length === 0 },
            t('save.revert')),
          h('button', { className: 'ma-btn ma-primary', onClick: save, disabled: saving || !config || dirty.length === 0 },
            saving ? t('save.saving') : t('save.save')),
        ),
      )
    }

    // ── Left sidebar → Anonymize: run batches, history, reports ────────────

    function AnonymizerPage() {
      const t = services.t
      const [config, setConfig] = React.useState(null)
      const [inputDir, setInputDir] = React.useState('')
      const [outputRoot, setOutputRoot] = React.useState('')
      const [dryRun, setDryRun] = React.useState(true)
      const [runs, setRuns] = React.useState([])
      const [activeId, setActiveId] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [reportText, setReportText] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [cancelling, setCancelling] = React.useState(false)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [copied, setCopied] = React.useState(false)
      const reportLoaded = React.useRef(new Set())

      React.useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const info = await call('config')
            if (!alive) return
            setConfig(info)
            setOutputRoot(info.outputRoot ?? '')
            setDryRun(info.dryRun !== false)
          } catch (cause) {
            if (alive) setError(message(cause))
          }
        })()
        return () => { alive = false }
      }, [])

      React.useEffect(() => {
        let alive = true
        async function tick() {
          try {
            const list = await call('list')
            if (!alive) return
            setRuns(list.runs ?? [])
            if (activeId) {
              const response = await call('status', { runId: activeId })
              if (!alive) return
              const run = response?.run ?? null
              setDetail(run)
              if (run && run.status !== 'running' && !reportLoaded.current.has(run.id)) {
                reportLoaded.current.add(run.id)
                try {
                  const report = await call('report', { runId: run.id })
                  if (alive) setReportText(report.markdown ?? '')
                } catch { reportLoaded.current.delete(run.id) }
              }
            }
          } catch { /* transient while the host reloads */ }
        }
        tick()
        const timer = setInterval(tick, 2500)
        return () => { alive = false; clearInterval(timer) }
      }, [activeId])

      async function refreshRuns() {
        try {
          setRuns((await call('list')).runs ?? [])
        } catch (cause) {
          setError(message(cause))
        }
      }

      function selectRun(id) {
        setActiveId(id === activeId ? null : id)
        setDetail(null)
        setReportText('')
        reportLoaded.current.delete(id)
      }

      async function browse() {
        try {
          const uiWorkspace = services.ctx.get('uiWorkspace')
          if (!uiWorkspace?.pickDirectory) throw new Error(`${t('form.browse')} unavailable`)
          const picked = await uiWorkspace.pickDirectory()
          if (picked) setInputDir(picked)
        } catch (cause) {
          setError(message(cause))
        }
      }

      async function start() {
        setError('')
        setNotice('')
        if (!inputDir.trim()) {
          setError(t('form.inputRequired'))
          return
        }
        setBusy(true)
        try {
          // Model, endpoint, key, thinking mode and rounds come from the saved
          // configuration; only per-batch choices are sent.
          const result = await call('start', { inputDir: inputDir.trim(), outputRoot: outputRoot.trim(), dryRun })
          setNotice(t('notice.started'))
          reportLoaded.current.delete(result.runId)
          setActiveId(result.runId)
          setDetail(null)
          setReportText('')
          await refreshRuns()
        } catch (cause) {
          setError(message(cause))
        } finally {
          setBusy(false)
        }
      }

      const current = detail ?? runs.find((run) => run.id === activeId) ?? null

      async function cancelRun() {
        if (!current?.id) return
        setError('')
        setCancelling(true)
        try {
          const result = await call('cancel', { runId: current.id })
          if (result?.cancelled) setNotice(t('notice.cancelled'))
          else setError(result?.reason ?? 'cancel failed')
          await refreshRuns()
        } catch (cause) {
          setError(message(cause))
        } finally {
          setCancelling(false)
        }
      }

      async function copyPath() {
        try {
          await navigator.clipboard.writeText(current?.runDir ?? '')
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          setError('clipboard unavailable')
        }
      }

      const modelLine = config
        ? (config.model ? t('page.model', { model: config.model, endpoint: config.baseURL }) : t('page.noModel'))
        : ''

      return h('div', { className: 'ma-page' },
        h('style', { key: 'ma-style' }, CSS),
        h('div', { className: 'ma-page-inner' },
          h('h2', { className: 'ma-heading' }, t('page.title')),
          h('div', { className: 'ma-summary' },
            h('span', {}, modelLine), h('span', {}, '·'),
            h('span', {}, config ? t(config.quasiIdentifiers ? 'page.rulesQuasiOn' : 'page.rulesQuasiOff') : ''), h('span', {}, '·'),
            h('span', {}, t('page.settingsHint'))),
          error ? h('div', { className: 'ma-banner' }, `${t('error.title')}: ${error}`) : null,

          h('div', { className: 'ma-card' },
            h('h3', {}, t('form.title')),
            h('div', { className: 'ma-grid' },
              h('label', { className: 'ma-field ma-wide' }, t('form.input'),
                h('div', { className: 'ma-inline' },
                  h('input', {
                    className: 'ma-input', value: inputDir,
                    onChange: (event) => setInputDir(event.target.value),
                    placeholder: t('form.inputPlaceholder'),
                  }),
                  h('button', { className: 'ma-btn', onClick: browse }, t('form.browse')),
                )),
              h('label', { className: 'ma-field ma-wide' }, t('form.output'),
                h('input', {
                  className: 'ma-input', value: outputRoot,
                  onChange: (event) => setOutputRoot(event.target.value),
                  placeholder: t('run.outputDefault'),
                })),
            ),
            h('label', { className: 'ma-check' },
              h('input', { type: 'checkbox', checked: dryRun, onChange: (event) => setDryRun(event.target.checked) }),
              t('form.dry')),
            h('div', { className: 'ma-actions' },
              h('button', { className: 'ma-btn ma-primary', onClick: start, disabled: busy },
                busy ? t('form.starting') : t('form.start')),
              notice ? h('span', { className: 'ma-hint ma-ok' }, notice) : null,
            ),
          ),

          h('div', { className: 'ma-card' },
            h('div', { className: 'ma-card-head' },
              h('h3', {}, t('runs.title')),
              h('button', { className: 'ma-btn ma-small', onClick: refreshRuns }, t('runs.refresh')),
            ),
            runs.length === 0
              ? h('p', { className: 'ma-empty' }, t('runs.empty'))
              : h('table', { className: 'ma-table' },
                h('thead', {}, h('tr', {},
                  h('th', {}, t('runs.time')),
                  h('th', {}, t('runs.input')),
                  h('th', {}, t('runs.status')),
                  h('th', {}, t('runs.files')),
                  h('th', {}, t('runs.entities')),
                  h('th', {}, t('runs.unresolved')),
                )),
                h('tbody', {}, runs.map((run) => h('tr', {
                  key: run.id,
                  className: `ma-click${run.id === activeId ? ' ma-selected' : ''}`,
                  onClick: () => selectRun(run.id),
                },
                  h('td', {}, formatTime(run.startedAt)),
                  h('td', { className: 'ma-mono', title: run.inputDir ?? '' }, baseName(run.inputDir)),
                  h('td', {}, h('span', { className: statusClass(run.status) },
                    `${t(`status.${run.status}`)}${run.dryRun ? ` · ${t('detail.dry')}` : ''}`)),
                  h('td', {}, String(run.files ?? 0)),
                  h('td', {}, String(run.entities ?? 0)),
                  h('td', {}, String(run.unresolved ?? 0)),
                ))),
              ),
          ),

          current
            ? h('div', { className: 'ma-card' },
              h('div', { className: 'ma-card-head' },
                h('h3', {}, `${t('detail.title')} · ${current.id}`),
                current.status === 'running'
                  ? h('button', { className: 'ma-btn ma-small', onClick: cancelRun, disabled: cancelling },
                    cancelling ? t('run.cancelling') : t('run.cancel'))
                  : null,
                current.status ? h('span', { className: statusClass(current.status) }, t(`status.${current.status}`)) : null,
                h('button', { className: 'ma-btn ma-small', onClick: () => selectRun(current.id) }, t('detail.close')),
              ),
              current.runDir
                ? h('div', { className: 'ma-path' },
                  h('span', { className: 'ma-mono' }, current.runDir),
                  h('button', { className: 'ma-btn ma-small', onClick: copyPath }, copied ? t('detail.copied') : t('detail.copy')))
                : null,
              h('div', { className: 'ma-stats' },
                stat(t('runs.files'), current.totals?.files ?? current.files?.length ?? 0),
                stat(t('runs.entities'), current.totals?.entities ?? 0),
                stat(t('runs.unresolved'), current.totals?.unresolved ?? 0),
                stat(t('detail.dry'), current.dryRun ? '✓' : '—'),
              ),
              h('h4', {}, t('detail.files')),
              !Array.isArray(current.files) || current.files.length === 0
                ? h('p', { className: 'ma-empty' }, t('detail.noFiles'))
                : h('table', { className: 'ma-table' },
                  h('thead', {}, h('tr', {},
                    h('th', {}, t('runs.file')),
                    h('th', {}, t('runs.status')),
                    h('th', {}, t('runs.entities')),
                    h('th', {}, t('runs.rounds')),
                  )),
                  h('tbody', {}, current.files.map((file) => h('tr', { key: file.relPath },
                    h('td', { className: 'ma-mono' }, file.relPath),
                    h('td', {}, h('span', { className: statusClass(file.status) }, t(`file.${file.status}`))),
                    h('td', {}, String(Array.isArray(file.entities)
                      ? file.entities.reduce((sum, entity) => sum + entity.count, 0)
                      : (file.entities ?? 0))),
                    h('td', {}, String(file.rounds ?? 0)),
                  ))),
                ),
              h('h4', {}, t('detail.report')),
              current.status === 'running'
                ? h('p', { className: 'ma-empty' }, t('detail.noReport'))
                : (reportText
                  ? h('pre', { className: 'ma-pre' }, reportText)
                  : h('p', { className: 'ma-empty' }, t('detail.loading'))),
            )
            : null,
        ),
      )
    }

    // Original artwork: a medical record (clipboard with a cross) whose text
    // lines are redacted, drawn in currentColor so it follows the theme.
    function AnonymizerIcon({ size = 16 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
      h('rect', { x: 4.5, y: 4, width: 15, height: 17.5, rx: 2.2 }),
      h('rect', { x: 9, y: 2.5, width: 6, height: 3, rx: 1 }),
      h('path', { d: 'M12 8.3v4.4M9.8 10.5h4.4' }),
      h('path', { d: 'M8 15.6h8', strokeWidth: 2.4 }),
      h('path', { d: 'M8 18.4h4.5', strokeWidth: 2.4 }))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        services.ctx = ctx
        services.t = tFactory(ctx)
        const t = services.t
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'medical-anonymizer',
          order: 30,
          label: () => t('nav'),
        }, SettingsSection))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, AnonymizerPage))
        // The sidebar entry is user-toggleable (Settings → Interface). It is
        // shown by default and removed once the saved config says otherwise.
        let disposeEntry = null
        services.setSidebarVisible = (visible) => {
          if (visible && !disposeEntry) {
            disposeEntry = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 30,
              label: () => t('panel'),
            }, AnonymizerIcon))
          } else if (!visible && disposeEntry) {
            disposeEntry()
            disposeEntry = null
          }
        }
        services.setSidebarVisible(true)
        let stopped = false
        ;(async () => {
          for (let attempt = 0; attempt < 10 && !stopped; attempt += 1) {
            try {
              const info = await call('config')
              if (!stopped) services.setSidebarVisible(info.showSidebarEntry !== false)
              return
            } catch {
              await new Promise((resolve) => setTimeout(resolve, 1000))
            }
          }
        })()
        ctx.effect?.(() => () => {
          stopped = true
          services.setSidebarVisible?.(false)
          services.setSidebarVisible = null
        })
      },
    }
  },
})
