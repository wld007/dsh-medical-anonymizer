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
      'rules.quasiToggle': '同时处理准标识符（日期、年龄、性别）',
      'rules.always': '始终处理',
      'rules.quasiAlways': '邮编属于标识符（HIPAA 18 项之一），不论是否开启准标识符都会处理：保留前 3 位或替换为类型标签。',
      'rules.quasiHint': '默认关闭，即只处理标识符（邮编属于标识符，始终处理）。开启后按下表处理；只处理文本值，Excel 数值/日期单元格和 JSON 数字不改动。',
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
      'run.rounds': '核验轮次上限',
      'run.roundsHint': '每轮都以核验结束：第 1 轮识别后核验；有可疑项时进入下一轮，先复判修正再核验。用完轮次仍有问题的转人工复核。',
      'run.maxFiles': '每组文件数',
      'run.concurrency': '模型并发',
      'run.concurrencyTip': '每个模型同时处理的请求数；同时处理的文件数自动为它的 3 倍（最多 32 个）。',
      'run.concurrencyHint': '每组文件数：输入超出时自动分组，依次处理，不丢文件。模型并发是每个模型同时处理的请求数。同时处理的文件数为模型并发的 3 倍（最多 32 个），后面文件的请求提前排队，模型不会空等；内存用到 70% 时暂停补充新文件。',
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
      'model.detectTitle': '识别模型',
      'model.detectHint': '负责识别·替换，以及复判盲审报出的可疑项。',
      'model.sharedTitle': '调用参数（识别、核验共用）',
      'model.sharedHint': '以下设置同时作用于识别模型和核验模型的每次调用。',
      'verify.sameName': '⚠ 核验模型与识别模型同为 {model}，盲区相同，起不到独立判别的作用（部署在另一台机器上只能分担请求）。建议换用不同系列的模型。',
      'model.fetch': '获取模型列表',
      'model.fetching': '正在获取模型列表…',
      'model.noMatch': '没有匹配的模型，可直接输入名称',
      'model.clearChoice': '清空',
      'verify.title': '核验模型（可选）',
      'verify.hint': '核验以外部审查员的身份检查脱敏后的文本。用另一个模型核验，两者的盲区不同，更容易发现遗漏；留空则由上面的识别模型核验。病历原文同样会发给这个端点，请只用本机或可信内网的服务。',
      'verify.endpoint': '端点（留空沿用识别模型的端点）',
      'verify.endpointPlaceholder': '留空：与识别模型相同',
      'verify.modelPlaceholder': '留空：由识别模型核验',
      'verify.keyPlaceholder': '留空：端点相同时沿用识别模型的 Key',
      'verify.same': '当前由识别模型核验。',
      'field.verifyModel': '核验模型',
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
      'field.maxRounds': '核验轮次上限',
      'field.maxFiles': '每组文件数',
      'field.concurrency': '模型并发',
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
      'ws.st.read': '解析·拆层',
      'ws.st.discover': '识别·替换',
      'ws.st.rules': '规则核验',
      'ws.st.blind': '独立盲审',
      'ws.st.repair': '复判修正',
      'ws.st.rescan': '批次复扫',
      'ws.st.dicom': 'DICOM',
      'ws.st.pack': '比对·打包',
      'ws.st.review': '人工复核',
      'ws.st.deliver': '交付',
      'ws.sub.prescan': '解压·路径匿名',
      'ws.sub.read': '解码·切分·画像',
      'ws.sub.discover': '规则 + 识别模型',
      'ws.sub.rules': '复扫·原值·结构',
      'ws.sub.blind': '核验模型',
      'ws.sub.repair': '识别模型复判',
      'ws.sub.rescan': '跨文件一致',
      'ws.sub.dicom': '元数据·UID·日期',
      'ws.sub.pack': '比对记录·打包',
      'ws.sub.review': '分歧·无法检查',
      'ws.sub.deliver': '输出根目录',
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
      'ws.m.entities': '替换次数',
      'ws.m.entitiesHint': '本批实际替换了多少处；同一个原值出现多次按多次计',
      'ws.m.distinct': '发现标识符',
      'ws.m.distinctHint': '本批发现的不同原值个数（去重）；同一个人出现多次只算 1 个，之前批次处理过的也计入',
      'ws.m.calls': '模型调用',
      'ws.m.tokens': 'Token 消耗',
      'ws.m.tokensHint': '模型端点返回的 token 用量合计（输入 + 输出）',
      'ws.m.noUsage': '端点未返回',
      'ws.m.review': '待复核',
      'ws.m.failed': '失败文件',
      'ws.m.mappings': '新增映射',
      'ws.m.mappingsHint': '本批次新写入映射库的「原值 → 假名」条数；之前批次已有的不计',
      'ws.m.chunks': '分组',
      'ws.m.chunksHint': '文件较多时本批次自动拆成的组数',
      'ws.m.groupResult': '处理结果',
      'ws.m.groupTech': '模型',
      'ws.m.memoryPeak': '堆内存峰值',
      'ws.model': '识别',
      'ws.modelShared': '识别·核验',
      'ws.rulesOnly': '仅规则',
      'ws.online': '在线',
      'ws.dotRetry': '点击重新检测',
      'ws.params': '处理参数',
      'ws.locked': '锁定',
      'ws.p.concurrency': '模型并发',
      'ws.p.maxFiles': '每组文件数',
      'ws.p.timeout': '模型超时（秒）',
      'ws.p.temperature': '温度',
      'ws.p.noThinking': '关闭思考模式',
      'ws.p.quasi': '处理准标识符（日期/年龄/性别）',
      'ws.paramsSave': '保存参数',
      'ws.paramsSaved': '参数已保存，下一批次生效。',
      'ws.paramsLocked': '批次运行中，参数已锁定。',
      'ws.paramsHint': '保存为默认值，下一批次生效',
      'ws.unitFiles': '文件',
      'ws.feedParams': '数据输入与参数',
      'ws.ps.rounds': '轮次 {n}',
      'ws.ps.concurrency': '并发 {n}',
      'ws.ps.chunk': '每组 {n}',
      'ws.ps.temp': '温度 {n}',
      'ws.ps.noThink': '思考关',
      'ws.ps.think': '思考开',
      'ws.ps.quasi': '准标识符',
      'ws.ps.noQuasi': '准标识符关',
      'ws.paramsReset': '恢复默认',
      'ws.paramsResetHint': '恢复为已保存的默认值',
      'ws.paramsDefault': '设为默认',
      'ws.paramsDefaultHint': '保存为默认值，以后的批次（含 Agent 与 /anonymize）都用这些值',
      'ws.paramsBatchOnly': '橙色项与默认值不同，只用于下一批；点「设为默认」才会保存。',
      'ws.paramsHint2': '这里的值用于下一批。',
      'ws.x.title': '交叉核验',
      'ws.x.reported': '盲审报出',
      'ws.x.calls': '{flagged}/{calls} 次调用有报出',
      'ws.x.reportedHint': '独立盲审（核验模型）报出的可疑项数，按次数计，不去重。',
      'ws.x.confirmed': '确认',
      'ws.x.dismissed': '误报',
      'ws.x.disputed': '分歧',
      'ws.x.unjudged': '未复判',
      'ws.x.splitHint': '盲审报出的每一项最后的去向：确认 = 识别模型复判为标识符并补替换；误报 = 复判为不是，保留原文；分歧 = 误报后核验又报出，转人工；未复判 = 最后一轮报出或过短，直接转人工。四项之和 = 盲审报出。',
      'ws.x.agree': '一致率',
      'ws.x.agreeShort': '一致 {pct}%',
      'ws.x.agreeHint': '确认 ÷（确认 + 误报 + 分歧）：识别模型同意核验模型判断的比例。',
      'ws.x.disputeRate': '分歧率 {pct}%',
      'ws.x.human': '人工裁定',
      'ws.x.humanVal': '核验对 {v} · 识别对 {d}',
      'ws.x.humanHint': '分歧项和未复判项的人工处理：替换为假名 = 核验对；不是标识符 / 确认保留 = 识别对。',
      'ws.x.pending': '待裁定 {n} →',
      'ws.x.none': '本批次没有盲审数据。',
      'ws.x.waiting': '采集中…',
      'ws.x.shared': '未配置独立核验模型，盲审由识别模型兼任，一致性参考意义有限。',
      'ws.calls.r.bad-shape': '格式不符',
      'ws.calls.retries': '重试',
      'ws.calls.dropped': '丢弃条目',
      'ws.calls.retryHint': '这次调用内部重试了 {n} 次（输出不是 JSON / 格式不符 / 网络或 5xx 错误）',
      'ws.calls.dropHint': '回复中有 {n} 条被丢弃：格式不对、类型不在允许范围、或原文在段落中找不到',
      'ws.calls.retrySumHint': '调用内部的重试次数合计',
      'ws.calls.dropSumHint': '回复中被丢弃的条目合计',
      'ws.m.failRate': '失败率',
      'ws.m.failHint': '失败的调用 ÷ 调用次数（已取消的不计）。↻ 为调用内部的重试次数。失败的段落会拆分重发，仍失败的转人工复核。',
      'ws.m.failNone': '没有失败',
      'ws.m.retryLine': '内部重试 {n} 次',
      'ws.rv.code.model-unchecked': '未经模型检查',
      'ws.m.outPer': '输出 / 次',
      'ws.m.perCall': '每次 输出/耗时',
      'ws.m.outPerHint': '每次调用平均输出多少 token。模型生成文字比读入慢得多，输出越多，单次耗时越长。',
      'ws.m.msPer': '耗时 / 次',
      'ws.m.msPerHint': '每次调用平均耗时（从拿到名额开始，不含排队）。',
      'ws.spark.title': '速率 件/分',
      'ws.spark.nowShort': '当前',
      'ws.spark.avgShort': '平均 {rate}',
      'ws.spark.peakShort': '峰值 {rate}',
      'ws.spark.tip': '处理速率（文件/分）。全程平均 {avg}（每个文件约 {secs} 秒）；峰值 {peak}（30 秒内的最高值）。虚线为全程平均。',
      'ws.m.peakHint': '本批次的峰值：进行中 / 上限，+N 为排队峰值',
      'ws.m.busyIdle': '批次运行时显示',
      'ws.m.busyCollect': '正在采样…',
      'ws.m.inflightTag': '进行',
      'ws.m.queueTag': '排队',
      'ws.m.busyAxis': '横轴以上：进行中的请求（虚线 = 模型并发 {limit}）；横轴以下：插件内排队（峰值 {max}）。覆盖最近约 {minutes} 分钟。',
      'ws.m.queueChart': '插件内排队',
      'ws.m.queuePeak': '排队峰值 {max}',
      'ws.m.queueMax': '峰值 {max} · 当前 {now}',
      'ws.m.splitHint': '段落去向（按段落计）：发给模型 {sent} · 复用缓存 {replayed} · 免送 {skipped}。免送是本批其他文件或上一轮已经问过的相同内容。',
      'ws.m.segSent': '发给模型','ws.m.segReplayed': '复用','ws.m.segSkipped': '免送',
      'ws.m.ctxDist': '上下文分布',
      'ws.m.ctxDistHint': '单次调用上下文长度的分布：<0.5k、0.5–1k、1–2k、2–4k、4–8k、8–16k、≥16k（红色为 8k 以上）。悬停可看各档次数。',
      'ws.m.busy': '请求占用',
      'ws.m.busyHint': '插件这边的统计：每个模型同时发出、尚未返回的请求数（进行中），以及在插件内等待名额的请求数（排队）。上限是「模型并发」设置。它反映插件给模型派了多少活，不代表端点上模型的真实负载，端点可能同时服务其他客户端。',
      'ws.m.busyLimit': '虚线下：进行中（上限 {limit}）· 虚线上：插件内排队',
      'ws.m.busySpan': '最近约 {minutes} 分钟',
      'ws.overview': '运行概况',
      'ws.expand': '展开',
      'ws.collapse': '收起',
      'ws.m.speed': '处理速度 tok/s',
      'ws.m.speedHint': '该模型每次调用的输入 + 输出 token 之和 ÷ 调用耗时之和（不含排队）。',
      'ws.m.speedSplit': '拆分估算：提示处理（预填充）约 {prompt} tok/s · 生成（解码）约 {gen} tok/s。提示处理慢可提高模型并发或开启前缀缓存；生成慢才需要换更快的模型。',
      'ws.m.speedFew': '拆分估算（提示处理 / 生成）需要至少 30 次调用。',
      'ws.tab.advice': '改进',
      'ws.adv.paramsTitle': '参数调整（下一批生效）',
      'ws.m.mReq': '占用 / 排队',
      'ws.m.mCalls': '调用',
      'ws.m.mTokens': 'Token',
      'ws.m.ctxAvg': '平均上下文',
      'ws.m.ctx': '上下文 均/最大',
      'ws.m.fitHint2': '按该模型的全部调用拟合「耗时 = 固定开销 + 输入 token ÷ 提示处理速度 + 输出 token ÷ 生成速度」得到的估算值，至少 30 次调用后显示。生成即解码速度，提示处理即预填充速度。',
      'ws.m.ctxMax': '最大上下文',
      'ws.m.ctxHint': '单次调用的上下文长度 = 输入 token + 输出 token（按端点返回的用量）。前一个是平均值，反映负载和速度；后一个是最大值，接近模型的上下文窗口时有被截断的风险。',
      'ws.m.callsHint': '真正发给模型的请求数（识别、盲审、复判修正、字段画像），复用缓存的不计',
      'ws.m.req': '模型请求',
      'ws.m.reqDetect': '识别请求',
      'ws.m.reqVerify': '核验请求',
      'ws.m.queued': '排队',
      'ws.m.reqHint': '插件侧统计：进行中 / 上限（模型并发），+N 为在插件内排队等名额的请求。进行中低于上限且没有排队，说明插件这边有空闲名额；不代表端点上模型的真实负载。',
      'ws.queued': '排队 {count}',
      'ws.resumedFrom': '↻ 续跑自 …{id}',
      'ws.resumedBy': '已由 …{id} 续跑',
      'ws.m.replayed': '复用调用',
      'ws.m.memo': '免送段落',
      'ws.m.memoHint': '本批次其他文件（或上一轮）已经问过模型的相同文本：识别结果直接沿用，盲审已通过的不再送审。按段落 / 数值计数，只在内存中保留。',
      'ws.m.replayedHint': '与中断前完全相同的模型请求直接复用缓存的结果，不再调用模型；已处理过的文件会快速过一遍，从中断处起才真正调用模型。同一批次内重复的请求也会复用。',
      'ws.blindSame': '⚠ 与识别模型相同',
      'ws.blindSameHint': '核验模型与识别模型同为 {model}，盲区相同，独立性有限。点击打开设置。',
      'ws.cmp.only': '只看改动',
      'ws.cmp.onlyHint': '只显示被替换过的段落和待复核的段落；取消勾选显示全部内容',
      'ws.stage1': '① 批次准备',
      'ws.stage2': '② 逐个文件 · 并行',
      'ws.stage3': '③ 批次收尾',
      'ws.stage4': '④ 交付',
      'ws.loopWait': '待回流',
      'ws.notNeeded': '未触发',
      'ws.noModel': '未配置模型',
      'ws.notDelivered': '未交付',
      'ws.reviewHeld': '暂扣 · {count} 项',
      'ws.awaitReview': '待复核完成',
      'ws.reviewed': '已复核',
      'ws.reviewNone': '无需复核',
      'ws.delivered': '已交付',
      'ws.blindShared': '⚠ 由识别模型兼任',
      'ws.blindHint': '核验模型：{model}。只看替换后的内容，不知道识别结果。',
      'ws.blindSharedHint': '未配置独立核验模型，盲审由识别模型兼任，不是独立判别。点击打开设置。',
      'ws.blindStats': '确认 {confirmed} · 误报 {dismissed} · 分歧 {disputed}',
      'ws.modelOf': '识别模型：{model}',
      'ws.dicomActive': '旁路 · DICOM 元数据处理中（不经模型）',
      'ws.dicomDone': '旁路 · DICOM {count} 个（只处理元数据，不经模型）',
      'ws.dicomIdle': '旁路 · DICOM（只处理元数据，不经模型）',
      'ws.cmp.rows.all': '全部内容',
      'ws.cmp.rows.changed': '只看改动',
      'ws.cmp.legend': '红：被替换的原文 · 绿：假名 · 橙：待复核 · 虚线下划线：保留的长数字，请抽查',
      'ws.cmp.legacy': '该批次只记录了改动处（0.8.1-dev.18 之前运行）。',
      'ws.cmp.empty': '该文件没有可比对的文字。',
      'ws.cmp.suspectHint': '未替换的长数字，抽查是否为证件号、电话或病历号',
      'rules.opaqueTitle': '无法检查的内容',
      'rules.opaqueHint': '图片、PDF、Word、二进制、无法解码的编码串、加密内容等无法转成文字检查，不会被当作「通过」。默认转人工复核：在复核完成前，批次的交付数据不会放到输出根目录。',
      'rules.opaqueLabel': '处理方式',
      'rules.opaqueReview': '转人工复核（默认，推荐）',
      'rules.opaqueRemove': '自动移除，用空白占位替代',
      'ws.rv.remove': '移除',
      'ws.rv.removeHint': '从交付数据中移除这部分内容（图片替换为空白占位）',
      'ws.rv.keepOpaque': '确认保留',
      'ws.rv.keepHint': '已人工确认其中不含个人信息，原样交付',
      'ws.rv.removed': '已移除',
      'ws.rv.bulkTitle': '{count} 项无法检查的内容',
      'ws.rv.bulkRemove': '全部移除（{count}）',
      'ws.rv.bulkKeep': '全部确认保留',
      'ws.rv.bulkDone': '已处理 {count} 项。',
      'ws.withheldTag': '暂扣',
      'ws.withheld': '有待复核项，交付数据暂不放到输出根目录；处理完全部复核项后自动交付。',
      'ws.rv.code.opaque': '无法检查的内容',
      'ws.rv.code.opaque-token': '无法解读的编码串',
      'ws.rv.code.unreadable': '无法解读的长字符串',
      'ws.rv.code.zip-failed': '压缩包无法解压',
      'ws.rv.code.over-limit': '超出上限未处理',
      'ws.rv.code.opaque-check': '核查失败',
      'ws.cmp.title': '结果比对',
      'ws.cmp.open': '结果比对',
      'ws.cmp.openReview': '比对与复核 {count} 项',
      'ws.cmp.none': '该批次没有比对记录（0.8.1 之前运行的批次，或没有文本类文件）。',
      'ws.cmp.pick': '在左侧选择一个文件。',
      'ws.cmp.nochange': '该文件没有改动。',
      'ws.cmp.field': '字段',
      'ws.cmp.before': '原文',
      'ws.cmp.after': '结果',
      'ws.cmp.more': '已显示 {shown} / {total} 处，显示更多',
      'ws.cmp.truncated': '文件过大，只记录了前 {shown} 段（共 {total} 段）。',
      'ws.cmp.stats': '改动 {changed} 处 · 共 {total} 段',
      'ws.cmp.prev': '上一份',
      'ws.cmp.next': '下一份',
      'ws.cmp.keys': '↑ ↓ 切换文件',
      'ws.cmp.f.all': '全部',
      'ws.cmp.f.changed': '有改动',
      'ws.cmp.f.review': '待复核',
      'ws.cmp.skipped.too-large': '文件超过 50 MB，未生成比对记录。',
      'ws.cmp.skipped.error': '生成比对记录时出错。',
      'ws.cmp.rowHint': '点击查看原文与结果比对',
      'ws.verifyModel': '核验',
      'ws.m.speedGen': '生成 tok/s',
      'ws.m.speedPrompt': '提示处理 tok/s',
      'ws.m.fitHint': '按 {n} 次调用拟合「耗时 = 固定开销 + 输入 token ÷ 提示处理速度 + 输出 token ÷ 生成速度」得到的估算值。生成速度即模型解码速度；并发时含排队影响，会偏低。',
      'ws.m.fitFew': '样本不足（{n} 次调用），至少 30 次且输入输出长度有差异时才能估算。',
      'ws.m.totalHint': '本批次全部输出 token ÷ 已用时间，含并发，表示整体吞吐。',
      'ws.calls.fit': '生成 {gen} tok/s · 提示处理 {prompt} tok/s',
      'ws.calls.io': '输入 / 输出',
      'ws.m.speedTotal': '合计输出 tok/s',
      'ws.m.memory': '堆内存',
      'ws.tab.review': '复核',
      'ws.rv.none': '本批次没有需要人工复核的项。',
      'ws.rv.running': '批次结束后列出需要人工复核的项。',
      'ws.rv.open': '待复核 {count} 项',
      'ws.rv.reviewed': '已于 {at} 完成复核',
      'ws.rv.total': '{files} 个文件 · {items} 项',
      'ws.rv.hint': '替换写回交付数据（含 zip 内文件）和复核副本；全部处理后批次转为「完成」',
      'ws.rv.allDone': '全部复核项已处理，批次已转为完成。',
      'ws.rv.copyPath': '复制副本路径',
      'ws.rv.replace': '替换为假名',
      'ws.rv.replaceWith': '替换为 {to}',
      'ws.rv.allow': '不是标识符',
      'ws.rv.allowHint': '保留原文，并加入「不匹配的值」，以后不再识别',
      'ws.rv.accept': '确认保留',
      'ws.rv.noText': '该项没有可定位的文字',
      'ws.rv.replaced': '已替换为 {to}（{count} 处）',
      'ws.rv.allowed': '已确认不是标识符，并加入不匹配的值',
      'ws.rv.accepted': '已确认保留',
      'ws.rv.go': '复核 {count} 项',
      'ws.rv.code.residual': '规则复扫残留',
      'ws.rv.code.disputed': '核验与识别意见不一致',
      'ws.rv.code.model-residual': '模型复核残留',
      'ws.rv.code.not-removed': '原值未清除',
      'ws.rv.code.structure': '结构校验未通过',
      'ws.rv.code.embedded': '假名嵌入编码',
      'ws.rv.code.partial': '数值被部分替换',
      'ws.rv.code.pipeline': '处理异常',
      'ws.rv.code.load': '无法读取',
      'ws.rv.code.quasi': '准标识符处理失败',
      'ws.picked': '已选 {count} 项',
      'ws.pickedClear': '清除',
      'ws.pickedRemove': '移除',
      'ws.pickedName': '{first} 等 {count} 项',
      'ws.resume': '继续处理',
      'ws.resumeHint': '沿用原输入和输出根目录重新开始：已完成的模型调用直接复用，只处理剩下的部分。可以先在设置里换模型再继续',
      'ws.calls.r.cached': '复用',
      'ws.queueCount': '{done} / {total} 个文件',
      'ws.gaugeHint': '按数据量计算的进度：已处理字节（含处理中文件的估计进度）÷ 总字节',
      'ws.gaugeHintFiles': '该批次没有数据量记录，按文件数计算',
      'ws.byFiles': '按文件数',
      'ws.del.clear': '清空',
      'ws.del.clearTitle': '清空批次记录',
      'ws.del.clearGo': '全部删除',
      'ws.del.allCount': '共 {count} 条批次记录',
      'ws.del.keepRunning': '（正在运行的批次保留）',
      'ws.del.allRecords': '将删除这些批次的报告、待复核副本、改进建议、模型调用记录和路径对照，并清空批次记录。此操作不可撤销。',
      'ws.del.allDeliverable': '同时删除这些批次在输出根目录下的交付数据',
      'ws.del.partial': '已删除 {removed} 条，{failed} 条失败：{first}',
      'ws.del.title': '删除批次记录',
      'ws.del.records': '将删除该批次的报告、待复核副本、改进建议、模型调用记录和路径对照，并从批次记录中移除。此操作不可撤销。',
      'ws.del.deliverable': '同时删除交付数据：{path}',
      'ws.del.noDeliverable': '该批次没有交付数据',
      'ws.del.vault': '映射库保留不变：已交付的数据仍可还原。如需撤销本批次新增的映射，请使用 anonymize_undo_mappings。',
      'ws.del.cancel': '取消',
      'ws.del.go': '删除',
      'ws.del.busy': '正在删除…',
      'ws.m.mem': '内存 {now} GB（峰值 {peak} / 上限 {limit} GB，{pct}%）',
      'ws.m.memHint': '插件处理数据所在进程（DSH 宿主的 Node 进程）的堆内存：已用 / 上限，不是整台电脑的内存。超过 70% 时暂停补充新文件，接近上限时可减小「每组文件数」。',
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
      'ws.adv.draftTitle': '插件可改进 {count} 项',
      'ws.adv.draftHint': '这些问题靠调参数解决不了。已生成改进草稿，只含问题类型、计数、扩展名和内容类别，不含原值、路径和字段名。复制后发到对话里让 Agent 修改插件，或检查后提交到仓库 issue。',
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
      'ws.loop': '复判修正 → 规则核验 · 最多 {rounds} 轮',
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
      'rules.quasiToggle': 'Also process quasi-identifiers (date, age, sex)',
      'rules.always': 'always',
      'rules.quasiAlways': 'Postal codes are identifiers (one of the HIPAA 18) and are always processed, whether or not quasi-identifiers are on: keep the first 3 digits or replace with a type label.',
      'rules.quasiHint': 'Off by default, so only identifiers are processed (postal codes count as identifiers and are always processed). When on, text values are handled as below; Excel numeric/date cells and JSON numbers are not changed.',
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
      'run.rounds': 'Verification rounds (max)',
      'run.roundsHint': 'Every round ends with verification: round 1 verifies after detection; with suspects, the next round re-judges and fixes, then verifies again. Files still failing after the last round go to manual review.',
      'run.maxFiles': 'Files per chunk',
      'run.concurrency': 'Model concurrency',
      'run.concurrencyTip': 'Requests each model handles at once; three times as many files (at most 32) are processed at once.',
      'run.concurrencyHint': 'Files per chunk: larger inputs are split and processed in turn; nothing is dropped. Concurrency is the number of requests each model handles at once. Three times as many files (at most 32) are processed at once, so later files queue requests and the model never waits; no new files start while memory use is at 70% or more.',
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
      'model.detectTitle': 'Detection model',
      'model.detectHint': 'Detects and replaces, and re-judges suspects reported by the blind review.',
      'model.sharedTitle': 'Call settings (detection and verification)',
      'model.sharedHint': 'These apply to every call of both the detection and the verification model.',
      'verify.sameName': '⚠ The verification model is the same as the detection model ({model}): two servers share the load, but the blind spots are the same, so the review is not independent. Use a model from another family.',
      'model.fetch': 'Fetch the model list',
      'model.fetching': 'Fetching models…',
      'model.noMatch': 'No match; you can type the name',
      'model.clearChoice': 'Clear',
      'verify.title': 'Verification model (optional)',
      'verify.hint': 'Verification reviews the anonymized text as an outside reviewer. A different model has different blind spots and catches more misses; leave empty to verify with the detection model above. Patient text is sent to this endpoint too, so use only local or trusted internal services.',
      'verify.endpoint': 'Endpoint (empty: same as detection)',
      'verify.endpointPlaceholder': 'Empty: same as the detection model',
      'verify.modelPlaceholder': 'Empty: the detection model verifies',
      'verify.keyPlaceholder': 'Empty: the detection key when the endpoint is the same',
      'verify.same': 'The detection model verifies.',
      'field.verifyModel': 'verification model',
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
      'ws.st.read': 'Parse & unwrap',
      'ws.st.discover': 'Detect & replace',
      'ws.st.rules': 'Rule checks',
      'ws.st.blind': 'Blind review',
      'ws.st.repair': 'Re-judge & fix',
      'ws.st.rescan': 'Batch rescan',
      'ws.st.dicom': 'DICOM',
      'ws.st.pack': 'Compare & pack',
      'ws.st.review': 'Manual review',
      'ws.st.deliver': 'Deliver',
      'ws.sub.prescan': 'Archives · paths',
      'ws.sub.read': 'Decode · split · profile',
      'ws.sub.discover': 'Rules + detector',
      'ws.sub.rules': 'Rescan · structure',
      'ws.sub.blind': 'Verification model',
      'ws.sub.repair': 'Detector re-judges',
      'ws.sub.rescan': 'Cross-file',
      'ws.sub.dicom': 'Metadata · UID · dates',
      'ws.sub.pack': 'Comparison · pack',
      'ws.sub.review': 'Disputes · unreadable',
      'ws.sub.deliver': 'Output root',
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
      'ws.m.entities': 'Replacements',
      'ws.m.entitiesHint': 'How many occurrences this batch replaced; a value seen many times counts each time',
      'ws.m.distinct': 'Identifiers found',
      'ws.m.distinctHint': 'Distinct original values found in this batch; one person counts once, including values known from earlier batches',
      'ws.m.calls': 'Model calls',
      'ws.m.tokens': 'Tokens',
      'ws.m.tokensHint': 'Total tokens reported by the model endpoint (prompt + completion)',
      'ws.m.noUsage': 'not reported',
      'ws.m.review': 'To review',
      'ws.m.failed': 'Failed files',
      'ws.m.mappings': 'New mappings',
      'ws.m.mappingsHint': 'Original → pseudonym pairs this batch added to the vault; earlier ones are not counted',
      'ws.m.chunks': 'Chunks',
      'ws.m.chunksHint': 'Number of groups this batch was split into when there are many files',
      'ws.m.groupResult': 'Results',
      'ws.m.groupTech': 'Models',
      'ws.m.memoryPeak': 'Heap peak',
      'ws.model': 'Detector',
      'ws.modelShared': 'Detect & verify',
      'ws.rulesOnly': 'Rules only',
      'ws.online': 'Online',
      'ws.dotRetry': 'click to check again',
      'ws.params': 'Processing settings',
      'ws.locked': 'LOCKED',
      'ws.p.concurrency': 'Model concurrency',
      'ws.p.maxFiles': 'Files per chunk',
      'ws.p.timeout': 'Model timeout (s)',
      'ws.p.temperature': 'Temperature',
      'ws.p.noThinking': 'Disable thinking',
      'ws.p.quasi': 'Process quasi-identifiers (date/age/sex)',
      'ws.paramsSave': 'Save',
      'ws.paramsSaved': 'Saved; the next batch uses these values.',
      'ws.paramsLocked': 'Locked while a batch runs.',
      'ws.paramsHint': 'Saved as defaults for the next batch',
      'ws.unitFiles': 'files',
      'ws.feedParams': 'Input & settings',
      'ws.ps.rounds': 'rounds {n}',
      'ws.ps.concurrency': 'conc {n}',
      'ws.ps.chunk': 'chunk {n}',
      'ws.ps.temp': 'temp {n}',
      'ws.ps.noThink': 'no think',
      'ws.ps.think': 'think',
      'ws.ps.quasi': 'quasi',
      'ws.ps.noQuasi': 'no quasi',
      'ws.paramsReset': 'Defaults',
      'ws.paramsResetHint': 'Back to the saved defaults',
      'ws.paramsDefault': 'Set as default',
      'ws.paramsDefaultHint': 'Save as defaults for later batches (agent and /anonymize too)',
      'ws.paramsBatchOnly': 'Orange values differ from the defaults and apply to the next batch only; "Set as default" saves them.',
      'ws.paramsHint2': 'These values apply to the next batch.',
      'ws.x.title': 'Cross-check',
      'ws.x.reported': 'Blind review reported',
      'ws.x.calls': '{flagged}/{calls} calls with findings',
      'ws.x.reportedHint': 'Suspects reported by the blind review (verification model), counted per report.',
      'ws.x.confirmed': 'confirmed',
      'ws.x.dismissed': 'false alarm',
      'ws.x.disputed': 'dispute',
      'ws.x.unjudged': 'not re-judged',
      'ws.x.splitHint': 'Where each blind-review finding ended: confirmed = detector agreed, replaced; false alarm = detector disagreed, kept; dispute = reported again after that, to manual review; not re-judged = last round or too short, to manual review. The four add up to the reported count.',
      'ws.x.agree': 'Agreement',
      'ws.x.agreeShort': 'agree {pct}%',
      'ws.x.agreeHint': 'confirmed ÷ (confirmed + false alarm + dispute).',
      'ws.x.disputeRate': 'dispute rate {pct}%',
      'ws.x.human': 'Human verdict',
      'ws.x.humanVal': 'verifier {v} · detector {d}',
      'ws.x.humanHint': 'Manual decisions on disputed / not re-judged items: replaced = verifier right; kept = detector right.',
      'ws.x.pending': '{n} pending →',
      'ws.x.none': 'No blind-review data for this batch.',
      'ws.x.waiting': 'collecting…',
      'ws.x.shared': 'No separate verification model: the detector also reviews, so agreement means little.',
      'ws.calls.r.bad-shape': 'Wrong shape',
      'ws.calls.retries': 'retries',
      'ws.calls.dropped': 'dropped items',
      'ws.calls.retryHint': 'Retried {n} times inside this call (not JSON / wrong shape / network or 5xx)',
      'ws.calls.dropHint': '{n} items of the reply were dropped: malformed, unknown type, or text not found in the segment',
      'ws.calls.retrySumHint': 'Total retries inside calls',
      'ws.calls.dropSumHint': 'Total dropped reply items',
      'ws.m.failRate': 'Failure rate',
      'ws.m.failHint': 'Failed calls ÷ calls (cancelled ones excluded). ↻ = retries inside calls. Failed segments are split and resent; still failing ones go to manual review.',
      'ws.m.failNone': 'No failures',
      'ws.m.retryLine': '{n} retries inside calls',
      'ws.rv.code.model-unchecked': 'Not checked by the model',
      'ws.m.outPer': 'Output / call',
      'ws.m.perCall': 'Per call out/time',
      'ws.m.outPerHint': 'Average output tokens per call. Generating is much slower than reading the prompt; more output means longer calls.',
      'ws.m.msPer': 'Time / call',
      'ws.m.msPerHint': 'Average time per call (from getting a slot, queueing excluded).',
      'ws.spark.title': 'Files/min',
      'ws.spark.nowShort': 'now',
      'ws.spark.avgShort': 'avg {rate}',
      'ws.spark.peakShort': 'peak {rate}',
      'ws.spark.tip': 'Files per minute. Overall average {avg} (about {secs} s per file); peak {peak} (highest 30-second value). The dashed line is the average.',
      'ws.m.peakHint': 'Peaks over this batch: in flight / limit, +N queued',
      'ws.m.busyIdle': 'Shown while a batch runs',
      'ws.m.busyCollect': 'Sampling…',
      'ws.m.inflightTag': 'run',
      'ws.m.queueTag': 'queue',
      'ws.m.busyAxis': 'Above the axis: requests in flight (dashed = concurrency {limit}); below: queued in the plugin (peak {max}). Covers about the last {minutes} min.',
      'ws.m.queueChart': 'Queued in plugin',
      'ws.m.queuePeak': 'queue peak {max}',
      'ws.m.queueMax': 'peak {max} · now {now}',
      'ws.m.splitHint': 'Where segments went: sent to a model {sent} · replayed from cache {replayed} · skipped {skipped} (identical content already asked about in this batch).',
      'ws.m.segSent': 'sent','ws.m.segReplayed': 'replayed','ws.m.segSkipped': 'skipped',
      'ws.m.ctxDist': 'Context spread',
      'ws.m.ctxDistHint': 'Context length per call: <0.5k, 0.5–1k, 1–2k, 2–4k, 4–8k, 8–16k, ≥16k (red above 8k). Hover for counts.',
      'ws.m.busy': 'Request slots',
      'ws.m.busyHint': 'Counted by the plugin: requests sent to each model and not yet answered (in flight), and requests waiting for a slot inside the plugin (queued). The limit is the model-concurrency setting. It shows how much work the plugin hands out, not the real load on the endpoint, which may serve other clients too.',
      'ws.m.busyLimit': 'below dashed: in flight (limit {limit}) · above: queued',
      'ws.m.busySpan': 'last ~{minutes} min',
      'ws.overview': 'Run overview',
      'ws.expand': 'Expand',
      'ws.collapse': 'Collapse',
      'ws.m.speed': 'Speed tok/s',
      'ws.m.speedHint': 'Input + output tokens of all calls of this model ÷ their total time (queueing excluded).',
      'ws.m.speedSplit': 'Split estimate: prompt (prefill) about {prompt} tok/s · generation (decode) about {gen} tok/s. Slow prefill: raise model concurrency or enable prefix caching; slow decode: consider a faster model.',
      'ws.m.speedFew': 'The prompt / generation split needs at least 30 calls.',
      'ws.tab.advice': 'Improve',
      'ws.adv.paramsTitle': 'Parameter changes (next batch)',
      'ws.m.mReq': 'Slots / queue',
      'ws.m.mCalls': 'Calls',
      'ws.m.mTokens': 'Tokens',
      'ws.m.ctxAvg': 'Avg context',
      'ws.m.ctx': 'Context avg/max',
      'ws.m.fitHint2': 'Estimated from all calls of this model by fitting duration = overhead + input / prompt speed + output / generation speed; shown after 30 calls. Generation = decode, prompt = prefill.',
      'ws.m.ctxMax': 'Max context',
      'ws.m.ctxHint': 'Context per call = input + output tokens (as reported by the endpoint). A max close to the model window risks truncation.',
      'ws.m.callsHint': 'Requests actually sent to a model (detection, blind review, re-judge, profiling); cache reuse not counted',
      'ws.m.req': 'Model requests',
      'ws.m.reqDetect': 'Detector req.',
      'ws.m.reqVerify': 'Verifier req.',
      'ws.m.queued': 'queued',
      'ws.m.reqHint': 'In flight / limit; "+N" is the number waiting (hidden when none). Below the limit with nothing waiting means the model has idle capacity.',
      'ws.queued': '{count} queued',
      'ws.resumedFrom': '↻ resumed from …{id}',
      'ws.resumedBy': 'resumed by …{id}',
      'ws.m.replayed': 'Replayed calls',
      'ws.m.memo': 'Segments reused',
      'ws.m.memoHint': 'Identical text already asked about in another file of this batch (or the previous round): its detection result is reused and text that passed the blind review is not reviewed again. Counted per segment / value; kept in memory only.',
      'ws.m.replayedHint': 'Requests identical to ones answered before the interruption reuse the cached reply without calling the model; finished files pass quickly and real calls start where the batch stopped. Repeated requests within a batch are reused too.',
      'ws.blindSame': '⚠ Same as detector',
      'ws.blindSameHint': 'Verification and detection both use {model}: same blind spots, limited independence. Click to open settings.',
      'ws.cmp.only': 'Changes only',
      'ws.cmp.onlyHint': 'Show only replaced and flagged segments; untick to show all content',
      'ws.stage1': '① PREPARE',
      'ws.stage2': '② PER FILE · PARALLEL',
      'ws.stage3': '③ FINISH',
      'ws.stage4': '④ DELIVER',
      'ws.loopWait': 'Loop pending',
      'ws.notNeeded': 'Not needed',
      'ws.noModel': 'No model',
      'ws.notDelivered': 'Not delivered',
      'ws.reviewHeld': 'Held · {count}',
      'ws.awaitReview': 'Awaiting review',
      'ws.reviewed': 'Reviewed',
      'ws.reviewNone': 'Not needed',
      'ws.delivered': 'Delivered',
      'ws.blindShared': '⚠ Detector doubles',
      'ws.blindHint': 'Verification model: {model}. Sees only the replaced content, not the detection results.',
      'ws.blindSharedHint': 'No separate verification model: the detector also reviews, so this is not independent. Click to open settings.',
      'ws.blindStats': 'OK {confirmed} · FP {dismissed} · split {disputed}',
      'ws.modelOf': 'Detection model: {model}',
      'ws.dicomActive': 'Bypass · DICOM metadata in progress (no model)',
      'ws.dicomDone': 'Bypass · {count} DICOM files (metadata only, no model)',
      'ws.dicomIdle': 'Bypass · DICOM (metadata only, no model)',
      'ws.cmp.rows.all': 'All content',
      'ws.cmp.rows.changed': 'Changes only',
      'ws.cmp.legend': 'Red: replaced original · green: pseudonym · orange: to review · dotted: long numbers kept, spot-check them',
      'ws.cmp.legacy': 'This batch recorded changed segments only (run before 0.8.1-dev.18).',
      'ws.cmp.empty': 'No text to compare in this file.',
      'ws.cmp.suspectHint': 'Long number left as is; check it is not an ID, phone or record number',
      'rules.opaqueTitle': 'Content that cannot be checked',
      'rules.opaqueHint': 'Images, PDFs, Word files, binary data, undecodable encodings and encrypted content cannot be read as text and never count as clean. By default they go to manual review, and the batch result stays out of the output root until review is complete.',
      'rules.opaqueLabel': 'Handling',
      'rules.opaqueReview': 'Manual review (default, recommended)',
      'rules.opaqueRemove': 'Remove automatically, leave an empty placeholder',
      'ws.rv.remove': 'Remove',
      'ws.rv.removeHint': 'Remove this content from the deliverable (images become an empty placeholder)',
      'ws.rv.keepOpaque': 'Keep',
      'ws.rv.keepHint': 'Checked by a person: contains no personal data, deliver as is',
      'ws.rv.removed': 'Removed',
      'ws.rv.bulkTitle': '{count} items cannot be checked',
      'ws.rv.bulkRemove': 'Remove all ({count})',
      'ws.rv.bulkKeep': 'Keep all',
      'ws.rv.bulkDone': '{count} items decided.',
      'ws.withheldTag': 'Held',
      'ws.withheld': 'Items await review; the result stays out of the output root and is delivered once all are decided.',
      'ws.rv.code.opaque': 'Cannot be checked',
      'ws.rv.code.opaque-token': 'Undecodable encoded string',
      'ws.rv.code.unreadable': 'Unreadable long string',
      'ws.rv.code.zip-failed': 'Archive could not be opened',
      'ws.rv.code.over-limit': 'Over the limit, not processed',
      'ws.rv.code.opaque-check': 'Check failed',
      'ws.cmp.title': 'Compare results',
      'ws.cmp.open': 'Compare results',
      'ws.cmp.openReview': 'Compare & review {count}',
      'ws.cmp.none': 'No comparison for this batch (run before 0.8.1, or no text files).',
      'ws.cmp.pick': 'Pick a file on the left.',
      'ws.cmp.nochange': 'No changes in this file.',
      'ws.cmp.field': 'Field',
      'ws.cmp.before': 'Original',
      'ws.cmp.after': 'Result',
      'ws.cmp.more': '{shown} of {total} shown, show more',
      'ws.cmp.truncated': 'Large file: the first {shown} of {total} segments were recorded.',
      'ws.cmp.stats': '{changed} changed · {total} segments',
      'ws.cmp.prev': 'Previous',
      'ws.cmp.next': 'Next',
      'ws.cmp.keys': '↑ ↓ to switch files',
      'ws.cmp.f.all': 'All',
      'ws.cmp.f.changed': 'Changed',
      'ws.cmp.f.review': 'To review',
      'ws.cmp.skipped.too-large': 'File over 50 MB; no comparison recorded.',
      'ws.cmp.skipped.error': 'The comparison could not be built.',
      'ws.cmp.rowHint': 'Click to compare original and result',
      'ws.verifyModel': 'Verifier',
      'ws.m.speedGen': 'Generation tok/s',
      'ws.m.speedPrompt': 'Prompt tok/s',
      'ws.m.fitHint': 'Estimated from {n} calls by fitting duration = overhead + input tokens / prompt speed + output tokens / generation speed. Generation speed is the decode speed; with concurrency, queueing makes it lower.',
      'ws.m.fitFew': 'Too few samples ({n} calls); at least 30 with varying lengths are needed.',
      'ws.m.totalHint': 'All output tokens of the batch / elapsed time, concurrency included: overall throughput.',
      'ws.calls.fit': 'generation {gen} tok/s · prompt {prompt} tok/s',
      'ws.calls.io': 'In / out',
      'ws.m.speedTotal': 'tok/s total',
      'ws.m.memory': 'Heap',
      'ws.tab.review': 'Review',
      'ws.rv.none': 'Nothing in this batch needs manual review.',
      'ws.rv.running': 'Items needing manual review are listed when the batch finishes.',
      'ws.rv.open': '{count} to review',
      'ws.rv.reviewed': 'Reviewed {at}',
      'ws.rv.total': '{files} files · {items} items',
      'ws.rv.hint': 'Replacements are written to the deliverable (zip entries too) and the review copy; once all are decided the batch becomes completed',
      'ws.rv.allDone': 'All review items decided; the batch is now completed.',
      'ws.rv.copyPath': 'Copy copy path',
      'ws.rv.replace': 'Replace with pseudonym',
      'ws.rv.replaceWith': 'Replace with {to}',
      'ws.rv.allow': 'Not an identifier',
      'ws.rv.allowHint': 'Keep the text and add it to allowed values so it is no longer detected',
      'ws.rv.accept': 'Keep',
      'ws.rv.noText': 'No locatable text for this item',
      'ws.rv.replaced': 'Replaced with {to} ({count}×)',
      'ws.rv.allowed': 'Confirmed not an identifier; added to allowed values',
      'ws.rv.accepted': 'Kept',
      'ws.rv.go': 'Review {count}',
      'ws.rv.code.residual': 'Rule rescan residual',
      'ws.rv.code.disputed': 'Verifier and detector disagree',
      'ws.rv.code.model-residual': 'Model review residual',
      'ws.rv.code.not-removed': 'Original not removed',
      'ws.rv.code.structure': 'Structure check failed',
      'ws.rv.code.embedded': 'Pseudonym inside a code',
      'ws.rv.code.partial': 'Value partly replaced',
      'ws.rv.code.pipeline': 'Processing error',
      'ws.rv.code.load': 'Unreadable',
      'ws.rv.code.quasi': 'Quasi-identifier step failed',
      'ws.picked': '{count} selected',
      'ws.pickedClear': 'Clear',
      'ws.pickedRemove': 'Remove',
      'ws.pickedName': '{first} +{count}',
      'ws.resume': 'Resume',
      'ws.resumeHint': 'Run again on the same input and output root, replaying finished model calls so only the rest is processed. You may switch the model in Settings first',
      'ws.calls.r.cached': 'Replayed',
      'ws.queueCount': '{done} / {total} files',
      'ws.gaugeHint': 'Progress by data volume: processed bytes (including an estimate for files in progress) ÷ total bytes',
      'ws.gaugeHintFiles': 'No data-volume record for this batch; by file count',
      'ws.byFiles': 'by files',
      'ws.del.clear': 'Clear',
      'ws.del.clearTitle': 'Clear batch history',
      'ws.del.clearGo': 'Delete all',
      'ws.del.allCount': '{count} batch records',
      'ws.del.keepRunning': '(a running batch is kept)',
      'ws.del.allRecords': 'Deletes the reports, review copies, advice, model-call logs and path maps, and empties the history. This cannot be undone.',
      'ws.del.allDeliverable': 'Also delete their deliverables in the output roots',
      'ws.del.partial': '{removed} deleted, {failed} failed: {first}',
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
      'ws.loop': 'Re-judge → rule checks · up to {rounds} rounds',
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
          '处理方式可在下方「匿名化规则」中逐类配置：标识符可选稳定假名、部分遮盖、类型标签或保留；准标识符（日期、年龄、性别）默认不处理，开启后可选平移、泛化或标签；邮编属于标识符，始终处理（保留前 3 位或类型标签）。',
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
          '定向修复：复核发现的残留会在下一轮直接替换，最多重复「核验轮次上限」次；仍解决不了的标为「待复核」，写进报告的人工复核清单。',
          '准标识符（开启时）：在标识符处理完后，按规则确定性地处理日期、年龄、性别，不经过模型（邮编不论是否开启都按同样方式处理）。日期平移对同一输出根目录使用同一个偏移量，日期之间的间隔保持不变。',
        ] },
        { title: '输出在哪里', items: [
          '输出根目录/<输入名>：交付数据。输入是目录就是同名文件夹（名称中的标识符已替换），输入是单个文件就是那个文件；里面只有匿名化后的数据，可以整个拿走。同名已存在时加「 (2)」，不会覆盖旧结果。',
          '输出根目录/_records/runs/<批次号>/report.md：报告，包括每个文件的实体统计、结构校验、残留问题和人工复核清单；报告里不出现原值。取消或失败的批次，部分结果留在同目录的 output/，不放到输出根目录。待复核文件的匿名化副本单独放在同目录的 review/（zip 里的也已取出），不用解压交付数据就能检查。',
          '输出根目录/_records/vault.json：映射库（原值 ↔ 假名），权限 600。它是还原钥匙，泄露等同原文泄露，请与交付数据分开保管。旧版本放在输出根目录下的 vault.json、index.json、runs/ 会在下次运行时自动移入 _records。',
          '不设置输出根目录时，写到输入目录旁的 _medical-anonymizer 文件夹（旧版本的隐藏目录 .medical-anonymizer 会在下次运行时自动改名沿用）；以后对上级目录做匿名化时会自动跳过它。模型调用次数不设上限；报告会记录源文件在运行前后是否一致。',
        ] },
        { title: '注意事项', items: [
          '模型会看到原文。请使用本机或可信内网的模型端点，不要用公网云服务处理患者数据。',
          '默认只处理直接标识符。邮编始终处理；开启准标识符后另外覆盖日期、年龄、性别的文本值；科室、机构代码等不处理。文件名和目录名里的姓名、证件号、手机号、病人编号、住院号/门诊号会替换，原路径对照写在 path-map.json（与映射库同样敏感）。',
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
          'Treatment is configurable per type under Anonymization rules: identifiers can be pseudonymized, partially masked, labelled, or kept; quasi-identifiers (date, age, sex) are off by default and can be shifted, generalized, or labelled; postal codes are identifiers and are always processed (first 3 digits kept, or a type label).',
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
          'Repair: confirmed leftovers are replaced in the next round, up to the verification-round limit; anything still unresolved is marked Needs review and listed in the report.',
          'Quasi-identifiers (when on): after identifiers, dates, ages, and sex are handled deterministically, without the model (postal codes are handled the same way whether or not this is on). Date shifting uses one offset per output root, so intervals between dates are preserved.',
        ] },
        { title: 'Where output goes', items: [
          '<output root>/<input name>: the finished result — a folder named after the input directory (identifiers in the name replaced), or the single file. It holds anonymized data only and can be taken as is. An existing name gets " (2)"; earlier results are never overwritten.',
          '<output root>/_records/runs/<batch>/report.md: per-file counts, structure checks, leftovers, and the manual-review list; no original values. A cancelled or failed batch keeps its partial result in output/ there, not in the output root. Anonymized copies of files that need review are placed loose in review/ there (taken out of zips too), so they can be checked without unpacking the result.',
          '<output root>/_records/vault.json: original ↔ pseudonym map, mode 600. It is the re-identification key; store it apart from the results. vault.json, index.json and runs/ left in the output root by older versions move into _records on the next run.',
          'With no output root set, output goes to a _medical-anonymizer folder beside the input (an older hidden .medical-anonymizer is renamed and reused on the next run); it is skipped when a parent directory is anonymized later. Model calls are not capped; the report records whether source files were unchanged.',
        ] },
        { title: 'Cautions', items: [
          'The model sees the original text. Use a local or trusted internal endpoint, never a public cloud service, for patient data.',
          'By default only direct identifiers are processed. Postal codes are always processed; quasi-identifier handling adds text values of date, age, and sex only; department and institution codes are not touched, while names, ID and phone numbers, patient numbers, and admission/visit numbers in file and folder names are replaced (the original-path map is saved as path-map.json, as sensitive as the vault).',
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
      .ws-grid{flex:1;min-height:0;display:grid;grid-template-columns:minmax(260px,290px) minmax(0,1fr) minmax(270px,300px);gap:10px;align-items:stretch}
      .ws-col{display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0}
      .ws-col-right{overflow:auto;min-height:0;scrollbar-width:none}
      .ws-page .ws-col-right::-webkit-scrollbar{display:none}
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
.ws-page .ws-drawer-body,.ws-page .ws-history,.ws-page .ws-pieces,.ws-page .ws-bars{scrollbar-width:thin;scrollbar-color:transparent transparent;scrollbar-gutter:auto}
      .ws-page .ws-drawer-body:hover,.ws-page .ws-history:hover,.ws-page .ws-pieces:hover,.ws-page .ws-bars:hover{scrollbar-color:color-mix(in srgb,var(--dsw-alias-label-primary) 28%,transparent) transparent}
      .ws-page ::-webkit-scrollbar{width:6px;height:6px}
      .ws-page ::-webkit-scrollbar-track{background:transparent}
      .ws-page ::-webkit-scrollbar-thumb{background:transparent;border-radius:3px}
      .ws-page :hover::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dsw-alias-label-primary) 28%,transparent)}
      .ws-table thead th{position:sticky;top:0;z-index:1;background:var(--ws-paper,var(--dsw-alias-bg-layer-1))}
            .ws-tag.ws-tag-hot{color:#fff;background:var(--ws-accent);border-color:var(--ws-accent)}
      .ws-panel.ws-advice{gap:6px;flex:1 1 0;min-height:0;overflow:hidden}
      .ws-adv-body{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:8px;scrollbar-width:thin;scrollbar-color:transparent transparent}
      .ws-adv-body:hover{scrollbar-color:color-mix(in srgb,var(--dsw-alias-label-primary) 28%,transparent) transparent}
      .ws-col-right>.ws-panel{gap:6px;padding:8px 12px}
      .ws-col-right{gap:8px}
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
      .ws-calls-top{position:sticky;top:0;z-index:3;height:88px;box-sizing:border-box;overflow:hidden;background:var(--ws-paper,var(--dsw-alias-bg-layer-1))}
      .ws-calls-top .ws-calls-sum{flex-wrap:nowrap;overflow:hidden;white-space:nowrap}
      .ws-table.ws-calls thead th{top:88px;white-space:nowrap}
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
      /* Settings in the modal: one scroll area only (the tab panel). The
         modal has a fixed height, the body does not scroll, the section
         fills what is left, and the save bar stays visible at the bottom. */
      .ws-modal-settings{height:min(800px,calc(100vh - 48px))}
      .ws-modal-settings .ws-modal-body{display:flex;flex-direction:column;overflow:hidden;padding-bottom:24px}
      .ws-modal-settings .ws-modal-body>.ma-banner{flex:none;margin-bottom:10px}
      .ws-modal .ma-section.ma-settings{flex:1 1 auto;min-height:0;height:auto;max-height:none}
      .ws-modal .ma-settings>.ma-heading{display:none}
      .ws-help{font-size:13px;line-height:20px}
      .ws-help>h4:first-child{margin-top:0}
      .ws-readouts{grid-template-columns:1fr 1fr}
      .ws-subhead{display:flex;align-items:center;gap:8px;margin-top:2px;font-size:11px;color:var(--dsw-alias-label-secondary)}
      .ws-subhead::after{content:'';flex:1;order:1;border-top:1px solid var(--dsw-alias-border-l1)}
      .ws-subhead>span:first-child{font-weight:600;color:var(--dsw-alias-label-primary)}
      .ws-subhead>span+span{order:2}
      .ws-minor{display:grid;grid-template-columns:1fr 1fr;gap:2px 14px;font-size:11px;color:var(--dsw-alias-label-secondary)}
      .ws-kv{display:flex;justify-content:space-between;align-items:baseline;gap:6px;min-width:0;border-bottom:1px dotted color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);padding:1px 0}
      .ws-kv span{white-space:nowrap}
      .ws-kv b{font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ws-kv-bar{grid-column:1 / -1;flex-wrap:wrap;row-gap:3px}
      .ws-membar{position:relative;flex-basis:100%;height:5px;border-radius:3px;background:linear-gradient(90deg,transparent 0 70%,color-mix(in srgb,var(--dsw-alias-state-warn-primary) 18%,transparent) 70% 85%,color-mix(in srgb,var(--dsw-alias-state-error-primary) 18%,transparent) 85%),var(--dsw-alias-bg-layer-2);overflow:visible}
      .ws-membar-fill{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--dsw-alias-state-success-primary);transition:width .6s ease}
      .ws-kv-warn .ws-membar-fill{background:var(--dsw-alias-state-warn-primary)}
      .ws-kv-bad .ws-membar-fill{background:var(--dsw-alias-state-error-primary)}
      .ws-membar-peak{position:absolute;top:-2px;bottom:-2px;width:2px;margin-left:-1px;border-radius:1px;background:var(--dsw-alias-label-secondary);opacity:.7}
      .ws-mtable{display:grid;grid-template-columns:auto minmax(0,1fr) minmax(0,1fr);gap:1px 10px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px}
      .ws-mtable-one{grid-template-columns:auto minmax(0,1fr)}
      .ws-mtable>b{min-width:0;overflow:hidden;text-overflow:ellipsis}
      .ws-mt-head{font-size:10.5px;font-weight:600;text-align:right;color:var(--dsw-alias-label-primary);border-bottom:1px solid var(--dsw-alias-border-l2);padding-bottom:1px}
      .ws-mt-head:first-child{border-bottom-color:transparent}
      .ws-mtable>b{font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-primary);text-align:right;white-space:nowrap;border-bottom:1px dotted color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent)}
      .ws-mt-label{display:flex;align-items:center;white-space:nowrap;border-bottom:1px dotted color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent)}
      .ws-mtable>b{display:flex;align-items:center;justify-content:flex-end}
      .ws-mtable>b.ws-mt-warn{color:var(--dsw-alias-state-warn-primary)}
      .ws-adv-findings{margin:2px 0 4px;padding-left:16px;display:flex;flex-direction:column;gap:5px;font-size:12px}
      .ws-adv-findings li{line-height:18px}
      .ws-adv-findings b{margin-right:6px}
      .ws-adv-findings i{display:block;font-style:normal;color:var(--dsw-alias-label-secondary);font-size:11.5px}
      .ws-adv-sec{margin:6px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .ws-mon-spark{flex:1;min-width:0}
      .ws-split{display:flex;height:6px;border-radius:3px;overflow:hidden;gap:1px;margin:2px 0 4px;background:var(--dsw-alias-bg-layer-2)}
      .ws-split i{display:block;min-width:2px}
      .ws-splitbox{display:flex;flex-direction:column;gap:2px;margin:2px 0 4px}
      .ws-splitbox .ws-split{margin:0}
      .ws-split-legend{display:flex;gap:10px;font-size:10px;color:var(--dsw-alias-label-secondary)}
      .ws-split-legend span{display:inline-flex;align-items:center;gap:4px}
      .ws-split-legend i{display:inline-block;width:8px;height:8px;border-radius:2px}
      .ws-ctxcell{display:inline-flex;flex-direction:column;align-items:flex-end;gap:1px;max-width:100%}
      .ws-busy-plot{position:relative;flex:1;display:flex;gap:4px;min-height:50px}
      .ws-busy-gutter{flex:none;width:26px;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end;font-size:9.5px;line-height:11px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}
      .ws-busy-zero{opacity:.7}
      .ws-busy-plot svg{flex:1;border-bottom:0!important}
      .ws-busy-axis{stroke:color-mix(in srgb,var(--ws-ink) 35%,transparent);stroke-width:1;vector-effect:non-scaling-stroke}
      .ws-busy-tag{position:absolute;left:2px;font-size:9.5px;color:var(--dsw-alias-label-secondary);pointer-events:none}
      .ws-busy-tag-up{top:0}
      .ws-busy-tag-down{bottom:0}
      .ws-busy-wait{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10.5px;color:var(--dsw-alias-label-secondary);pointer-events:none}
      .ws-busy-qlabel{position:absolute;right:2px;top:0;font-size:9.5px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;pointer-events:none}
      .ws-busy-ld.ws-busy-q,.ws-busy-lv.ws-busy-q{stroke-width:1;opacity:.5}
      .ws-version{font-style:normal;margin-left:8px;padding:0 5px;border-radius:4px;border:1px solid var(--dsw-alias-border-l2);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:0;color:var(--dsw-alias-label-secondary)}
      .ws-busy-fd{fill:color-mix(in srgb,var(--ws-accent) 11%,transparent);stroke:none}
      .ws-busy-fv{fill:color-mix(in srgb,#3b82c4 11%,transparent);stroke:none}
      .ws-call-mark{font-style:normal;margin-left:4px;font-size:10.5px;color:var(--dsw-alias-state-warn-primary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
      .ws-call-drop{color:var(--dsw-alias-label-secondary)}
      .ws-fail-bad{color:var(--dsw-alias-state-error-primary)}
      .ws-heap{min-width:96px}
      .ws-heap b small{font-size:10.5px;font-weight:500;color:var(--dsw-alias-label-secondary);letter-spacing:0}
      .ws-heap .ws-membar{display:block;width:100%;margin-top:2px}
      .ws-heap-warn b{color:var(--dsw-alias-state-warn-primary)}
      .ws-heap-warn .ws-membar-fill{background:var(--dsw-alias-state-warn-primary)}
      .ws-heap-bad b{color:var(--dsw-alias-state-error-primary)}
      .ws-heap-bad .ws-membar-fill{background:var(--dsw-alias-state-error-primary)}
      .ws-params{position:relative;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base)}
      .ws-params-head{width:100%;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;padding:6px 8px;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
      .ws-params-head:disabled{cursor:default}
      .ws-params-title{font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
      .ws-psum{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:10.5px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;min-width:0}
      .ws-psum i{font-style:normal;opacity:.6}
      .ws-psum .ws-psum-mod{color:var(--dsw-alias-state-warn-primary);font-weight:600}
      .ws-params-body{position:absolute;z-index:30;left:-1px;top:calc(100% + 4px);width:max(100%,300px);display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 10px 28px rgba(0,0,0,.22)}
      .ws-params-actions{flex-wrap:nowrap}
      .ws-cross .ws-x-line{display:flex;align-items:baseline;gap:6px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
      .ws-cross .ws-x-line b{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-primary);font-size:13px}
      .ws-x-sub{margin-left:auto;font-size:10.5px}
      .ws-x-confirmed{background:var(--dsw-alias-state-success-primary)}
      .ws-x-dismissed{background:color-mix(in srgb,var(--dsw-alias-label-primary) 30%,transparent)}
      .ws-x-disputed{background:var(--dsw-alias-state-warn-primary)}
      .ws-x-unjudged{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,transparent)}
      .ws-busy-now{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;color:var(--dsw-alias-label-primary);margin-left:2px}
      .ws-busy-now.ws-mt-warn{color:var(--dsw-alias-state-warn-primary)}
      .ws-busy-qhead{display:flex;justify-content:space-between;font-size:10px;color:var(--dsw-alias-label-secondary);margin-top:2px}
      .ws-busy .ws-busy-qsvg{flex:none;height:16px;min-height:16px}
      .ws-split-sent{background:var(--ws-accent)}
      .ws-split-replayed{background:var(--dsw-alias-state-success-primary)}
      .ws-split-skipped{background:color-mix(in srgb,var(--dsw-alias-label-primary) 30%,transparent)}
      .ws-hist{display:inline-flex;align-items:flex-end;gap:1px;height:12px;width:48px;justify-content:flex-end}
      .ws-hist i{display:block;width:5px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 45%,transparent);border-radius:1px 1px 0 0}
      .ws-hist i.ws-hist-hot{background:var(--dsw-alias-state-error-primary)}
      .ws-busy{display:flex;flex-direction:column;gap:2px;margin-top:6px;flex:1;min-height:70px}
      .ws-busy-head{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--dsw-alias-label-secondary)}
      .ws-busy-legend{display:inline-flex;align-items:center;gap:4px;font-size:10px}
      .ws-busy-legend i{display:inline-block;width:10px;height:3px;border-radius:2px;margin-left:4px}
      .ws-busy svg{flex:1;width:100%;min-height:44px;display:block;border-bottom:1px solid color-mix(in srgb,var(--ws-ink) 25%,transparent)}
      .ws-busy-d,.ws-busy-ld{background:var(--ws-accent);stroke:var(--ws-accent)}
      .ws-busy-v,.ws-busy-lv{background:#3b82c4;stroke:#3b82c4}
      .ws-busy-q{background:color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent)}
      .ws-busy-ld,.ws-busy-lv{fill:none;stroke-width:1.6;vector-effect:non-scaling-stroke}
      .ws-busy-qd{fill:color-mix(in srgb,var(--ws-accent) 18%,transparent)}
      .ws-busy-qv{fill:color-mix(in srgb,#3b82c4 18%,transparent)}
      .ws-busy-limit{stroke:var(--dsw-alias-label-secondary);stroke-dasharray:3 3;stroke-width:1;vector-effect:non-scaling-stroke}
      .ws-res{display:flex;flex-direction:column}
      /* The column fills the height: C2 takes the spare space (C1 when C2 is folded). */
      .ws-col-right>.ws-res{flex:1 0 auto}
      .ws-col-right>.ws-res.ws-collapsed{flex:none}
      .ws-col-right:has(>.ws-res.ws-collapsed)>.ws-panel:first-child{flex:1 0 auto}
      .ws-col-right>.ws-panel:last-child{margin-bottom:0}
      .ws-fold{display:inline-flex;align-items:center;gap:6px;border:0;background:none;padding:0;color:inherit;font:inherit;cursor:pointer}
      .ws-fold-arrow{font-size:11px;color:var(--dsw-alias-label-secondary)}
      .ws-res-mini{font-size:11px;color:var(--dsw-alias-label-secondary)}
      .ws-panel.ws-collapsed{gap:0}
      .ws-mt-head{display:flex;flex-direction:column;align-items:flex-end;min-width:0;gap:1px}
      .ws-mt-head em{font-style:normal;font-size:10.5px}
      .ws-mt-name{display:flex;align-items:center;gap:4px;max-width:100%;min-width:0;font-weight:500;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--dsw-alias-label-secondary)}
      .ws-mt-name i{font-style:normal;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ws-kv-warn b{color:var(--dsw-alias-state-warn-primary)}
      .ws-kv-bad b{color:var(--dsw-alias-state-error-primary)}
      .ws-spark-avg{stroke:var(--dsw-alias-label-secondary);stroke-width:1;stroke-dasharray:3 3;vector-effect:non-scaling-stroke}
      .ws-spark-foot{display:flex;justify-content:space-between;gap:6px;font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
      .ws-spark-foot>*{overflow:hidden;text-overflow:ellipsis;min-width:0}
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
      .ws-clear{color:var(--dsw-alias-label-secondary)}
      .ws-clear:hover{color:var(--dsw-alias-state-error-primary)}
      .ws-gauge-wrap{display:flex;flex-direction:column;align-items:center;gap:3px;flex:none}
      .ws-gauge-cap{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
      .ws-resume{border-color:var(--ws-accent);color:var(--ws-accent);font-weight:600}
      .ws-picked{flex:1;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-base);padding:6px 8px;display:flex;flex-direction:column;gap:5px}
      .ws-picked-head{display:flex;align-items:center;gap:6px;font-size:12px}
      .ws-picked-head .ma-mono{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ws-picked-list{display:flex;flex-wrap:wrap;gap:4px;max-height:84px;overflow:auto}
      .ws-picked-item{display:inline-flex;align-items:center;gap:3px;max-width:100%;padding:1px 4px 1px 7px;border-radius:5px;font-size:11.5px;background:var(--ws-accent-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ws-picked-item button{border:0;background:none;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1;padding:0 2px}
      .ws-speed{color:var(--dsw-alias-label-primary)}
      .ws-count.ws-count-bad{background:var(--dsw-alias-state-error-primary)}
      .ws-page .ws-rv-item .ma-btn.ma-primary{background:var(--ws-accent);border-color:var(--ws-accent);color:#fff}
      .ws-rv{display:flex;flex-direction:column;gap:10px;padding:4px 0}
      .ws-rv-sum{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;font-size:12px}
      .ws-rv-file{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);overflow:hidden}
      .ws-rv-head{display:flex;align-items:center;gap:10px;padding:6px 10px;background:color-mix(in srgb,var(--ws-accent) 6%,transparent);border-bottom:1px solid var(--dsw-alias-border-l1)}
      .ws-rv-head .ma-mono{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--dsw-alias-label-primary)}
      .ws-rv-item{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-top:1px dashed var(--dsw-alias-border-l1)}
      .ws-rv-item:first-of-type{border-top:0}
      .ws-rv-done{opacity:.6}
      .ws-rv-meta{display:flex;align-items:center;gap:8px;font-size:12px}
      .ws-rv-code{font-size:10.5px;padding:0 6px;border-radius:3px;color:#fff;background:var(--dsw-alias-state-warn-primary);line-height:17px}
      .ws-rv-ctx{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:19px;padding:6px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);white-space:pre-wrap;word-break:break-all}
      .ws-rv-ctx mark{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 22%,transparent);color:var(--dsw-alias-state-error-primary);font-weight:700;border-radius:3px;padding:0 2px}
      .ws-rv-plain{font-family:inherit;color:var(--dsw-alias-label-secondary)}
      .ws-rv-result{font-size:12px;color:var(--dsw-alias-state-success-primary)}
      .ws-more-hot{color:var(--dsw-alias-state-error-primary)!important;font-weight:600}
      .ws-modal-compare{width:min(1500px,100%);height:calc(100vh - 48px)}
      .ws-modal-compare .ws-modal-body{padding:0;display:flex;min-height:0}
      .ws-cmp-keys{margin-right:8px}
      .ws-cmp{flex:1;min-height:0;display:grid;grid-template-columns:280px minmax(0,1fr);outline:none}
      .ws-cmp-side{display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
      .ws-cmp-filters{display:flex;gap:4px;padding:8px}
      .ws-cmp-filter{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:26px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}
      .ws-cmp-filter i{font-style:normal;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px}
      .ws-cmp-filter.ws-on{border-color:var(--ws-accent);color:var(--ws-accent);font-weight:600}
      .ws-cmp-list{flex:1;min-height:0;overflow:auto;padding:0 6px 8px}
      .ws-cmp-item{width:100%;display:grid;grid-template-columns:10px minmax(0,1fr) auto;align-items:center;gap:8px;padding:6px 8px;border:0;border-radius:6px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
      .ws-cmp-item:hover{background:var(--dsw-alias-bg-overlay)}
      .ws-cmp-item.ws-on{background:var(--ws-accent-soft);box-shadow:inset 3px 0 0 var(--ws-accent)}
      .ws-cmp-dot{width:8px;height:8px;border-radius:2px;background:var(--dsw-alias-state-success-primary)}
      .ws-cmp-dot.ws-p-review{background:var(--dsw-alias-state-warn-primary)}
      .ws-cmp-name{min-width:0;display:flex;flex-direction:column}
      .ws-cmp-name b{font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ws-cmp-name small{font-size:10.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ws-cmp-n{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
      .ws-cmp-main{display:flex;flex-direction:column;min-width:0;min-height:0}
      .ws-cmp-bar{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}
      .ws-cmp-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-primary)}
      .ws-cmp-pane{flex:1;min-height:0;overflow:auto;padding:10px 14px 18px;display:flex;flex-direction:column;gap:10px}
      .ws-cmp-review{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-state-warn-primary);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-base)}
      .ws-cmp-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12.5px}
      .ws-cmp-table th{position:sticky;top:-10px;z-index:1;text-align:left;font-weight:600;font-size:11.5px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2)}
      .ws-cmp-table th:first-child{width:150px}
      .ws-cmp-table td{padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top;white-space:pre-wrap;word-break:break-word;line-height:19px}
      .ws-cmp-table td:nth-child(2){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 3%,transparent)}
      .ws-cmp-table td:nth-child(3){background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 3%,transparent)}
      .ws-cmp-field{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}
      .ws-cmp-table del{text-decoration:none;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 18%,transparent);color:var(--dsw-alias-state-error-primary);border-radius:3px;padding:0 1px}
      .ws-cmp-table ins{text-decoration:none;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 20%,transparent);color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 75%,#000);border-radius:3px;padding:0 1px;font-weight:600}
      .ws-cmp-flag{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 35%,transparent);color:inherit;border-radius:3px;padding:0 1px;outline:1px solid var(--dsw-alias-state-warn-primary)}
      .ws-cmp-flagged td{box-shadow:inset 0 1px 0 var(--dsw-alias-state-warn-primary),inset 0 -1px 0 var(--dsw-alias-state-warn-primary)}
      .ws-cmp-more{align-self:center}
      .ws-cmp-bulk{display:flex;flex-direction:column;gap:6px;margin:8px 8px 0;padding:8px;border-radius:7px;border:1px solid var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent);font-size:12px}
      .ws-mp{position:relative;width:100%}
      .ws-mp-row{display:flex;gap:6px}
      .ws-mp-row .ma-input{flex:1;min-width:0}
      .ws-mp-btn{flex:none;width:34px;padding:0;font-size:12px}
      .ws-mp-menu{position:absolute;z-index:20;left:0;right:0;top:calc(100% + 4px);max-height:240px;overflow:auto;padding:4px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));box-shadow:0 8px 24px rgba(0,0,0,.14)}
      .ws-mp-item{display:block;width:100%;text-align:left;padding:6px 8px;border:0;border-radius:5px;background:none;color:inherit;font:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;cursor:pointer}
      .ws-mp-item:hover{background:var(--dsw-alias-bg-layer-2)}
      .ws-mp-item.ws-on{color:var(--ws-accent,var(--dsw-alias-brand-primary));font-weight:600}
      .ws-mp-clear{font-family:inherit;color:var(--dsw-alias-label-secondary)}
      .ws-mp-note{padding:6px 8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .ws-cmp-rowbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      .ws-cmp-rowbar .ws-cmp-filter{flex:none;padding:0 10px}
      .ws-cmp-same td{color:var(--dsw-alias-label-secondary)}
      .ws-cmp-same td:nth-child(2),.ws-cmp-same td:nth-child(3){background:none!important}
      .ws-cmp-suspect{background:none;color:inherit;text-decoration:underline dotted var(--dsw-alias-state-warn-primary);text-decoration-thickness:2px;text-underline-offset:3px}
      .ws-cmp-only{flex:none;display:inline-flex;align-items:center;gap:5px;font-size:12px;white-space:nowrap;cursor:pointer}
      .ws-warn-line{color:var(--dsw-alias-state-warn-primary)!important;margin:6px 0 0}
      .ws-run-resume{color:var(--ws-accent);font-weight:600}
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
      .ws-gauge{--ws-pct:0deg;flex:none;width:66px;height:66px;border-radius:50%;background:conic-gradient(var(--ws-accent) var(--ws-pct),var(--dsw-alias-border-l2) 0);display:flex;align-items:center;justify-content:center}
      .ws-gauge-in{width:52px;height:52px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);display:flex;align-items:center;justify-content:center}
      .ws-gauge-in b{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:19px;font-weight:600}
      .ws-gauge-in span{font-size:11px;color:var(--dsw-alias-label-secondary);margin-left:1px}
      .ws-readouts{display:grid;grid-template-columns:1fr 1fr;gap:4px}
      .ws-readout{display:flex;align-items:baseline;justify-content:space-between;gap:6px;padding:4px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
      .ws-readout span{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
      .ws-readout b{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;font-weight:600}
      .ws-readout.ws-tone-warn b{color:var(--dsw-alias-state-warn-primary)}
      .ws-readout.ws-tone-bad b{color:var(--dsw-alias-state-error-primary)}
      .ws-model{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
      .ws-model>div{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .ws-model>div b{color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ws-model{justify-content:center;gap:8px}
      .ws-model>div>span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
      .ws-dot{flex:none;width:8px;height:8px;padding:0;border:0;border-radius:50%;cursor:pointer;background:var(--dsw-alias-label-tertiary,#aaa)}
      .ws-dot-ok{background:var(--dsw-alias-state-success-primary,#22a06b)}
      .ws-dot-bad{background:var(--dsw-alias-state-error-primary,#d0453a)}
      .ws-dot-wait{animation:ws-dot-pulse 1s ease-in-out infinite;cursor:default}
      @keyframes ws-dot-pulse{50%{opacity:.35}}
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
      .ws-schematic{display:block;width:100%;height:auto;max-height:290px;overflow:visible;font-family:inherit}
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
      .ws-mc-name{font-size:16px;font-weight:700;letter-spacing:.5px}
      .ws-mc-sub{font-size:11.5px;fill:var(--dsw-alias-label-secondary)!important}
      .ws-mc-load{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;fill:var(--dsw-alias-label-secondary)!important}
      .ws-mc-idle{opacity:.55}
      .ws-mc-click{cursor:pointer}
      .ws-mc-click:hover .ws-housing{stroke-width:2.4}
      .ws-mc-warn .ws-housing{stroke:var(--dsw-alias-state-error-primary);stroke-width:2.2;fill:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent)}
      .ws-mc-warn .ws-plate{fill:var(--dsw-alias-state-error-primary)}
      .ws-mc-warn .ws-mc-no{fill:#fff!important}
      .ws-mc-warn .ws-mc-lamp{fill:#fff;animation:ws-blink 1.2s infinite}
      .ws-mc-warn .ws-icon *{stroke:var(--dsw-alias-state-error-primary)}
      .ws-mc-sub.ws-tone-warn,.ws-mc-load.ws-tone-warn{fill:var(--dsw-alias-state-warn-primary)!important}
      .ws-mc-load.ws-tone-bad{fill:var(--dsw-alias-state-error-primary)!important;font-weight:700}
      .ws-bypass-line,.ws-bypass-head{fill:none;stroke:var(--dsw-alias-label-secondary);stroke-width:1.2;stroke-dasharray:4 4;opacity:.7}
      .ws-bypass-head{stroke-dasharray:none}
      .ws-bypass-label{font-size:11px;fill:var(--dsw-alias-label-secondary)!important}
      .ws-bypass-active .ws-bypass-line,.ws-bypass-active .ws-bypass-head{stroke:var(--ws-accent);opacity:1}
      .ws-bypass-active .ws-bypass-label{fill:var(--ws-accent)!important}
      .ws-bypass-done .ws-bypass-label{fill:var(--dsw-alias-state-success-primary)!important}
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
      .ws-spark-head{display:flex;justify-content:space-between;gap:6px;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-secondary)}
      .ws-spark svg{width:100%;height:34px;display:block;border-bottom:1px solid color-mix(in srgb,var(--ws-ink) 25%,transparent)}
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
      const [verifyEndpoint, setVerifyEndpointRaw] = React.useState('')
      const setVerifyEndpoint = (next) => { setVerifyEndpointRaw(next); setVerifyPing(null) }
      const [verifyModelName, setVerifyModelName] = React.useState('')
      const [verifyKey, setVerifyKey] = React.useState('')
      const [clearVerifyKey, setClearVerifyKey] = React.useState(false)
      const [verifyPing, setVerifyPing] = React.useState(null)
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
      const [opaquePolicy, setOpaquePolicy] = React.useState('review')
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
        setVerifyEndpoint(info.verifyBaseURL ?? '')
        setVerifyModelName(info.verifyModel ?? '')
        setVerifyKey('')
        setClearVerifyKey(false)
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
        setOpaquePolicy(info.opaquePolicy === 'remove' ? 'remove' : 'review')
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
        setOpaquePolicy('review')
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
        ['verifyModel', verifyModelName.trim() !== String(config.verifyModel ?? '') || verifyEndpoint.trim().replace(/\/+$/, '') !== String(config.verifyBaseURL ?? '').replace(/\/+$/, '') || verifyKey.length > 0 || clearVerifyKey],
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
          || !sameList(allowText, config.allowValues) || !sameList(skipText, config.skipFields)
          || opaquePolicy !== (config.opaquePolicy === 'remove' ? 'remove' : 'review')],
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
            opaquePolicy,
          }
          if (apiKey.length > 0) request.apiKey = apiKey
          else if (clearKey) request.apiKey = ''
          request.verifyBaseURL = verifyEndpoint.trim()
          request.verifyModel = verifyModelName.trim()
          if (verifyKey.length > 0) request.verifyApiKey = verifyKey
          else if (clearVerifyKey) request.verifyApiKey = ''
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
        model: ['baseURL', 'model', 'apiKey', 'verifyModel', 'disableThinking', 'timeoutMs', 'temperature'],
        rules: ['rules'],
        batch: ['outputRoot', 'maxRounds', 'maxFiles', 'concurrency', 'maxDicomFiles', 'vaultPassphrase', 'showSidebarEntry'],
        guide: [],
      }
      const tabs = ['model', 'rules', 'batch', 'guide']
      const strategySelect = (value, options, onChange, disabled = false) => h('select', {
        className: 'ma-input ma-select', value, disabled, onChange: (event) => onChange(event.target.value),
      }, ...options.map((option) => h('option', { key: option, value: option }, t(`strategy.${option}`))))

      const sameModel = Boolean(verifyModelName.trim()) && verifyModelName.trim() === model.trim()
      const modelPanel = () => h('div', { className: 'ma-panel' },
        h('div', { className: 'ma-card' },
          h('div', { className: 'ma-block-head' },
            h('div', {},
              h('h3', {}, t('model.detectTitle')),
              h('p', { className: 'ma-hint' }, t('model.detectHint')))),
          h('div', { className: 'ma-grid' },
            h('label', { className: 'ma-field' }, t('model.endpoint'),
              h('input', {
                className: 'ma-input', value: endpoint,
                onChange: (event) => setEndpoint(event.target.value),
                placeholder: 'http://127.0.0.1:11434/v1',
              })),
            h('div', { className: 'ma-field' }, t('model.name'),
              h(ModelPicker, {
                value: model, onChange: setModel, placeholder: t('model.namePlaceholder'),
                source: `${endpoint.trim()}|${apiKey}`,
                fetchModels: () => call('ping', { baseURL: endpoint.trim(), apiKey }),
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
          h('div', { className: 'ma-actions' },
            h('button', { className: 'ma-btn ma-small', onClick: testConnection, disabled: testing },
              testing ? t('model.testing') : t('model.test')),
            h('span', { className: pingClass }, pingText()),
          ),
        ),
        h('div', { className: 'ma-card' },
          h('div', { className: 'ma-block-head' },
            h('div', {},
              h('h3', {}, t('verify.title')),
              h('p', { className: 'ma-hint' }, t('verify.hint')))),
          h('div', { className: 'ma-grid' },
            h('label', { className: 'ma-field' }, t('verify.endpoint'),
              h('input', { className: 'ma-input', value: verifyEndpoint, onChange: (event) => setVerifyEndpoint(event.target.value), placeholder: t('verify.endpointPlaceholder') })),
            h('div', { className: 'ma-field' }, t('model.name'),
              h(ModelPicker, {
                value: verifyModelName, onChange: (next) => { setVerifyModelName(next); setVerifyPing(null) }, placeholder: t('verify.modelPlaceholder'),
                source: `${verifyEndpoint.trim() || endpoint.trim()}|${verifyKey}`,
                fetchModels: () => call('ping', { baseURL: verifyEndpoint.trim() || endpoint.trim(), apiKey: verifyKey, keySource: 'verify' }),
              })),
            h('label', { className: 'ma-field ma-wide' }, t('model.key'),
              h('input', {
                className: 'ma-input', value: verifyKey, type: 'password', autoComplete: 'off',
                onChange: (event) => { setVerifyKey(event.target.value); setClearVerifyKey(false) },
                placeholder: config?.hasVerifyApiKey && !clearVerifyKey ? t('model.keySaved') : t('verify.keyPlaceholder'),
              })),
          ),
          config?.hasVerifyApiKey
            ? h('label', { className: 'ma-check' },
              h('input', { type: 'checkbox', checked: clearVerifyKey, onChange: (event) => { setClearVerifyKey(event.target.checked); if (event.target.checked) setVerifyKey('') } }),
              t('model.keyClear'))
            : null,
          h('div', { className: 'ma-actions' },
            h('button', {
              className: 'ma-btn ma-small', disabled: !verifyModelName.trim() || verifyPing?.pending,
              onClick: async () => {
                setVerifyPing({ pending: true })
                try {
                  setVerifyPing(await call('ping', { baseURL: verifyEndpoint.trim() || endpoint.trim(), model: verifyModelName.trim(), apiKey: verifyKey, keySource: 'verify' }))
                } catch (cause) { setVerifyPing({ ok: false, error: message(cause) }) }
              },
            }, verifyPing?.pending ? t('model.testing') : t('model.test')),
            verifyPing && !verifyPing.pending && verifyModelName.trim()
              ? h('span', { className: verifyPing.ok && (!verifyPing.models?.length || verifyPing.models.includes(verifyModelName.trim())) ? 'ma-hint ma-ok' : 'ma-hint ma-error' },
                verifyPing.ok
                  ? (verifyPing.models?.length && !verifyPing.models.includes(verifyModelName.trim()) ? t('model.missing', { model: verifyModelName.trim() }) : t('model.ok', { models: (verifyPing.models ?? []).slice(0, 6).join('、') }))
                  : t('model.fail', { error: verifyPing.error }))
              : h('span', { className: 'ma-hint' }, verifyModelName.trim() ? '' : t('verify.same'))),
          sameModel ? h('p', { className: 'ma-hint ws-warn-line' }, t('verify.sameName', { model: model.trim() })) : null,
        ),
        h('div', { className: 'ma-card' },
          h('div', { className: 'ma-block-head' },
            h('div', {},
              h('h3', {}, t('model.sharedTitle')),
              h('p', { className: 'ma-hint' }, t('model.sharedHint')))),
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
            // 邮编 is an identifier: always processed, whatever the toggle.
            const on = quasiOn || item.always
            return h('div', { key: item.id, className: `ma-rule${on ? '' : ' ma-off'}`, title: item.always ? t('rules.quasiAlways') : '' },
              h('span', { className: 'ma-rule-name' }, item.type, item.always ? h('small', { className: 'ma-hint' }, ` · ${t('rules.always')}`) : null),
              strategySelect(item.strategies.includes(strategy) ? strategy : item.default, item.strategies,
                (value) => setQuasiPolicy({ ...quasiPolicy, [item.id]: value }), !on),
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
        h('div', { className: 'ma-card' },
          h('div', { className: 'ma-block-head' },
            h('div', {},
              h('h3', {}, t('rules.opaqueTitle')),
              h('p', { className: 'ma-hint' }, t('rules.opaqueHint')))),
          h('label', { className: 'ma-field' }, t('rules.opaqueLabel'),
            h('select', { className: 'ma-input', value: opaquePolicy, onChange: (event) => setOpaquePolicy(event.target.value) },
              h('option', { value: 'review' }, t('rules.opaqueReview')),
              h('option', { value: 'remove' }, t('rules.opaqueRemove')))),
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
            h('label', { className: 'ma-field', title: t('run.roundsHint') }, t('run.rounds'),
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
          h('p', { className: 'ma-hint' }, t('run.concurrencyHint')),
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

    // S01–S10 on the line; DICOM is a bypass (metadata only, no model).
    const STATIONS = ['prescan', 'read', 'discover', 'rules', 'blind', 'repair', 'rescan', 'pack', 'review', 'deliver']
    const LOOP_STATIONS = new Set(['discover', 'rules', 'blind', 'repair'])

    function stationOf(state) {
      const step = String(state?.step ?? '')
      if (step === '批次预扫') return 'prescan'
      if (step === '读取' || step === '画像') return 'read'
      if (step === '发现') return Number(state?.round ?? 1) > 1 ? 'repair' : 'discover'
      if (step === '复判') return 'repair'
      if (step === '规则核验') return 'rules'
      if (step === '复核') return 'blind'
      if (step.startsWith('批次复扫') || step.startsWith('跨组复扫')) return 'rescan'
      if (step === 'DICOM') return 'dicom'
      if (step === '打包' || step === '比对记录') return 'pack'
      return null
    }

    // Process line drawn as an engineering schematic: machines on a conveyor,
    // dimension lines over the two stages, the repair loop, and workpieces
    // riding the belt while a batch runs.
    const ICONS = {
      prescan: [h('rect', { key: 1, x: -16, y: -11, width: 32, height: 22, rx: 3 }), h('path', { key: 2, d: 'M-11 -5h22M-11 0h22M-11 5h14' }), h('path', { key: 3, className: 'ws-beam', d: 'M-19 0h38' })],
      read: [h('path', { key: 1, d: 'M-10 -15h13l7 7v23h-20z M3 -15v7h7' }), h('path', { key: 2, d: 'M-6 -1h12M-6 4h12M-6 9h8' })],
      discover: [h('circle', { key: 1, cx: -3, cy: -3, r: 9.5 }), h('path', { key: 2, d: 'M4 4l10 10' }), h('path', { key: 3, d: 'M-7 -3h8' })],
      rules: [h('path', { key: 1, d: 'M0 -15l12 5v7c0 8-5 13-12 16c-7-3-12-8-12-16v-7z' }), h('path', { key: 2, d: 'M-5 0l4 4l7-8' })],
      blind: [h('path', { key: 1, d: 'M-16 0c5-8 11-12 16-12s11 4 16 12c-5 8-11 12-16 12s-11-4-16-12z' }), h('circle', { key: 2, r: 5.5, className: 'ws-pulse' }), h('path', { key: 3, d: 'M-14 14l28 -28' })],
      review: [h('circle', { key: 1, cy: -7, r: 6 }), h('path', { key: 2, d: 'M-12 14c0-8 5-12 12-12s12 4 12 12' }), h('path', { key: 3, d: 'M8 -2l3 3l6-7' })],
      deliver: [h('path', { key: 1, d: 'M-14 -2v14h28v-14' }), h('path', { key: 2, d: 'M0 4v-18M-6 -8l6 -6l6 6' })],
      repair: [h('path', { key: 1, d: 'M7 -14a8 8 0 0 0-7 12l-11 11a2.8 2.8 0 0 0 4 4l11-11a8 8 0 0 0 12-7l-5 4l-5-1l-1-5z' })],
      rescan: [h('circle', { key: 1, r: 13 }), h('circle', { key: 2, r: 6.5 }), h('path', { key: 3, className: 'ws-sweep', d: 'M0 0l9.2 -9.2' })],
      dicom: [h('circle', { key: 1, cy: -3, r: 13 }), h('circle', { key: 2, cy: -3, r: 6.5, className: 'ws-pulse' }), h('path', { key: 3, d: 'M-18 13h36' })],
      pack: [h('path', { key: 1, d: 'M-14 -7l14 -8l14 8v15l-14 8l-14 -8z' }), h('path', { key: 2, d: 'M-14 -7l14 8l14 -8M0 1v15' })],
    }

    function LineSchematic({ load, states, notes, running, inflight, maxRounds, rounds, dicom, onStation, t }) {
      const W = 1300
      const step = W / STATIONS.length
      const cx = (index) => step * index + step / 2
      const belt = 186
      const half = 44
      const doc = (x, y, key, extra = {}) => h('g', { key, transform: `translate(${x} ${y})`, className: 'ws-doc', ...extra },
        h('path', { d: 'M-6 -8h8l4 4v12h-12z' }), h('path', { d: 'M-3 -2h6M-3 2h6' }))
      const dim = (from, to, label, key) => {
        const x1 = cx(from) - half + 2
        const x2 = cx(to) + half - 2
        const width = Math.min(x2 - x1 - 30, 260)
        return h('g', { key, className: 'ws-dim' },
          h('path', { d: `M${x1} 18v12M${x2} 18v12M${x1} 24H${x2}` }),
          h('path', { className: 'ws-dim-arrow', d: `M${x1 + 7} 21l-7 3l7 3M${x2 - 7} 21l7 3l-7 3` }),
          h('rect', { className: 'ws-dim-bg', x: (x1 + x2) / 2 - width / 2, y: 15, width, height: 18 }),
          h('text', { x: (x1 + x2) / 2, y: 28, textAnchor: 'middle' }, label))
      }
      // Loop: 复判修正 (S06) back to 规则核验 (S04).
      const loopFrom = cx(STATIONS.indexOf('repair'))
      const loopTo = cx(STATIONS.indexOf('rules'))
      const roundText = rounds.length ? ` · ${rounds.map(([round, count]) => `R${round} ${count}`).join(' · ')}` : ''
      const loopLabel = `${t('ws.loop', { rounds: maxRounds })}${roundText}`
      const clickable = (id) => Boolean(onStation?.[id])
      return h('svg', { className: `ws-schematic${running ? ' ws-run' : ''}`, viewBox: `0 0 ${W} 290`, role: 'img', 'aria-label': t('ws.line') },
        dim(0, 1, t('ws.stage1'), 'a'),
        dim(2, 5, t('ws.stage2'), 'b'),
        dim(6, 7, t('ws.stage3'), 'c'),
        dim(8, 9, t('ws.stage4'), 'd'),
        h('path', { className: 'ws-loop', d: `M${loopFrom} 66 C ${loopFrom} 42, ${loopTo} 42, ${loopTo} 66` }),
        h('path', { className: 'ws-loop-head', d: `M${loopTo - 5} 58l5 8l5 -8` }),
        h('rect', { className: 'ws-dim-bg', x: (loopFrom + loopTo) / 2 - 130, y: 39, width: 260, height: 16, rx: 3 }),
        h('text', { className: 'ws-loop-label', x: (loopFrom + loopTo) / 2, y: 51, textAnchor: 'middle' }, loopLabel),
        h('rect', { className: 'ws-belt', x: 8, y: belt, width: W - 16, height: 16, rx: 8 }),
        h('path', { className: 'ws-belt-run', d: `M18 ${belt}H${W - 18}` }),
        Array.from({ length: 30 }, (_, index) => h('circle', { key: `r${index}`, className: 'ws-roller', cx: 24 + index * ((W - 48) / 29), cy: belt + 8, r: 4 })),
        STATIONS.map((id, index) => {
          const x = cx(index)
          const state = states[id]
          const note = notes[id] ?? {}
          return h('g', {
            key: id, className: `ws-mc ws-mc-${state}${clickable(id) ? ' ws-mc-click' : ''}`,
            onClick: clickable(id) ? onStation[id] : undefined,
          },
            note.title ? h('title', {}, note.title) : null,
            h('path', { className: 'ws-leg', d: `M${x - 28} 154V${belt}M${x + 28} 154V${belt}` }),
            index < STATIONS.length - 1
              ? h('g', { className: 'ws-feedline' },
                h('path', { d: `M${x + half} 112H${x + step - half - 4}` }),
                h('path', { className: 'ws-feedhead', d: `M${x + step - half - 9} 108l5 4l-5 4` }))
              : null,
            h('rect', { className: 'ws-housing', x: x - half, y: 70, width: half * 2, height: 84, rx: 7 }),
            h('rect', { className: 'ws-plate', x: x - half, y: 70, width: half * 2, height: 15, rx: 7 }),
            h('text', { className: 'ws-mc-no', x: x - half + 8, y: 81 }, `S${String(index + 1).padStart(2, '0')}`),
            h('circle', { className: 'ws-mc-lamp', cx: x + half - 10, cy: 77.5, r: 3.6 }),
            h('g', { className: 'ws-icon', transform: `translate(${x} 120)` }, ICONS[id]),
            h('text', { className: 'ws-mc-name', x, y: 224, textAnchor: 'middle' }, t(`ws.st.${id}`)),
            h('text', { className: `ws-mc-sub${note.subTone ? ` ws-tone-${note.subTone}` : ''}`, x, y: 241, textAnchor: 'middle' }, note.sub ?? t(`ws.sub.${id}`)),
            h('text', { className: `ws-mc-load${note.loadTone ? ` ws-tone-${note.loadTone}` : ''}`, x, y: 257, textAnchor: 'middle' },
              load[id] > 0
                ? `${t('ws.load', { count: load[id] })}${note.queue ? ` · ${t('ws.queued', { count: note.queue })}` : ''}`
                : (note.load ?? (state === 'done' ? t('ws.passed') : '·'))))
        }),
        inflight.map((state, index) => {
          const at = STATIONS.indexOf(stationOf(state))
          if (at < 0) return null
          const sameBefore = inflight.slice(0, index).filter((other) => stationOf(other) === stationOf(state)).length
          return doc(cx(at) - 18 + (sameBefore % 4) * 12, belt - 9, `w${index}`, { className: 'ws-doc ws-doc-hot' })
        }),
        running
          ? [0, 1, 2, 3].map((index) => h('g', { key: `m${index}`, className: 'ws-doc ws-doc-flow' },
            h('path', { d: 'M-6 -8h8l4 4v12h-12z' }),
            h('animateMotion', { dur: '10s', begin: `-${index * 2.5}s`, repeatCount: 'indefinite', path: `M14 ${belt - 9}H${W - 14}` })))
          : null,
        // Bypass: DICOM (header only, no model) from 预扫描 to 比对·打包.
        h('g', { className: `ws-bypass ws-bypass-${dicom.state}` },
          h('path', { className: 'ws-bypass-line', d: `M${cx(0)} 262V276H${cx(7)}V262` }),
          h('path', { className: 'ws-bypass-head', d: `M${cx(7) - 4} 268l4 -6l4 6` }),
          h('rect', { className: 'ws-dim-bg', x: (cx(0) + cx(7)) / 2 - 170, y: 268, width: 340, height: 16, rx: 3 }),
          h('text', { className: 'ws-bypass-label', x: (cx(0) + cx(7)) / 2, y: 280, textAnchor: 'middle' }, dicom.label)))
    }

    // Least-squares fit of call duration = c + in/P + out/D over model calls;
    // returns generation (D) and prompt (P) speed in tok/s, or nulls when
    // the sample is too small or degenerate.
    function fitSpeed(f) {
      if (!f || f.n < 30) return { gen: null, prompt: null, n: f?.n ?? 0 }
      const n = f.n
      const s11 = f.aa - (f.a * f.a) / n
      const s22 = f.bb - (f.b * f.b) / n
      const s12 = f.ab - (f.a * f.b) / n
      const s1y = f.ay - (f.a * f.y) / n
      const s2y = f.by - (f.b * f.y) / n
      const det = s11 * s22 - s12 * s12
      if (!(det > 0)) return { gen: null, prompt: null, n }
      const b1 = (s1y * s22 - s2y * s12) / det
      const b2 = (s2y * s11 - s1y * s12) / det
      return { gen: b2 > 0 ? 1000 / b2 : null, prompt: b1 > 0 ? 1000 / b1 : null, n }
    }
    function fitSums(entries) {
      const f = { n: 0, a: 0, b: 0, y: 0, aa: 0, bb: 0, ab: 0, ay: 0, by: 0 }
      for (const e of entries) {
        if (e.result !== 'ok' || !(e.out > 0)) continue
        const x1 = e.in || 0
        const x2 = e.out
        f.n += 1; f.a += x1; f.b += x2; f.y += e.ms
        f.aa += x1 * x1; f.bb += x2 * x2; f.ab += x1 * x2; f.ay += x1 * e.ms; f.by += x2 * e.ms
      }
      return f
    }
    const fmtSpeed = (value) => (value === null ? '—' : value >= 1000 ? compact(Math.round(value)) : value.toFixed(1))

    /**
     * Model name field with a dropdown filled from the endpoint's /models.
     * Typing stays possible (servers that list nothing, or a name to type).
     * The list is fetched when the field is focused or the arrow is clicked,
     * and again whenever the endpoint changes.
     */
    function ModelPicker({ value, onChange, placeholder, fetchModels, source, emptyHint }) {
      const t = services.t
      const [open, setOpen] = React.useState(false)
      const [state, setState] = React.useState({ source: null, loading: false, models: [], error: '' })
      const box = React.useRef(null)
      const load = async (force = false) => {
        if (!force && state.source === source && (state.loading || state.models.length || state.error)) return
        setState({ source, loading: true, models: [], error: '' })
        try {
          const result = await fetchModels()
          setState(result?.ok ? { source, loading: false, models: result.models ?? [], error: '' } : { source, loading: false, models: [], error: result?.error ?? 'failed' })
        } catch (cause) {
          setState({ source, loading: false, models: [], error: message(cause) })
        }
      }
      React.useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => { if (box.current && !box.current.contains(event.target)) setOpen(false) }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
      }, [open])
      const stale = state.source !== source
      const filter = value.trim().toLowerCase()
      const models = stale ? [] : state.models
      const matches = filter && models.some((name) => name.toLowerCase() === filter) ? models : models.filter((name) => !filter || name.toLowerCase().includes(filter))
      return h('div', { className: 'ws-mp', ref: box },
        h('div', { className: 'ws-mp-row' },
          h('input', {
            className: 'ma-input', value, placeholder, autoComplete: 'off', spellCheck: false,
            onChange: (event) => { onChange(event.target.value); setOpen(true) },
            onFocus: () => { setOpen(true); load() },
            onKeyDown: (event) => { if (event.key === 'Escape') setOpen(false) },
          }),
          h('button', {
            type: 'button', className: 'ma-btn ws-mp-btn', title: t('model.fetch'),
            onClick: () => { setOpen(true); load(true) },
          }, state.loading && !stale ? '…' : '▾')),
        open
          ? h('div', { className: 'ws-mp-menu', role: 'listbox' },
            state.loading && !stale ? h('div', { className: 'ws-mp-note' }, t('model.fetching'))
              : !stale && state.error ? h('div', { className: 'ws-mp-note ma-error' }, t('model.fail', { error: state.error }))
                : stale ? h('div', { className: 'ws-mp-note' }, t('model.fetching'))
                  : models.length === 0 ? h('div', { className: 'ws-mp-note' }, emptyHint ?? t('model.okEmpty'))
                    : [
                      value ? h('button', { key: '__clear', type: 'button', className: 'ws-mp-item ws-mp-clear', onClick: () => { onChange(''); setOpen(false) } }, t('model.clearChoice')) : null,
                      ...matches.map((name) => h('button', {
                        key: name, type: 'button', role: 'option', 'aria-selected': name === value ? 'true' : 'false',
                        className: `ws-mp-item${name === value ? ' ws-on' : ''}`,
                        onClick: () => { onChange(name); setOpen(false) },
                      }, name)),
                      matches.length === 0 ? h('div', { key: '__none', className: 'ws-mp-note' }, t('model.noMatch')) : null,
                    ])
          : null)
    }

    const OPAQUE_REVIEW = new Set(['opaque', 'opaque-token', 'unreadable', 'zip-failed', 'over-limit', 'opaque-check'])

    // Token-level diff (Myers) between an original segment and its result.
    // Tokens: Latin/digit runs, single CJK characters, single other chars.
    function tokenize(text) {
      // A pseudonym (化名-9F3A2C) is one token, so it never half-matches
      // the original it replaced (北京协和医院 → 医院-5D3E02).
      return String(text).match(/(?:化名|医生|证件|电话|邮箱|地址|病历|住院|就诊|社保|银行卡|医院|标识)-[0-9A-F]{6,}|[A-Za-z0-9]+|[\s\S]/g) ?? []
    }
    function diffTexts(before, after) {
      const a = tokenize(before)
      const b = tokenize(after)
      let start = 0
      while (start < a.length && start < b.length && a[start] === b[start]) start += 1
      let endA = a.length
      let endB = b.length
      while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1 }
      const ops = []
      const push = (t, s) => { if (!s) return; const last = ops[ops.length - 1]; if (last && last.t === t) last.s += s; else ops.push({ t, s }) }
      push('eq', a.slice(0, start).join(''))
      const ma = a.slice(start, endA)
      const mb = b.slice(start, endB)
      const n = ma.length
      const m = mb.length
      const max = n + m
      if (max > 0) {
        const off = max + 1
        let v = new Int32Array(2 * max + 3)
        const trace = []
        let found = -1
        for (let d = 0; d <= max && d <= 1500; d += 1) {
          trace.push(v.slice())
          for (let k = -d; k <= d; k += 2) {
            let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1
            let y = x - k
            while (x < n && y < m && ma[x] === mb[y]) { x += 1; y += 1 }
            v[off + k] = x
            if (x >= n && y >= m) { found = d; break }
          }
          if (found >= 0) break
        }
        if (found < 0) {
          push('del', ma.join('')); push('ins', mb.join(''))
        } else {
          const middle = []
          let x = n
          let y = m
          for (let d = found; d > 0; d -= 1) {
            const vv = trace[d]
            const k = x - y
            const prevK = (k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1])) ? k + 1 : k - 1
            const prevX = vv[off + prevK]
            const prevY = prevX - prevK
            while (x > prevX && y > prevY) { middle.push({ t: 'eq', s: ma[x - 1] }); x -= 1; y -= 1 }
            if (x === prevX) middle.push({ t: 'ins', s: mb[y - 1] })
            else middle.push({ t: 'del', s: ma[x - 1] })
            x = prevX
            y = prevY
          }
          while (x > 0 && y > 0) { middle.push({ t: 'eq', s: ma[x - 1] }); x -= 1; y -= 1 }
          for (const op of middle.reverse()) push(op.t, op.s)
        }
      }
      push('eq', a.slice(endA).join(''))
      return ops
    }
    // Wrap occurrences of flagged texts inside plain runs of a rendered side.
    function markFlags(text, flags, keyBase) {
      if (!flags.length || !text) return text
      const out = []
      let rest = text
      let index = 0
      while (rest) {
        let hit = null
        for (const flag of flags) {
          const at = rest.indexOf(flag)
          if (at >= 0 && (!hit || at < hit.at)) hit = { at, flag }
        }
        if (!hit) { out.push(rest); break }
        if (hit.at > 0) out.push(rest.slice(0, hit.at))
        out.push(h('mark', { key: `${keyBase}f${index}`, className: 'ws-cmp-flag' }, hit.flag))
        rest = rest.slice(hit.at + hit.flag.length)
        index += 1
      }
      return out
    }

    // Spot-check aid: besides review flags, mark long digit runs (IDs, phone
    // numbers, record numbers) that remain in the result. Pseudonyms are skipped.
    const SUSPECT = /(?<![0-9A-F-])0\d{2,3}-\d{7,8}(?!\d)|(?<![0-9A-F-])\d{7,}(?:[Xx](?![A-Za-z0-9]))?|1[3-9]\d{9}/g
    function markSuspects(text, flags, keyBase) {
      const out = []
      const parts = flags.length ? markFlags(text, flags, keyBase) : [text]
      ;(Array.isArray(parts) ? parts : [parts]).forEach((part, index) => {
        if (typeof part !== 'string') { out.push(part); return }
        let last = 0
        let match
        SUSPECT.lastIndex = 0
        while ((match = SUSPECT.exec(part))) {
          // Dates and timestamps (20240312, 20240312083000) are not identifiers.
          if (/^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?:[01]\d|2[0-3])?(?:[0-5]\d){0,2}(?:\d{3})?$/.test(match[0])) continue
          if (match.index > last) out.push(part.slice(last, match.index))
          out.push(h('mark', { key: `${keyBase}d${index}-${match.index}`, className: 'ws-cmp-suspect', title: services.t('ws.cmp.suspectHint') }, match[0]))
          last = match.index + match[0].length
        }
        if (last < part.length) out.push(part.slice(last))
      })
      return out
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
      const [pickedInputs, setPickedInputs] = React.useState([])
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
      // File queue: on first view of a batch, a running one opens at the top
      // and a finished one at the bottom; after that the user scrolls freely.
      // A batch that finishes while being watched counts as a new view.
      const piecesRef = React.useRef(null)
      const piecesKey = React.useRef(null)
      React.useLayoutEffect(() => {
        const node = piecesRef.current
        if (!node || !current || detail?.id !== current.id) return
        const key = `${current.id}:${running ? 'running' : 'done'}`
        if (piecesKey.current === key) return
        piecesKey.current = key
        node.scrollTop = running ? 0 : node.scrollHeight
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
        piecesKey.current = null
        setSelectedId(id)
        setDetail(null)
        setReportText('')
        reportLoaded.current.delete(id)
      }

      // Several picks of one folder become a list; one pick fills the field.
      function applyPicked(paths) {
        if (!paths?.length) return
        if (paths.length === 1) { setPickedInputs([]); setInputDir(paths[0]) } else { setPickedInputs(paths); setInputDir('') }
      }

      async function browse() {
        setError('')
        try {
          // Native macOS chooser with multi-select; elsewhere the Harness picker.
          applyPicked((await call('pickFolders')).paths)
        } catch (cause) {
          try {
            const uiWorkspace = services.ctx.get('uiWorkspace')
            if (!uiWorkspace?.pickDirectory) throw cause
            const picked = await uiWorkspace.pickDirectory()
            if (picked) applyPicked([picked])
          } catch (fallback) {
            setError(message(fallback))
          }
        }
      }

      async function browseFile() {
        setError('')
        try {
          const picked = await call('pickFile')
          applyPicked(picked?.paths ?? (picked?.path ? [picked.path] : []))
        } catch (cause) {
          setError(message(cause))
        }
      }

      async function start() {
        setError('')
        setNotice('')
        if (!inputDir.trim() && pickedInputs.length === 0) {
          setError(t('form.inputRequired'))
          return
        }
        setBusy(true)
        try {
          // Parameters shown in A1 apply to this batch, saved as defaults or not.
          const batchParams = draft ? {
            maxRounds: draft.maxRounds,
            concurrency: draft.concurrency,
            maxFiles: draft.maxFiles,
            timeoutMs: Math.round(Number(draft.timeoutSec) * 1000),
            temperature: draft.temperature,
            disableThinking: draft.disableThinking,
            quasiIdentifiers: draft.quasiIdentifiers,
          } : {}
          const result = await call('start', pickedInputs.length > 0
            ? { ...batchParams, inputs: pickedInputs, outputRoot: outputRoot.trim() }
            : { ...batchParams, inputDir: inputDir.trim(), outputRoot: outputRoot.trim() })
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

      async function resumeRun() {
        if (!current?.id) return
        setError('')
        setBusy(true)
        try {
          const result = await call('start', { resumeFrom: current.id })
          // Show what the resumed batch reads and where it writes, as for a new start.
          if (Array.isArray(result.inputs) && result.inputs.length > 1) { setPickedInputs(result.inputs); setInputDir('') }
          else if (result.inputDir) { setPickedInputs([]); setInputDir(result.inputDir) }
          if (result.outputRoot) setOutputRoot(result.outputRoot)
          reportLoaded.current.delete(result.runId)
          piecesKey.current = null
          setActiveRunId(result.runId)
          setSelectedId(result.runId)
          setDetail(null)
          setReportText('')
          await refreshRuns()
        } catch (cause) {
          setError(message(cause))
        } finally {
          setBusy(false)
        }
      }

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

      // Params block in A1: folded to a one-line summary; values apply to the
      // next batch directly, "设为默认" also saves them as defaults.
      // The editor opens as a floating panel over the history, so the
      // left column never grows; outside click or Esc closes it.
      const [paramsOpen, setParamsOpen] = React.useState(false)
      const paramsRef = React.useRef(null)
      const toggleParams = () => setParamsOpen((value) => !value)
      React.useEffect(() => {
        if (!paramsOpen) return undefined
        const onDown = (event) => { if (paramsRef.current && !paramsRef.current.contains(event.target)) setParamsOpen(false) }
        const onKey = (event) => { if (event.key === 'Escape') setParamsOpen(false) }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
      }, [paramsOpen])
      const runParams = running && current?.config ? {
        maxRounds: Number(current.config.maxRounds ?? draft?.maxRounds),
        concurrency: Number(current.config.concurrency ?? draft?.concurrency),
        maxFiles: Number(current.config.chunkSize ?? draft?.maxFiles),
        timeoutSec: current.config.timeoutMs ? Math.round(current.config.timeoutMs / 1000) : draft?.timeoutSec,
        temperature: Number(current.config.temperature ?? draft?.temperature ?? 0),
        disableThinking: current.config.disableThinking === true,
        quasiIdentifiers: current.config.policy?.quasiIdentifiers === true || current.config.policy?.quasiEnabled === true,
      } : null
      const paramsBlock = () => {
        if (!draft) return null
        const shown = runParams ?? draft
        const differs = (key) => !runParams && saved && draft[key] !== saved[key]
        const item = (key, text) => h('span', { key, className: differs(key) ? 'ws-psum-mod' : '' }, text)
        const summary = [
          item('maxRounds', t('ws.ps.rounds', { n: shown.maxRounds })),
          item('concurrency', t('ws.ps.concurrency', { n: shown.concurrency })),
          item('maxFiles', t('ws.ps.chunk', { n: shown.maxFiles })),
          item('timeoutSec', `${shown.timeoutSec}s`),
          item('temperature', t('ws.ps.temp', { n: Number(shown.temperature).toFixed(1) })),
          item('disableThinking', shown.disableThinking ? t('ws.ps.noThink') : t('ws.ps.think')),
          shown.quasiIdentifiers || differs('quasiIdentifiers') ? item('quasiIdentifiers', shown.quasiIdentifiers ? t('ws.ps.quasi') : t('ws.ps.noQuasi')) : null,
        ].filter(Boolean)
        return h('div', { className: `ws-params${paramsOpen && !running ? ' ws-params-open' : ''}`, ref: paramsRef, title: running ? '' : summary.map((node) => node.props.children).join(' · ') },
          h('button', { type: 'button', className: 'ws-params-head', onClick: toggleParams, disabled: running, 'aria-expanded': paramsOpen && !running ? 'true' : 'false', title: running ? t('ws.paramsLocked') : '' },
            h('span', { className: 'ws-params-title' }, t('ws.params'), changed.length && !running ? h('i', { className: 'ws-mod' }) : null),
            h('span', { className: 'ws-psum' }, summary.flatMap((node, index) => (index ? [h('i', { key: `d${index}` }, ' · '), node] : [node]))),
            running ? h('span', { className: 'ws-tag' }, t('ws.locked')) : h('span', { className: 'ws-fold-arrow' }, paramsOpen ? '▾' : '▸')),
          paramsOpen && !running ? h('div', { className: 'ws-params-body' },
            paramRow('maxRounds', t('run.rounds'), stepper('maxRounds', 1, 6)),
            paramRow('concurrency', t('ws.p.concurrency'), stepper('concurrency', 1, 16)),
            paramRow('maxFiles', t('ws.p.maxFiles'), stepper('maxFiles', 1, 2000, 50)),
            paramRow('timeoutSec', t('ws.p.timeout'), stepper('timeoutSec', 10, 1800, 10)),
            paramRow('temperature', t('ws.p.temperature'), h('div', { className: 'ws-slider' },
              h('input', { type: 'range', min: 0, max: 2, step: 0.1, value: draft.temperature, disabled: anyRunning, onChange: (event) => setParam('temperature', Number(event.target.value)) }),
              h('b', { className: 'ma-mono' }, Number(draft.temperature).toFixed(1)))),
            toggle('disableThinking', t('ws.p.noThinking')),
            toggle('quasiIdentifiers', t('ws.p.quasi')),
            h('div', { className: 'ma-actions ws-params-actions' },
              h('button', { className: 'ma-link ws-more', onClick: () => setModal('settings') }, `${t('ws.allSettings')} →`),
              h('span', { style: { flex: 1 } }),
              h('button', { className: 'ma-btn ma-small', disabled: changed.length === 0 || savingParams, onClick: () => { setDraft(saved); setParamNote(null) }, title: t('ws.paramsResetHint') }, t('ws.paramsReset')),
              h('button', { className: 'ma-btn ma-small', disabled: changed.length === 0 || savingParams || anyRunning, onClick: saveParams, title: t('ws.paramsDefaultHint') },
                savingParams ? t('save.saving') : t('ws.paramsDefault'))),
            h('p', { className: 'ma-hint' }, changed.length ? t('ws.paramsBatchOnly') : t('ws.paramsHint2')),
            paramNote ? h('p', { className: paramNote.ok ? 'ma-hint ma-ok' : 'ma-hint ma-error' }, paramNote.text) : null) : null)
      }

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
      // Manual review: items with context, fetched for a finished batch.
      const [reviewByRun, setReviewByRun] = React.useState({})
      const [reviewBusy, setReviewBusy] = React.useState(null)
      const [reviewNote, setReviewNote] = React.useState(null)
      const loadReview = React.useCallback(async (id) => {
        try {
          const value = await call('reviewItems', { runId: id })
          setReviewByRun((map) => ({ ...map, [id]: value }))
        } catch { setReviewByRun((map) => ({ ...map, [id]: null })) }
      }, [])
      React.useEffect(() => {
        if (!adviceRunId || reviewByRun[adviceRunId] !== undefined) return
        loadReview(adviceRunId)
      }, [adviceRunId, current?.status])
      const reviewData = adviceRunId ? reviewByRun[adviceRunId] : undefined
      const reviewOpen = (reviewData?.files ?? []).reduce((sum, file) => sum + file.items.filter((item) => !item.decision).length, 0)

      // Side-by-side comparison: file list per batch, one file's changes.
      const [compareByRun, setCompareByRun] = React.useState({})
      const [compareSel, setCompareSel] = React.useState(0)
      const [compareFilter, setCompareFilter] = React.useState('all')
      const [compareFiles, setCompareFiles] = React.useState({})
      const [compareShow, setCompareShow] = React.useState(300)
      const [compareRows, setCompareRows] = React.useState('all') // 'all' | 'changed'
      async function loadCompareList(id) {
        try {
          const value = await call('compareList', { runId: id })
          setCompareByRun((map) => ({ ...map, [id]: value?.files ?? null }))
        } catch { setCompareByRun((map) => ({ ...map, [id]: null })) }
      }
      async function loadCompareFile(id, n, force = false) {
        const key = `${id}:${n}`
        if (!force && compareFiles[key] !== undefined) return
        try {
          const value = await call('compareFile', { runId: id, n })
          setCompareFiles((map) => ({ ...map, [key]: value }))
        } catch (cause) { setCompareFiles((map) => ({ ...map, [key]: { error: message(cause) } })) }
      }
      function openCompare({ relPath = null, filter = null } = {}) {
        if (!adviceRunId) return
        setCompareFilter(filter ?? 'all')
        setCompareShow(300)
        const list = compareByRun[adviceRunId]
        if (relPath && Array.isArray(list)) {
          const hit = list.find((entry) => entry.relPath === relPath)
          if (hit) setCompareSel(hit.n)
        } else if (filter === 'review') {
          const open = (reviewData?.files ?? []).find((file) => file.items.some((item) => !item.decision))
          if (open) {
            const hit = Array.isArray(list) ? list.find((entry) => entry.relPath === open.relPath) : null
            setCompareSel(hit ? hit.n : `rv:${open.relPath}`)
          }
        }
        if (compareByRun[adviceRunId] === undefined) loadCompareList(adviceRunId)
        setModal('compare')
      }
      React.useEffect(() => {
        if (modal === 'compare' && adviceRunId && typeof compareSel === 'number') loadCompareFile(adviceRunId, compareSel)
      }, [modal, adviceRunId, compareSel])
      React.useEffect(() => {
        if (adviceRunId && compareByRun[adviceRunId] === undefined) loadCompareList(adviceRunId)
      }, [adviceRunId])

      async function decideReview(file, item, action) {
        setReviewBusy(item.id)
        setReviewNote(null)
        try {
          const result = await call('reviewDecide', { runId: adviceRunId, itemId: item.id, action })
          if (action === 'allow' && item.text && config && !anyRunning) {
            // Future batches no longer treat this value as an identifier.
            await saveAndReload({ allowValues: [...new Set([...(config.allowValues ?? []), item.text])] })
          }
          await loadReview(adviceRunId)
          if (action === 'replace' && Array.isArray(compareByRun[adviceRunId])) {
            const hit = compareByRun[adviceRunId].find((entry) => entry.relPath === file.relPath)
            if (hit) await loadCompareFile(adviceRunId, hit.n, true)
          }
          if (result.completed) {
            reportLoaded.current.delete(adviceRunId)
            setDetail(null)
            setReportText('')
            setReviewNote({ ok: true, text: t('ws.rv.allDone') })
            await refreshRuns()
          }
        } catch (cause) {
          setReviewNote({ ok: false, text: message(cause) })
        } finally {
          setReviewBusy(null)
        }
      }
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
          if (deleting.all) {
            const result = await call('clearRuns', { deliverable: deleting.deliverable })
            if (!activeRunId) { setSelectedId(null); setDetail(null); setReportText('') }
            setAdviceByRun({})
            if (result.failed?.length) {
              await refreshRuns()
              setDeleting((state) => state && { ...state, busy: false, error: t('ws.del.partial', { removed: result.removed, failed: result.failed.length, first: result.failed[0].error }) })
              return
            }
          } else {
            await call('deleteRun', { runId: deleting.run.id, deliverable: deleting.deliverable })
            if (selectedId === deleting.run.id || viewId === deleting.run.id) { setSelectedId(null); setDetail(null); setReportText('') }
            setAdviceByRun((map) => { const next = { ...map }; delete next[deleting.run.id]; return next })
          }
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

      // Model status dots in the monitor: checked when the page opens and
      // whenever the configured models change, not while a batch runs (its
      // requests show the endpoint works). Click a dot to check again.
      async function checkModels() {
        if (!config?.model) { setPing(null); return }
        const probe = async (request) => {
          try { return await call('ping', request) } catch (cause) { return { ok: false, error: message(cause) } }
        }
        setPing({ detect: { pending: true }, ...(config.verifyModel ? { verify: { pending: true } } : {}) })
        const [detect, verify] = await Promise.all([
          probe({}),
          config.verifyModel ? probe({ baseURL: config.verifyBaseURL || config.baseURL, model: config.verifyModel, keySource: 'verify' }) : null,
        ])
        setPing({ detect, ...(verify ? { verify } : {}) })
      }
      React.useEffect(() => {
        if (config && !running) checkModels()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [config?.model, config?.baseURL, config?.verifyModel, config?.verifyBaseURL])
      // C2 (model & resources) can be folded; remembered across visits.
      const [resCollapsed, setResCollapsed] = React.useState(() => {
        try { return window.localStorage.getItem('ma-ws-res-collapsed') === '1' } catch { return false }
      })
      const toggleRes = () => setResCollapsed((value) => {
        try { window.localStorage.setItem('ma-ws-res-collapsed', value ? '0' : '1') } catch { /* private mode */ }
        return !value
      })
      const modelDot = (state, name) => {
        if (!state) return null
        const ok = state.ok && (state.models ?? []).includes(name)
        const tone = state.pending ? 'wait' : ok ? 'ok' : 'bad'
        const title = state.pending ? t('model.testing')
          : ok ? `${t('ws.online')} · ${t('ws.dotRetry')}`
            : `${state.ok ? t('model.missing', { model: name }) : t('model.fail', { error: state.error })} · ${t('ws.dotRetry')}`
        return h('button', { type: 'button', className: `ws-dot ws-dot-${tone}`, title, 'aria-label': title, disabled: state.pending, onClick: checkModels })
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
      // Ring: progress by data volume, including in-flight files' estimated
      // share; batches from before 0.8.1 have no byte counts and use files.
      const plannedBytes = Number(current?.plannedBytes ?? 0)
      const inflightBytes = running ? inflight.reduce((sum, state) => sum + (Number(state.bytes) || 0) * Math.min(1, Number(state.fraction) || 0), 0) : 0
      // Finished batches: all of it; stopped / failed ones: what was done.
      const processedBytes = running ? Number(current?.doneBytes ?? 0) + inflightBytes
        : (current?.status === 'completed' || current?.status === 'review' ? plannedBytes : Number(current?.doneBytes ?? 0))
      const bytePercent = plannedBytes > 0
        ? (running ? Math.min(99, Math.floor((processedBytes / plannedBytes) * 100)) : (current?.status === 'completed' || current?.status === 'review' ? 100 : Math.round((Number(current?.doneBytes ?? 0) / plannedBytes) * 100)))
        : percent
      const fmtBytes = (bytes) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(0, Math.round(bytes / 1024))} KB`
      const startedMs = current?.startedAt ? Date.parse(current.startedAt) : 0
      const elapsed = running ? now - startedMs : Number(current?.durationMs ?? 0)
      const rate = elapsed > 0 ? (done / (elapsed / 60000)) : 0
      const counts = { clean: 0, review: 0, failed: 0, cancelled: 0 }
      for (const file of files) counts[file.status] = (counts[file.status] ?? 0) + 1
      // Station states. While files are still in the loop (识别 → 核验 →
      // 盲审 → 复判修正), the loop stations are never shown as done: a file
      // in 复判修正 goes back through 规则核验 and 盲审.
      const stationStates = Object.fromEntries(STATIONS.map((id) => [id, 'idle']))
      const stationNotes = {}
      const blindStats = totals.blind ?? null
      // A batch shows the verifier it ran with; with no batch, the configured one.
      const verifierName = current?.config ? String(current.config.verifyModel ?? '') : String(config?.verifyModel ?? '')
      const detectorName = current?.config?.model ?? config?.model ?? ''
      const withheld = current?.withheld === true
      if (current) {
        if (running) {
          const active = new Set(inflight.map(stationOf).filter(Boolean))
          const loopBusy = [...active].some((id) => LOOP_STATIONS.has(id))
          const lastActive = Math.max(-1, ...[...active].map((id) => STATIONS.indexOf(id)))
          STATIONS.forEach((id, index) => {
            if (active.has(id)) stationStates[id] = 'active'
            else if (index < lastActive && !(loopBusy && LOOP_STATIONS.has(id))) stationStates[id] = 'done'
            else if (loopBusy && LOOP_STATIONS.has(id) && index < lastActive) { stationStates[id] = 'idle'; stationNotes[id] = { load: t('ws.loopWait') } }
          })
          stationStates.review = 'idle'
          stationStates.deliver = 'idle'
        } else {
          for (const id of STATIONS) stationStates[id] = 'done'
          if (!(Number(current.config?.maxRounds ?? 1) > 1) || !files.some((file) => Number(file.rounds ?? 0) > 1)) {
            stationStates.repair = 'idle'
            stationNotes.repair = { load: t('ws.notNeeded') }
          }
          if (!current.config?.modelConfigured) {
            stationStates.blind = 'idle'
            stationNotes.blind = { load: t('ws.noModel') }
          }
          const ended = current.status === 'completed' || current.status === 'review'
          if (!ended) {
            for (const id of ['rescan', 'pack', 'review', 'deliver']) stationStates[id] = 'idle'
            stationNotes.deliver = { load: t('ws.notDelivered') }
          } else if (reviewOpen > 0 || withheld) {
            stationStates.review = 'warn'
            stationNotes.review = { load: t('ws.reviewHeld', { count: reviewOpen }), loadTone: 'bad' }
            stationStates.deliver = 'idle'
            stationNotes.deliver = { load: t('ws.awaitReview'), loadTone: 'warn' }
          } else {
            stationNotes.review = { load: current.humanReview ? t('ws.reviewed') : t('ws.reviewNone') }
            stationNotes.deliver = { load: current.output ? t('ws.delivered') : t('ws.notDelivered') }
            if (!current.output) stationStates.deliver = 'idle'
          }
        }
      }
      // 独立盲审: which model, and whether it is independent.
      if (detectorName || verifierName) {
        const sameAsDetector = Boolean(verifierName) && verifierName === detectorName
        stationNotes.blind = {
          ...(stationNotes.blind ?? {}),
          sub: !verifierName ? t('ws.blindShared') : sameAsDetector ? t('ws.blindSame') : verifierName,
          subTone: !verifierName || sameAsDetector ? 'warn' : '',
          title: !verifierName ? t('ws.blindSharedHint') : sameAsDetector ? t('ws.blindSameHint', { model: verifierName }) : t('ws.blindHint', { model: verifierName }),
        }
      }
      if (blindStats && (blindStats.reported || blindStats.confirmed || blindStats.dismissed) && !(running && stationStates.blind === 'active')) {
        stationNotes.blind = { ...(stationNotes.blind ?? {}), load: t('ws.blindStats', { confirmed: blindStats.confirmed ?? 0, dismissed: blindStats.dismissed ?? 0, disputed: blindStats.disputed ?? 0 }), loadTone: blindStats.disputed ? 'warn' : '' }
      }
      stationNotes.discover = { ...(stationNotes.discover ?? {}), title: detectorName ? t('ws.modelOf', { model: detectorName }) : undefined }
      stationNotes.repair = { ...(stationNotes.repair ?? {}), title: detectorName ? t('ws.modelOf', { model: detectorName }) : undefined }
      // Requests waiting for a model slot, per station.
      if (running && current?.stageRequests) {
        const waiting = { discover: 0, blind: 0, repair: 0 }
        for (const [stage, counts] of Object.entries(current.stageRequests)) {
          const id = stage === '识别·替换' ? 'discover' : stage === '盲审' ? 'blind' : stage === '复判修正' ? 'repair' : null
          if (id) waiting[id] += Number(counts?.queued ?? 0)
        }
        for (const [id, count] of Object.entries(waiting)) if (count > 0) stationNotes[id] = { ...(stationNotes[id] ?? {}), queue: count }
      }
      // Files in the loop by round, for the loop label.
      const roundCounts = new Map()
      for (const state of inflight) {
        if (!LOOP_STATIONS.has(stationOf(state))) continue
        const round = Math.max(1, Number(state.round ?? 1))
        roundCounts.set(round, (roundCounts.get(round) ?? 0) + 1)
      }
      const rounds = [...roundCounts].sort((a, b) => a[0] - b[0])
      const dicomCount = Number(totals.dicom ?? 0)
      const dicomActive = running && inflight.some((state) => stationOf(state) === 'dicom')
      const dicomBypass = {
        state: dicomActive ? 'active' : dicomCount ? 'done' : 'idle',
        label: dicomActive ? t('ws.dicomActive') : dicomCount ? t('ws.dicomDone', { count: dicomCount }) : t('ws.dicomIdle'),
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
      // ETA from data volume when known (file sizes vary a lot), else files.
      const etaMs = !running ? null
        : plannedBytes > 0 && processedBytes > 0 && elapsed > 5000
          ? ((plannedBytes - processedBytes) / (processedBytes / elapsed))
          : (done > 0 && recentRate > 0 ? (remaining / recentRate) * 60000 : null)
      const spark = () => {
        const W = 260
        const H = 44
        const has = finishedAt.length > 1
        const max = Math.max(1, ...series)
        const pts = has
          ? series.map((value, index) => `${((index + 0.5) / BINS) * W},${H - 3 - (value / max) * (H - 8)}`)
          : [`0,${H - 3}`, `${W},${H - 3}`]
        const avgY = H - 3 - (rate / max) * (H - 8)
        // Short labels that fit the narrow column; units and details in the tooltip.
        const peakRate = BINS > 1 && has ? Math.max(...series) : null
        const sparkTip = has ? t('ws.spark.tip', { avg: rate.toFixed(1), secs: rate > 0 ? (60 / rate).toFixed(1) : '—', peak: peakRate === null ? '—' : peakRate.toFixed(1) }) : ''
        return h('div', { className: 'ws-spark', title: sparkTip },
          h('div', { className: 'ws-spark-head' },
            h('span', {}, t('ws.spark.title')),
            h('b', { className: 'ma-mono', title: running ? t('ws.spark.nowHint') : '' }, has ? `${running ? `${t('ws.spark.nowShort')} ` : ''}${(running ? recentRate : rate).toFixed(1)}` : '—')),
          h('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' },
            [1, 2, 3].map((index) => h('path', { key: index, className: 'ws-spark-grid', d: `M0 ${(H / 4) * index}H${W}` })),
            has ? h('path', { className: 'ws-spark-area', d: `M0 ${H} L${pts.join(' L')} L${W} ${H} Z` }) : null,
            h('polyline', { className: 'ws-spark-line', points: pts.join(' ') }),
            has && rate > 0 ? h('path', { className: 'ws-spark-avg', d: `M0 ${avgY}H${W}` }) : null),
          has ? h('div', { className: 'ws-spark-foot' },
            h('span', {}, t('ws.spark.avgShort', { rate: rate.toFixed(1) })),
            peakRate !== null ? h('span', {}, t('ws.spark.peakShort', { rate: peakRate.toFixed(1) })) : null) : null)
      }

      // ── Render helpers ──
      const readout = (label, value, tone = '', title = '') => h('div', { className: `ws-readout${tone ? ` ws-tone-${tone}` : ''}`, title },
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

      const paramTips = { maxRounds: t('run.roundsHint'), concurrency: t('run.concurrencyTip') }
      const paramRow = (key, label, control) => h('div', { className: 'ws-param', title: paramTips[key] ?? '' },
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
              h('tbody', {}, rows.map((file) => h('tr', {
                key: file.relPath,
                className: adviceRunId && Array.isArray(compareByRun[adviceRunId]) && file.status !== 'running' ? 'ma-click' : '',
                title: adviceRunId && Array.isArray(compareByRun[adviceRunId]) ? t('ws.cmp.rowHint') : '',
                onClick: () => { if (adviceRunId && Array.isArray(compareByRun[adviceRunId]) && file.status !== 'running') openCompare({ relPath: file.relPath }) },
              },
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
          const failed = entries.filter((entry) => !['ok', 'timeout', 'cancelled', 'cached'].includes(entry.result)).length
          const replayed = entries.filter((entry) => entry.result === 'cached').length
          const tokens = entries.reduce((sum, entry) => sum + (entry.tokens || 0), 0)
          const callFit = fitSpeed(fitSums(entries))
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
          const rank = { cached: -1, ok: 0, cancelled: 1, 'bad-json': 2, timeout: 3 }
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
                className: `ws-bar-${bar.result === 'ok' ? 'ok' : (bar.result === 'cancelled' || bar.result === 'cached') ? 'cancel' : bar.result === 'timeout' ? 'timeout' : 'bad'}${bar.seq === callFocus ? ' ws-bar-focus' : ''}`,
                onClick: () => { followLog.current = false; setLogPinned(true); setCallFocus(bar.seq) },
              }, h('title', {}, `${hhmmss(new Date(bar.at))} · ${secs(bar.ms)} · ${t(`ws.calls.r.${bar.result}`)}`)))),
            h('div', { className: 'ws-strip-axis' }, h('span', {}, hhmmss(new Date(entries[0].at))), h('span', {}, `max ${secs(maxMs)}`), h('span', {}, hhmmss(new Date(entries[entries.length - 1].at)))))
          return h(React.Fragment, {},
            h('div', { className: 'ws-calls-top' },
            strip,
            h('div', { className: 'ws-calls-sum' },
              h('span', {}, t('ws.calls.count', { count: entries.length })),
              h('span', {}, `${t('ws.calls.avg')} ${secs(avg)}`),
              h('span', {}, `P95 ${secs(p95)}`),
              h('span', {}, `Token ${compact(tokens)}`),
              callFit.n > 0 ? h('span', { title: callFit.gen === null ? t('ws.m.fitFew', { n: callFit.n }) : t('ws.m.fitHint', { n: callFit.n }) }, t('ws.calls.fit', { gen: fmtSpeed(callFit.gen), prompt: fmtSpeed(callFit.prompt) })) : null,
              h('span', { className: timeouts ? 'ws-c-bad' : '' }, `${t('ws.calls.timeout')} ${timeouts}`),
              h('span', { className: failed ? 'ws-c-bad' : '' }, `${t('ws.calls.failed')} ${failed}`),
              replayed ? h('span', {}, `${t('ws.calls.r.cached')} ${replayed}`) : null,
              (() => { const retries = entries.reduce((sum, entry) => sum + Math.max(0, (entry.attempts ?? 1) - 1), 0); return retries ? h('span', { title: t('ws.calls.retrySumHint') }, `${t('ws.calls.retries')} ${retries}`) : null })(),
              (() => { const dropped = entries.reduce((sum, entry) => sum + (entry.dropped ?? 0), 0); return dropped ? h('span', { title: t('ws.calls.dropSumHint') }, `${t('ws.calls.dropped')} ${dropped}`) : null })(),
              entries.length > shown.length ? h('span', {}, t('ws.calls.latest', { count: shown.length })) : null)),
            h('table', { className: 'ma-table ws-table ws-calls' },
              h('thead', {}, h('tr', {},
                h('th', {}, t('runs.time')), h('th', {}, t('runs.file')), h('th', {}, t('ws.station')), h('th', {}, t('runs.rounds')),
                h('th', {}, t('ws.calls.segments')), h('th', {}, t('ws.calls.ms')), h('th', {}, 'Token'), h('th', {}, t('ws.calls.io')), h('th', {}, t('runs.status')))),
              h('tbody', {}, shown.map((entry) => h('tr', { key: entry.seq, id: `ws-call-${entry.seq}`, className: `${entry.ms > p95 * 1.5 && entry.ms > 5000 ? 'ws-slow' : ''}${entry.seq === callFocus ? ' ws-focus' : ''}` },
                h('td', { className: 'ma-mono' }, hhmmss(new Date(entry.at))),
                h('td', { className: 'ma-mono', title: entry.file }, entry.file),
                h('td', {}, entry.stage),
                h('td', {}, `R${entry.round}`),
                h('td', {}, String(entry.segments)),
                h('td', { className: 'ma-mono' }, secs(entry.ms)),
                h('td', { className: 'ma-mono' }, entry.tokens ? compact(entry.tokens) : '—'),
                h('td', { className: 'ma-mono' }, entry.out ? `${compact(entry.in || 0)} / ${entry.out}` : '—'),
                h('td', {}, h('span', { className: entry.result === 'ok' ? 'ma-chip ma-ok' : (entry.result === 'cancelled' || entry.result === 'cached') ? 'ma-chip' : 'ma-chip ma-bad' }, t(`ws.calls.r.${entry.result}`) === `ws.calls.r.${entry.result}` ? entry.result : t(`ws.calls.r.${entry.result}`,
                  entry.attempts > 1 ? h('i', { className: 'ws-call-mark', title: t('ws.calls.retryHint', { n: entry.attempts - 1 }) }, `↻${entry.attempts - 1}`) : null,
                  entry.dropped ? h('i', { className: 'ws-call-mark ws-call-drop', title: t('ws.calls.dropHint', { n: entry.dropped }) }, `−${entry.dropped}`) : null))))))))
        }
        if (drawer === 'advice') return advicePanel()
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

      async function bulkReview(action) {
        const ids = (reviewData?.files ?? []).flatMap((file) => file.items)
          .filter((item) => !item.decision && OPAQUE_REVIEW.has(item.code) && (action === 'accept' || item.code === 'opaque'))
          .map((item) => item.id)
        if (ids.length === 0) return
        setReviewBusy('bulk')
        setReviewNote(null)
        try {
          const result = await call('reviewBulk', { runId: adviceRunId, itemIds: ids, action })
          await loadReview(adviceRunId)
          setCompareFiles({})
          if (result.completed) {
            reportLoaded.current.delete(adviceRunId)
            setDetail(null)
            setReportText('')
            setReviewNote({ ok: true, text: t('ws.rv.allDone') })
            await refreshRuns()
          } else {
            setReviewNote({ ok: true, text: t('ws.rv.bulkDone', { count: result.decided }) })
          }
        } catch (cause) {
          setReviewNote({ ok: false, text: message(cause) })
        } finally {
          setReviewBusy(null)
        }
      }

      const reviewCard = (file, item) => h('div', { key: item.id, className: `ws-rv-item${item.decision ? ' ws-rv-done' : ''}` },
        h('div', { className: 'ws-rv-meta' },
          h('span', { className: 'ws-rv-code' }, t(`ws.rv.code.${item.code}`) === `ws.rv.code.${item.code}` ? item.code : t(`ws.rv.code.${item.code}`)),
          item.type ? h('b', {}, item.type) : null,
          item.field ? h('span', { className: 'ma-mono' }, item.field) : null),
        item.text
          ? h('div', { className: 'ws-rv-ctx' }, item.before, h('mark', {}, item.text), item.after)
          : h('div', { className: 'ws-rv-ctx ws-rv-plain' }, item.detail),
        item.decision
          ? h('div', { className: 'ws-rv-result' }, item.decision.action === 'replace'
            ? t('ws.rv.replaced', { to: item.decision.replacement, count: item.decision.count })
            : item.decision.action === 'remove' ? t('ws.rv.removed')
              : item.decision.action === 'allow' ? t('ws.rv.allowed') : t('ws.rv.accepted'))
          : OPAQUE_REVIEW.has(item.code)
            ? h('div', { className: 'ma-actions' },
              item.code === 'opaque'
                ? h('button', { className: 'ma-btn ma-small ma-primary', disabled: reviewBusy !== null || !file.editable, title: file.editable ? t('ws.rv.removeHint') : file.reason, onClick: () => decideReview(file, item, 'remove') }, reviewBusy === item.id ? t('save.saving') : t('ws.rv.remove'))
                : null,
              h('button', { className: 'ma-btn ma-small', disabled: reviewBusy !== null, title: t('ws.rv.keepHint'), onClick: () => decideReview(file, item, 'accept') }, t('ws.rv.keepOpaque')))
            : h('div', { className: 'ma-actions' },
            h('button', {
              className: 'ma-btn ma-small ma-primary', disabled: reviewBusy !== null || !file.editable || !item.text,
              title: !item.text ? t('ws.rv.noText') : file.editable ? '' : file.reason, onClick: () => decideReview(file, item, 'replace'),
            }, reviewBusy === item.id ? t('save.saving') : (item.replacement ? t('ws.rv.replaceWith', { to: item.replacement }) : t('ws.rv.replace'))),
            item.text ? h('button', { className: 'ma-btn ma-small', disabled: reviewBusy !== null || anyRunning, title: t('ws.rv.allowHint'), onClick: () => decideReview(file, item, 'allow') }, t('ws.rv.allow')) : null,
            h('button', { className: 'ma-btn ma-small', disabled: reviewBusy !== null, onClick: () => decideReview(file, item, 'accept') }, t('ws.rv.accept'))))

      const compareBody = () => {
        let list = adviceRunId ? compareByRun[adviceRunId] : undefined
        if (list === undefined) return h('p', { className: 'ma-empty' }, t('detail.loading'))
        if (!Array.isArray(list)) list = []
        if (list.length === 0 && !(reviewData?.files?.length)) return h('p', { className: 'ma-empty' }, t('ws.cmp.none'))
        const reviewByPath = new Map((reviewData?.files ?? []).map((file) => [file.relPath, file]))
        const openOf = (relPath) => (reviewByPath.get(relPath)?.items ?? []).filter((item) => !item.decision).length
        const listed = new Set(list.map((entry) => entry.relPath))
        const extra = (reviewData?.files ?? []).filter((file) => !listed.has(file.relPath))
          .map((file) => ({ n: `rv:${file.relPath}`, relPath: file.relPath, status: 'review', changed: 0, total: 0, reviewOnly: true }))
        list = [...extra, ...list]
        const shown = list.filter((entry) => compareFilter === 'all' ? true
          : compareFilter === 'changed' ? entry.changed > 0
            : reviewByPath.has(entry.relPath))
        const position = shown.findIndex((entry) => entry.n === compareSel)
        // The open file always belongs to the current filter.
        const selected = (position >= 0 ? shown[position] : shown[0]) ?? null
        if (selected && selected.n !== compareSel) Promise.resolve().then(() => setCompareSel(selected.n))
        const go = (step) => {
          if (shown.length === 0) return
          const next = shown[Math.min(shown.length - 1, Math.max(0, (position < 0 ? 0 : position) + step))]
          setCompareSel(next.n)
          setCompareShow(300)
        }
        const data = selected ? compareFiles[`${adviceRunId}:${selected.n}`] : undefined
        const reviewFile = selected ? reviewByPath.get(selected.relPath) : null
        const flags = (reviewFile?.items ?? []).filter((item) => !item.decision && item.text).map((item) => item.text)
        const dir = (path) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
        const name = (path) => path.slice(path.lastIndexOf('/') + 1)
        const pane = () => {
          if (!selected) return h('p', { className: 'ma-empty' }, t('ws.cmp.pick'))
          if (selected.reviewOnly) {
            return reviewFile
              ? h('div', { className: 'ws-cmp-review' }, reviewFile.items.map((item) => reviewCard(reviewFile, item)))
              : h('p', { className: 'ma-empty' }, t('ws.cmp.pick'))
          }
          if (selected.skipped) return h('p', { className: 'ma-empty' }, t(`ws.cmp.skipped.${selected.skipped}`))
          if (data === undefined) return h('p', { className: 'ma-empty' }, t('detail.loading'))
          if (data.error) return h('p', { className: 'ma-hint ma-error' }, data.error)
          const rows = data.changes ?? []
          const full = data.all === true
          const visible = compareRows === 'changed' ? rows.filter((row) => !row.same || row.flagged) : rows
          return h(React.Fragment, {},
            reviewFile ? h('div', { className: 'ws-cmp-review' }, reviewFile.items.map((item) => reviewCard(reviewFile, item))) : null,
            h('div', { className: 'ws-cmp-rowbar' },
              h('span', { className: 'ma-hint' }, full ? t('ws.cmp.legend') : t('ws.cmp.legacy'))),
            visible.length === 0
              ? h('p', { className: 'ma-empty' }, rows.length === 0 ? t('ws.cmp.empty') : t('ws.cmp.nochange'))
              : h('table', { className: 'ws-cmp-table' },
                h('thead', {}, h('tr', {}, h('th', {}, t('ws.cmp.field')), h('th', {}, t('ws.cmp.before')), h('th', {}, t('ws.cmp.after')))),
                h('tbody', {}, visible.slice(0, compareShow).map((change, row) => {
                  const after = change.same ? change.before : change.after
                  const flaggedRow = change.flagged && flags.some((flag) => after.includes(flag))
                  if (change.same) {
                    return h('tr', { key: change.id ?? row, className: `ws-cmp-same${flaggedRow ? ' ws-cmp-flagged' : ''}` },
                      h('td', { className: 'ws-cmp-field' }, change.field ?? '—'),
                      h('td', {}, change.before),
                      h('td', {}, markSuspects(after, flags, `s${row}`)))
                  }
                  const ops = diffTexts(change.before, after)
                  return h('tr', { key: change.id ?? row, className: flaggedRow ? 'ws-cmp-flagged' : '' },
                    h('td', { className: 'ws-cmp-field' }, change.field ?? '—'),
                    h('td', {}, ops.filter((op) => op.t !== 'ins').map((op, i) => op.t === 'del' ? h('del', { key: i }, op.s) : h(React.Fragment, { key: i }, op.s))),
                    h('td', {}, ops.filter((op) => op.t !== 'del').map((op, i) => op.t === 'ins' ? h('ins', { key: i }, op.s) : h(React.Fragment, { key: i }, markSuspects(op.s, flags, `${row}-${i}`)))))
                }))),
            visible.length > compareShow ? h('button', { className: 'ma-btn ma-small ws-cmp-more', onClick: () => setCompareShow(compareShow + 300) }, t('ws.cmp.more', { shown: compareShow, total: visible.length })) : null,
            selected.truncated ? h('p', { className: 'ma-hint' }, t('ws.cmp.truncated', { shown: selected.truncated, total: selected.total })) : null)
        }
        return h('div', { className: 'ws-cmp', tabIndex: 0, onKeyDown: (event) => {
          if (event.target.tagName === 'INPUT') return
          if (event.key === 'ArrowDown' || event.key === 'j') { event.preventDefault(); go(1) }
          if (event.key === 'ArrowUp' || event.key === 'k') { event.preventDefault(); go(-1) }
        } },
          h('aside', { className: 'ws-cmp-side' },
            (() => {
              const pending = (reviewData?.files ?? []).flatMap((file) => file.items).filter((item) => !item.decision && OPAQUE_REVIEW.has(item.code))
              if (pending.length === 0) return null
              const removable = pending.filter((item) => item.code === 'opaque').length
              return h('div', { className: 'ws-cmp-bulk' },
                h('span', {}, t('ws.rv.bulkTitle', { count: pending.length })),
                h('div', { className: 'ma-actions' },
                  removable ? h('button', { className: 'ma-btn ma-small ma-primary', disabled: reviewBusy !== null, onClick: () => bulkReview('remove') }, reviewBusy === 'bulk' ? t('save.saving') : t('ws.rv.bulkRemove', { count: removable })) : null,
                  h('button', { className: 'ma-btn ma-small', disabled: reviewBusy !== null, onClick: () => bulkReview('accept') }, t('ws.rv.bulkKeep'))))
            })(),
            h('div', { className: 'ws-cmp-filters' }, ['all', 'changed', 'review'].map((id) => h('button', {
              key: id, type: 'button', className: `ws-cmp-filter${compareFilter === id ? ' ws-on' : ''}`, onClick: () => setCompareFilter(id),
            }, t(`ws.cmp.f.${id}`), h('i', {}, String(id === 'all' ? list.length : id === 'changed' ? list.filter((entry) => entry.changed > 0).length : list.filter((entry) => reviewByPath.has(entry.relPath)).length))))),
            h('div', { className: 'ws-cmp-list' }, shown.map((entry) => {
              const open = openOf(entry.relPath)
              return h('button', {
                key: entry.n, type: 'button', className: `ws-cmp-item${entry.n === selected?.n ? ' ws-on' : ''}`, title: entry.relPath,
                onClick: () => { setCompareSel(entry.n); setCompareShow(300) },
              },
                h('span', { className: `ws-cmp-dot ws-p-${open > 0 ? 'review' : entry.status}` }),
                h('span', { className: 'ws-cmp-name' }, h('b', {}, name(entry.relPath)), dir(entry.relPath) ? h('small', {}, dir(entry.relPath)) : null),
                open > 0 ? h('span', { className: 'ws-count ws-count-bad' }, String(open)) : h('span', { className: 'ma-mono ws-cmp-n' }, String(entry.changed)))
            }))),
          h('section', { className: 'ws-cmp-main' },
            h('div', { className: 'ws-cmp-bar' },
              h('span', { className: 'ma-mono ws-cmp-path', title: selected?.relPath ?? '' }, selected?.relPath ?? ''),
              selected ? h('span', { className: 'ma-hint' }, t('ws.cmp.stats', { changed: selected.changed, total: selected.total })) : null,
              // Stays in the fixed bar, so it is reachable however far the table is scrolled.
              h('label', { className: 'ma-check ws-cmp-only', title: t('ws.cmp.onlyHint') },
                h('input', { type: 'checkbox', checked: compareRows === 'changed', onChange: (event) => { setCompareRows(event.target.checked ? 'changed' : 'all'); setCompareShow(300) } }),
                t('ws.cmp.only')),
              h('span', { className: 'ma-mono' }, shown.length ? `${position < 0 ? '—' : position + 1} / ${shown.length}` : ''),
              h('button', { className: 'ma-btn ma-small', disabled: position <= 0, onClick: () => go(-1) }, `↑ ${t('ws.cmp.prev')}`),
              h('button', { className: 'ma-btn ma-small', disabled: position < 0 || position >= shown.length - 1, onClick: () => go(1) }, `↓ ${t('ws.cmp.next')}`)),
            reviewNote ? h('p', { className: reviewNote.ok ? 'ma-hint ma-ok' : 'ma-hint ma-error' }, reviewNote.text) : null,
            h('div', { className: 'ws-cmp-pane' }, pane())))
      }

      // C3: blind review findings and how the detector re-judged them.
      const [crossCollapsed, setCrossCollapsed] = React.useState(() => {
        try { return window.localStorage.getItem('ma-ws-cross-collapsed') === '1' } catch { return false }
      })
      const toggleCross = () => setCrossCollapsed((value) => {
        try { window.localStorage.setItem('ma-ws-cross-collapsed', value ? '0' : '1') } catch { /* private mode */ }
        return !value
      })
      const crossCheckPanel = () => {
        const blind = current?.totals?.blind ?? null
        const verifierName = current?.config ? String(current.config.verifyModel ?? '') : String(config?.verifyModel ?? '')
        const parts = [
          ['confirmed', Number(blind?.confirmed ?? 0)],
          ['dismissed', Number(blind?.dismissed ?? 0)],
          ['disputed', Number(blind?.disputed ?? 0)],
          ['unjudged', Number(blind?.unjudged ?? 0)],
        ]
        const reported = Number(blind?.reported ?? 0)
        const judged = parts[0][1] + parts[1][1] + parts[2][1]
        // Human verdicts on verifier findings (disputed / not re-judged), live.
        const judgedItems = (reviewData?.files ?? []).flatMap((file) => file.items).filter((item) => item.code === 'disputed' || item.code === 'model-residual')
        const verifierRight = judgedItems.filter((item) => item.decision?.action === 'replace').length
        const detectorRight = judgedItems.filter((item) => item.decision && item.decision.action !== 'replace' && item.decision.action !== 'remove').length
        const waiting = judgedItems.filter((item) => !item.decision).length
        return h('section', { className: `ws-panel ws-cross${crossCollapsed ? ' ws-collapsed' : ''}` },
          h('div', { className: 'ws-panel-head' },
            h('button', { type: 'button', className: 'ws-fold', onClick: toggleCross, 'aria-expanded': crossCollapsed ? 'false' : 'true', title: crossCollapsed ? t('ws.expand') : t('ws.collapse') },
              h('h3', { 'data-code': 'C3' }, t('ws.x.title')),
              h('span', { className: 'ws-fold-arrow' }, crossCollapsed ? '▸' : '▾')),
            crossCollapsed && judged > 0 ? h('span', { className: 'ma-mono ws-res-mini' }, t('ws.x.agreeShort', { pct: Math.round((parts[0][1] / judged) * 100) })) : null),
          // Always the full layout: values are "—" / 0 until a batch has data.
          crossCollapsed ? null : h(React.Fragment, {},
            h('div', { className: 'ws-x-line', title: t('ws.x.reportedHint') },
              h('span', {}, t('ws.x.reported')), h('b', {}, blind ? String(reported) : '—'),
              h('span', { className: 'ws-x-sub' }, blind ? t('ws.x.calls', { flagged: blind.flaggedCalls ?? 0, calls: blind.calls ?? 0 }) : (running ? t('ws.x.waiting') : ''))),
            h('div', { className: 'ws-splitbox', title: t('ws.x.splitHint') },
              h('div', { className: 'ws-split' }, reported > 0 ? parts.filter(([, value]) => value > 0).map(([kind, value]) => h('i', { key: kind, className: `ws-x-${kind}`, style: { flexGrow: value } })) : null),
              h('div', { className: 'ws-split-legend' }, parts.map(([kind, value]) => h('span', { key: kind }, h('i', { className: `ws-x-${kind}` }), `${t(`ws.x.${kind}`)} ${blind ? value : '—'}`)))),
            h('div', { className: 'ws-x-line', title: t('ws.x.agreeHint') },
              h('span', {}, t('ws.x.agree')), h('b', {}, judged > 0 ? `${Math.round((parts[0][1] / judged) * 100)}%` : '—'),
              h('span', { className: 'ws-x-sub' }, t('ws.x.disputeRate', { pct: reported ? Math.round((parts[2][1] / reported) * 100) : '—' }))),
            h('div', { className: 'ws-x-line', title: t('ws.x.humanHint') },
              h('span', {}, t('ws.x.human')),
              h('b', {}, judgedItems.length ? t('ws.x.humanVal', { v: verifierRight, d: detectorRight }) : '—'),
              waiting ? h('button', { type: 'button', className: 'ma-link ws-x-sub', onClick: () => openCompare({ filter: 'review' }) }, t('ws.x.pending', { n: waiting })) : null),
            !verifierName ? h('p', { className: 'ma-hint ws-warn-line' }, t('ws.x.shared')) : null))
      }

      const adviceCount = (() => {
        const advice = adviceRunId ? adviceByRun[adviceRunId] : undefined
        if (!advice) return 0
        return (advice.findings?.length ?? 0) + (advice.suggestions ?? []).filter((item) => !dismissed[`${adviceRunId}:${item.id}`] && !isApplied(item)).length
      })()
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
        if (open.length > 0) body.push(h('h4', { key: 'ph', className: 'ws-adv-sec' }, t('ws.adv.paramsTitle')))
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
          // Plugin capability gaps come first: what the plugin itself should
          // learn to handle, beyond parameter changes.
          body.unshift(h('div', { key: 'draft', className: 'ws-adv ws-adv-draft' },
            h('div', { className: 'ws-adv-title' }, h('span', { className: 'ws-adv-flag' }, t('ws.adv.plugin')), h('b', {}, t('ws.adv.draftTitle', { count: advice.findings.length }))),
            h('ul', { className: 'ws-adv-findings' }, advice.findings.map((finding, index) => h('li', { key: index },
              h('b', {}, finding.area), h('span', {}, finding.detail), h('i', {}, finding.hint)))),
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
        void pending
        return h('div', { className: 'ws-adv-body' }, ...body)
      }

      return h('div', { className: 'ma-page ws-page', ref: rootRef },
        h('style', { key: 'ma-style' }, CSS + WS_CSS),
        // ── Header bar ──
        h('header', { className: 'ws-head' },
          h('button', { type: 'button', className: 'ws-brand', onClick: () => setModal('help'), title: t('ws.helpHint') },
            h('span', { className: 'ws-brand-mark' }, h(AnonymizerIcon, { size: 18 })),
            h('div', {},
              h('h2', {}, t('ws.title'), h('span', { className: 'ws-brand-info', 'aria-hidden': 'true' }, 'i')),
              h('span', {}, t('ws.subtitle'), config?.version ? h('em', { className: 'ws-version' }, `v${config.version}`) : null))),
          h('div', { className: `ws-status ws-s-${lineStatus}` },
            h('span', { className: 'ws-lamp' }),
            h('div', {},
              h('b', {}, lineStatus === 'idle' ? t('ws.idle') : t(`status.${lineStatus}`)),
              h('span', { className: 'ma-mono' }, current?.id ?? '—'),
              current?.resumedFrom
                ? h('span', { className: 'ws-run-resume', title: current.resumedFrom }, t('ws.resumedFrom', { id: current.resumedFrom.slice(-6) }))
                : (current?.source ? sourceLabel(current.source) : null))),
          // Heap of the plugin process: a global safety readout, always visible.
          current?.memory?.heapLimit ? (() => {
            const m = current.memory
            const used = running ? m.heapUsed : m.peakHeap
            const ratio = m.peakHeap / m.heapLimit
            const tone = ratio >= 0.85 ? ' ws-heap-bad' : ratio >= 0.7 ? ' ws-heap-warn' : ''
            return h('div', { className: `ws-clock ws-heap${tone}`, title: `${t('ws.m.mem', { now: (used / 1024 ** 3).toFixed(1), peak: (m.peakHeap / 1024 ** 3).toFixed(1), limit: (m.heapLimit / 1024 ** 3).toFixed(1), pct: Math.round(ratio * 100) })}\n${t('ws.m.memHint')}` },
              h('span', {}, running ? t('ws.m.memory') : t('ws.m.memoryPeak')),
              h('b', {}, `${(used / 1024 ** 3).toFixed(1)}`, h('small', {}, ` / ${(m.heapLimit / 1024 ** 3).toFixed(1)} GB`)),
              h('i', { className: 'ws-membar', 'aria-hidden': 'true' },
                h('i', { className: 'ws-membar-fill', style: { width: `${Math.min(100, (used / m.heapLimit) * 100)}%` } }),
                ratio * 100 > (used / m.heapLimit) * 100 ? h('i', { className: 'ws-membar-peak', style: { left: `${Math.min(100, ratio * 100)}%` } }) : null))
          })() : null,
          h('div', { className: 'ws-clock' }, h('span', {}, t('ws.m.elapsed')), h('b', {}, clock(elapsed))),
          running
            ? null
            : h('div', { className: 'ws-clock' }, h('span', {}, t('ws.m.progress')), h('b', {}, `${done}/${planned || '—'}`)),
          h('div', { className: 'ws-head-actions' },
            running
              ? h('button', { className: 'ma-btn ws-stop', onClick: cancelRun, disabled: cancelling }, cancelling ? t('run.cancelling') : t('ws.stop'))
              : (current?.resumable && !anyRunning
                ? h('button', { className: 'ma-btn ws-resume', onClick: resumeRun, disabled: busy, title: t('ws.resumeHint') }, busy ? t('form.starting') : `▶ ${t('ws.resume')}`)
                : null))),
        error ? h('div', { className: 'ma-banner' }, `${t('error.title')}: ${error}`, h('button', { className: 'ma-link', style: { marginLeft: 8 }, onClick: () => setError('') }, '×')) : null,

        h('div', { className: 'ws-grid' },
          // ── Left: feed + history ──
          h('aside', { className: 'ws-col' },
            h('section', { className: 'ws-panel' },
              h('div', { className: 'ws-panel-head' }, h('h3', { 'data-code': 'A1' }, t('ws.feedParams')), h('span', { className: 'ws-tag' }, 'INPUT')),
              h('label', { className: 'ma-field' }, t('form.input'),
                h('div', { className: 'ma-inline' },
                  pickedInputs.length > 0
                    ? h('div', { className: 'ws-picked', title: pickedInputs.join('\n') },
                      h('div', { className: 'ws-picked-head' },
                        h('b', {}, t('ws.picked', { count: pickedInputs.length })),
                        h('span', { className: 'ma-mono' }, baseName(pickedInputs[0].replace(/\/[^/]+$/, ''))),
                        h('button', { type: 'button', className: 'ma-link', onClick: () => setPickedInputs([]) }, t('ws.pickedClear'))),
                      h('div', { className: 'ws-picked-list' }, pickedInputs.map((path) => h('span', { key: path, className: 'ws-picked-item' },
                        baseName(path),
                        h('button', { type: 'button', 'aria-label': t('ws.pickedRemove'), onClick: () => { const next = pickedInputs.filter((item) => item !== path); applyPicked(next.length ? next : []); if (!next.length) setPickedInputs([]) } }, '×')))))
                    : h('input', { className: 'ma-input', value: inputDir, onChange: (event) => setInputDir(event.target.value), placeholder: t('form.inputPlaceholder'), title: inputDir })),
                h('div', { className: 'ws-pick' },
                  h('button', { className: 'ma-btn ma-small', onClick: browse }, t('ws.pickDir')),
                  h('button', { className: 'ma-btn ma-small', onClick: browseFile }, t('ws.pickFile')))),
              h('label', { className: 'ma-field' }, t('form.output'),
                h('input', { className: 'ma-input', value: outputRoot, onChange: (event) => setOutputRoot(event.target.value), placeholder: t('run.outputDefault') })),
              paramsBlock(),
              h('button', { className: 'ma-btn ma-primary ws-start', onClick: start, disabled: busy || anyRunning },
                busy ? t('form.starting') : (anyRunning ? t('ws.lineBusy') : `▶ ${t('form.start')}`)),
              notice ? h('span', { className: 'ma-hint ma-ok' }, notice) : null),
            h('section', { className: 'ws-panel ws-grow' },
              h('div', { className: 'ws-panel-head' },
                h('h3', { 'data-code': 'A2' }, t('runs.title')),
                runs.some((run) => run.status !== 'running')
                  ? h('button', { className: 'ma-btn ma-small ws-clear', onClick: () => setDeleting({ all: true, deliverable: false, busy: false, error: '' }) }, t('ws.del.clear'))
                  : null,
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
                    h('span', { className: 'ws-run-name', title: run.selection?.length ? run.selection.join('\n') : (run.inputDir ?? '') }, run.selection?.length > 1 ? t('ws.pickedName', { first: run.selection[0], count: run.selection.length }) : (baseName(run.inputDir) || run.id)),
                    h('span', { className: statusClass(run.status) }, t(`status.${run.status}`)),
                    run.status !== 'running'
                      ? h('button', {
                        type: 'button', className: 'ws-run-del', title: t('ws.del.title'), 'aria-label': t('ws.del.title'),
                        onClick: (event) => { event.stopPropagation(); setDeleting({ run, deliverable: false, busy: false, error: '' }) },
                      }, '✕')
                      : null),
                  h('div', { className: 'ws-run-meta' },
                    h('span', {}, `${formatTime(run.startedAt)}${run.source ? ` · ${t(`ws.src.${run.source.kind}`)}` : ''}`),
                    run.resumedFrom ? h('span', { className: 'ws-run-resume', title: run.resumedFrom }, t('ws.resumedFrom', { id: run.resumedFrom.slice(-6) })) : null,
                    run.resumedBy ? h('span', { className: 'ws-run-resume', title: run.resumedBy }, t('ws.resumedBy', { id: run.resumedBy.slice(-6) })) : null,
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
              h(LineSchematic, {
                load, states: stationStates, notes: stationNotes, running, inflight, rounds, dicom: dicomBypass, t,
                maxRounds: Number(current?.config?.maxRounds ?? config?.maxRounds ?? 3),
                onStation: {
                  ...(stationStates.review === 'warn' && adviceRunId ? { review: () => openCompare({ filter: 'review' }), deliver: () => openCompare({ filter: 'review' }) } : {}),
                  ...((!verifierName || verifierName === detectorName) && !anyRunning ? { blind: () => setModal('settings') } : {}),
                },
              }),
              h('div', { className: 'ws-conveyor-head' },
                h('span', {}, t('ws.conveyor')),
                h('span', { className: 'ma-mono' }, t('ws.queueCount', { done, total: planned || '—' }))),
              h('div', { className: 'ws-bar' }, h('div', { className: 'ws-bar-fill', style: { width: `${percent}%` } })),
              h('div', { className: 'ws-pieces', ref: piecesRef }, workpieces())),
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
                h('div', { className: 'ws-panel-head' }, h('h3', { 'data-code': 'B3' }, t('ws.quality')),
                  adviceRunId && (reviewOpen > 0 || Array.isArray(compareByRun[adviceRunId]))
                    ? h('button', { className: `ma-link ws-more${reviewOpen > 0 ? ' ws-more-hot' : ''}`, onClick: () => openCompare({ filter: reviewOpen > 0 ? 'review' : null }) },
                      `${reviewOpen > 0 ? t('ws.cmp.openReview', { count: reviewOpen }) : t('ws.cmp.open')} →`)
                    : null,
                  h('span', { className: 'ma-mono' }, `${done}`)),
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
                current?.withheld
                  ? h('div', { className: 'ws-path' },
                    h('span', { className: 'ws-path-tag ws-path-warn' }, t('ws.withheldTag')),
                    h('span', { className: 'ma-hint' }, t('ws.withheld')))
                  : null,
                !current?.withheld && (current?.output || current?.runDir)
                  ? h('div', { className: 'ws-path' },
                    h('span', { className: 'ws-path-tag' }, current.output ? t('ws.result') : t('ws.records')),
                    h('span', { className: 'ma-mono', title: current.output ?? current.runDir }, current.output ?? current.runDir),
                    h('button', { className: 'ma-btn ma-small', onClick: copyPath }, copied ? t('detail.copied') : t('detail.copy')))
                  : null)),
            h('section', { className: 'ws-panel ws-drawer' },
              h('div', { className: 'ma-tabs', role: 'tablist' }, ['parts', 'log', 'calls', 'warn', 'advice', 'report'].map((id) => h('button', {
                key: id, type: 'button', role: 'tab', className: 'ma-tab',
                'aria-selected': drawer === id ? 'true' : 'false',
                onClick: () => {
                  // Opening the log starts at the latest line.
                  if (id === 'log' || id === 'calls') { followLog.current = true; setLogPinned(false) }
                  setDrawer(id)
                },
              }, t(`ws.tab.${id}`),
              id === 'warn' && (current?.warnings?.length ?? 0) > 0 ? h('span', { className: 'ws-count' }, String(current.warnings.length)) : null,
              id === 'advice' && adviceCount > 0 ? h('span', { className: 'ws-count' }, String(adviceCount)) : null,
              null))),
              h('div', { className: 'ws-drawer-wrap' },
                h('div', { className: 'ws-drawer-body', ref: drawerRef, onScroll: onDrawerScroll }, drawerBody()),
                (drawer === 'log' || drawer === 'calls') && logPinned
                  ? h('button', { type: 'button', className: 'ws-latest', onClick: jumpToLatest }, `↓ ${t('ws.latest')}`)
                  : null))),

          // ── Right: monitor + parameters ──
          h('aside', { className: 'ws-col ws-col-right' },
            h('section', { className: 'ws-panel' },
              h('div', { className: 'ws-panel-head' }, h('h3', { 'data-code': 'C1' }, t('ws.overview')), h('span', { className: `ws-tag${running ? ' ws-live' : ''}` }, running ? 'LIVE' : 'IDLE')),
              h('div', { className: 'ws-mon-top' },
                h('div', { className: 'ws-gauge-wrap', title: plannedBytes > 0 ? t('ws.gaugeHint') : t('ws.gaugeHintFiles') },
                  h('div', { className: 'ws-gauge', style: { '--ws-pct': `${bytePercent * 3.6}deg` } },
                    h('div', { className: 'ws-gauge-in' }, h('b', {}, `${bytePercent}`), h('span', {}, '%'))),
                  h('div', { className: 'ws-gauge-cap' }, plannedBytes > 0 ? `${fmtBytes(Math.min(processedBytes, plannedBytes))} / ${fmtBytes(plannedBytes)}` : t('ws.byFiles'))),
                h('div', { className: 'ws-mon-spark' }, spark())),
              // Business results: what the batch produced.
              h('div', { className: 'ws-subhead' }, h('span', {}, t('ws.m.groupResult')),
                h('span', { className: 'ma-mono', title: t('ws.m.chunksHint') }, `${t('ws.m.chunks')} ${current?.chunks ?? '—'}`)),
              h('div', { className: 'ws-readouts' },
                readout(t('ws.m.distinct'), compact(totals.distinctIds ?? totals.newMappings ?? 0), '', `${t('ws.m.distinctHint')}${totals.newMappings !== undefined ? `\n${t('ws.m.mappings')} ${totals.newMappings}：${t('ws.m.mappingsHint')}` : ''}`),
                readout(t('ws.m.entities'), compact(totals.entities ?? 0), '', t('ws.m.entitiesHint')),
                readout(t('ws.m.review'), String(totals.unresolved ?? 0), (totals.unresolved ?? 0) > 0 ? 'warn' : ''),
                readout(t('ws.m.failed'), String(totals.filesFailed ?? 0), (totals.filesFailed ?? 0) > 0 ? 'bad' : '')),
            ),
            // C2: model usage, throughput and process resources (collapsible).
            h('section', { className: `ws-panel ws-res${resCollapsed ? ' ws-collapsed' : ''}` },
              h('div', { className: 'ws-panel-head' },
                h('button', { type: 'button', className: 'ws-fold', onClick: toggleRes, 'aria-expanded': resCollapsed ? 'false' : 'true', title: resCollapsed ? t('ws.expand') : t('ws.collapse') },
                  h('h3', { 'data-code': 'C2' }, t('ws.m.groupTech')),
                  h('span', { className: 'ws-fold-arrow' }, resCollapsed ? '▸' : '▾')),
                resCollapsed && running && current?.requests?.detect
                  ? h('span', { className: 'ma-mono ws-res-mini', title: t('ws.m.reqHint') }, `${current.requests.detect.active}/${current.requests.detect.limit}${current.requests.verify ? ` · ${current.requests.verify.active}/${current.requests.verify.limit}` : ''}`)
                  : null),
              resCollapsed ? null : (() => {
                // Secondary readouts: one aligned label/value grid instead of
                // a wrapping run of text.
                const rows = []
                const row = (label, value, extra = {}) => rows.push(h('div', { key: label, className: `ws-kv${extra.tone ? ` ws-kv-${extra.tone}` : ''}${extra.bar ? ' ws-kv-bar' : ''}`, title: extra.title ?? '' },
                  h('span', {}, label), h('b', {}, value),
                  // Usage bar: current fill, peak tick, 70% / 85% thresholds.
                  extra.bar
                    ? h('i', { className: 'ws-membar', 'aria-hidden': 'true' },
                      h('i', { className: 'ws-membar-fill', style: { width: `${Math.min(100, extra.bar.pct)}%` } }),
                      extra.bar.peak > extra.bar.pct ? h('i', { className: 'ws-membar-peak', style: { left: `${Math.min(100, extra.bar.peak)}%` } }) : null)
                    : null))
                // Totals (both models): calls, reuse, tokens, memory.
                // Where the work went: sent to a model / replayed / skipped.
                // All three counted in segments, so the bar compares like with like.
                const sent = Number(totals.sentSegments ?? 0)
                const replayed = Number(totals.replayedSegments ?? 0)
                const skipped = Number(totals.memoHits ?? 0)
                const whole = sent + replayed + skipped
                const pct = (value) => `${Math.round((value / whole) * 100)}%`
                const splitBar = whole > 0 && sent + replayed > 0
                  ? h('div', { className: 'ws-splitbox', title: t('ws.m.splitHint', { sent, replayed, skipped }) },
                    h('div', { className: 'ws-split' },
                      [['sent', sent], ['replayed', replayed], ['skipped', skipped]].filter(([, value]) => value > 0)
                        .map(([kind, value]) => h('i', { key: kind, className: `ws-split-${kind}`, style: { flexGrow: value } }))),
                    h('div', { className: 'ws-split-legend' },
                      h('span', {}, h('i', { className: 'ws-split-sent' }), `${t('ws.m.segSent')} ${pct(sent)}`),
                      replayed ? h('span', {}, h('i', { className: 'ws-split-replayed' }), `${t('ws.m.segReplayed')} ${pct(replayed)}`) : null,
                      skipped ? h('span', {}, h('i', { className: 'ws-split-skipped' }), `${t('ws.m.segSkipped')} ${pct(skipped)}`) : null))
                  : null
                // Row 1: what was sent (calls, tokens); row 2: what was saved.
                row(t('ws.m.calls'), compact(running ? (current?.current?.modelCalls ?? totals.modelCalls ?? 0) : (totals.modelCalls ?? 0)), { title: t('ws.m.callsHint') })
                row(t('ws.m.tokens'), totals.tokens ? compact(totals.tokens) : ((totals.modelCalls ?? 0) > 0 && !totals.tokensReported ? t('ws.m.noUsage') : '0'), { title: t('ws.m.tokensHint') })
                row(t('ws.m.replayed'), compact(totals.replayedCalls ?? 0), { title: t('ws.m.replayedHint') })
                row(t('ws.m.memo'), compact(totals.memoHits ?? 0), { title: t('ws.m.memoHint') })
                // Per model: detector on the left, verifier on the right.
                const models = totals.models ?? {}
                const separate = Boolean(models.verify || current?.requests?.verify || (current?.config ? current.config.verifyModel : config?.verifyModel))
                const cols = separate ? ['detect', 'verify'] : ['detect']
                const slots = (r) => (r ? `${r.active}/${r.limit}${r.queued > 0 ? ` +${r.queued}` : ''}` : '—')
                const slotTone = (r) => (r && r.active < r.limit && r.queued === 0 ? 'warn' : '')
                const fits = Object.fromEntries(cols.map((key) => [key, fitSpeed(models[key]?.fit ?? (key === 'detect' ? totals.speedFit : null))]))
                // One speed per model; the prefill / decode split is in the hint.
                const speedOf = (key) => {
                  const m = models[key]
                  if (m?.ioMs > 0) return (m.ioTokens / m.ioMs) * 1000
                  const f = m?.fit ?? (key === 'detect' ? totals.speedFit : null)
                  return f?.y > 0 ? ((f.a + f.b) / f.y) * 1000 : null
                }
                const speedHint = (key) => {
                  const fit = fits[key]
                  const split = fit.gen === null ? t('ws.m.speedFew') : t('ws.m.speedSplit', { prompt: fmtSpeed(fit.prompt), gen: fmtSpeed(fit.gen) })
                  return `${t('ws.m.speedHint')}\n${split}`
                }
                // Context distribution: 7 buckets, bar heights relative to the largest.
                const HIST_LABELS = ['<0.5k', '0.5–1k', '1–2k', '2–4k', '4–8k', '8–16k', '≥16k']
                const histBar = (hist) => {
                  if (!hist?.some((value) => value > 0)) return '—'
                  const top = Math.max(...hist)
                  return h('span', { className: 'ws-hist', title: hist.map((value, index) => `${HIST_LABELS[index]}: ${value}`).join('\n') },
                    hist.map((value, index) => h('i', { key: index, className: index >= 5 ? 'ws-hist-hot' : '', style: { height: `${value ? Math.max(12, (value / top) * 100) : 0}%` } })))
                }
                // Token counts as 2.3k / 4.6k so a cell stays narrow.
                const kTok = (value) => (value >= 1000 ? `${(value / 1000).toFixed(value >= 100000 ? 0 : 1)}k` : String(Math.round(value)))
                // Failed calls (cancelled ones excluded) and retries per model.
                const FAIL_LABEL = (code) => (t(`ws.calls.r.${code}`) === `ws.calls.r.${code}` ? code : t(`ws.calls.r.${code}`))
                const failCell = (m) => {
                  if (!m?.calls) return '—'
                  const fails = Object.values(m.fails ?? {}).reduce((a, b) => a + b, 0)
                  const pct = (fails / m.calls) * 100
                  return h('span', { className: fails ? 'ws-fail-bad' : '' }, `${pct < 10 && pct > 0 ? pct.toFixed(1) : Math.round(pct)}%${m.retries ? ` ↻${m.retries}` : ''}`)
                }
                const failHint = (m) => {
                  const parts = Object.entries(m?.fails ?? {}).map(([code, count]) => `${FAIL_LABEL(code)} ${count}`)
                  return `${t('ws.m.failHint')}\n${parts.length ? parts.join(' · ') : t('ws.m.failNone')}${m?.retries ? `\n${t('ws.m.retryLine', { n: m.retries })}` : ''}`
                }
                const avgCtx = (m) => (m?.ctxN ? compact(Math.round(m.ctxSum / m.ctxN)) : '—')
                const lines = [
                  [t('ws.m.mCalls'), (key) => compact(models[key]?.calls ?? 0), t('ws.m.callsHint')],
                  [t('ws.m.ctx'), (key) => (models[key]?.ctxN
                    ? h('span', { className: 'ws-ctxcell' }, histBar(models[key].ctxHist), `${kTok(models[key].ctxSum / models[key].ctxN)} / ${kTok(models[key].ctxMax)}`)
                    : '—'), `${t('ws.m.ctxHint')}\n${t('ws.m.ctxDistHint')}`],
                  [t('ws.m.failRate'), (key) => failCell(models[key]), (key) => failHint(models[key])],
                  // One row: average output tokens / average time per call.
                  [t('ws.m.perCall'), (key) => (models[key]?.okN ? `${models[key].outSum ? kTok(models[key].outSum / models[key].okN) : '—'} / ${(models[key].msSum / models[key].okN / 1000).toFixed(1)}s` : '—'),
                    (key) => `${t('ws.m.outPerHint')}\n${t('ws.m.msPerHint')}\n${t('ws.m.speed')} ${fmtSpeed(speedOf(key))}\n${speedHint(key)}`],
                ]
                const table = h('div', { className: `ws-mtable${separate ? '' : ' ws-mtable-one'}` },
                  h('span', { className: 'ws-mt-head' }),
                  ...cols.map((key) => {
                    const name = key === 'verify' ? (current?.config?.verifyModel ?? config?.verifyModel ?? '') : (current?.config?.model ?? config?.model ?? '')
                    const role = key === 'detect' ? (separate ? t('ws.model') : t('ws.modelShared')) : t('ws.verifyModel')
                    return h('span', { key: `h${key}`, className: 'ws-mt-head', title: `${role} · ${name}` },
                      h('em', {}, role),
                      h('span', { className: 'ws-mt-name' }, name ? modelDot(ping?.[key], name) : null, h('i', {}, name || '—')))
                  }),
                  ...lines.flatMap(([label, value, hint, tone]) => [
                    h('span', { key: `l${label}`, className: 'ws-mt-label', title: typeof hint === 'function' ? hint(cols[0]) : hint }, label),
                    ...cols.map((key) => h('b', { key: `${label}${key}`, className: tone?.(key) ? `ws-mt-${tone(key)}` : '', title: typeof hint === 'function' ? hint(key) : hint }, value(key))),
                  ]))
                // Busy chart: requests in flight per model over time; the
                // queued part is shaded above each line, the dashed line is the limit.
                const series = current?.loadSeries
                // Current slots per model sit in the chart legend.
                const legendSlot = (key) => {
                  if (running && current?.requests?.[key]) {
                    return h('b', { className: `ws-busy-now${slotTone(current.requests[key]) ? ' ws-mt-warn' : ''}`, title: t('ws.m.reqHint') }, slots(current.requests[key]))
                  }
                  // Finished batch: peaks over the run (in flight / limit, +queue).
                  const pts = current?.loadSeries?.points ?? []
                  if (pts.length === 0) return null
                  const [ai, qi] = key === 'verify' ? [2, 3] : [0, 1]
                  const peakA = Math.max(...pts.map((p) => p[ai] ?? 0))
                  const peakQ = Math.max(...pts.map((p) => p[qi] ?? 0))
                  const lim = Number(current?.requests?.[key]?.limit ?? current?.requests?.detect?.limit ?? config?.concurrency ?? 4)
                  return h('b', { className: 'ws-busy-now', title: t('ws.m.peakHint') }, `${peakA}/${lim}${peakQ > 0 ? ` +${peakQ}` : ''}`)
                }
                const busy = (() => {
                  const points = series?.points ?? []
                  // Before any data the frame (axis, limit line, legend) is still drawn.
                  const empty = points.length < 2
                  const limit = Number(current?.requests?.detect?.limit ?? current?.config?.concurrency ?? config?.concurrency ?? 4)
                  const hasVerify = empty ? Boolean(current?.requests?.verify ?? (current ? current.config?.verifyModel : config?.verifyModel)) : points.some((p) => p.length > 2)
                  const W = 300
                  const H = 72
                  // Mirror chart around the axis: above, requests in flight
                  // (0..limit, the dashed line is the limit); below, requests
                  // queued in the plugin, on their own scale.
                  const AX = H / 2
                  const x = (index) => (index / Math.max(1, points.length - 1)) * W
                  const up = (value) => AX - (Math.min(value, limit) / limit) * (AX - 3)
                  const line = (pick) => points.map((p, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${up(pick(p)).toFixed(1)}`).join(' ')
                  const qMax = Math.max(1, ...points.map((p) => Math.max(p[1], p[3] ?? 0)))
                  void qMax
                  const down = (value) => AX + (value / qMax) * (AX - 3)
                  const qLine = (pick) => points.map((p, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${down(pick(p)).toFixed(1)}`).join(' ')
                  const qArea = (pick) => `M0 ${AX} ${points.map((p, index) => `L${x(index).toFixed(1)} ${down(pick(p)).toFixed(1)}`).join(' ')} L${W} ${AX} Z`
                  const minutes = empty ? 0 : Math.round(((points.length - 1) * (series.step ?? 2000)) / 60000)
                  return h('div', { className: `ws-busy${empty ? ' ws-busy-empty' : ''}`, title: `${t('ws.m.busyHint')}\n${t('ws.m.busyAxis', { limit, max: qMax, minutes: Math.max(1, minutes) })}` },
                    h('div', { className: 'ws-busy-head' },
                      h('span', {}, t('ws.m.busy')),
                      h('span', { className: 'ws-busy-legend' },
                        h('i', { className: 'ws-busy-d' }), t('ws.model'), legendSlot('detect'),
                        hasVerify ? h(React.Fragment, {}, h('i', { className: 'ws-busy-v' }), t('ws.verifyModel'), legendSlot('verify')) : null)),
                    h('div', { className: 'ws-busy-plot' },
                      // Scale labels sit in a gutter left of the plot, never over the lines.
                      h('div', { className: 'ws-busy-gutter', 'aria-hidden': 'true' },
                        h('span', {}, t('ws.m.inflightTag')),
                        h('span', { className: 'ws-busy-zero' }, '0'),
                        h('span', {}, t('ws.m.queueTag'))),
                      h('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': t('ws.m.busy') },
                        h('line', { className: 'ws-busy-limit', x1: 0, x2: W, y1: up(limit), y2: up(limit) }),
                        // Queue drawn like the lines above, mirrored; dashed = queue peak.
                        h('line', { className: 'ws-busy-limit', x1: 0, x2: W, y1: down(qMax), y2: down(qMax) }),
                        empty ? null : h('path', { className: 'ws-busy-ld ws-busy-q', d: qLine((p) => p[1]) }),
                        !empty && hasVerify ? h('path', { className: 'ws-busy-lv ws-busy-q', d: qLine((p) => p[3] ?? 0) }) : null,
                        // Light fill between the in-flight lines and the axis.
                        empty ? null : h('path', { className: 'ws-busy-fd', d: `${line((p) => p[0])} L${W} ${AX} L0 ${AX} Z` }),
                        !empty && hasVerify ? h('path', { className: 'ws-busy-fv', d: `${line((p) => p[2] ?? 0)} L${W} ${AX} L0 ${AX} Z` }) : null,
                        h('line', { className: 'ws-busy-axis', x1: 0, x2: W, y1: AX, y2: AX }),
                        empty ? null : h('path', { className: 'ws-busy-ld', d: line((p) => p[0]) }),
                        !empty && hasVerify ? h('path', { className: 'ws-busy-lv', d: line((p) => p[2] ?? 0) }) : null),
                      empty ? h('span', { className: 'ws-busy-wait' }, running ? t('ws.m.busyCollect') : t('ws.m.busyIdle')) : null,
                    ))
                })()
                return h(React.Fragment, {}, splitBar, h('div', { className: 'ws-minor' }, rows), table, busy)
              })()),
            crossCheckPanel(),
            null)),
        deleting ? h('div', { className: 'ws-modal-back', onMouseDown: (event) => { if (event.target === event.currentTarget && !deleting.busy) setDeleting(null) } },
          h('div', { className: 'ws-modal ws-modal-del', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': t('ws.del.title') },
            h('div', { className: 'ws-modal-head' }, h('h3', {}, deleting.all ? t('ws.del.clearTitle') : t('ws.del.title'))),
            h('div', { className: 'ws-modal-body ws-del' },
              deleting.all
                ? h('p', {}, h('b', {}, t('ws.del.allCount', { count: runs.filter((run) => run.status !== 'running').length })), activeRunId ? h('span', { className: 'ma-hint' }, ` ${t('ws.del.keepRunning')}`) : null)
                : h('p', {}, h('b', {}, baseName(deleting.run.inputDir) || deleting.run.id), h('span', { className: 'ma-mono' }, ` · ${deleting.run.id}`)),
              h('p', { className: 'ma-hint' }, deleting.all ? t('ws.del.allRecords') : t('ws.del.records')),
              h('label', { className: 'ma-check' },
                h('input', { type: 'checkbox', checked: deleting.deliverable, disabled: !deleting.all && !deleting.run.output, onChange: (event) => setDeleting({ ...deleting, deliverable: event.target.checked }) }),
                deleting.all ? t('ws.del.allDeliverable') : deleting.run.output ? t('ws.del.deliverable', { path: deleting.run.output }) : t('ws.del.noDeliverable')),
              h('p', { className: 'ma-hint' }, t('ws.del.vault')),
              deleting.error ? h('p', { className: 'ma-hint ma-error' }, deleting.error) : null,
              h('div', { className: 'ma-actions ws-del-actions' },
                h('button', { className: 'ma-btn', disabled: deleting.busy, onClick: () => setDeleting(null) }, t('ws.del.cancel')),
                h('button', { className: 'ma-btn ws-del-go', disabled: deleting.busy, onClick: confirmDelete }, deleting.busy ? t('ws.del.busy') : deleting.all ? t('ws.del.clearGo') : t('ws.del.go'))))))
          : null,
        modal ? h('div', { className: 'ws-modal-back', onMouseDown: (event) => { if (event.target === event.currentTarget) closeModal() } },
          h('div', { className: `ws-modal ws-modal-${modal}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': (modal === 'help' ? t('ws.helpTitle') : modal === 'report' ? `${t('ws.tab.report')} · ${current?.id ?? ''}` : modal === 'compare' ? t('ws.cmp.title') : t('settings.title')) },
            h('div', { className: 'ws-modal-head' },
              h('h3', {}, (modal === 'help' ? t('ws.helpTitle') : modal === 'report' ? `${t('ws.tab.report')} · ${current?.id ?? ''}` : modal === 'compare' ? `${t('ws.cmp.title')} · ${current?.id ?? ''}` : t('settings.title'))),
              modal === 'compare' ? h('span', { className: 'ma-hint ws-cmp-keys' }, t('ws.cmp.keys')) : null,
              modal === 'report' && reportText ? h('button', { className: 'ma-btn ma-small', onClick: () => copyText(reportText) }, t('ws.report.copy')) : null,
              h('button', { className: 'ma-btn ma-small', onClick: closeModal, 'aria-label': t('detail.close') }, '✕')),
            h('div', { className: 'ws-modal-body' },
              modal === 'help'
                ? h(HelpBody, { config })
                : (modal === 'settings' && anyRunning ? h('div', { className: 'ma-banner' }, t('ws.paramsLocked')) : null),
              modal === 'settings' ? h(SettingsSection) : null,
              modal === 'report' ? (reportText ? h(MarkdownView, { text: reportText }) : h('p', { className: 'ma-empty' }, t('detail.noReport'))) : null,
              modal === 'compare' ? compareBody() : null)))
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
          ['字段里的编码内容', 'base64 · gzip · URL 编码 · \\u 转义 · HTML 实体 · HTML/XML · 嵌套 JSON · HL7', '逐层拆开后识别，按原编码写回'],
          ['无法检查的内容', '图片 · PDF · 二进制 · 未知编码 · 加密内容', '转人工复核，复核完成前不交付'],
          ['压缩包', 'zip（最多 3 层嵌套）', '解压处理后按原结构重新打包'],
          ['医学影像', 'DICOM', '仅处理元数据，像素不变'],
          ['文件名 / 目录名', '姓名、证件号、病人编号、住院号、门诊号', '替换为对应假名'],
          ['邮编', '6 位邮政编码（带「邮编」标签或邮编字段）', '始终处理，保留前 3 位（如 100***）'],
          ['准标识符', '日期 · 年龄 · 性别', '不处理（可在处理参数中开启）'],
          ['不支持', 'Word · PDF · 图片', '跳过，并在「提示」中列出'],
        ],
        ids: '直接标识符及当前处理方式',
        flow: '二、处理流程',
        flowNote: '每个文件在 S03–S06 之间循环：识别·替换后先做规则核验，再交给独立盲审；盲审报出的可疑项由识别模型复判，确认的补替换后回到规则核验。最多 {rounds} 轮；两个模型意见不一致、或仍有残留的进入人工复核，复核完成前交付数据暂扣。',
        stageHead: ['环节', '方法', '产出'],
        stageRows: {
          prescan: ['列出文件、解压压缩包、替换路径中的标识符', '批次字典；匿名化后的输出路径'],
          read: ['解析格式；逐层解码编码内容（base64、HTML 等），超长字段切成小段；结构化文件按列做字段画像（标识符列 / 临床词表 / 编码 / 自由文本）', '待处理片段；拆不开的转人工复核'],
          discover: ['规则匹配 + 识别模型识别；插件逐字定位并替换为假名', '替换后的内容（识别模型）'],
          rules: ['规则复扫 · 原值清除检查 · 结构校验', '通过 / 残留'],
          blind: ['把替换后的内容交给核验模型，不告知识别结果，尝试重新认出具体的人；数字和短编码按字段合并送审', '盲审报出的可疑项（核验模型）'],
          repair: ['识别模型逐条复判可疑项：确认的补替换，误报保留，回到规则核验', '修正后的内容；分歧项转人工复核'],
          rescan: ['一组文件处理完后，以全部已知标识符回扫各文件及分组之间', '跨文件一致性'],
          pack: ['生成比对记录；重新打包压缩包', '待交付数据 · 报告 · 比对记录'],
          review: ['处理分歧项、无法检查的内容；未处理完时交付数据暂扣', '人工复核记录'],
          deliver: ['复核全部处理完后放到输出根目录', '交付数据'],
          dicom: ['旁路，不经模型：删除姓名与 ID、重生成 UID、平移日期', '去标识化影像'],
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
          ['Encoded field content', 'base64 · gzip · URL encoding · \\u escapes · HTML entities · HTML/XML · nested JSON · HL7', 'Unwrapped layer by layer, written back in the same encoding'],
          ['Content that cannot be checked', 'Images · PDF · binary · unknown encodings · encrypted data', 'Manual review; nothing is delivered until reviewed'],
          ['Archives', 'zip (up to 3 levels)', 'Processed, then re-packed in the original layout'],
          ['Medical images', 'DICOM', 'Metadata only; pixels unchanged'],
          ['File / folder names', 'Names, ID, patient, admission and visit numbers', 'Replaced with pseudonyms'],
          ['Postal code', '6-digit codes (labelled or in a postal-code field)', 'Always processed, first 3 digits kept (e.g. 100***)'],
          ['Quasi-identifiers', 'Date · age · sex', 'Not processed (switch in Processing settings)'],
          ['Unsupported', 'Word · PDF · images', 'Skipped and listed under Notices'],
        ],
        ids: 'Direct identifiers and current treatment',
        flow: '2. Pipeline',
        flowNote: 'Each file loops through S03–S06: after detection and replacement come the rule checks and the blind review; suspects are re-judged by the detection model, confirmed ones replaced, then back to the rule checks. Up to {rounds} rounds; disagreements and remaining residuals go to manual review, and the result is held until review is complete.',
        stageHead: ['Stage', 'Method', 'Output'],
        stageRows: {
          prescan: ['List files, extract archives, replace identifiers in paths', 'Batch dictionary; anonymized output paths'],
          read: ['Parse formats; unwrap encoded content (base64, HTML …); cut long fields into pieces', 'Segments; what cannot be unwrapped goes to manual review'],
          discover: ['Rules + detection model; exact location and replacement by the plugin', 'Replaced content (detection model)'],
          rules: ['Rule rescan · absence check · structure check', 'Pass / residuals'],
          blind: ['The replaced content goes to the verification model, which is not told what was found and tries to re-identify people; numbers and short codes are sent as per-field lists', 'Suspects (verification model)'],
          repair: ['The detection model re-judges each suspect: confirmed ones are replaced, false positives kept, back to the rule checks', 'Remediated content; disagreements to manual review'],
          rescan: ['After a chunk: rescan every file with all known identifiers, within and across chunks', 'Cross-file consistency'],
          pack: ['Write the comparison; re-pack archives', 'Data to deliver · report · comparison'],
          review: ['Disagreements and content that cannot be checked; the result is held until all are decided', 'Review record'],
          deliver: ['Move into the output root once review is complete', 'Deliverable'],
          dicom: ['Bypass, no model: remove names and IDs, regenerate UIDs, shift dates', 'De-identified images'],
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
      const flowMain = ['prescan', 'read', 'discover', 'rules', 'blind', 'rescan', 'pack', 'review', 'deliver']
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
            h('span', { className: `ws-hf-node${id === 'discover' || id === 'blind' ? ' ws-hf-core' : ''}` },
              h('em', {}, String(STATIONS.indexOf(id) + 1).padStart(2, '0')), t(`ws.st.${id}`))))),
        h('div', { className: 'ws-help-loop' },
          h('span', { className: 'ws-hf-node ws-hf-small' }, t('ws.st.blind')),
          h('span', { className: 'ws-hf-arrow' }, '⇢'),
          h('span', { className: 'ws-hf-node ws-hf-small' }, t('ws.st.repair')),
          h('span', { className: 'ws-hf-arrow' }, '⇢'),
          h('span', { className: 'ws-hf-node ws-hf-small' }, t('ws.st.rules')),
          h('span', { className: 'ws-hf-max' }, `≤ ${rounds}`),
          h('span', { className: 'ws-hf-side' }, `DICOM：${t('ws.sub.dicom')}`)),
        h('p', { className: 'ws-help-note' }, c.flowNote.replace('{rounds}', String(rounds))),
        table(c.stageHead, [...STATIONS, 'dicom'].map((id) => h('tr', { key: id },
          h('td', { className: 'ws-help-stage' }, h('em', {}, id === 'dicom' ? '旁路' : String(STATIONS.indexOf(id) + 1).padStart(2, '0')), t(`ws.st.${id}`)),
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
