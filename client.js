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
      'rules.allowTitle': '排除误判',
      'rules.allowHint': '报告里出现误判时在这里排除，然后重新运行。每行一项；之前误存进映射库的对应关系会在下次运行时移除。',
      'rules.allowValues': '不匹配的值（这些值永远不当作标识符，如 01、居民身份证、科室名称）',
      'rules.skipFields': '不处理的字段（列名或 JSON 键名，不区分大小写，如 ADMN_BED_NO；这些字段原样输出）',
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
      'run.outputDefault': '留空：输入目录旁的 _medical-anonymizer',
      'run.rounds': '最大轮次',
      'run.maxFiles': '每组文件数（超出自动分组，不丢文件）',
      'run.concurrency': '同时处理的文件数',
      'run.maxDicom': '单批 DICOM 文件上限',
      'model.timeout': '单次模型调用超时（秒）',
      'model.temperature': '温度（0 最稳定）',
      'vault.title': '映射库加密',
      'vault.hint': '设置口令后，映射库（原值 ↔ 假名）用 AES-256-GCM 加密保存；口令写入本机 profile 配置文件（权限 600），之后不再显示。',
      'vault.on': '当前：已加密（留空表示不修改口令）',
      'vault.off': '当前：未加密（映射库为权限 600 的明文 JSON）',
      'vault.pass': '新口令（至少 8 个字符）',
      'vault.confirm': '再次输入新口令',
      'vault.mismatch': '两次输入的口令不一致',
      'vault.clear': '取消加密（清除已保存的口令）',
      'vault.warn': '注意：口令只用于读写映射库，不会转换已有文件。未加密的映射库在下次运行时会被加密；已用旧口令加密的映射库，改口令或取消加密后将无法读取，批次会报错。请先确认没有要继续使用的旧映射库，并牢记口令——丢失后无法找回。',
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
      'field.maxFiles': '每组文件数',
      'field.concurrency': '并发文件数',
      'field.maxDicomFiles': 'DICOM 上限',
      'field.timeoutMs': '模型超时',
      'field.temperature': '温度',
      'field.vaultPassphrase': '映射库口令',
      'page.title': '医疗数据匿名化',
      'page.model': '模型：{model} · {endpoint}',
      'page.noModel': '未配置模型，只跑规则层',
      'page.settingsHint': '在 设置 → 医疗数据匿名化 中修改',
      'form.title': '新建批次',
      'form.input': '输入目录或文件',
      'form.inputPlaceholder': '/path/to/records 或 /path/to/note.txt',
      'form.browse': '浏览…',
      'form.output': '输出根目录',
      'form.start': '开始匿名化',
      'form.starting': '正在启动…',
      'form.inputRequired': '请先选择输入目录或文件。',
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
      'detail.copy': '复制交付数据路径',
      'detail.copied': '已复制',
      'detail.loading': '加载中…',
      'detail.noReport': '批次尚未结束，报告将在完成后生成。',
      'detail.progress': '进行中：{file} · {step}{round}，已调用模型 {calls} 次',
      'detail.round': ' · 第 {round} 轮',
      'detail.files': '文件明细',
      'detail.noFiles': '暂无文件记录。',
      'detail.calls': '模型调用',
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
      'ws.title': '医疗数据匿名化处理流水线',
      'ws.subtitle': 'Medical Data De-identification Pipeline',
      'ws.idle': '空闲',
      'ws.stop': '■ 停止批次',
      'ws.feed': '数据输入',
      'ws.lineBusy': '正在处理…',
      'ws.line': '处理流程',
      'ws.conveyor': '文件队列',
      'ws.kActive': '处理中',
      'ws.kDone': '已完成',
      'ws.kIdle': '未开始',
      'ws.load': '{count} 个文件处理中',
      'ws.passed': '已完成',
      'ws.st.prescan': '预扫描',
      'ws.st.read': '解析',
      'ws.st.discover': '识别',
      'ws.st.verify': '核验',
      'ws.st.repair': '修正',
      'ws.st.rescan': '批次复扫',
      'ws.st.dicom': 'DICOM',
      'ws.st.pack': '输出',
      'ws.sub.prescan': '批次字典·路径匿名',
      'ws.sub.read': '格式解析·字段策略',
      'ws.sub.discover': '规则 + 模型识别',
      'ws.sub.verify': '残留·结构校验',
      'ws.sub.repair': '残留定向修正',
      'ws.sub.rescan': '批内 / 跨组一致性',
      'ws.sub.dicom': '元数据·UID·日期',
      'ws.sub.pack': '封装·报告·映射',
      'ws.byType': '标识符替换（按类型）',
      'ws.quality': '核验结果',
      'ws.station': '环节',
      'ws.batch': '批次',
      'ws.tab.parts': '文件',
      'ws.tab.log': '日志',
      'ws.tab.warn': '提示',
      'ws.tab.report': '报告',
      'ws.noRun': '还没有批次。在左侧选择输入数据后开始。',
      'ws.logEmpty': '批次运行时，这里实时记录每个文件经过的处理环节。',
      'ws.noWarn': '没有提示。',
      'ws.monitor': '运行监控',
      'ws.m.progress': '完成',
      'ws.m.elapsed': '用时',
      'ws.m.rate': '处理速率 文件/分',
      'ws.m.entities': '替换标识符',
      'ws.m.calls': '模型调用',
      'ws.m.tokens': 'Token 消耗',
      'ws.m.tokensHint': '模型端点返回的 token 用量合计（输入 + 输出）',
      'ws.m.noUsage': '端点未返回',
      'ws.m.review': '待复核',
      'ws.m.failed': '失败文件',
      'ws.m.mappings': '新增映射',
      'ws.m.mappingsHint': '本批次新写入映射库的「原值 → 假名」条数；之前批次已有的不计',
      'ws.m.chunks': '分组',
      'ws.model': '模型',
      'ws.rulesOnly': '仅规则',
      'ws.online': '在线',
      'ws.params': '处理参数',
      'ws.locked': '锁定',
      'ws.p.concurrency': '并发文件数',
      'ws.p.maxFiles': '每组文件数',
      'ws.p.timeout': '模型超时（秒）',
      'ws.p.temperature': '温度',
      'ws.p.noThinking': '关闭思考模式',
      'ws.p.quasi': '处理准标识符（日期/年龄/性别/邮编）',
      'ws.paramsSave': '保存参数',
      'ws.paramsSaved': '参数已保存，下一批次生效。',
      'ws.paramsLocked': '批次运行中，参数已锁定。',
      'ws.paramsHint': '保存为默认值，下一批次生效',
      'ws.unitFiles': '文件',
      'ws.del.title': '删除批次记录',
      'ws.del.records': '将删除该批次的报告、待复核副本、改进建议、模型调用记录和路径对照，并从批次记录中移除。此操作不可撤销。',
      'ws.del.deliverable': '同时删除交付数据：{path}',
      'ws.del.noDeliverable': '该批次没有交付数据',
      'ws.del.vault': '映射库保留不变：已交付的数据仍可还原。如需撤销本批次新增的映射，请使用 anonymize_undo_mappings。',
      'ws.del.cancel': '取消',
      'ws.del.go': '删除',
      'ws.del.busy': '正在删除…',
      'ws.m.mem': '内存 {now} GB（峰值 {peak} / 上限 {limit} GB，{pct}%）',
      'ws.m.memHint': '本机插件进程的堆内存（与 Harness 共用进程）。接近上限会导致进程内存不足而中断，此时应调小「每组文件数」。',
      'ws.report.full': '全屏',
      'ws.report.copy': '复制 Markdown',
      'ws.perMin': '件/分',
      'ws.spark.avg': '全程平均 {rate}（{secs} s/文件）',
      'ws.spark.now': '当前',
      'ws.spark.nowHint': '最近 2 分钟的处理速率',
      'ws.spark.peak': '峰值 {rate}（30 秒内）',
      'ws.m.remaining': '剩余',
      'ws.m.eta': '预计剩余',
      'ws.m.perFile': '平均 {secs} s/文件',
      'ws.calls.strip': '调用耗时分布',
      'ws.allSettings': '全部设置',
      'ws.helpTitle': '处理说明',
      'ws.helpHint': '查看处理说明',
      'ws.tab.calls': '模型调用',
      'ws.calls.empty': '批次开始调用模型后，这里逐条记录每次调用。',
      'ws.calls.noModel': '这一批没有配置模型，只用了规则层，没有模型调用。',
      'ws.calls.count': '{count} 次调用',
      'ws.calls.avg': '平均',
      'ws.calls.timeout': '超时',
      'ws.calls.failed': '失败',
      'ws.calls.latest': '仅显示最近 {count} 条',
      'ws.calls.segments': '片段',
      'ws.calls.ms': '耗时',
      'ws.calls.r.ok': '成功',
      'ws.calls.r.timeout': '超时',
      'ws.calls.r.bad-json': '输出无法解析',
      'ws.calls.r.cancelled': '已取消',
      'ws.calls.r.network': '连接失败',
      'ws.calls.r.empty-response': '空回复',
      'ws.src.panel': '来源：面板',
      'ws.src.command': '来源：/anonymize',
      'ws.src.agent': '来源：Agent 会话',
      'ws.src.api': '来源：其他',
      'ws.adv.title': '改进建议',
      'ws.adv.none': '批次结束后，这里会根据运行统计给出参数调整建议。',
      'ws.adv.running': '批次运行中，结束后生成建议。',
      'ws.adv.clean': '本批次没有需要调整的地方。',
      'ws.adv.allDone': '本批次的建议都已采纳。',
      'ws.adv.confirm': '需确认',
      'ws.adv.adopt': '采纳',
      'ws.adv.dismiss': '忽略',
      'ws.adv.pickFirst': '请先勾选要采纳的项。',
      'ws.adv.adopted': '已采纳：{title}。下一批次生效。',
      'ws.adv.spread': '扩散 {count} 处',
      'ws.adv.hits': '{count} 次提示',
      'ws.adv.plugin': '插件',
      'ws.adv.draftTitle': '{count} 项问题需要改进插件',
      'ws.adv.draftHint': '这些问题靠调参数解决不了。已生成改进草稿，只含问题类型、计数和扩展名，不含原值、路径和字段名。复制后发到对话里让 Agent 修改插件，或检查后提交到仓库 issue。',
      'ws.adv.copyDraft': '复制草稿',
      'ws.adv.preview': '预览',
      'ws.adv.hide': '收起',
      'ws.adv.copied': '草稿已复制。',
      'ws.adv.doneCount': '已采纳 {count} 项。',
      'ws.col.replaced': '替换数',
      'ws.reviewCopies': '待复核',
      'ws.copy': '复制',
      'ws.latest': '回到最新',
      'ws.pickDir': '选文件夹…',
      'ws.pickFile': '选文件 / zip…',
      'ws.result': '交付数据',
      'ws.records': '记录',
      'ws.stageA': '阶段 A · 识别与替换',
      'ws.stageB': '阶段 B · 修正与输出',
      'ws.loop': '残留复处理 · 最多 {rounds} 轮',
      'ws.trend': '处理速率（文件/分）',
      'ws.unitEntities': '处替换',
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
      'rules.allowTitle': 'Exclude false positives',
      'rules.allowHint': 'When the report shows a false positive, exclude it here and run again. One item per line; mappings an earlier run stored for these values are removed on the next run.',
      'rules.allowValues': 'Values that are never identifiers (e.g. 01, 居民身份证, department names)',
      'rules.skipFields': 'Fields left untouched (column or JSON key names, case-insensitive, e.g. ADMN_BED_NO; values are copied as-is)',
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
      'run.outputDefault': 'Empty: _medical-anonymizer beside the input',
      'run.rounds': 'Max rounds',
      'run.maxFiles': 'Files per chunk (larger inputs are split; nothing is dropped)',
      'run.concurrency': 'Files processed at the same time',
      'run.maxDicom': 'DICOM files per batch (cap)',
      'model.timeout': 'Model call timeout (seconds)',
      'model.temperature': 'Temperature (0 is most stable)',
      'vault.title': 'Vault encryption',
      'vault.hint': 'With a passphrase, the vault (original ↔ pseudonym) is stored AES-256-GCM encrypted. The passphrase is written to this profile\'s config file (mode 600) and never shown again.',
      'vault.on': 'Currently encrypted (leave empty to keep the passphrase)',
      'vault.off': 'Currently not encrypted (plain JSON, mode 600)',
      'vault.pass': 'New passphrase (at least 8 characters)',
      'vault.confirm': 'Repeat the new passphrase',
      'vault.mismatch': 'The two passphrases do not match',
      'vault.clear': 'Turn encryption off (clear the saved passphrase)',
      'vault.warn': 'The passphrase is only used to read and write vaults; existing files are not converted. A plain vault is encrypted on its next run; a vault encrypted with the old passphrase can no longer be read after you change or clear it, and batches using it will fail. Make sure no old vault is still needed, and keep the passphrase safe: it cannot be recovered.',
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
      'field.maxFiles': 'files per chunk',
      'field.concurrency': 'concurrency',
      'field.maxDicomFiles': 'DICOM cap',
      'field.timeoutMs': 'model timeout',
      'field.temperature': 'temperature',
      'field.vaultPassphrase': 'vault passphrase',
      'page.title': 'Medical Data Anonymization',
      'page.model': 'Model: {model} · {endpoint}',
      'page.noModel': 'No model configured; rule layer only',
      'page.settingsHint': 'Change it in Settings → Medical Data Anonymization',
      'form.title': 'New batch',
      'form.input': 'Input directory or file',
      'form.inputPlaceholder': '/path/to/records or /path/to/note.txt',
      'form.browse': 'Browse…',
      'form.output': 'Output root',
      'form.start': 'Start anonymization',
      'form.starting': 'Starting…',
      'form.inputRequired': 'Choose an input directory or file first.',
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
      'detail.copy': 'Copy result path',
      'detail.copied': 'Copied',
      'detail.loading': 'Loading…',
      'detail.noReport': 'The batch is still running; the report appears when it finishes.',
      'detail.progress': 'In progress: {file} · {step}{round}; {calls} model calls so far',
      'detail.round': ' · round {round}',
      'detail.files': 'Files',
      'detail.noFiles': 'No file records.',
      'detail.calls': 'Model calls',
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
      'ws.title': 'Medical Data De-identification Pipeline',
      'ws.subtitle': 'Pseudonymization · verification · audit',
      'ws.idle': 'Idle',
      'ws.stop': '■ Stop batch',
      'ws.feed': 'Input',
      'ws.lineBusy': 'Processing…',
      'ws.line': 'Pipeline',
      'ws.conveyor': 'File queue',
      'ws.kActive': 'Processing',
      'ws.kDone': 'Done',
      'ws.kIdle': 'Not started',
      'ws.load': '{count} files in progress',
      'ws.passed': 'Done',
      'ws.st.prescan': 'Prescan',
      'ws.st.read': 'Parse',
      'ws.st.discover': 'Detect',
      'ws.st.verify': 'Verify',
      'ws.st.repair': 'Remediate',
      'ws.st.rescan': 'Batch rescan',
      'ws.st.dicom': 'DICOM',
      'ws.st.pack': 'Output',
      'ws.sub.prescan': 'Dictionary · path names',
      'ws.sub.read': 'Format · field policy',
      'ws.sub.discover': 'Rules + model',
      'ws.sub.verify': 'Residuals · structure',
      'ws.sub.repair': 'Targeted remediation',
      'ws.sub.rescan': 'Within / across chunks',
      'ws.sub.dicom': 'Metadata · UID · dates',
      'ws.sub.pack': 'Package · report · map',
      'ws.byType': 'Identifiers replaced, by type',
      'ws.quality': 'Verification',
      'ws.station': 'Stage',
      'ws.batch': 'Batch',
      'ws.tab.parts': 'Files',
      'ws.tab.log': 'Log',
      'ws.tab.warn': 'Notices',
      'ws.tab.report': 'Report',
      'ws.noRun': 'No batches yet. Choose input data on the left to start.',
      'ws.logEmpty': 'While a batch runs, each processing stage a file passes is logged here.',
      'ws.noWarn': 'No notices.',
      'ws.monitor': 'Run monitor',
      'ws.m.progress': 'Done',
      'ws.m.elapsed': 'Elapsed',
      'ws.m.rate': 'Files / min',
      'ws.m.entities': 'Identifiers replaced',
      'ws.m.calls': 'Model calls',
      'ws.m.tokens': 'Tokens',
      'ws.m.tokensHint': 'Total tokens reported by the model endpoint (prompt + completion)',
      'ws.m.noUsage': 'not reported',
      'ws.m.review': 'To review',
      'ws.m.failed': 'Failed files',
      'ws.m.mappings': 'New mappings',
      'ws.m.mappingsHint': 'Original → pseudonym pairs this batch added to the vault; earlier ones are not counted',
      'ws.m.chunks': 'Chunks',
      'ws.model': 'Model',
      'ws.rulesOnly': 'Rules only',
      'ws.online': 'Online',
      'ws.params': 'Processing settings',
      'ws.locked': 'LOCKED',
      'ws.p.concurrency': 'Concurrent files',
      'ws.p.maxFiles': 'Files per chunk',
      'ws.p.timeout': 'Model timeout (s)',
      'ws.p.temperature': 'Temperature',
      'ws.p.noThinking': 'Disable thinking',
      'ws.p.quasi': 'Process quasi-identifiers (date/age/sex/postal)',
      'ws.paramsSave': 'Save',
      'ws.paramsSaved': 'Saved; the next batch uses these values.',
      'ws.paramsLocked': 'Locked while a batch runs.',
      'ws.paramsHint': 'Saved as defaults for the next batch',
      'ws.unitFiles': 'files',
      'ws.del.title': 'Delete batch record',
      'ws.del.records': 'Deletes this batch\'s report, review copies, advice, model-call log and path map, and removes it from the history. This cannot be undone.',
      'ws.del.deliverable': 'Also delete the deliverable: {path}',
      'ws.del.noDeliverable': 'This batch has no deliverable',
      'ws.del.vault': 'The vault is kept, so delivered data can still be restored. Use anonymize_undo_mappings to withdraw this batch\'s new mappings.',
      'ws.del.cancel': 'Cancel',
      'ws.del.go': 'Delete',
      'ws.del.busy': 'Deleting…',
      'ws.m.mem': 'Memory {now} GB (peak {peak} / limit {limit} GB, {pct}%)',
      'ws.m.memHint': 'Heap of the local plugin process (shared with the Harness). Near the limit the process can run out of memory; lower Files per chunk.',
      'ws.report.full': 'Full screen',
      'ws.report.copy': 'Copy Markdown',
      'ws.perMin': '/min',
      'ws.spark.avg': 'overall {rate} ({secs} s/file)',
      'ws.spark.now': 'now',
      'ws.spark.nowHint': 'Throughput over the last 2 minutes',
      'ws.spark.peak': 'peak {rate} (30 s)',
      'ws.m.remaining': 'Left',
      'ws.m.eta': 'ETA',
      'ws.m.perFile': '{secs} s/file',
      'ws.calls.strip': 'Call durations',
      'ws.allSettings': 'All settings',
      'ws.helpTitle': 'Processing reference',
      'ws.helpHint': 'Processing reference',
      'ws.tab.calls': 'Model calls',
      'ws.calls.empty': 'Each model call is listed here once the batch starts calling the model.',
      'ws.calls.noModel': 'This batch ran without a model (rules only); there are no model calls.',
      'ws.calls.count': '{count} calls',
      'ws.calls.avg': 'avg',
      'ws.calls.timeout': 'timeouts',
      'ws.calls.failed': 'failed',
      'ws.calls.latest': 'latest {count} shown',
      'ws.calls.segments': 'Segments',
      'ws.calls.ms': 'Time',
      'ws.calls.r.ok': 'OK',
      'ws.calls.r.timeout': 'Timeout',
      'ws.calls.r.bad-json': 'Unparsable',
      'ws.calls.r.cancelled': 'Cancelled',
      'ws.calls.r.network': 'Unreachable',
      'ws.calls.r.empty-response': 'Empty reply',
      'ws.src.panel': 'From: page',
      'ws.src.command': 'From: /anonymize',
      'ws.src.agent': 'From: agent session',
      'ws.src.api': 'From: other',
      'ws.adv.title': 'Improvements',
      'ws.adv.none': 'After a batch finishes, setting suggestions based on its statistics appear here.',
      'ws.adv.running': 'Suggestions appear when the batch finishes.',
      'ws.adv.clean': 'Nothing to adjust for this batch.',
      'ws.adv.allDone': 'All suggestions for this batch are adopted.',
      'ws.adv.confirm': 'Confirm',
      'ws.adv.adopt': 'Adopt',
      'ws.adv.dismiss': 'Dismiss',
      'ws.adv.pickFirst': 'Tick the items to adopt first.',
      'ws.adv.adopted': 'Adopted: {title}. Applies from the next batch.',
      'ws.adv.spread': 'spread {count}',
      'ws.adv.hits': '{count} notices',
      'ws.adv.plugin': 'Plugin',
      'ws.adv.draftTitle': '{count} issues need a plugin change',
      'ws.adv.draftHint': 'Settings cannot fix these. A draft was generated with issue types, counts and extensions only, without original values, paths or field names. Paste it into a conversation for the agent to change the plugin, or review it and file an issue.',
      'ws.adv.copyDraft': 'Copy draft',
      'ws.adv.preview': 'Preview',
      'ws.adv.hide': 'Hide',
      'ws.adv.copied': 'Draft copied.',
      'ws.adv.doneCount': '{count} adopted.',
      'ws.col.replaced': 'Replaced',
      'ws.reviewCopies': 'Review',
      'ws.copy': 'Copy',
      'ws.latest': 'Latest',
      'ws.pickDir': 'Folder…',
      'ws.pickFile': 'File / zip…',
      'ws.result': 'Deliverable',
      'ws.records': 'Records',
      'ws.stageA': 'STAGE A · DETECT & REPLACE',
      'ws.stageB': 'STAGE B · REMEDIATE & OUTPUT',
      'ws.loop': 'Residual reprocessing · up to {rounds} rounds',
      'ws.trend': 'Throughput (files/min)',
      'ws.unitEntities': 'replacements',
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
          '打开左侧栏「医疗数据匿名化」，选择输入目录或文件（支持 .zip），点「开始」。匿名化文件写到单独的输出目录，源文件只读、绝不修改。',
          '在批次详情里查看报告。发现规则误判时，修改规则后可用 anonymize_undo_mappings 撤销该批新增的映射再重跑。',
          '也可以在聊天框输入 /anonymize <目录>，或让 Agent 调用 anonymize_start 等工具。'
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
          '输出根目录/<输入名>：交付数据。输入是目录就是同名文件夹（名称中的标识符已替换），输入是单个文件就是那个文件；里面只有匿名化后的数据，可以整个拿走。同名已存在时加「 (2)」，不会覆盖旧结果。',
          '输出根目录/_records/runs/<批次号>/report.md：报告，包括每个文件的实体统计、结构校验、残留问题和人工复核清单；报告里不出现原值。取消或失败的批次，部分结果留在同目录的 output/，不放到输出根目录。待复核文件的匿名化副本单独放在同目录的 review/（zip 里的也已取出），不用解压交付数据就能检查。',
          '输出根目录/_records/vault.json：映射库（原值 ↔ 假名），权限 600。它是还原钥匙，泄露等同原文泄露，请与交付数据分开保管。旧版本放在输出根目录下的 vault.json、index.json、runs/ 会在下次运行时自动移入 _records。',
          '不设置输出根目录时，写到输入目录旁的 _medical-anonymizer 文件夹（旧版本的隐藏目录 .medical-anonymizer 会在下次运行时自动改名沿用）；以后对上级目录做匿名化时会自动跳过它。模型调用次数不设上限；报告会记录源文件在运行前后是否一致。',
        ] },
        { title: '注意事项', items: [
          '模型会看到原文。请使用本机或可信内网的模型端点，不要用公网云服务处理患者数据。',
          '默认只处理直接标识符。开启准标识符后也只覆盖日期、年龄、性别、邮编的文本值；科室、机构代码等不处理。文件名和目录名里的姓名、证件号、手机号、病人编号、住院号/门诊号会替换，原路径对照写在 path-map.json（与映射库同样敏感）。',
          '部分遮盖会保留一部分原值，且不可还原；需要能还原时请用稳定假名。日期平移后不要对输出再跑一遍，否则会被平移两次。',
          '不支持 Word、PDF、图片；DICOM 只处理元数据。zip 会解压到临时目录处理后重新打包（嵌套最多 3 层，有防 zip 炸弹限制）。跳过的文件在报告的「注意」里列出；文件很多时自动分组处理，不丢文件。',
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
          'Open Medical Anonymization in the left sidebar, choose an input directory or file (.zip supported), and press Start. Output goes to a separate folder; source files are read-only and never modified.',
          'Read the report in the batch detail. If a rule misfired, fix the rule, withdraw that batch\'s new mappings with anonymize_undo_mappings, and run again.',
          'You can also type /anonymize <dir> in the composer or ask the agent to use anonymize_start and the related tools.'
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
          '<output root>/<input name>: the finished result — a folder named after the input directory (identifiers in the name replaced), or the single file. It holds anonymized data only and can be taken as is. An existing name gets " (2)"; earlier results are never overwritten.',
          '<output root>/_records/runs/<batch>/report.md: per-file counts, structure checks, leftovers, and the manual-review list; no original values. A cancelled or failed batch keeps its partial result in output/ there, not in the output root. Anonymized copies of files that need review are placed loose in review/ there (taken out of zips too), so they can be checked without unpacking the result.',
          '<output root>/_records/vault.json: original ↔ pseudonym map, mode 600. It is the re-identification key; store it apart from the results. vault.json, index.json and runs/ left in the output root by older versions move into _records on the next run.',
          'With no output root set, output goes to a _medical-anonymizer folder beside the input (an older hidden .medical-anonymizer is renamed and reused on the next run); it is skipped when a parent directory is anonymized later. Model calls are not capped; the report records whether source files were unchanged.',
        ] },
        { title: 'Cautions', items: [
          'The model sees the original text. Use a local or trusted internal endpoint, never a public cloud service, for patient data.',
          'By default only direct identifiers are processed. Quasi-identifier handling covers text values of date, age, sex, and postal code only; department and institution codes are not touched, while names, ID and phone numbers, patient numbers, and admission/visit numbers in file and folder names are replaced (the original-path map is saved as path-map.json, as sensitive as the vault).',
          'Partial masks keep part of the original and cannot be reversed; use pseudonyms when you need restoration. Do not re-run date shifting on its own output, or dates shift twice.',
          'Word, PDF, and images are not supported; DICOM gets metadata-only processing. Zip archives are extracted to a temporary folder and re-packed (up to 3 nesting levels, with zip-bomb limits). Skipped files are listed in the report; large inputs are split into chunks automatically, nothing is dropped.',
          'Review every Needs review item before publishing. This tool is not a compliance certification.',
        ] },
      ],
    }

    const CSS = `
      .ma-section{max-width:820px;display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary)}
      .ma-section.ma-settings{max-width:none;box-sizing:border-box;height:calc(min(800px, calc(100vh - 2 * max(24px, var(--dsh-frame-overlay-top,24px)))) - 78px)}
      .ma-settings>*{flex:none}
      .ma-settings>[role=tabpanel]{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;margin-right:calc(-1 * var(--ma-shell-pad,24px));padding-right:var(--ma-shell-pad,24px)}
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
      .ma-textarea{height:auto;min-height:84px;padding:6px 9px;resize:vertical;font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:12px;line-height:1.5}
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
      .ma-savebar{position:relative;z-index:2;display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 calc(-1 * var(--ma-shell-pad,24px)) calc(-1 * var(--ma-shell-pad,24px));padding:12px var(--ma-shell-pad,24px) 16px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
      .ma-tabs{display:flex;gap:2px;box-shadow:inset 0 -1px 0 var(--dsw-alias-border-l2);overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
      .ma-tabs::-webkit-scrollbar{display:none}
      .ma-tab{position:relative;flex:none;display:inline-flex;align-items:center;gap:6px;background:none;border:0;border-bottom:2px solid transparent;padding:8px 12px;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}
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

    const WS_CSS = `
      .ws-page{height:100%;overflow:hidden;padding:10px 14px 12px;display:flex;flex-direction:column;gap:10px;font-size:13px}
      .ws-page .ma-mono{word-break:normal}
      .ws-head{flex:none;display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:6px 12px 6px calc(12px + var(--ws-inset,0px));border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
      .ws-brand{display:flex;align-items:center;gap:10px;flex:1;min-width:220px}
      .ws-brand h2{margin:0;font-size:15px;font-weight:700;letter-spacing:.5px}
      .ws-brand>div>span{font-size:11px;color:var(--dsw-alias-label-secondary);letter-spacing:1px;text-transform:uppercase}
      .ws-brand-mark{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:var(--ws-accent);color:#fff}
      .ws-status{display:flex;align-items:center;gap:8px;padding:4px 12px 4px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);min-width:150px}
      .ws-status>div{display:flex;flex-direction:column;line-height:16px}
      .ws-status b{font-size:13px}
      .ws-clock{display:flex;flex-direction:column;align-items:flex-end;line-height:16px;padding:0 4px}
      .ws-clock span{font-size:10px;color:var(--dsw-alias-label-secondary);letter-spacing:1px}
      .ws-clock b{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:18px;font-weight:600;letter-spacing:1px;line-height:22px}
      .ws-head-actions{display:flex;gap:8px}
      .ws-stop{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
      .ws-lamp{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--dsw-alias-border-l2);flex:none}
      .ws-s-running .ws-lamp{background:var(--dsw-alias-state-warn-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-warn-primary) 25%,transparent);animation:ws-blink 1.2s infinite}
      .ws-s-completed .ws-lamp{background:var(--dsw-alias-state-success-primary)}
      .ws-s-review .ws-lamp{background:var(--dsw-alias-state-warn-primary)}
      .ws-s-failed .ws-lamp,.ws-s-cancelled .ws-lamp{background:var(--dsw-alias-state-error-primary)}
      @keyframes ws-blink{50%{opacity:.35}}
      .ws-grid{flex:1;min-height:0;display:grid;grid-template-columns:minmax(230px,270px) minmax(0,1fr) minmax(270px,300px);gap:10px;align-items:stretch}
      .ws-col{display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0}
      .ws-col-right{overflow:auto;scrollbar-width:thin}
      .ws-panel{flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-1);min-width:0}
      .ws-panel-head{display:flex;align-items:center;gap:8px}
      .ws-panel-head h3{margin:0;flex:1;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
      .ws-tag{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;padding:1px 6px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);letter-spacing:1px}
      .ws-tag.ws-live{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);animation:ws-blink 1.6s infinite}
      .ws-pick{display:grid;grid-template-columns:1fr 1fr;gap:6px}
      .ws-start{height:34px;font-weight:600}
      .ws-panel.ws-grow{flex:1 1 auto;min-height:0}
      .ws-history{flex:1;min-height:0;display:flex;flex-direction:column;gap:6px;overflow:auto;margin-right:-6px;padding-right:6px}
      .ws-run{display:flex;flex-direction:column;gap:4px;text-align:left;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:inherit;font:inherit;cursor:pointer}
      .ws-run:hover{border-color:var(--dsw-alias-border-l2)}
      .ws-run-on{border-color:var(--ws-accent);box-shadow:inset 3px 0 0 var(--ws-accent)}
      .ws-run-top{display:flex;align-items:center;gap:6px}
      .ws-run-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
      .ws-run-meta{display:flex;flex-direction:column;font-size:11px;color:var(--dsw-alias-label-secondary)}
      .ws-floor{background-color:var(--dsw-alias-bg-layer-1);background-image:linear-gradient(var(--dsw-alias-border-l1) 1px,transparent 1px),linear-gradient(90deg,var(--dsw-alias-border-l1) 1px,transparent 1px);background-size:22px 22px;background-position:-1px -1px}
      .ws-legend{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary)}
      .ws-legend i{width:8px;height:8px;border-radius:2px;margin-left:6px}
      .ws-k-active{background:var(--ws-accent)}
      .ws-k-done{background:var(--dsw-alias-state-success-primary)}
      .ws-k-idle{background:var(--dsw-alias-border-l2)}
      .ws-line{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 18px;padding:2px}
      .ws-station{position:relative;display:flex;flex-direction:column;gap:1px;padding:6px 9px;border-radius:8px;border:1.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);transition:border-color .2s,box-shadow .2s}
      .ws-station:not(:last-child)::after{content:'';position:absolute;top:50%;right:-17px;width:16px;border-top:2px dashed var(--dsw-alias-border-l2)}
      .ws-station:nth-child(4n)::after{display:none}
      .ws-moving .ws-station::after{border-top-color:var(--ws-accent);animation:ws-flow .8s linear infinite}
      @keyframes ws-flow{to{opacity:.3}}
      .ws-station-top{display:flex;align-items:center;justify-content:space-between}
      .ws-station-no{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-secondary)}
      .ws-station-name{font-size:13px;font-weight:700}
      .ws-station-sub{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ws-station-load{margin-top:2px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-secondary)}
      .ws-station.ws-active{border-color:var(--ws-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--ws-accent) 18%,transparent)}
      .ws-station.ws-active .ws-lamp{background:var(--ws-accent);animation:ws-blink 1s infinite}
      .ws-station.ws-active .ws-station-load{color:var(--ws-accent);font-weight:600}
      .ws-station.ws-done{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-border-l2))}
      .ws-station.ws-done .ws-lamp{background:var(--dsw-alias-state-success-primary)}
      .ws-station.ws-idle{opacity:.7}
      .ws-conveyor-head{display:flex;justify-content:space-between;font-size:11px;color:var(--dsw-alias-label-secondary);letter-spacing:1px;margin-top:2px}
      .ws-bar{height:8px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);overflow:hidden}
      .ws-bar.ws-thin{height:6px;flex:1}
      .ws-bar-fill{height:100%;background:var(--ws-accent);transition:width .4s}
      .ws-pieces{display:flex;flex-wrap:wrap;gap:3px;min-height:14px;max-height:52px;overflow:auto;padding:6px;border-radius:6px;background:var(--dsw-alias-bg-base);border:1px dashed var(--dsw-alias-border-l2)}
      .ws-piece{width:10px;height:10px;border-radius:2px;background:var(--dsw-alias-border-l1);border:1px solid var(--dsw-alias-border-l2);box-sizing:border-box}
      .ws-p-clean{background:var(--dsw-alias-state-success-primary);border-color:transparent}
      .ws-p-review{background:var(--dsw-alias-state-warn-primary);border-color:transparent}
      .ws-p-failed,.ws-p-cancelled{background:var(--dsw-alias-state-error-primary);border-color:transparent}
      .ws-p-running{background:var(--ws-accent);border-color:transparent;animation:ws-blink .9s infinite}
      .ws-twin{flex:none;display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .ws-bars{display:flex;flex-direction:column;gap:4px;height:68px;overflow:auto}
      .ws-bar-row{display:grid;grid-template-columns:76px minmax(0,1fr) 44px;align-items:center;gap:8px;font-size:12px}
      .ws-bar-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ws-bar-row b{text-align:right;font-weight:600;color:var(--dsw-alias-label-primary)}
      .ws-qbar{display:flex;height:14px;border-radius:4px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
      .ws-q-clean{background:var(--dsw-alias-state-success-primary)}
      .ws-q-review{background:var(--dsw-alias-state-warn-primary)}
      .ws-q-failed{background:var(--dsw-alias-state-error-primary)}
      .ws-qlegend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .ws-qlegend span{display:inline-flex;align-items:center;gap:5px}
      .ws-qlegend i{width:8px;height:8px;border-radius:2px}
      .ws-qlegend b{color:var(--dsw-alias-label-primary)}
      .ws-path{display:flex;align-items:center;gap:8px}
      .ws-path:first-of-type{margin-top:auto}
      .ws-path-warn{background:var(--dsw-alias-state-warn-primary)!important}
      .ws-path-tag{flex:none;font-size:10px;padding:0 5px;border-radius:3px;background:var(--ws-accent);color:#fff;line-height:16px}
      .ws-path .ma-mono{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ws-panel.ws-drawer{flex:1 1 auto;min-height:120px;padding-top:2px}
      .ws-drawer-wrap{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
      .ws-drawer-body{flex:1;min-height:0;overflow:auto}
.ws-page .ws-drawer-body,.ws-page .ws-history,.ws-page .ws-col-right,.ws-page .ws-pieces,.ws-page .ws-bars{scrollbar-width:thin;scrollbar-color:transparent transparent;scrollbar-gutter:auto}
      .ws-page .ws-drawer-body:hover,.ws-page .ws-history:hover,.ws-page .ws-col-right:hover,.ws-page .ws-pieces:hover,.ws-page .ws-bars:hover{scrollbar-color:color-mix(in srgb,var(--dsw-alias-label-primary) 28%,transparent) transparent}
      .ws-page ::-webkit-scrollbar{width:6px;height:6px}
      .ws-page ::-webkit-scrollbar-track{background:transparent}
      .ws-page ::-webkit-scrollbar-thumb{background:transparent;border-radius:3px}
      .ws-page :hover::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dsw-alias-label-primary) 28%,transparent)}
      .ws-table thead th{position:sticky;top:0;z-index:1;background:var(--ws-paper,var(--dsw-alias-bg-layer-1))}
            .ws-tag.ws-tag-hot{color:#fff;background:var(--ws-accent);border-color:var(--ws-accent)}
      .ws-panel.ws-advice{gap:8px;flex:1 0 auto}
      .ws-adv{display:flex;flex-direction:column;gap:5px;padding:8px 10px;border-radius:7px;border:1px solid color-mix(in srgb,var(--ws-ink) 12%,transparent);border-left:3px solid var(--dsw-alias-state-success-primary);background:var(--dsw-alias-bg-base)}
      .ws-adv-warn{border-left-color:var(--dsw-alias-state-warn-primary)}
      .ws-adv-confirm{border-left-color:var(--ws-accent)}
      .ws-adv-draft{border-left-color:var(--dsw-alias-label-secondary);border-left-style:dashed}
      .ws-adv-title{display:flex;align-items:center;gap:6px;font-size:12.5px}
      .ws-adv-flag{flex:none;font-size:10px;line-height:15px;padding:0 4px;border-radius:3px;color:#fff;background:var(--ws-accent)}
      .ws-adv-draft .ws-adv-flag{background:var(--dsw-alias-label-secondary)}
      .ws-adv-reason{margin:0;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary)}
      .ws-adv-choices{display:flex;flex-direction:column;gap:3px;max-height:140px;overflow:auto}
      .ws-adv-choice{display:grid;grid-template-columns:auto auto minmax(0,1fr);align-items:center;gap:6px;font-size:12px;cursor:pointer}
      .ws-adv-choice i{font-style:normal;font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ws-adv-pre{max-height:180px;font-size:11px;line-height:16px}
      .ws-calls-sum{display:flex;flex-wrap:wrap;gap:4px 14px;padding:2px 0 6px;font-size:11.5px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
      .ws-c-bad{color:var(--dsw-alias-state-error-primary);font-weight:600}
      .ws-calls td{white-space:nowrap;font-size:12px;padding:4px 8px}
      .ws-calls td.ma-mono{font-size:11.5px}
      .ws-calls tr.ws-slow td{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent)}
      .ws-src{font-size:11px;color:var(--dsw-alias-label-secondary);background:none;border:0;padding:0;font:inherit;font-size:11px;text-align:left}
      .ws-src-link{color:var(--ws-accent);cursor:pointer}
      .ws-src-link:hover{text-decoration:underline}
      .ws-head .ws-brand{background:none;border:0;padding:0;margin:0;font:inherit;color:inherit;text-align:left;cursor:pointer;border-radius:8px}
      .ws-head .ws-brand:focus-visible{outline:2px solid var(--ws-accent);outline-offset:4px}
      .ws-brand-info{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;margin-left:6px;border-radius:50%;border:1px solid currentColor;font-size:9.5px;font-style:italic;font-weight:700;letter-spacing:0;vertical-align:2px;opacity:0;transition:opacity .15s;color:var(--ws-accent)}
      .ws-head .ws-brand:hover .ws-brand-info,.ws-head .ws-brand:focus-visible .ws-brand-info{opacity:1}
      .ws-help h4{margin:18px 0 8px;font-size:13px;letter-spacing:.5px;color:var(--ws-accent);border-bottom:1px solid color-mix(in srgb,var(--ws-accent) 25%,transparent);padding-bottom:4px}
      .ws-help-table{width:100%;border-collapse:collapse;font-size:12.5px}
      .ws-help-table th{text-align:left;font-weight:600;font-size:11.5px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--ws-accent) 7%,transparent);padding:5px 8px}
      .ws-help-table td{padding:5px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top;color:var(--dsw-alias-label-primary)}
      .ws-help-stage{white-space:nowrap;font-weight:600}
      .ws-help-stage em,.ws-hf-node em{font-style:normal;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--dsw-alias-label-secondary);margin-right:5px}
      .ws-help-sub{margin:10px 0 6px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
      .ws-help-chips{display:flex;flex-wrap:wrap;gap:5px}
      .ws-help-chip{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:5px;font-size:12px;border:1px solid color-mix(in srgb,var(--ws-accent) 35%,transparent);background:color-mix(in srgb,var(--ws-accent) 6%,transparent)}
      .ws-help-chip i{font-style:normal;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
      .ws-hc-keep{border-color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent)}
      .ws-help-flow,.ws-help-loop{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
      .ws-help-loop{margin-top:8px;padding-left:14px}
      .ws-hf-node{display:inline-flex;align-items:center;padding:5px 10px;border-radius:6px;border:1.5px solid color-mix(in srgb,var(--dsw-alias-label-primary) 30%,transparent);background:var(--dsw-alias-bg-base);font-size:12.5px;font-weight:600}
      .ws-hf-core{border-color:var(--ws-accent);background:color-mix(in srgb,var(--ws-accent) 9%,transparent)}
      .ws-hf-small{padding:2px 8px;font-size:11.5px;font-weight:500;border-style:dashed;border-color:var(--ws-accent)}
      .ws-hf-arrow{color:var(--ws-accent);font-weight:700}
      .ws-hf-max{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#fff;background:var(--ws-accent);border-radius:3px;padding:0 5px}
      .ws-hf-side{margin-left:auto;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
      .ws-help-note{margin:8px 0;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
      .ws-help-two{display:grid;grid-template-columns:1fr 1fr;gap:20px}
      .ws-help-dl{display:grid;grid-template-columns:auto 1fr;gap:5px 12px;margin:0;font-size:12.5px}
      .ws-help-dl dt{font-weight:600;white-space:nowrap}
      .ws-help-dl dd{margin:0;color:var(--dsw-alias-label-secondary)}
      .ws-help-tree{font-size:12px;display:flex;flex-direction:column;gap:3px;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1)}
      .ws-help-tree div{display:flex;gap:10px;align-items:baseline}
      .ws-help-tree code{flex:none;white-space:pre;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
      .ws-help-tree span{color:var(--dsw-alias-label-secondary);font-size:11px}
      @media (max-width:760px){.ws-help-two{grid-template-columns:1fr}}
      .ws-more{font-size:11.5px;color:var(--ws-accent)}
      .ws-modal-back{position:fixed;inset:0;z-index:1000;background:rgba(15,25,30,.38);display:flex;align-items:center;justify-content:center;padding:24px}
      .ws-modal{width:min(880px,100%);max-height:calc(100vh - 48px);display:flex;flex-direction:column;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 18px 50px rgba(0,0,0,.25);overflow:hidden}
      .ws-modal-help{width:min(760px,100%)}
      .ws-modal-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l2);border-top:3px solid var(--ws-accent)}
      .ws-modal-head h3{flex:1;margin:0;font-size:15px}
      .ws-modal-body{flex:1;min-height:0;overflow:auto;padding:16px 24px 0;--ma-shell-pad:24px}
      .ws-modal-help .ws-modal-body{padding-bottom:18px}
      .ws-modal .ma-section.ma-settings{height:calc(100vh - 150px);max-height:720px}
      .ws-modal .ma-settings>.ma-heading{display:none}
      .ws-help{font-size:13px;line-height:20px}
      .ws-help>h4:first-child{margin-top:0}
      .ws-readouts{grid-template-columns:1fr 1fr}
      .ws-minor{display:flex;flex-wrap:wrap;gap:2px 12px;font-size:11px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
      .ws-spark-avg{stroke:var(--dsw-alias-label-secondary);stroke-width:1;stroke-dasharray:3 3;vector-effect:non-scaling-stroke}
      .ws-spark-foot{display:flex;justify-content:space-between;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
      .ws-strip{margin-bottom:4px}
      .ws-strip svg{display:block;width:100%;height:40px;border-bottom:1px solid var(--dsw-alias-border-l2)}
      .ws-strip rect{cursor:pointer}
      .ws-strip rect:hover{opacity:.7}
      .ws-bar-ok{fill:color-mix(in srgb,var(--ws-accent) 70%,transparent)}
      .ws-bar-timeout{fill:var(--dsw-alias-state-error-primary)}
      .ws-bar-bad{fill:var(--dsw-alias-state-warn-primary)}
      .ws-bar-cancel{fill:var(--dsw-alias-border-l2)}
      .ws-bar-focus{fill:var(--dsw-alias-label-primary)}
      .ws-strip-axis{display:flex;justify-content:space-between;font-size:10px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
      .ws-calls tr.ws-focus td{background:color-mix(in srgb,var(--ws-accent) 14%,transparent)}
      .ws-report{position:relative}
      .ws-report-tools{position:sticky;top:0;z-index:2;display:flex;justify-content:flex-end;gap:6px;margin-bottom:-28px;pointer-events:none}
      .ws-report-tools button{pointer-events:auto}
      .ws-modal-report{width:min(1100px,100%);height:calc(100vh - 48px)}
      .ws-modal-report .ws-modal-body{padding:8px 32px 28px}
      .ws-md{font-size:13px;line-height:21px;color:var(--dsw-alias-label-primary);max-width:960px}
      .ws-md h1{font-size:18px;margin:6px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--ws-accent)}
      .ws-md h2{font-size:15px;margin:20px 0 8px;padding-left:8px;border-left:3px solid var(--ws-accent)}
      .ws-md h3{font-size:13.5px;margin:16px 0 6px}
      .ws-md h4{font-size:13px;margin:12px 0 4px}
      .ws-md p{margin:6px 0}
      .ws-md ul,.ws-md ol{margin:4px 0 8px;padding-left:20px}
      .ws-md li{margin:2px 0;word-break:break-word}
      .ws-md li.ws-md-task{list-style:none;margin-left:-18px}
      .ws-md li.ws-md-task input{margin:0 4px 0 0;vertical-align:-1px}
      .ws-md code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;padding:1px 4px;border-radius:4px;background:color-mix(in srgb,var(--ws-accent) 8%,transparent);word-break:break-all}
      .ws-md blockquote{margin:8px 0;padding:6px 10px;border-left:3px solid var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,transparent);color:var(--dsw-alias-label-secondary)}
      .ws-md-tablewrap{overflow-x:auto;margin:6px 0 10px}
      .ws-md table{border-collapse:collapse;font-size:12.5px;min-width:50%}
      .ws-md th{text-align:left;font-weight:600;background:color-mix(in srgb,var(--ws-accent) 8%,transparent);padding:5px 10px;border:1px solid var(--dsw-alias-border-l1)}
      .ws-md td{padding:4px 10px;border:1px solid var(--dsw-alias-border-l1);vertical-align:top}
      .ws-mem-warn{color:var(--dsw-alias-state-warn-primary);font-weight:600}
      .ws-mem-bad{color:var(--dsw-alias-state-error-primary);font-weight:600}
      .ws-run{position:relative}
      .ws-run-del{position:absolute;right:8px;bottom:8px;width:20px;height:20px;padding:0;border:0;border-radius:4px;background:none;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;cursor:pointer;opacity:0;transition:opacity .15s}
      .ws-run:hover .ws-run-del,.ws-run:focus-within .ws-run-del,.ws-run-del:focus-visible{opacity:1}
      .ws-run-del:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}
      .ws-modal-del{width:min(520px,100%)}
      .ws-modal-del .ws-modal-head{border-top-color:var(--dsw-alias-state-error-primary)}
      .ws-del{display:flex;flex-direction:column;gap:10px;padding-bottom:16px}
      .ws-del p{margin:0}
      .ws-del .ma-check{align-items:flex-start;word-break:break-all}
      .ws-del-actions{justify-content:flex-end}
      .ws-del-go{background:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);color:#fff}
      .ws-latest{position:absolute;right:14px;bottom:8px;height:24px;padding:0 10px;border-radius:999px;border:0;background:var(--ws-accent,var(--dsw-alias-brand-primary));color:#fff;font:inherit;font-size:12px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.18)}
      .ws-log-text{overflow:hidden;text-overflow:ellipsis}
      .ws-count{font-size:10px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-state-warn-primary);color:#fff}
      .ws-table td.ma-mono{max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ws-log{display:flex;flex-direction:column;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:19px}
      .ws-log-line{display:flex;gap:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px dotted var(--dsw-alias-border-l1)}
      .ws-log-time{color:var(--dsw-alias-label-secondary);flex:none}
      .ws-l-clean,.ws-l-completed{color:var(--dsw-alias-state-success-primary)}
      .ws-l-review{color:var(--dsw-alias-state-warn-primary)}
      .ws-l-failed,.ws-l-cancelled{color:var(--dsw-alias-state-error-primary)}
      .ws-warn{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
      .ws-mon-top{display:flex;align-items:center;gap:12px}
      .ws-gauge{--ws-pct:0deg;flex:none;width:76px;height:76px;border-radius:50%;background:conic-gradient(var(--ws-accent) var(--ws-pct),var(--dsw-alias-border-l2) 0);display:flex;align-items:center;justify-content:center}
      .ws-gauge-in{width:60px;height:60px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);display:flex;align-items:center;justify-content:center}
      .ws-gauge-in b{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:19px;font-weight:600}
      .ws-gauge-in span{font-size:11px;color:var(--dsw-alias-label-secondary);margin-left:1px}
      .ws-readouts{display:grid;grid-template-columns:1fr 1fr;gap:4px}
      .ws-readout{display:flex;align-items:baseline;justify-content:space-between;gap:6px;padding:4px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
      .ws-readout span{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
      .ws-readout b{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;font-weight:600}
      .ws-readout.ws-tone-warn b{color:var(--dsw-alias-state-warn-primary)}
      .ws-readout.ws-tone-bad b{color:var(--dsw-alias-state-error-primary)}
      .ws-model{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
      .ws-model>div:first-child{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .ws-model>div:first-child b{color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ws-endpoint{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ws-ping{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .ws-param{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .ws-param-label{font-size:12px;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;gap:5px}
      .ws-mod{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);display:inline-block}
      .ws-stepper{display:inline-flex;align-items:stretch;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;overflow:hidden;height:24px;background:var(--dsw-alias-bg-base)}
      .ws-stepper button{width:26px;border:0;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
      .ws-stepper button:disabled{opacity:.4;cursor:default}
      .ws-stepper input{width:52px;border:0;border-left:1px solid var(--dsw-alias-border-l1);border-right:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;-moz-appearance:textfield}
      .ws-stepper input::-webkit-inner-spin-button,.ws-stepper input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
      .ws-slider{display:inline-flex;align-items:center;gap:8px}
      .ws-slider input{width:110px;accent-color:var(--ws-accent)}
      .ws-toggle{display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;position:relative}
      .ws-toggle input{position:absolute;opacity:0;width:0;height:0}
      .ws-switch{flex:none;width:30px;height:17px;border-radius:999px;background:var(--dsw-alias-border-l2);position:relative;transition:background .2s}
      .ws-switch::after{content:'';position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;transition:left .2s}
      .ws-toggle input:checked+.ws-switch{background:var(--ws-accent)}
      .ws-toggle input:checked+.ws-switch::after{left:15px}
      .ws-toggle input:focus-visible+.ws-switch{outline:2px solid var(--ws-accent);outline-offset:2px}
      .ws-toggle input:disabled+.ws-switch{opacity:.5}
      .ws-page{--ws-accent:#c8432b;--ws-accent-soft:color-mix(in srgb,#c8432b 12%,transparent);--ws-ink:var(--dsw-alias-label-primary);--ws-paper:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 93%,#d6b47c);background:color-mix(in srgb,var(--dsw-alias-bg-base) 95%,#d6b47c)}
      .ws-page .ws-panel,.ws-page .ws-head{background:var(--ws-paper);position:relative}
      .ws-page .ws-panel::before,.ws-page .ws-panel::after{content:'';position:absolute;width:9px;height:9px;pointer-events:none;border-color:var(--ws-accent);border-style:solid;opacity:.75}
      .ws-page .ws-panel::before{top:-1px;left:-1px;border-width:2px 0 0 2px;border-top-left-radius:10px}
      .ws-page .ws-panel::after{bottom:-1px;right:-1px;border-width:0 2px 2px 0;border-bottom-right-radius:10px}
      .ws-head{border-left:3px solid var(--ws-accent)}
      .ws-head::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;background:repeating-linear-gradient(90deg,var(--ws-accent) 0 14px,transparent 14px 20px);opacity:.35}
      .ws-brand h2{letter-spacing:2px}
      .ws-brand .ws-brand-mark{background:var(--ws-accent);color:#fff}
      .ws-brand-mark svg{width:20px;height:20px}
      .ws-panel-head h3::before{content:attr(data-code);display:inline-block;margin-right:7px;padding:0 4px;border-radius:3px;background:var(--ws-accent);color:#fff;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;line-height:15px;letter-spacing:.5px;vertical-align:1px}
      .ws-panel-head{padding-bottom:6px;border-bottom:1px solid color-mix(in srgb,var(--ws-ink) 12%,transparent)}
      .ws-drawer .ma-tabs{box-shadow:inset 0 -1px 0 color-mix(in srgb,var(--ws-ink) 12%,transparent)}
      .ws-drawer .ma-tab[aria-selected="true"]{border-bottom-color:var(--ws-accent)}
      .ws-page .ws-start{background:var(--ws-accent);border-color:var(--ws-accent);letter-spacing:2px}
      .ws-page .ws-start:hover{filter:brightness(1.08)}
      .ws-drawno{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--dsw-alias-label-secondary);letter-spacing:.5px;padding:1px 6px;border:1px solid color-mix(in srgb,var(--ws-ink) 18%,transparent);border-radius:3px}
      .ws-floor{background-color:var(--ws-paper);background-image:linear-gradient(color-mix(in srgb,var(--ws-accent) 9%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--ws-accent) 9%,transparent) 1px,transparent 1px),linear-gradient(color-mix(in srgb,var(--ws-ink) 4%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--ws-ink) 4%,transparent) 1px,transparent 1px);background-size:100px 100px,100px 100px,20px 20px,20px 20px}
      .ws-schematic{display:block;width:100%;height:auto;max-height:262px;overflow:visible;font-family:inherit}
      .ws-schematic text{fill:var(--ws-ink)}
      .ws-dim path{fill:none;stroke:var(--ws-accent);stroke-width:1.2}
      .ws-dim-bg{fill:var(--ws-paper)}
      .ws-dim text{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;letter-spacing:1px;fill:var(--ws-accent)}
      .ws-loop,.ws-loop-head{fill:none;stroke:var(--ws-accent);stroke-width:1.4;stroke-dasharray:5 4}
      .ws-loop-head{stroke-dasharray:none}
      .ws-loop-label{font-size:11.5px;fill:var(--ws-accent)!important}
      .ws-belt{fill:color-mix(in srgb,var(--ws-ink) 10%,var(--ws-paper));stroke:color-mix(in srgb,var(--ws-ink) 45%,transparent);stroke-width:1.2}
      .ws-belt-run{stroke:color-mix(in srgb,var(--ws-ink) 40%,transparent);stroke-width:1.4;stroke-dasharray:10 8}
      .ws-run .ws-belt-run{stroke:var(--ws-accent);animation:ws-belt .9s linear infinite}
      @keyframes ws-belt{to{stroke-dashoffset:-18}}
      .ws-roller{fill:var(--ws-paper);stroke:color-mix(in srgb,var(--ws-ink) 40%,transparent);stroke-width:1}
      .ws-leg{stroke:color-mix(in srgb,var(--ws-ink) 35%,transparent);stroke-width:2.5}
      .ws-feedline path{fill:none;stroke:color-mix(in srgb,var(--ws-ink) 35%,transparent);stroke-width:1.4;stroke-dasharray:4 3}
      .ws-feedline .ws-feedhead{stroke-dasharray:none}
      .ws-run .ws-feedline path:first-child{stroke:var(--ws-accent);animation:ws-belt .8s linear infinite}
      .ws-housing{fill:var(--dsw-alias-bg-base);stroke:color-mix(in srgb,var(--ws-ink) 45%,transparent);stroke-width:1.4}
      .ws-plate{fill:color-mix(in srgb,var(--ws-ink) 8%,transparent)}
      .ws-mc-no{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9.5px;fill:var(--dsw-alias-label-secondary)!important;letter-spacing:.5px}
      .ws-mc-lamp{fill:color-mix(in srgb,var(--ws-ink) 22%,transparent)}
      .ws-icon *{fill:none;stroke:var(--ws-ink);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
      .ws-mc-name{font-size:18px;font-weight:700;letter-spacing:1px}
      .ws-mc-sub{font-size:12.5px;fill:var(--dsw-alias-label-secondary)!important}
      .ws-mc-load{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;fill:var(--dsw-alias-label-secondary)!important}
      .ws-mc-idle{opacity:.55}
      .ws-mc-done .ws-housing{stroke:var(--dsw-alias-state-success-primary)}
      .ws-mc-done .ws-mc-lamp{fill:var(--dsw-alias-state-success-primary)}
      .ws-mc-done .ws-mc-load{fill:var(--dsw-alias-state-success-primary)!important}
      .ws-mc-active .ws-housing{fill:var(--ws-accent-soft);stroke:var(--ws-accent);stroke-width:2.2;animation:ws-glow 1.4s ease-in-out infinite}
      .ws-mc-active .ws-plate{fill:var(--ws-accent)}
      .ws-mc-active .ws-mc-no{fill:#fff!important}
      .ws-mc-active .ws-mc-lamp{fill:#fff;animation:ws-blink .8s infinite}
      .ws-mc-active .ws-icon *{stroke:var(--ws-accent)}
      .ws-mc-active .ws-mc-name,.ws-mc-active .ws-mc-load{fill:var(--ws-accent)!important}
      .ws-mc-active .ws-beam{animation:ws-scan 1.2s ease-in-out infinite alternate}
      .ws-sweep{transform-box:fill-box;transform-origin:0% 100%}
      .ws-pulse{transform-box:fill-box;transform-origin:50% 50%}
      .ws-mc-active .ws-sweep{animation:ws-spin 1.6s linear infinite}
      .ws-mc-active .ws-pulse{animation:ws-pulse 1s ease-in-out infinite alternate}
      @keyframes ws-pulse{to{transform:scale(1.5)}}
      .ws-beam{stroke:var(--ws-accent)!important;opacity:.0}
      .ws-mc-active .ws-beam{opacity:1}
      @keyframes ws-scan{from{transform:translateY(-10px)}to{transform:translateY(10px)}}
      @keyframes ws-spin{to{transform:rotate(360deg)}}
      @keyframes ws-glow{50%{stroke-opacity:.45}}
      .ws-doc path{fill:var(--dsw-alias-bg-base);stroke:color-mix(in srgb,var(--ws-ink) 55%,transparent);stroke-width:1.1}
      .ws-doc-hot path{fill:var(--ws-accent);stroke:var(--ws-accent)}
      .ws-doc-hot path+path{stroke:#fff}
      .ws-doc-flow path{fill:var(--ws-paper)}
      .ws-spark{display:flex;flex-direction:column;gap:2px}
      .ws-spark-head{display:flex;justify-content:space-between;font-size:11px;color:var(--dsw-alias-label-secondary)}
      .ws-spark svg{width:100%;height:44px;display:block;border-bottom:1px solid color-mix(in srgb,var(--ws-ink) 25%,transparent)}
      .ws-spark-grid{stroke:color-mix(in srgb,var(--ws-ink) 8%,transparent);stroke-width:1;vector-effect:non-scaling-stroke}
      .ws-spark-area{fill:var(--ws-accent-soft)}
      .ws-spark-line{fill:none;stroke:var(--ws-accent);stroke-width:1.6;vector-effect:non-scaling-stroke}
      .ws-readout{border-left:2px solid var(--ws-accent)}
      @media (max-width:1280px),(max-height:640px){.ws-page{height:auto;min-height:100%;overflow:visible}.ws-col-right{overflow:visible}.ws-drawer-body{max-height:360px}}
      @media (max-width:1280px){.ws-grid{grid-template-columns:minmax(0,1fr) minmax(260px,300px)}.ws-grid>.ws-col:first-child{grid-column:1 / -1;display:grid;grid-template-columns:1fr 1fr}}
      @media (max-width:920px){.ws-grid,.ws-grid>.ws-col:first-child{grid-template-columns:minmax(0,1fr)}.ws-line{grid-template-columns:repeat(2,minmax(0,1fr))}.ws-station:nth-child(2n)::after{display:none}.ws-twin{grid-template-columns:1fr}}
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
      const [maxFiles, setMaxFiles] = React.useState(200)
      const [concurrency, setConcurrency] = React.useState(4)
      const [maxDicomFiles, setMaxDicomFiles] = React.useState(50000)
      const [timeoutSec, setTimeoutSec] = React.useState(120)
      const [temperature, setTemperature] = React.useState(0)
      const [passphrase, setPassphrase] = React.useState('')
      const [passphrase2, setPassphrase2] = React.useState('')
      const [clearPassphrase, setClearPassphrase] = React.useState(false)
      const [showSidebar, setShowSidebar] = React.useState(true)
      const [identifierPolicy, setIdentifierPolicy] = React.useState({})
      const [quasiOn, setQuasiOn] = React.useState(false)
      const [quasiPolicy, setQuasiPolicy] = React.useState({})
      const [allowText, setAllowText] = React.useState('')
      const [skipText, setSkipText] = React.useState('')
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
        setMaxFiles(Number(info.maxFiles ?? 200))
        setConcurrency(Number(info.concurrency ?? 4))
        setMaxDicomFiles(Number(info.maxDicomFiles ?? 50000))
        setTimeoutSec(Math.round(Number(info.timeoutMs ?? 120000) / 1000))
        setTemperature(Number(info.temperature ?? 0))
        setPassphrase('')
        setPassphrase2('')
        setClearPassphrase(false)
        setShowSidebar(info.showSidebarEntry !== false)
        setIdentifierPolicy({ ...(info.identifierPolicy ?? {}) })
        setQuasiOn(info.quasiIdentifiers === true)
        setQuasiPolicy({ ...(info.quasiPolicy ?? {}) })
        setAllowText((info.allowValues ?? []).join('\n'))
        setSkipText((info.skipFields ?? []).join('\n'))
      }
      const lines = (text) => [...new Set(String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean))]
      const sameList = (text, list) => JSON.stringify(lines(text)) === JSON.stringify(list ?? [])

      const schema = config?.policySchema ?? { identifiers: [], quasi: [] }
      const sameMap = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort())
      function resetRules() {
        setIdentifierPolicy(Object.fromEntries(schema.identifiers.map((item) => [item.id, 'pseudonym'])))
        setQuasiOn(false)
        setQuasiPolicy(Object.fromEntries(schema.quasi.map((item) => [item.id, item.default])))
        setAllowText('')
        setSkipText('')
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
        ['maxFiles', Number(maxFiles) !== Number(config.maxFiles ?? 200)],
        ['concurrency', Number(concurrency) !== Number(config.concurrency ?? 4)],
        ['maxDicomFiles', Number(maxDicomFiles) !== Number(config.maxDicomFiles ?? 50000)],
        ['timeoutMs', Number(timeoutSec) * 1000 !== Number(config.timeoutMs ?? 120000)],
        ['temperature', Number(temperature) !== Number(config.temperature ?? 0)],
        ['vaultPassphrase', passphrase.length > 0 || passphrase2.length > 0 || clearPassphrase],
        ['showSidebarEntry', showSidebar !== (config.showSidebarEntry !== false)],
        ['rules', !sameMap(identifierPolicy, config.identifierPolicy) || quasiOn !== (config.quasiIdentifiers === true)
          || !sameMap(quasiPolicy, config.quasiPolicy)
          || !sameList(allowText, config.allowValues) || !sameList(skipText, config.skipFields)],
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
        if (passphrase !== passphrase2) {
          setError(t('vault.mismatch'))
          return
        }
        setSaving(true)
        try {
          const request = {
            baseURL: endpoint.trim(),
            model: model.trim(),
            disableThinking,
            outputRoot: outputRoot.trim(),
            maxRounds: Number(maxRounds),
            maxFiles: Number(maxFiles),
            concurrency: Number(concurrency),
            maxDicomFiles: Number(maxDicomFiles),
            timeoutMs: Math.round(Number(timeoutSec) * 1000),
            temperature: Number(temperature),
            showSidebarEntry: showSidebar,
            identifierPolicy,
            quasiIdentifiers: quasiOn,
            quasiPolicy,
            allowValues: lines(allowText),
            skipFields: lines(skipText),
          }
          if (apiKey.length > 0) request.apiKey = apiKey
          else if (clearKey) request.apiKey = ''
          if (passphrase.length > 0) request.vaultPassphrase = passphrase
          else if (clearPassphrase) request.vaultPassphrase = ''
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
        model: ['baseURL', 'model', 'apiKey', 'disableThinking', 'timeoutMs', 'temperature'],
        rules: ['rules'],
        batch: ['outputRoot', 'maxRounds', 'maxFiles', 'concurrency', 'maxDicomFiles', 'vaultPassphrase', 'showSidebarEntry'],
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
          h('div', { className: 'ma-grid' },
            h('label', { className: 'ma-field' }, t('model.timeout'),
              h('input', {
                className: 'ma-input', type: 'number', min: 10, max: 1800, value: timeoutSec,
                onChange: (event) => setTimeoutSec(Number(event.target.value)),
              })),
            h('label', { className: 'ma-field' }, t('model.temperature'),
              h('input', {
                className: 'ma-input', type: 'number', min: 0, max: 2, step: 0.1, value: temperature,
                onChange: (event) => setTemperature(Number(event.target.value)),
              })),
          ),
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
        h('div', { className: 'ma-card' },
          h('div', { className: 'ma-block-head' },
            h('div', {},
              h('h3', {}, t('rules.allowTitle')),
              h('p', { className: 'ma-hint' }, t('rules.allowHint'))),
          ),
          h('label', { className: 'ma-field' }, t('rules.allowValues'),
            h('textarea', {
              className: 'ma-input ma-textarea', value: allowText, spellCheck: false,
              onChange: (event) => setAllowText(event.target.value),
            })),
          h('label', { className: 'ma-field' }, t('rules.skipFields'),
            h('textarea', {
              className: 'ma-input ma-textarea', value: skipText, spellCheck: false,
              onChange: (event) => setSkipText(event.target.value),
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
            h('label', { className: 'ma-field' }, t('run.maxFiles'),
              h('input', {
                className: 'ma-input', type: 'number', min: 1, max: 2000, value: maxFiles,
                onChange: (event) => setMaxFiles(Number(event.target.value)),
              })),
            h('label', { className: 'ma-field' }, t('run.concurrency'),
              h('input', {
                className: 'ma-input', type: 'number', min: 1, max: 16, value: concurrency,
                onChange: (event) => setConcurrency(Number(event.target.value)),
              })),
            h('label', { className: 'ma-field' }, t('run.maxDicom'),
              h('input', {
                className: 'ma-input', type: 'number', min: 1, max: 500000, value: maxDicomFiles,
                onChange: (event) => setMaxDicomFiles(Number(event.target.value)),
              })),
          ),
          h('hr', { className: 'ma-divider' }),
          h('h3', {}, t('vault.title')),
          h('p', { className: 'ma-hint' }, t('vault.hint')),
          h('p', { className: 'ma-hint' }, config?.vaultEncrypted ? t('vault.on') : t('vault.off')),
          h('div', { className: 'ma-grid' },
            h('label', { className: 'ma-field' }, t('vault.pass'),
              h('input', {
                className: 'ma-input', type: 'password', autoComplete: 'new-password', value: passphrase,
                onChange: (event) => { setPassphrase(event.target.value); setClearPassphrase(false) },
              })),
            h('label', { className: 'ma-field' }, t('vault.confirm'),
              h('input', {
                className: 'ma-input', type: 'password', autoComplete: 'new-password', value: passphrase2,
                onChange: (event) => { setPassphrase2(event.target.value); setClearPassphrase(false) },
              })),
          ),
          passphrase && passphrase2 && passphrase !== passphrase2 ? h('p', { className: 'ma-hint ma-error' }, t('vault.mismatch')) : null,
          config?.vaultEncrypted
            ? h('label', { className: 'ma-check' },
              h('input', { type: 'checkbox', checked: clearPassphrase, onChange: (event) => { setClearPassphrase(event.target.checked); if (event.target.checked) { setPassphrase(''); setPassphrase2('') } } }),
              t('vault.clear'))
            : null,
          dirty.includes('vaultPassphrase') ? h('p', { className: 'ma-hint ma-error' }, t('vault.warn')) : null,
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

    // ── Left sidebar → Anonymize: production-line dashboard ────────────────
    // Center: the per-file pipeline drawn as stations on a line, workpieces on
    // a conveyor, output by type, and a log/report drawer. Left: feed (input)
    // and batch history. Right: live monitor readouts and editable defaults.

    const STATIONS = ['prescan', 'read', 'discover', 'verify', 'repair', 'rescan', 'dicom', 'pack']

    function stationOf(state) {
      const step = String(state?.step ?? '')
      if (step === '批次预扫') return 'prescan'
      if (step === '读取') return 'read'
      if (step === '发现') return Number(state?.round ?? 1) > 1 ? 'repair' : 'discover'
      if (step === '复核') return 'verify'
      if (step.startsWith('批次复扫') || step.startsWith('跨组复扫')) return 'rescan'
      if (step === 'DICOM') return 'dicom'
      if (step === '打包') return 'pack'
      return null
    }

    // Process line drawn as an engineering schematic: machines on a conveyor,
    // dimension lines over the two stages, the repair loop, and workpieces
    // riding the belt while a batch runs.
    const ICONS = {
      prescan: [h('rect', { key: 1, x: -16, y: -11, width: 32, height: 22, rx: 3 }), h('path', { key: 2, d: 'M-11 -5h22M-11 0h22M-11 5h14' }), h('path', { key: 3, className: 'ws-beam', d: 'M-19 0h38' })],
      read: [h('path', { key: 1, d: 'M-10 -15h13l7 7v23h-20z M3 -15v7h7' }), h('path', { key: 2, d: 'M-6 -1h12M-6 4h12M-6 9h8' })],
      discover: [h('circle', { key: 1, cx: -3, cy: -3, r: 9.5 }), h('path', { key: 2, d: 'M4 4l10 10' }), h('path', { key: 3, d: 'M-7 -3h8' })],
      verify: [h('path', { key: 1, d: 'M0 -15l12 5v7c0 8-5 13-12 16c-7-3-12-8-12-16v-7z' }), h('path', { key: 2, d: 'M-5 0l4 4l7-8' })],
      repair: [h('path', { key: 1, d: 'M7 -14a8 8 0 0 0-7 12l-11 11a2.8 2.8 0 0 0 4 4l11-11a8 8 0 0 0 12-7l-5 4l-5-1l-1-5z' })],
      rescan: [h('circle', { key: 1, r: 13 }), h('circle', { key: 2, r: 6.5 }), h('path', { key: 3, className: 'ws-sweep', d: 'M0 0l9.2 -9.2' })],
      dicom: [h('circle', { key: 1, cy: -3, r: 13 }), h('circle', { key: 2, cy: -3, r: 6.5, className: 'ws-pulse' }), h('path', { key: 3, d: 'M-18 13h36' })],
      pack: [h('path', { key: 1, d: 'M-14 -7l14 -8l14 8v15l-14 8l-14 -8z' }), h('path', { key: 2, d: 'M-14 -7l14 8l14 -8M0 1v15' })],
    }

    function LineSchematic({ load, reached, running, inflight, maxRounds, t }) {
      const W = 1000
      const step = W / STATIONS.length
      const cx = (index) => step * index + step / 2
      const belt = 186
      const doc = (x, y, key, extra = {}) => h('g', { key, transform: `translate(${x} ${y})`, className: 'ws-doc', ...extra },
        h('path', { d: 'M-6 -8h8l4 4v12h-12z' }), h('path', { d: 'M-3 -2h6M-3 2h6' }))
      const dim = (from, to, label, key) => {
        const x1 = cx(from) - 46
        const x2 = cx(to) + 46
        return h('g', { key, className: 'ws-dim' },
          h('path', { d: `M${x1} 18v12M${x2} 18v12M${x1} 24H${x2}` }),
          h('path', { className: 'ws-dim-arrow', d: `M${x1 + 7} 21l-7 3l7 3M${x2 - 7} 21l7 3l-7 3` }),
          h('rect', { className: 'ws-dim-bg', x: (x1 + x2) / 2 - 92, y: 15, width: 184, height: 18 }),
          h('text', { x: (x1 + x2) / 2, y: 28, textAnchor: 'middle' }, label))
      }
      const loopFrom = cx(4)
      const loopTo = cx(2)
      const states = STATIONS.map((id) => (load[id] > 0 ? 'active' : (reached.has(id) ? 'done' : 'idle')))
      return h('svg', { className: `ws-schematic${running ? ' ws-run' : ''}`, viewBox: `0 0 ${W} 262`, role: 'img', 'aria-label': t('ws.line') },
        dim(0, 3, t('ws.stageA'), 'a'),
        dim(4, 7, t('ws.stageB'), 'b'),
        // repair loop: verify finds leftovers → repair → back through discover
        h('path', { className: 'ws-loop', d: `M${loopFrom} 66 C ${loopFrom} 40, ${loopTo} 40, ${loopTo} 66` }),
        h('path', { className: 'ws-loop-head', d: `M${loopTo - 5} 58l5 8l5 -8` }),
        // Background plate so the dashed curve does not run through the label.
        h('rect', { className: 'ws-dim-bg', x: (loopFrom + loopTo) / 2 - 92, y: 38, width: 184, height: 16, rx: 3 }),
        h('text', { className: 'ws-loop-label', x: (loopFrom + loopTo) / 2, y: 50, textAnchor: 'middle' }, t('ws.loop', { rounds: maxRounds })),
        // belt
        h('rect', { className: 'ws-belt', x: 8, y: belt, width: W - 16, height: 16, rx: 8 }),
        h('path', { className: 'ws-belt-run', d: `M18 ${belt}H${W - 18}` }),
        Array.from({ length: 24 }, (_, index) => h('circle', { key: `r${index}`, className: 'ws-roller', cx: 24 + index * ((W - 48) / 23), cy: belt + 8, r: 4 })),
        // machines
        STATIONS.map((id, index) => {
          const x = cx(index)
          const state = states[index]
          return h('g', { key: id, className: `ws-mc ws-mc-${state}` },
            h('path', { className: 'ws-leg', d: `M${x - 32} 154V${belt}M${x + 32} 154V${belt}` }),
            index < STATIONS.length - 1
              ? h('g', { className: 'ws-feedline' },
                h('path', { d: `M${x + 48} 112H${x + step - 52}` }),
                h('path', { className: 'ws-feedhead', d: `M${x + step - 57} 108l5 4l-5 4` }))
              : null,
            h('rect', { className: 'ws-housing', x: x - 48, y: 70, width: 96, height: 84, rx: 7 }),
            h('rect', { className: 'ws-plate', x: x - 48, y: 70, width: 96, height: 15, rx: 7 }),
            h('text', { className: 'ws-mc-no', x: x - 40, y: 81 }, `S${String(index + 1).padStart(2, '0')}`),
            h('circle', { className: 'ws-mc-lamp', cx: x + 38, cy: 77.5, r: 3.6 }),
            h('g', { className: 'ws-icon', transform: `translate(${x} 120)` }, ICONS[id]),
            h('text', { className: 'ws-mc-name', x, y: 224, textAnchor: 'middle' }, t(`ws.st.${id}`)),
            h('text', { className: 'ws-mc-sub', x, y: 241, textAnchor: 'middle' }, t(`ws.sub.${id}`)),
            h('text', { className: 'ws-mc-load', x, y: 257, textAnchor: 'middle' },
              load[id] > 0 ? t('ws.load', { count: load[id] }) : (state === 'done' ? t('ws.passed') : '·')))
        }),
        // workpieces sitting at their station
        inflight.map((state, index) => {
          const at = STATIONS.indexOf(stationOf(state))
          if (at < 0) return null
          const sameBefore = inflight.slice(0, index).filter((other) => stationOf(other) === stationOf(state)).length
          return doc(cx(at) - 18 + (sameBefore % 4) * 12, belt - 9, `w${index}`, { className: 'ws-doc ws-doc-hot' })
        }),
        // flow on the belt
        running
          ? [0, 1, 2, 3].map((index) => h('g', { key: `m${index}`, className: 'ws-doc ws-doc-flow' },
            h('path', { d: 'M-6 -8h8l4 4v12h-12z' }),
            h('animateMotion', { dur: '8s', begin: `-${index * 2}s`, repeatCount: 'indefinite', path: `M14 ${belt - 9}H${W - 14}` })))
          : null)
    }

    function clock(ms) {
      const total = Math.max(0, Math.floor(Number(ms || 0) / 1000))
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`
    }

    function compact(value) {
      const number = Number(value || 0)
      if (number >= 1e6) return `${(number / 1e6).toFixed(1)}M`
      if (number >= 1e4) return `${(number / 1e3).toFixed(1)}k`
      return String(number)
    }

    function hhmmss(date = new Date()) {
      return date.toTimeString().slice(0, 8)
    }

    function fileEntities(file) {
      return Array.isArray(file.entities) ? file.entities.reduce((sum, entity) => sum + entity.count, 0) : Number(file.entities ?? 0)
    }

    const PARAM_KEYS = ['maxRounds', 'concurrency', 'maxFiles', 'timeoutSec', 'temperature', 'disableThinking', 'quasiIdentifiers']

    function paramsFrom(info) {
      return {
        maxRounds: Number(info?.maxRounds ?? 3),
        concurrency: Number(info?.concurrency ?? 4),
        maxFiles: Number(info?.maxFiles ?? 200),
        timeoutSec: Math.round(Number(info?.timeoutMs ?? 120000) / 1000),
        temperature: Number(info?.temperature ?? 0),
        disableThinking: info?.disableThinking === true,
        quasiIdentifiers: info?.quasiIdentifiers === true,
      }
    }

    function AnonymizerPage() {
      const t = services.t
      const [config, setConfig] = React.useState(null)
      const [inputDir, setInputDir] = React.useState('')
      const [outputRoot, setOutputRoot] = React.useState('')
      const [runs, setRuns] = React.useState([])
      const [activeRunId, setActiveRunId] = React.useState(null)
      const [selectedId, setSelectedId] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [reportText, setReportText] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [cancelling, setCancelling] = React.useState(false)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [copied, setCopied] = React.useState(false)
      const [drawer, setDrawer] = React.useState('parts')
      const [now, setNow] = React.useState(Date.now())
      const [log, setLog] = React.useState([])
      const [draft, setDraft] = React.useState(null)
      const [savingParams, setSavingParams] = React.useState(false)
      const [paramNote, setParamNote] = React.useState(null)
      const [ping, setPing] = React.useState(null)
      // Post-run advice, cached per batch: a settings save reloads the host,
      // which may forget where an earlier batch's records are.
      const [adviceByRun, setAdviceByRun] = React.useState({})
      const [picked, setPicked] = React.useState({})
      const [adviceNote, setAdviceNote] = React.useState(null)
      const [adopting, setAdopting] = React.useState(null)
      const [showDraft, setShowDraft] = React.useState(false)
      const [modal, setModal] = React.useState(null) // 'settings' | 'help' | 'report'
      const [deleting, setDeleting] = React.useState(null)
      React.useEffect(() => {
        if (!modal) return undefined
        const onKey = (event) => { if (event.key === 'Escape') closeModal() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [modal])
      const [dismissed, setDismissed] = React.useState(() => {
        try { return JSON.parse(localStorage.getItem('ma-advice-dismissed') ?? '{}') } catch { return {} }
      })
      const reportLoaded = React.useRef(new Set())
      const seen = React.useRef({ id: null, keys: new Set(), status: null, done: new Set() })
      const lastActive = React.useRef(null)
      const rootRef = React.useRef(null)
      // Log drawer follows new lines while it is scrolled to the bottom; once
      // the user scrolls up it stays put, and following resumes when the user
      // scrolls back down to the bottom.
      const drawerRef = React.useRef(null)
      const followLog = React.useRef(true)
      const [logPinned, setLogPinned] = React.useState(false)
      // File queue sticks to its newest row unless the user scrolls up.
      const piecesRef = React.useRef(null)
      const followPieces = React.useRef(true)
      function onPiecesScroll(event) {
        const node = event.currentTarget
        followPieces.current = node.scrollHeight - node.scrollTop - node.clientHeight < 8
      }
      React.useLayoutEffect(() => {
        const node = piecesRef.current
        if (node && followPieces.current) node.scrollTop = node.scrollHeight
      })
      const callStore = React.useRef({ id: null, entries: [], last: 0 })
      const [callLog, setCallLog] = React.useState(callStore.current)
      const [callFocus, setCallFocus] = React.useState(null)
      function onDrawerScroll(event) {
        if (!(drawer === 'log' || drawer === 'calls')) return
        const node = event.currentTarget
        const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24
        followLog.current = atBottom
        setLogPinned(!atBottom)
      }
      function jumpToLatest() {
        setCallFocus(null)
        const node = drawerRef.current
        if (!node) return
        followLog.current = true
        setLogPinned(false)
        node.scrollTop = node.scrollHeight
      }

      // With the sidebar collapsed, the window controls float over the page's
      // top-left corner; push the header content clear of them.
      React.useLayoutEffect(() => {
        const node = rootRef.current
        if (!node) return undefined
        const update = () => {
          const left = node.getBoundingClientRect().left
          node.style.setProperty('--ws-inset', `${Math.max(0, Math.round(124 - left))}px`)
        }
        update()
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
        observer?.observe(node)
        window.addEventListener('resize', update)
        return () => { observer?.disconnect(); window.removeEventListener('resize', update) }
      }, [])

      const viewId = selectedId ?? activeRunId ?? runs[0]?.id ?? null

      async function loadConfig() {
        const info = await call('config')
        setConfig(info)
        setDraft(paramsFrom(info))
        return info
      }

      React.useEffect(() => {
        let alive = true
        call('config').then((info) => {
          if (!alive) return
          setConfig(info)
          setDraft(paramsFrom(info))
          setOutputRoot(info.outputRoot ?? '')
        }, (cause) => { if (alive) setError(message(cause)) })
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => { alive = false; clearInterval(timer) }
      }, [])

      function appendLog(lines) {
        if (lines.length === 0) return
        // Oldest first, newest at the bottom (like a console).
        setLog((previous) => [...previous, ...lines].slice(-500))
      }

      function trackEvents(run) {
        if (!run) return
        const memory = seen.current
        if (memory.id !== run.id) {
          memory.id = run.id
          memory.keys = new Set()
          memory.status = null
          memory.done = new Set()
          memory.points = []
          setLog([])
        }
        const lines = []
        const stamp = hhmmss()
        const states = [...Object.values(run.inflight ?? {}), run.current].filter(Boolean)
        for (const state of states) {
          const key = `${state.file}|${state.step}|${state.round ?? 0}`
          if (memory.keys.has(key)) continue
          memory.keys.add(key)
          const station = stationOf(state)
          lines.push({ stamp, kind: station ?? 'info', text: `${station ? t(`ws.st.${station}`) : state.step}${state.round ? ` R${state.round}` : ''}  ${state.file || ''}` })
        }
        for (const file of run.files ?? []) {
          if (memory.done.has(file.relPath)) continue
          memory.done.add(file.relPath)
          if (run.status === 'running' || memory.status === 'running') {
            lines.push({ stamp, kind: file.status, text: `${t(`file.${file.status}`)}  ${file.relPath}  · ${fileEntities(file)}` })
          }
        }
        if (memory.status && memory.status !== run.status) {
          lines.push({ stamp, kind: run.status, text: `${t('ws.batch')} ${run.id} → ${t(`status.${run.status}`)}` })
        }
        if (run.status === 'running') {
          memory.points = [...(memory.points ?? []), Number(run.totals?.entities ?? 0)].slice(-90)
        }
        memory.status = run.status
        appendLog(lines)
      }

      React.useEffect(() => {
        let alive = true
        async function tick() {
          try {
            const list = await call('list')
            if (!alive) return
            setRuns(list.runs ?? [])
            setActiveRunId(list.active ?? null)
            // A batch started elsewhere (/anonymize, agent tool) takes the
            // floor as soon as it appears.
            if (list.active && list.active !== lastActive.current) {
              lastActive.current = list.active
              if (selectedId && selectedId !== list.active) {
                setSelectedId(list.active)
                return
              }
            }
            if (!list.active) lastActive.current = null
            const id = selectedId ?? list.active ?? list.runs?.[0]?.id
            if (id) {
              const response = await call('status', { runId: id })
              if (!alive) return
              const run = response?.run ?? null
              setDetail(run)
              trackEvents(run)
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
        const timer = setInterval(tick, 2000)
        return () => { alive = false; clearInterval(timer) }
      }, [selectedId])

      async function refreshRuns() {
        try {
          const list = await call('list')
          setRuns(list.runs ?? [])
          setActiveRunId(list.active ?? null)
        } catch (cause) {
          setError(message(cause))
        }
      }

      function selectRun(id) {
        followPieces.current = true
        setSelectedId(id)
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

      async function browseFile() {
        try {
          const picked = await call('pickFile')
          if (picked?.path) setInputDir(picked.path)
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
          const result = await call('start', { inputDir: inputDir.trim(), outputRoot: outputRoot.trim() })
          setNotice(t('notice.started'))
          reportLoaded.current.delete(result.runId)
          setActiveRunId(result.runId)
          setSelectedId(result.runId)
          setDetail(null)
          setReportText('')
          followLog.current = true
          setLogPinned(false)
          setDrawer('log')
          await refreshRuns()
        } catch (cause) {
          setError(message(cause))
        } finally {
          setBusy(false)
        }
      }

      const current = detail && detail.id === viewId ? detail : (runs.find((run) => run.id === viewId) ?? null)
      const running = current?.status === 'running'
      const anyRunning = Boolean(activeRunId)

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
          await navigator.clipboard.writeText(current?.output ?? current?.runDir ?? '')
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          setError('clipboard unavailable')
        }
      }

      // ── Parameters (saved defaults; apply to the next batch) ──
      const saved = config ? paramsFrom(config) : null
      const changed = draft && saved ? PARAM_KEYS.filter((key) => draft[key] !== saved[key]) : []
      const setParam = (key, value) => { setDraft({ ...draft, [key]: value }); setParamNote(null) }

      async function saveParams() {
        if (changed.length === 0) return
        setSavingParams(true)
        setParamNote(null)
        try {
          const request = {}
          for (const key of changed) {
            if (key === 'timeoutSec') request.timeoutMs = Math.round(Number(draft.timeoutSec) * 1000)
            else request[key] = draft[key]
          }
          await call('saveDefaults', request)
          let info = null
          for (let attempt = 0; attempt < 20 && !info; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 250))
            try { info = await loadConfig() } catch { /* reloading */ }
          }
          setParamNote({ ok: true, text: t('ws.paramsSaved') })
        } catch (cause) {
          setParamNote({ ok: false, text: message(cause) })
        } finally {
          setSavingParams(false)
        }
      }

      const adviceRunId = current && current.status !== 'running' ? current.id : null
      React.useEffect(() => {
        if (!adviceRunId || adviceByRun[adviceRunId] !== undefined) return undefined
        let alive = true
        call('advice', { runId: adviceRunId }).then((value) => {
          if (alive) setAdviceByRun((map) => ({ ...map, [adviceRunId]: value ?? null }))
        }, () => {})
        return () => { alive = false }
      }, [adviceRunId, current?.status])

      async function confirmDelete() {
        if (!deleting) return
        setDeleting({ ...deleting, busy: true, error: '' })
        try {
          await call('deleteRun', { runId: deleting.run.id, deliverable: deleting.deliverable })
          if (selectedId === deleting.run.id || viewId === deleting.run.id) { setSelectedId(null); setDetail(null); setReportText('') }
          setAdviceByRun((map) => { const next = { ...map }; delete next[deleting.run.id]; return next })
          setDeleting(null)
          await refreshRuns()
        } catch (cause) {
          setDeleting((state) => state && { ...state, busy: false, error: message(cause) })
        }
      }

      function closeModal() {
        // The settings dialog may have saved; pick up the new values.
        if (modal === 'settings') loadConfig().catch(() => {})
        setModal(null)
      }

      async function saveAndReload(request) {
        await call('saveDefaults', request)
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 250))
          try { await loadConfig(); return } catch { /* reloading */ }
        }
      }

      function dismiss(key) {
        const next = { ...dismissed, [key]: Date.now() }
        setDismissed(next)
        try { localStorage.setItem('ma-advice-dismissed', JSON.stringify(next)) } catch { /* private mode */ }
      }

      function isApplied(item) {
        const patch = item.patch ?? {}
        if (!config) return false
        if (patch.timeoutMs !== undefined && Number(config.timeoutMs) < patch.timeoutMs) return false
        if (patch.concurrency !== undefined && Number(config.concurrency) > patch.concurrency) return false
        if (patch.maxRounds !== undefined && Number(config.maxRounds) !== patch.maxRounds) return false
        if (patch.disableThinking !== undefined && config.disableThinking !== patch.disableThinking) return false
        if (patch.allowValuesAdd && !patch.allowValuesAdd.some((value) => (config.allowValues ?? []).includes(value))) return false
        if (patch.skipFieldsAdd && !patch.skipFieldsAdd.some((field) => (config.skipFields ?? []).map((x) => x.toLowerCase()).includes(field.toLowerCase()))) return false
        return true
      }

      async function adopt(item) {
        const key = `${adviceRunId}:${item.id}`
        const patch = { ...item.patch }
        const request = {}
        if (patch.allowValuesAdd) {
          const chosen = patch.allowValuesAdd.filter((value) => picked[`${key}:${value}`])
          if (chosen.length === 0) { setAdviceNote({ ok: false, text: t('ws.adv.pickFirst') }); return }
          request.allowValues = [...new Set([...(config.allowValues ?? []), ...chosen])]
          delete patch.allowValuesAdd
        }
        if (patch.skipFieldsAdd) {
          const chosen = patch.skipFieldsAdd.filter((field) => picked[`${key}:${field}`])
          if (chosen.length === 0) { setAdviceNote({ ok: false, text: t('ws.adv.pickFirst') }); return }
          request.skipFields = [...new Set([...(config.skipFields ?? []), ...chosen])]
          delete patch.skipFieldsAdd
        }
        Object.assign(request, patch)
        setAdopting(item.id)
        setAdviceNote(null)
        try {
          await saveAndReload(request)
          setAdviceNote({ ok: true, text: t('ws.adv.adopted', { title: item.title }) })
        } catch (cause) {
          setAdviceNote({ ok: false, text: message(cause) })
        } finally {
          setAdopting(null)
        }
      }

      async function copyText(text) {
        try { await navigator.clipboard.writeText(text) } catch { setError('clipboard unavailable') }
      }

      async function copyDraft(text) {
        try {
          await navigator.clipboard.writeText(text)
          setAdviceNote({ ok: true, text: t('ws.adv.copied') })
        } catch {
          setAdviceNote({ ok: false, text: 'clipboard unavailable' })
        }
      }

      async function testModel() {
        setPing({ pending: true })
        try {
          const result = await call('ping', {})
          setPing(result)
        } catch (cause) {
          setPing({ ok: false, error: message(cause) })
        }
      }

      React.useLayoutEffect(() => {
        const node = drawerRef.current
        if ((drawer === 'log' || drawer === 'calls') && node && followLog.current) node.scrollTop = node.scrollHeight
      }, [log, drawer, callLog])

      React.useLayoutEffect(() => {
        if (!callFocus || drawer !== 'calls') return
        const row = document.getElementById(`ws-call-${callFocus}`)
        const body = drawerRef.current
        if (row && body) body.scrollTop = row.offsetTop - body.clientHeight / 2
      }, [callFocus, drawer])

      // Model-call log: fetched incrementally while its tab is open.
      React.useEffect(() => {
        if (drawer !== 'calls' || !current?.id) return undefined
        const id = current.id
        let alive = true
        const pull = async () => {
          const have = callStore.current.id === id ? callStore.current : { id, entries: [], last: 0 }
          try {
            const value = await call('calls', { runId: id, since: have.last })
            if (!alive) return
            if (value.entries.length > 0 || callStore.current.id !== id) {
              callStore.current = { id, entries: [...have.entries, ...value.entries].slice(-5000), last: value.last }
              setCallLog(callStore.current)
            }
          } catch { /* transient */ }
        }
        pull()
        const timer = running ? setInterval(pull, 2000) : null
        return () => { alive = false; if (timer) clearInterval(timer) }
      }, [drawer, current?.id, running])

      // ── Derived line state ──
      const files = Array.isArray(current?.files) ? current.files : []
      const totals = current?.totals ?? {}
      const inflight = running ? Object.values(current?.inflight ?? {}) : []
      if (running && inflight.length === 0 && current?.current) inflight.push(current.current)
      const load = Object.fromEntries(STATIONS.map((id) => [id, 0]))
      for (const state of inflight) {
        const station = stationOf(state)
        if (station) load[station] += 1
      }
      const planned = Number(current?.planned ?? 0) || (running ? 0 : files.length)
      const done = files.length
      const percent = planned > 0 ? Math.min(100, Math.round((done / planned) * 100)) : (current && !running ? 100 : 0)
      const startedMs = current?.startedAt ? Date.parse(current.startedAt) : 0
      const elapsed = running ? now - startedMs : Number(current?.durationMs ?? 0)
      const rate = elapsed > 0 ? (done / (elapsed / 60000)) : 0
      const counts = { clean: 0, review: 0, failed: 0, cancelled: 0 }
      for (const file of files) counts[file.status] = (counts[file.status] ?? 0) + 1
      const reached = new Set()
      if (current) {
        if (running) {
          const active = new Set(inflight.map(stationOf).filter(Boolean))
          const lastActive = Math.max(-1, ...[...active].map((id) => STATIONS.indexOf(id)))
          STATIONS.forEach((id, index) => { if (index < lastActive && !active.has(id)) reached.add(id) })
        } else {
          for (const id of STATIONS) reached.add(id)
          if (!(current.totals?.dicom)) reached.delete('dicom')
          if (!(Number(current.config?.maxRounds ?? 1) > 1) || !files.some((file) => Number(file.rounds ?? 0) > 1)) reached.delete('repair')
        }
      }
      const byType = Object.entries(totals.byType ?? {}).sort((a, b) => b[1] - a[1])
      const maxType = Math.max(1, ...byType.map(([, value]) => value))
      const lineStatus = !current ? 'idle' : current.status
      const inflightSet = new Set(inflight.map((state) => state.file))

      // Throughput over time (files/min), from each file's completion time.
      const finishedAt = files.map((file) => Number(file.doneMs)).filter((value) => Number.isFinite(value) && value >= 0).sort((x, y) => x - y)
      // Bins are at least 30 s wide: with concurrent workers files finish in
      // bursts, and a 3-second bin would turn one burst into a fake peak.
      const span = Math.max(elapsed, finishedAt[finishedAt.length - 1] ?? 0, 1)
      const binMs = Math.max(span / 40, 30000)
      const BINS = Math.max(1, Math.ceil(span / binMs))
      const bins = new Array(BINS).fill(0)
      for (const at of finishedAt) bins[Math.min(BINS - 1, Math.floor(at / binMs))] += 1
      // The last bin may be partial; rate it over the time it actually covers.
      const series = bins.map((count, index) => count / (Math.max(1000, Math.min(binMs, span - index * binMs)) / 60000))
      const recentRate = running && finishedAt.length > 0
        ? finishedAt.filter((at) => at >= elapsed - 120000).length / (Math.min(elapsed, 120000) / 60000)
        : rate
      const remaining = Math.max(0, planned - done)
      const etaMs = running && done > 0 && recentRate > 0 ? (remaining / recentRate) * 60000 : null
      const spark = () => {
        const W = 260
        const H = 44
        const has = finishedAt.length > 1
        const max = Math.max(1, ...series)
        const pts = has
          ? series.map((value, index) => `${((index + 0.5) / BINS) * W},${H - 3 - (value / max) * (H - 8)}`)
          : [`0,${H - 3}`, `${W},${H - 3}`]
        const avgY = H - 3 - (rate / max) * (H - 8)
        return h('div', { className: 'ws-spark' },
          h('div', { className: 'ws-spark-head' },
            h('span', {}, t('ws.trend')),
            h('b', { className: 'ma-mono', title: running ? t('ws.spark.nowHint') : '' }, has ? `${running ? `${t('ws.spark.now')} ` : ''}${(running ? recentRate : rate).toFixed(1)} ${t('ws.perMin')}` : '—')),
          h('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' },
            [1, 2, 3].map((index) => h('path', { key: index, className: 'ws-spark-grid', d: `M0 ${(H / 4) * index}H${W}` })),
            has ? h('path', { className: 'ws-spark-area', d: `M0 ${H} L${pts.join(' L')} L${W} ${H} Z` }) : null,
            h('polyline', { className: 'ws-spark-line', points: pts.join(' ') }),
            has && rate > 0 ? h('path', { className: 'ws-spark-avg', d: `M0 ${avgY}H${W}` }) : null),
          has ? h('div', { className: 'ws-spark-foot' },
            h('span', {}, t('ws.spark.avg', { rate: rate.toFixed(1), secs: rate > 0 ? (60 / rate).toFixed(1) : '—' })),
            BINS > 1 ? h('span', {}, t('ws.spark.peak', { rate: Math.max(...series).toFixed(1) })) : null) : null)
      }

      // ── Render helpers ──
      const readout = (label, value, tone = '') => h('div', { className: `ws-readout${tone ? ` ws-tone-${tone}` : ''}` },
        h('span', {}, label), h('b', {}, value))

      const stepper = (key, min, max, step = 1) => h('div', { className: 'ws-stepper' },
        h('button', { type: 'button', disabled: anyRunning || draft[key] <= min, onClick: () => setParam(key, Math.max(min, +(draft[key] - step).toFixed(2))) }, '−'),
        h('input', {
          type: 'number', min, max, step, value: draft[key], disabled: anyRunning,
          onChange: (event) => setParam(key, Number(event.target.value)),
        }),
        h('button', { type: 'button', disabled: anyRunning || draft[key] >= max, onClick: () => setParam(key, Math.min(max, +(draft[key] + step).toFixed(2))) }, '+'))

      const toggle = (key, label) => h('label', { className: 'ws-toggle' },
        h('input', { type: 'checkbox', checked: draft[key], disabled: anyRunning, onChange: (event) => setParam(key, event.target.checked) }),
        h('span', { className: 'ws-switch', 'aria-hidden': 'true' }),
        h('span', {}, label),
        changed.includes(key) ? h('i', { className: 'ws-mod' }) : null)

      const paramRow = (key, label, control) => h('div', { className: 'ws-param' },
        h('span', { className: 'ws-param-label' }, label, changed.includes(key) ? h('i', { className: 'ws-mod' }) : null),
        control)

      const workpieces = () => {
        const cells = []
        const limit = 600
        for (const file of files.slice(0, limit)) {
          cells.push(h('span', { key: `d-${file.relPath}`, className: `ws-piece ws-p-${file.status}`, title: `${file.relPath} · ${t(`file.${file.status}`)}` }))
        }
        for (const state of inflight) {
          if (!state.file || cells.length >= limit) continue
          cells.push(h('span', { key: `r-${state.file}`, className: 'ws-piece ws-p-running', title: `${state.file} · ${state.step}` }))
        }
        const pending = Math.max(0, Math.min(limit - cells.length, planned - files.length - inflightSet.size))
        for (let index = 0; index < pending; index += 1) cells.push(h('span', { key: `p-${index}`, className: 'ws-piece' }))
        return cells
      }

      const drawerBody = () => {
        if (!current) return h('p', { className: 'ma-empty' }, t('ws.noRun'))
        if (drawer === 'parts') {
          const rows = [
            ...inflight.filter((state) => state.file).map((state) => ({ relPath: state.file, status: 'running', step: state, entities: null, rounds: state.round })),
            ...files,
          ]
          return rows.length === 0
            ? h('p', { className: 'ma-empty' }, t('detail.noFiles'))
            : h('table', { className: 'ma-table ws-table' },
              h('thead', {}, h('tr', {},
                h('th', {}, t('runs.file')), h('th', {}, t('ws.station')), h('th', {}, t('runs.status')),
                h('th', {}, t('ws.col.replaced')), h('th', {}, t('runs.rounds')))),
              h('tbody', {}, rows.map((file) => h('tr', { key: file.relPath },
                h('td', { className: 'ma-mono', title: file.relPath }, file.relPath),
                h('td', {}, file.step ? `${t(`ws.st.${stationOf(file.step) ?? 'read'}`)}` : t('ws.st.pack')),
                h('td', {}, h('span', { className: file.status === 'running' ? 'ma-chip ma-running' : statusClass(file.status) }, t(`file.${file.status}`))),
                h('td', {}, file.entities === null ? '…' : String(fileEntities(file))),
                h('td', {}, String(file.rounds ?? 0))))))
        }
        if (drawer === 'log') {
          return log.length === 0
            ? h('p', { className: 'ma-empty' }, t('ws.logEmpty'))
            : h('div', { className: 'ws-log' }, log.map((line, index) => h('div', { key: index, className: `ws-log-line ws-l-${line.kind}` },
              h('span', { className: 'ws-log-time' }, line.stamp), h('span', { className: 'ws-log-text', title: line.text }, line.text))))
        }
        if (drawer === 'calls') {
          const entries = callLog.id === current.id ? callLog.entries : []
          if (entries.length === 0) {
            return h('p', { className: 'ma-empty' }, current.config?.modelConfigured === false ? t('ws.calls.noModel') : t('ws.calls.empty'))
          }
          const ok = entries.filter((entry) => entry.result === 'ok')
          const avg = ok.length ? ok.reduce((sum, entry) => sum + entry.ms, 0) / ok.length : 0
          const sorted = ok.map((entry) => entry.ms).sort((a, b) => a - b)
          const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0
          const timeouts = entries.filter((entry) => entry.result === 'timeout').length
          const failed = entries.filter((entry) => entry.result !== 'ok' && entry.result !== 'timeout' && entry.result !== 'cancelled').length
          const tokens = entries.reduce((sum, entry) => sum + (entry.tokens || 0), 0)
          const secs = (ms) => `${(ms / 1000).toFixed(1)} s`
          const focusIndex = callFocus ? entries.findIndex((entry) => entry.seq === callFocus) : -1
          const shown = focusIndex >= 0
            ? entries.slice(Math.max(0, focusIndex - 250), focusIndex + 250)
            : entries.slice(-500)
          // Duration strip: one bar per call (or per bucket of calls), height =
          // duration, colour = worst outcome; click jumps to the rows.
          const BARS = Math.min(entries.length, 400)
          const per = entries.length / BARS
          const maxMs = Math.max(1, ...entries.map((entry) => entry.ms))
          const rank = { ok: 0, cancelled: 1, 'bad-json': 2, timeout: 3 }
          const bars = Array.from({ length: BARS }, (_, index) => {
            const group = entries.slice(Math.floor(index * per), Math.max(Math.floor(index * per) + 1, Math.floor((index + 1) * per)))
            let worst = group[0]
            for (const entry of group) if ((rank[entry.result] ?? 4) > (rank[worst.result] ?? 4) || (entry.result === worst.result && entry.ms > worst.ms)) worst = entry
            return { seq: worst.seq, ms: Math.max(...group.map((entry) => entry.ms)), result: worst.result, at: group[0].at }
          })
          const strip = h('div', { className: 'ws-strip' },
            h('svg', { viewBox: `0 0 ${BARS} 40`, preserveAspectRatio: 'none', role: 'img', 'aria-label': t('ws.calls.strip') },
              bars.map((bar, index) => h('rect', {
                key: index, x: index + 0.12, width: 0.76, y: 40 - Math.max(1.5, (bar.ms / maxMs) * 38), height: Math.max(1.5, (bar.ms / maxMs) * 38),
                className: `ws-bar-${bar.result === 'ok' ? 'ok' : bar.result === 'cancelled' ? 'cancel' : bar.result === 'timeout' ? 'timeout' : 'bad'}${bar.seq === callFocus ? ' ws-bar-focus' : ''}`,
                onClick: () => { followLog.current = false; setLogPinned(true); setCallFocus(bar.seq) },
              }, h('title', {}, `${hhmmss(new Date(bar.at))} · ${secs(bar.ms)} · ${t(`ws.calls.r.${bar.result}`)}`)))),
            h('div', { className: 'ws-strip-axis' }, h('span', {}, hhmmss(new Date(entries[0].at))), h('span', {}, `max ${secs(maxMs)}`), h('span', {}, hhmmss(new Date(entries[entries.length - 1].at)))))
          return h(React.Fragment, {},
            strip,
            h('div', { className: 'ws-calls-sum' },
              h('span', {}, t('ws.calls.count', { count: entries.length })),
              h('span', {}, `${t('ws.calls.avg')} ${secs(avg)}`),
              h('span', {}, `P95 ${secs(p95)}`),
              h('span', {}, `Token ${compact(tokens)}`),
              h('span', { className: timeouts ? 'ws-c-bad' : '' }, `${t('ws.calls.timeout')} ${timeouts}`),
              h('span', { className: failed ? 'ws-c-bad' : '' }, `${t('ws.calls.failed')} ${failed}`),
              entries.length > shown.length ? h('span', {}, t('ws.calls.latest', { count: shown.length })) : null),
            h('table', { className: 'ma-table ws-table ws-calls' },
              h('thead', {}, h('tr', {},
                h('th', {}, t('runs.time')), h('th', {}, t('runs.file')), h('th', {}, t('ws.station')), h('th', {}, t('runs.rounds')),
                h('th', {}, t('ws.calls.segments')), h('th', {}, t('ws.calls.ms')), h('th', {}, 'Token'), h('th', {}, t('runs.status')))),
              h('tbody', {}, shown.map((entry) => h('tr', { key: entry.seq, id: `ws-call-${entry.seq}`, className: `${entry.ms > p95 * 1.5 && entry.ms > 5000 ? 'ws-slow' : ''}${entry.seq === callFocus ? ' ws-focus' : ''}` },
                h('td', { className: 'ma-mono' }, hhmmss(new Date(entry.at))),
                h('td', { className: 'ma-mono', title: entry.file }, entry.file),
                h('td', {}, entry.stage),
                h('td', {}, `R${entry.round}`),
                h('td', {}, String(entry.segments)),
                h('td', { className: 'ma-mono' }, secs(entry.ms)),
                h('td', { className: 'ma-mono' }, entry.tokens ? compact(entry.tokens) : '—'),
                h('td', {}, h('span', { className: entry.result === 'ok' ? 'ma-chip ma-ok' : entry.result === 'cancelled' ? 'ma-chip' : 'ma-chip ma-bad' }, t(`ws.calls.r.${entry.result}`) === `ws.calls.r.${entry.result}` ? entry.result : t(`ws.calls.r.${entry.result}`))))))))
        }
        if (drawer === 'warn') {
          const warnings = current.warnings ?? []
          return warnings.length === 0
            ? h('p', { className: 'ma-empty' }, t('ws.noWarn'))
            : h('ul', { className: 'ws-warn' }, warnings.map((text, index) => h('li', { key: index }, text)))
        }
        return running
          ? h('p', { className: 'ma-empty' }, t('detail.noReport'))
          : (reportText
            ? h('div', { className: 'ws-report' },
              h('div', { className: 'ws-report-tools' },
                h('button', { className: 'ma-btn ma-small', onClick: () => copyText(reportText) }, t('ws.report.copy')),
                h('button', { className: 'ma-btn ma-small', onClick: () => setModal('report') }, `⤢ ${t('ws.report.full')}`)),
              h(MarkdownView, { text: reportText }))
            : h('p', { className: 'ma-empty' }, t('detail.loading')))
      }

      const modelName = config ? (config.model || t('ws.rulesOnly')) : '—'

      const sourceLabel = (source) => {
        const label = t(`ws.src.${source.kind}`)
        if (!source.sessionId) return h('span', { className: 'ws-src' }, label)
        return h('button', {
          type: 'button', className: 'ws-src ws-src-link', title: source.sessionId,
          onClick: () => {
            try { services.ctx.get('uiWorkspace').openSession(source.sessionId) } catch (cause) { setError(message(cause)) }
          },
        }, `${label} ↗`)
      }

      const advicePanel = () => {
        const advice = adviceRunId ? adviceByRun[adviceRunId] : undefined
        const items = (advice?.suggestions ?? []).filter((item) => !dismissed[`${adviceRunId}:${item.id}`])
        const open = items.filter((item) => !isApplied(item))
        const done = items.filter((item) => isApplied(item))
        const draft = advice?.draft ?? null
        const body = []
        if (!adviceRunId) body.push(h('p', { key: 'e', className: 'ma-empty' }, running ? t('ws.adv.running') : t('ws.adv.none')))
        else if (advice === undefined) body.push(h('p', { key: 'e', className: 'ma-empty' }, t('detail.loading')))
        else if (open.length === 0 && !draft) body.push(h('p', { key: 'e', className: 'ma-empty' }, done.length > 0 ? t('ws.adv.allDone') : t('ws.adv.clean')))
        for (const item of open) {
          const key = `${adviceRunId}:${item.id}`
          const choices = item.values
            ? item.values.map((entry) => ({ id: entry.value, label: entry.value, sub: `${entry.type} · ${t('ws.adv.spread', { count: entry.spread })} · ${entry.fields.join('、')}` }))
            : item.fields ? item.fields.map((entry) => ({ id: entry.field, label: entry.field, sub: t('ws.adv.hits', { count: entry.hits }) })) : null
          body.push(h('div', { key: item.id, className: `ws-adv ws-adv-${item.level}` },
            h('div', { className: 'ws-adv-title' },
              item.level === 'confirm' ? h('span', { className: 'ws-adv-flag' }, t('ws.adv.confirm')) : null,
              h('b', {}, item.title)),
            h('p', { className: 'ws-adv-reason' }, item.reason),
            choices ? h('div', { className: 'ws-adv-choices' }, choices.map((choice) => h('label', { key: choice.id, className: 'ws-adv-choice', title: choice.sub },
              h('input', { type: 'checkbox', checked: Boolean(picked[`${key}:${choice.id}`]), onChange: (event) => setPicked({ ...picked, [`${key}:${choice.id}`]: event.target.checked }) }),
              h('span', { className: 'ma-mono' }, choice.label),
              h('i', {}, choice.sub)))) : null,
            h('div', { className: 'ma-actions' },
              h('button', { className: 'ma-btn ma-small ma-primary', disabled: anyRunning || adopting !== null || !config, onClick: () => adopt(item) },
                adopting === item.id ? t('save.saving') : t('ws.adv.adopt')),
              h('button', { className: 'ma-btn ma-small', onClick: () => dismiss(key) }, t('ws.adv.dismiss')))))
        }
        if (draft) {
          body.push(h('div', { key: 'draft', className: 'ws-adv ws-adv-draft' },
            h('div', { className: 'ws-adv-title' }, h('span', { className: 'ws-adv-flag' }, t('ws.adv.plugin')), h('b', {}, t('ws.adv.draftTitle', { count: advice.findings.length }))),
            h('p', { className: 'ws-adv-reason' }, t('ws.adv.draftHint')),
            showDraft ? h('pre', { className: 'ma-pre ws-adv-pre' }, draft) : null,
            h('div', { className: 'ma-actions' },
              h('button', { className: 'ma-btn ma-small ma-primary', onClick: () => copyDraft(draft) }, t('ws.adv.copyDraft')),
              h('button', { className: 'ma-btn ma-small', onClick: () => setShowDraft(!showDraft) }, showDraft ? t('ws.adv.hide') : t('ws.adv.preview')))))
        }
        if (done.length > 0) body.push(h('p', { key: 'done', className: 'ma-hint ma-ok' }, t('ws.adv.doneCount', { count: done.length })))
        if (adviceNote) body.push(h('p', { key: 'note', className: adviceNote.ok ? 'ma-hint ma-ok' : 'ma-hint ma-error' }, adviceNote.text))
        if (anyRunning && open.length > 0) body.push(h('p', { key: 'lock', className: 'ma-hint' }, t('ws.paramsLocked')))
        const pending = open.length + (draft ? 1 : 0)
        return h('section', { className: 'ws-panel ws-advice' },
          h('div', { className: 'ws-panel-head' }, h('h3', { 'data-code': 'C3' }, t('ws.adv.title')),
            h('span', { className: `ws-tag${pending > 0 ? ' ws-tag-hot' : ''}` }, String(pending))),
          ...body)
      }

      return h('div', { className: 'ma-page ws-page', ref: rootRef },
        h('style', { key: 'ma-style' }, CSS + WS_CSS),
        // ── Header bar ──
        h('header', { className: 'ws-head' },
          h('button', { type: 'button', className: 'ws-brand', onClick: () => setModal('help'), title: t('ws.helpHint') },
            h('span', { className: 'ws-brand-mark' }, h(AnonymizerIcon, { size: 18 })),
            h('div', {},
              h('h2', {}, t('ws.title'), h('span', { className: 'ws-brand-info', 'aria-hidden': 'true' }, 'i')),
              h('span', {}, t('ws.subtitle')))),
          h('div', { className: `ws-status ws-s-${lineStatus}` },
            h('span', { className: 'ws-lamp' }),
            h('div', {},
              h('b', {}, lineStatus === 'idle' ? t('ws.idle') : t(`status.${lineStatus}`)),
              h('span', { className: 'ma-mono' }, current?.id ?? '—'),
              current?.source ? sourceLabel(current.source) : null)),
          h('div', { className: 'ws-clock' }, h('span', {}, t('ws.m.elapsed')), h('b', {}, clock(elapsed))),
          running
            ? h('div', { className: 'ws-clock' }, h('span', {}, t('ws.m.remaining')), h('b', {}, `${remaining}`))
            : h('div', { className: 'ws-clock' }, h('span', {}, t('ws.m.progress')), h('b', {}, `${done}/${planned || '—'}`)),
          running
            ? h('div', { className: 'ws-clock' }, h('span', {}, t('ws.m.eta')), h('b', {}, etaMs === null ? '--:--:--' : clock(etaMs)))
            : null,
          h('div', { className: 'ws-head-actions' },
            running
              ? h('button', { className: 'ma-btn ws-stop', onClick: cancelRun, disabled: cancelling }, cancelling ? t('run.cancelling') : t('ws.stop'))
              : null)),
        error ? h('div', { className: 'ma-banner' }, `${t('error.title')}: ${error}`, h('button', { className: 'ma-link', style: { marginLeft: 8 }, onClick: () => setError('') }, '×')) : null,

        h('div', { className: 'ws-grid' },
          // ── Left: feed + history ──
          h('aside', { className: 'ws-col' },
            h('section', { className: 'ws-panel' },
              h('div', { className: 'ws-panel-head' }, h('h3', { 'data-code': 'A1' }, t('ws.feed')), h('span', { className: 'ws-tag' }, 'INPUT')),
              h('label', { className: 'ma-field' }, t('form.input'),
                h('div', { className: 'ma-inline' },
                  h('input', { className: 'ma-input', value: inputDir, onChange: (event) => setInputDir(event.target.value), placeholder: t('form.inputPlaceholder'), title: inputDir })),
                h('div', { className: 'ws-pick' },
                  h('button', { className: 'ma-btn ma-small', onClick: browse }, t('ws.pickDir')),
                  h('button', { className: 'ma-btn ma-small', onClick: browseFile }, t('ws.pickFile')))),
              h('label', { className: 'ma-field' }, t('form.output'),
                h('input', { className: 'ma-input', value: outputRoot, onChange: (event) => setOutputRoot(event.target.value), placeholder: t('run.outputDefault') })),
              h('button', { className: 'ma-btn ma-primary ws-start', onClick: start, disabled: busy || anyRunning },
                busy ? t('form.starting') : (anyRunning ? t('ws.lineBusy') : `▶ ${t('form.start')}`)),
              notice ? h('span', { className: 'ma-hint ma-ok' }, notice) : null),
            h('section', { className: 'ws-panel ws-grow' },
              h('div', { className: 'ws-panel-head' },
                h('h3', { 'data-code': 'A2' }, t('runs.title')),
                h('button', { className: 'ma-btn ma-small', onClick: refreshRuns }, t('runs.refresh'))),
              runs.length === 0
                ? h('p', { className: 'ma-empty' }, t('runs.empty'))
                : h('div', { className: 'ws-history' }, runs.map((run) => h('div', {
                  key: run.id, role: 'button', tabIndex: 0,
                  className: `ws-run${run.id === viewId ? ' ws-run-on' : ''}`,
                  onClick: () => selectRun(run.id),
                  onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectRun(run.id) } },
                },
                  h('div', { className: 'ws-run-top' },
                    h('span', { className: 'ws-run-name', title: run.inputDir ?? '' }, baseName(run.inputDir) || run.id),
                    h('span', { className: statusClass(run.status) }, t(`status.${run.status}`)),
                    run.status !== 'running'
                      ? h('button', {
                        type: 'button', className: 'ws-run-del', title: t('ws.del.title'), 'aria-label': t('ws.del.title'),
                        onClick: (event) => { event.stopPropagation(); setDeleting({ run, deliverable: false, busy: false, error: '' }) },
                      }, '✕')
                      : null),
                  h('div', { className: 'ws-run-meta' },
                    h('span', {}, `${formatTime(run.startedAt)}${run.source ? ` · ${t(`ws.src.${run.source.kind}`)}` : ''}`),
                    h('span', {}, `${run.files ?? 0} ${t('ws.unitFiles')} · ${run.entities ?? 0} ${t('ws.unitEntities')}${run.unresolved ? ` · ⚠ ${run.unresolved}` : ''}`))))))),

          // ── Center: the line ──
          h('main', { className: 'ws-col ws-center' },
            h('section', { className: 'ws-panel ws-floor' },
              h('div', { className: 'ws-panel-head' },
                h('h3', { 'data-code': 'B1' }, t('ws.line')),
                h('span', { className: 'ws-drawno' }, `RUN · ${current?.id ?? '—'}`),
                h('span', { className: 'ws-legend' },
                  h('i', { className: 'ws-k-active' }), t('ws.kActive'),
                  h('i', { className: 'ws-k-done' }), t('ws.kDone'),
                  h('i', { className: 'ws-k-idle' }), t('ws.kIdle'))),
              h(LineSchematic, { load, reached, running, inflight, maxRounds: Number(current?.config?.maxRounds ?? config?.maxRounds ?? 3), t }),
              h('div', { className: 'ws-conveyor-head' },
                h('span', {}, t('ws.conveyor')),
                h('span', { className: 'ma-mono' }, `${percent}%`)),
              h('div', { className: 'ws-bar' }, h('div', { className: 'ws-bar-fill', style: { width: `${percent}%` } })),
              h('div', { className: 'ws-pieces', ref: piecesRef, onScroll: onPiecesScroll }, workpieces())),
            h('div', { className: 'ws-twin' },
              h('section', { className: 'ws-panel' },
                h('div', { className: 'ws-panel-head' }, h('h3', { 'data-code': 'B2' }, t('ws.byType')), h('span', { className: 'ma-mono' }, compact(totals.entities ?? 0))),
                byType.length === 0
                  ? h('p', { className: 'ma-empty' }, '—')
                  : h('div', { className: 'ws-bars' }, byType.map(([type, value]) => h('div', { key: type, className: 'ws-bar-row' },
                    h('span', {}, type),
                    h('div', { className: 'ws-bar ws-thin' }, h('div', { className: 'ws-bar-fill', style: { width: `${(value / maxType) * 100}%` } })),
                    h('b', { className: 'ma-mono' }, String(value)))))),
              h('section', { className: 'ws-panel' },
                h('div', { className: 'ws-panel-head' }, h('h3', { 'data-code': 'B3' }, t('ws.quality')), h('span', { className: 'ma-mono' }, `${done}`)),
                h('div', { className: 'ws-qbar' },
                  ['clean', 'review', 'failed'].map((key) => counts[key] > 0
                    ? h('div', { key, className: `ws-q-${key}`, style: { flex: counts[key] }, title: `${t(`file.${key}`)} ${counts[key]}` })
                    : null)),
                h('div', { className: 'ws-qlegend' },
                  ['clean', 'review', 'failed'].map((key) => h('span', { key }, h('i', { className: `ws-q-${key}` }), `${t(`file.${key}`)} `, h('b', { className: 'ma-mono' }, String(counts[key]))))),
                current?.review?.files
                  ? h('div', { className: 'ws-path' },
                    h('span', { className: 'ws-path-tag ws-path-warn' }, `${t('ws.reviewCopies')} ${current.review.files}`),
                    h('span', { className: 'ma-mono', title: current.review.dir }, current.review.dir),
                    h('button', { className: 'ma-btn ma-small', onClick: () => navigator.clipboard?.writeText(current.review.dir) }, t('ws.copy')))
                  : null,
                current?.output || current?.runDir
                  ? h('div', { className: 'ws-path' },
                    h('span', { className: 'ws-path-tag' }, current.output ? t('ws.result') : t('ws.records')),
                    h('span', { className: 'ma-mono', title: current.output ?? current.runDir }, current.output ?? current.runDir),
                    h('button', { className: 'ma-btn ma-small', onClick: copyPath }, copied ? t('detail.copied') : t('detail.copy')))
                  : null)),
            h('section', { className: 'ws-panel ws-drawer' },
              h('div', { className: 'ma-tabs', role: 'tablist' }, ['parts', 'log', 'calls', 'warn', 'report'].map((id) => h('button', {
                key: id, type: 'button', role: 'tab', className: 'ma-tab',
                'aria-selected': drawer === id ? 'true' : 'false',
                onClick: () => {
                  // Opening the log starts at the latest line.
                  if (id === 'log' || id === 'calls') { followLog.current = true; setLogPinned(false) }
                  setDrawer(id)
                },
              }, t(`ws.tab.${id}`),
              id === 'warn' && (current?.warnings?.length ?? 0) > 0 ? h('span', { className: 'ws-count' }, String(current.warnings.length)) : null))),
              h('div', { className: 'ws-drawer-wrap' },
                h('div', { className: 'ws-drawer-body', ref: drawerRef, onScroll: onDrawerScroll }, drawerBody()),
                (drawer === 'log' || drawer === 'calls') && logPinned
                  ? h('button', { type: 'button', className: 'ws-latest', onClick: jumpToLatest }, `↓ ${t('ws.latest')}`)
                  : null))),

          // ── Right: monitor + parameters ──
          h('aside', { className: 'ws-col ws-col-right' },
            h('section', { className: 'ws-panel' },
              h('div', { className: 'ws-panel-head' }, h('h3', { 'data-code': 'C1' }, t('ws.monitor')), h('span', { className: `ws-tag${running ? ' ws-live' : ''}` }, running ? 'LIVE' : 'IDLE')),
              h('div', { className: 'ws-mon-top' },
                h('div', { className: 'ws-gauge', style: { '--ws-pct': `${percent * 3.6}deg` } },
                  h('div', { className: 'ws-gauge-in' }, h('b', {}, `${percent}`), h('span', {}, '%'))),
                h('div', { className: 'ws-model' },
                h('div', {}, h('span', {}, t('ws.model')), h('b', { className: 'ma-mono', title: config?.baseURL ?? '' }, modelName)),
                h('span', { className: 'ma-mono ws-endpoint', title: config?.baseURL ?? '' }, config?.model ? config.baseURL : ''),
                config?.model
                  ? h('div', { className: 'ws-ping' },
                    h('button', { className: 'ma-btn ma-small', onClick: testModel, disabled: ping?.pending }, ping?.pending ? t('model.testing') : t('model.test')),
                    ping && !ping.pending
                      ? h('span', { className: ping.ok && (ping.models ?? []).includes(config.model) ? 'ma-hint ma-ok' : 'ma-hint ma-error' },
                        ping.ok ? ((ping.models ?? []).includes(config.model) ? t('ws.online') : t('model.missing', { model: config.model })) : t('model.fail', { error: ping.error }))
                      : null)
                  : null)),
              spark(),
              h('div', { className: 'ws-readouts' },
                readout(t('ws.m.entities'), compact(totals.entities ?? 0)),
                readout(t('ws.m.calls'), compact(running ? (current?.current?.modelCalls ?? totals.modelCalls ?? 0) : (totals.modelCalls ?? 0))),
                readout(t('ws.m.review'), String(totals.unresolved ?? 0), (totals.unresolved ?? 0) > 0 ? 'warn' : ''),
                readout(t('ws.m.failed'), String(totals.filesFailed ?? 0), (totals.filesFailed ?? 0) > 0 ? 'bad' : '')),
              h('div', { className: 'ws-minor' },
                h('span', { title: t('ws.m.tokensHint') }, `${t('ws.m.tokens')} ${totals.tokens ? compact(totals.tokens) : ((totals.modelCalls ?? 0) > 0 && !totals.tokensReported ? t('ws.m.noUsage') : '0')}`),
                h('span', { title: t('ws.m.mappingsHint') }, `${t('ws.m.mappings')} ${compact(totals.newMappings ?? 0)}`),
                h('span', {}, `${t('ws.m.chunks')} ${current?.chunks ?? '—'}`),
                current?.memory?.heapLimit ? (() => {
                  const m = current.memory
                  const gb = (bytes) => (bytes / 1024 ** 3).toFixed(1)
                  const ratio = m.peakHeap / m.heapLimit
                  return h('span', {
                    className: ratio >= 0.85 ? 'ws-mem ws-mem-bad' : ratio >= 0.7 ? 'ws-mem ws-mem-warn' : 'ws-mem',
                    title: t('ws.m.memHint'),
                  }, t('ws.m.mem', { now: gb(running ? m.heapUsed : m.peakHeap), peak: gb(m.peakHeap), limit: gb(m.heapLimit), pct: Math.round(ratio * 100) }))
                })() : null)),
            h('section', { className: 'ws-panel' },
              h('div', { className: 'ws-panel-head' }, h('h3', { 'data-code': 'C2' }, t('ws.params')), anyRunning
                  ? h('span', { className: 'ws-tag' }, t('ws.locked'))
                  : h('button', { className: 'ma-link ws-more', onClick: () => setModal('settings') }, `${t('ws.allSettings')} →`)),
              !draft
                ? h('p', { className: 'ma-empty' }, t('detail.loading'))
                : h(React.Fragment, {},
                  paramRow('maxRounds', t('run.rounds'), stepper('maxRounds', 1, 6)),
                  paramRow('concurrency', t('ws.p.concurrency'), stepper('concurrency', 1, 16)),
                  paramRow('maxFiles', t('ws.p.maxFiles'), stepper('maxFiles', 1, 2000, 50)),
                  paramRow('timeoutSec', t('ws.p.timeout'), stepper('timeoutSec', 10, 1800, 10)),
                  paramRow('temperature', t('ws.p.temperature'), h('div', { className: 'ws-slider' },
                    h('input', { type: 'range', min: 0, max: 2, step: 0.1, value: draft.temperature, disabled: anyRunning, onChange: (event) => setParam('temperature', Number(event.target.value)) }),
                    h('b', { className: 'ma-mono' }, Number(draft.temperature).toFixed(1)))),
                  toggle('disableThinking', t('ws.p.noThinking')),
                  toggle('quasiIdentifiers', t('ws.p.quasi')),
                  h('div', { className: 'ma-actions' },
                    h('span', { className: 'ma-hint', style: { flex: 1, minWidth: 0 }, title: t('page.settingsHint') }, anyRunning ? t('ws.paramsLocked') : t('ws.paramsHint')),
                    h('button', { className: 'ma-btn ma-small', disabled: changed.length === 0 || savingParams, onClick: () => { setDraft(saved); setParamNote(null) } }, t('save.revert')),
                    h('button', { className: 'ma-btn ma-small ma-primary', disabled: changed.length === 0 || savingParams || anyRunning, onClick: saveParams },
                      savingParams ? t('save.saving') : t('ws.paramsSave'))),
                  paramNote ? h('p', { className: paramNote.ok ? 'ma-hint ma-ok' : 'ma-hint ma-error' }, paramNote.text) : null)),
            advicePanel())),
        deleting ? h('div', { className: 'ws-modal-back', onMouseDown: (event) => { if (event.target === event.currentTarget && !deleting.busy) setDeleting(null) } },
          h('div', { className: 'ws-modal ws-modal-del', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': t('ws.del.title') },
            h('div', { className: 'ws-modal-head' }, h('h3', {}, t('ws.del.title'))),
            h('div', { className: 'ws-modal-body ws-del' },
              h('p', {}, h('b', {}, baseName(deleting.run.inputDir) || deleting.run.id), h('span', { className: 'ma-mono' }, ` · ${deleting.run.id}`)),
              h('p', { className: 'ma-hint' }, t('ws.del.records')),
              h('label', { className: 'ma-check' },
                h('input', { type: 'checkbox', checked: deleting.deliverable, disabled: !deleting.run.output, onChange: (event) => setDeleting({ ...deleting, deliverable: event.target.checked }) }),
                deleting.run.output ? t('ws.del.deliverable', { path: deleting.run.output }) : t('ws.del.noDeliverable')),
              h('p', { className: 'ma-hint' }, t('ws.del.vault')),
              deleting.error ? h('p', { className: 'ma-hint ma-error' }, deleting.error) : null,
              h('div', { className: 'ma-actions ws-del-actions' },
                h('button', { className: 'ma-btn', disabled: deleting.busy, onClick: () => setDeleting(null) }, t('ws.del.cancel')),
                h('button', { className: 'ma-btn ws-del-go', disabled: deleting.busy, onClick: confirmDelete }, deleting.busy ? t('ws.del.busy') : t('ws.del.go'))))))
          : null,
        modal ? h('div', { className: 'ws-modal-back', onMouseDown: (event) => { if (event.target === event.currentTarget) closeModal() } },
          h('div', { className: `ws-modal ws-modal-${modal}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': (modal === 'help' ? t('ws.helpTitle') : modal === 'report' ? `${t('ws.tab.report')} · ${current?.id ?? ''}` : t('settings.title')) },
            h('div', { className: 'ws-modal-head' },
              h('h3', {}, (modal === 'help' ? t('ws.helpTitle') : modal === 'report' ? `${t('ws.tab.report')} · ${current?.id ?? ''}` : t('settings.title'))),
              modal === 'report' && reportText ? h('button', { className: 'ma-btn ma-small', onClick: () => copyText(reportText) }, t('ws.report.copy')) : null,
              h('button', { className: 'ma-btn ma-small', onClick: closeModal, 'aria-label': t('detail.close') }, '✕')),
            h('div', { className: 'ws-modal-body' },
              modal === 'help'
                ? h(HelpBody, { config })
                : (modal === 'settings' && anyRunning ? h('div', { className: 'ma-banner' }, t('ws.paramsLocked')) : null),
              modal === 'settings' ? h(SettingsSection) : null,
              modal === 'report' ? (reportText ? h(MarkdownView, { text: reportText }) : h('p', { className: 'ma-empty' }, t('detail.noReport'))) : null)))
          : null)
    }

    // Panel help (opened from the title): scope, method and output as tables
    // and diagrams rather than prose. Identifier treatments come from the
    // live configuration.
    const HELP = {
      zh: {
        title: '处理说明',
        scope: '一、处理范围',
        scopeHead: ['对象', '内容', '默认处理'],
        scopeRows: [
          ['文本类文件', 'txt · md · csv · json · xlsx', '识别并替换标识符'],
          ['压缩包', 'zip（最多 3 层嵌套）', '解压处理后按原结构重新打包'],
          ['医学影像', 'DICOM', '仅处理元数据，像素不变'],
          ['文件名 / 目录名', '姓名、证件号、病人编号、住院号、门诊号', '替换为对应假名'],
          ['准标识符', '日期 · 年龄 · 性别 · 邮编', '不处理（可在处理参数中开启）'],
          ['不支持', 'Word · PDF · 图片', '跳过，并在「提示」中列出'],
        ],
        ids: '直接标识符及当前处理方式',
        flow: '二、处理流程',
        flowNote: '核验未通过的文件进入修正，再次核验，最多 {rounds} 轮；仍未通过的标记为待复核。',
        stageHead: ['环节', '方法', '产出'],
        stageRows: {
          prescan: ['批次级扫描', '批次字典；匿名化后的输出路径'],
          read: ['格式解析；按字段名整格替换', '待处理片段'],
          discover: ['规则匹配 + 模型识别；插件逐字定位', '标识符清单'],
          verify: ['规则复扫 · 模型复核 · 原值清除检查 · 结构校验', '通过 / 残留'],
          repair: ['对残留定向替换', '修正后的文件'],
          rescan: ['以全部已知标识符复扫批次及分组之间', '跨文件一致性'],
          dicom: ['删除姓名与 ID、重生成 UID、平移日期', '去标识化影像'],
          pack: ['重新打包；交付数据与记录分离', '交付数据 · 报告 · 映射库'],
        },
        principles: '三、处理原则',
        principleRows: [
          ['一致性', '同一原值在同一输出根目录下始终对应同一假名'],
          ['结构保持', '行列、表头、JSON 键与类型不变，仅替换命中片段'],
          ['源数据只读', '不写入输入目录；运行前后核对源文件指纹'],
          ['数据不外发', '原文仅发往设置中配置的模型端点'],
          ['可还原', '映射库保存原值与假名的对应关系，权限 600'],
        ],
        output: '四、输出结构',
        tree: [
          ['<输出根目录>/', ''],
          ['  <输入名>/ 或 <文件名>', '交付数据，可直接取用'],
          ['  _records/', '记录（与交付数据分开保管）'],
          ['    vault.json', '映射库（敏感）'],
          ['    runs/<批次>/report.md', '审计报告'],
          ['    runs/<批次>/review/', '待复核文件副本'],
          ['    runs/<批次>/calls.json', '模型调用记录'],
        ],
        status: '五、结果判定',
        statusHead: ['状态', '含义', '处置'],
        statusRows: [
          ['clean', '通过', '核验无残留，结构一致', '可交付'],
          ['review', '待复核', '仍有未解决的残留或异常', '人工确认后再交付'],
          ['failed', '失败', '文件无法读取或处理出错', '查看报告，修正后重跑'],
        ],
      },
      en: {
        title: 'Processing reference',
        scope: '1. Scope',
        scopeHead: ['Object', 'Content', 'Default treatment'],
        scopeRows: [
          ['Text files', 'txt · md · csv · json · xlsx', 'Identifiers detected and replaced'],
          ['Archives', 'zip (up to 3 levels)', 'Processed, then re-packed in the original layout'],
          ['Medical images', 'DICOM', 'Metadata only; pixels unchanged'],
          ['File / folder names', 'Names, ID, patient, admission and visit numbers', 'Replaced with pseudonyms'],
          ['Quasi-identifiers', 'Date · age · sex · postal code', 'Not processed (switch in Processing settings)'],
          ['Unsupported', 'Word · PDF · images', 'Skipped and listed under Notices'],
        ],
        ids: 'Direct identifiers and current treatment',
        flow: '2. Pipeline',
        flowNote: 'Files failing verification go to remediation and are verified again, up to {rounds} rounds; files still failing are marked Needs review.',
        stageHead: ['Stage', 'Method', 'Output'],
        stageRows: {
          prescan: ['Batch-level scan', 'Batch dictionary; anonymized output paths'],
          read: ['Format parsing; whole-cell replacement by field name', 'Segments to process'],
          discover: ['Rules + model detection; exact location by the plugin', 'Identifier list'],
          verify: ['Rule rescan · model review · absence check · structure check', 'Pass / residuals'],
          repair: ['Targeted replacement of residuals', 'Remediated files'],
          rescan: ['Rescan with all known identifiers, within and across chunks', 'Cross-file consistency'],
          dicom: ['Remove names and IDs, regenerate UIDs, shift dates', 'De-identified images'],
          pack: ['Re-pack; deliverable separated from records', 'Deliverable · report · vault'],
        },
        principles: '3. Principles',
        principleRows: [
          ['Consistency', 'One value maps to one pseudonym within an output root'],
          ['Structure', 'Rows, columns, headers, JSON keys and types are kept; only matches change'],
          ['Read-only source', 'Nothing is written to the input; source fingerprints are compared'],
          ['No egress', 'Text goes only to the model endpoint configured in Settings'],
          ['Reversible', 'The vault maps values to pseudonyms (mode 600)'],
        ],
        output: '4. Output layout',
        tree: [
          ['<output root>/', ''],
          ['  <input name>/ or <file>', 'Deliverable, ready to take'],
          ['  _records/', 'Records (keep apart from the deliverable)'],
          ['    vault.json', 'Vault (sensitive)'],
          ['    runs/<batch>/report.md', 'Audit report'],
          ['    runs/<batch>/review/', 'Copies of files needing review'],
          ['    runs/<batch>/calls.json', 'Model-call log'],
        ],
        status: '5. Outcomes',
        statusHead: ['Status', 'Meaning', 'Action'],
        statusRows: [
          ['clean', 'Clean', 'No residuals; structure intact', 'Deliverable'],
          ['review', 'Needs review', 'Unresolved residuals or anomalies', 'Confirm manually before delivery'],
          ['failed', 'Failed', 'File unreadable or processing error', 'See the report, fix, re-run'],
        ],
      },
    }

    function HelpBody({ config }) {
      const t = services.t
      const zh = services.ctx?.locale?.getLocale?.().active === 'zh'
      const c = zh ? HELP.zh : HELP.en
      const rounds = Number(config?.maxRounds ?? 3)
      const table = (head, rows, className = '') => h('table', { className: `ws-help-table ${className}` },
        h('thead', {}, h('tr', {}, head.map((cell, index) => h('th', { key: index }, cell)))),
        h('tbody', {}, rows))
      const schema = config?.policySchema?.identifiers ?? []
      const policy = config?.identifierPolicy ?? {}
      const flowMain = ['prescan', 'read', 'discover', 'verify', 'rescan', 'pack']
      return h('div', { className: 'ws-help' },
        h('h4', {}, c.scope),
        table(c.scopeHead, c.scopeRows.map((row, index) => h('tr', { key: index }, row.map((cell, i) => h('td', { key: i }, cell))))),
        schema.length > 0
          ? h('div', { className: 'ws-help-ids' },
            h('div', { className: 'ws-help-sub' }, c.ids),
            h('div', { className: 'ws-help-chips' }, schema.map((item) => h('span', { key: item.id, className: `ws-help-chip ws-hc-${policy[item.id] ?? 'pseudonym'}` },
              h('b', {}, item.type), h('i', {}, t(`strategy.${policy[item.id] ?? 'pseudonym'}`))))))
          : null,

        h('h4', {}, c.flow),
        h('div', { className: 'ws-help-flow' },
          flowMain.map((id, index) => h(React.Fragment, { key: id },
            index > 0 ? h('span', { className: 'ws-hf-arrow' }, '→') : null,
            h('span', { className: `ws-hf-node${id === 'discover' || id === 'verify' ? ' ws-hf-core' : ''}` },
              h('em', {}, String(STATIONS.indexOf(id) + 1).padStart(2, '0')), t(`ws.st.${id}`))))),
        h('div', { className: 'ws-help-loop' },
          h('span', { className: 'ws-hf-node ws-hf-small' }, t('ws.st.verify')),
          h('span', { className: 'ws-hf-arrow' }, '⇢'),
          h('span', { className: 'ws-hf-node ws-hf-small' }, t('ws.st.repair')),
          h('span', { className: 'ws-hf-arrow' }, '⇢'),
          h('span', { className: 'ws-hf-node ws-hf-small' }, t('ws.st.verify')),
          h('span', { className: 'ws-hf-max' }, `≤ ${rounds}`),
          h('span', { className: 'ws-hf-side' }, `DICOM：${t('ws.sub.dicom')}`)),
        h('p', { className: 'ws-help-note' }, c.flowNote.replace('{rounds}', String(rounds))),
        table(c.stageHead, STATIONS.map((id) => h('tr', { key: id },
          h('td', { className: 'ws-help-stage' }, h('em', {}, String(STATIONS.indexOf(id) + 1).padStart(2, '0')), t(`ws.st.${id}`)),
          h('td', {}, c.stageRows[id][0]),
          h('td', {}, c.stageRows[id][1])))),

        h('div', { className: 'ws-help-two' },
          h('div', {},
            h('h4', {}, c.principles),
            h('dl', { className: 'ws-help-dl' }, c.principleRows.map(([term, desc]) => h(React.Fragment, { key: term }, h('dt', {}, term), h('dd', {}, desc))))),
          h('div', {},
            h('h4', {}, c.output),
            h('div', { className: 'ws-help-tree' }, c.tree.map(([path, note], index) => h('div', { key: index },
              h('code', {}, path), note ? h('span', {}, note) : null))))),

        h('h4', {}, c.status),
        table(c.statusHead, c.statusRows.map(([key, label, meaning, action]) => h('tr', { key },
          h('td', {}, h('span', { className: statusClass(key) }, label)), h('td', {}, meaning), h('td', {}, action)))))
    }

    // Minimal Markdown renderer for the batch report (headings, lists, task
    // lists, tables, quotes, bold, inline code). Builds React elements only;
    // no HTML is injected, so report text can never become markup.
    function inlineMd(text, keyBase) {
      const out = []
      const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g
      let last = 0
      let match
      let index = 0
      while ((match = pattern.exec(text))) {
        if (match.index > last) out.push(text.slice(last, match.index))
        const token = match[0]
        out.push(token.startsWith('`')
          ? h('code', { key: `${keyBase}-${index}` }, token.slice(1, -1))
          : h('strong', { key: `${keyBase}-${index}` }, token.slice(2, -2)))
        last = match.index + token.length
        index += 1
      }
      if (last < text.length) out.push(text.slice(last))
      return out
    }

    function MarkdownView({ text }) {
      const lines = String(text ?? '').split(/\r?\n/)
      const blocks = []
      let i = 0
      const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
      while (i < lines.length) {
        const line = lines[i]
        const key = `b${i}`
        if (!line.trim()) { i += 1; continue }
        const heading = /^(#{1,4})\s+(.*)$/.exec(line)
        if (heading) {
          blocks.push(h(`h${heading[1].length}`, { key }, inlineMd(heading[2], key)))
          i += 1
          continue
        }
        if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) {
          const head = cells(line)
          const rows = []
          i += 2
          while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(cells(lines[i])); i += 1 }
          blocks.push(h('div', { key, className: 'ws-md-tablewrap' }, h('table', {},
            h('thead', {}, h('tr', {}, head.map((cell, c) => h('th', { key: c }, inlineMd(cell, `${key}h${c}`))))),
            h('tbody', {}, rows.map((row, r) => h('tr', { key: r }, row.map((cell, c) => h('td', { key: c }, inlineMd(cell, `${key}r${r}c${c}`)))))))))
          continue
        }
        if (line.startsWith('>')) {
          const quote = []
          while (i < lines.length && lines[i].startsWith('>')) { quote.push(lines[i].replace(/^>\s?/, '')); i += 1 }
          blocks.push(h('blockquote', { key }, inlineMd(quote.join(' '), key)))
          continue
        }
        if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
          const ordered = /^\s*\d+\.\s+/.test(line)
          const items = []
          while (i < lines.length && (ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/).test(lines[i])) {
            const body = lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, '')
            const task = /^\[( |x)\]\s+(.*)$/i.exec(body)
            items.push(task
              ? h('li', { key: i, className: 'ws-md-task' }, h('input', { type: 'checkbox', checked: task[1].toLowerCase() === 'x', readOnly: true, tabIndex: -1 }), ' ', inlineMd(task[2], `${key}i${i}`))
              : h('li', { key: i }, inlineMd(body, `${key}i${i}`)))
            i += 1
          }
          blocks.push(h(ordered ? 'ol' : 'ul', { key }, items))
          continue
        }
        const para = []
        while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|>|\s*[-*]\s|\s*\d+\.\s|\s*\|)/.test(lines[i])) { para.push(lines[i]); i += 1 }
        if (para.length === 0) { para.push(line); i += 1 }
        blocks.push(h('p', { key }, inlineMd(para.join(' '), key)))
      }
      return h('div', { className: 'ws-md' }, blocks)
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
