# 代码审查结果（2026-11-09）

范围：整个代码库，按 5 块（流水线、识别与化名、文件格式、宿主端、前端）分别审查；每块的问题都另由一个代理尝试推翻，能复现的写了脚本实际运行（脚本在 $TMPDIR，不在仓库）。

共 63 条，无一被推翻；其中 3 条与其它条重复（已标注）。verdict：confirmed = 已复现或代码明确如此；plausible = 很可能但未复现。

## 高（12）

### #0 dedupeIssues merges different flagged values into one review item, so the others are delivered without review

- 位置：`lib/pipeline.js:2226`（pipeline，privacy-leak，confirmed）
- 问题：dedupeIssues builds its key as `${issue.severity}|${issue.code}|${issue.detail}`. For model-residual, disputed and residual issues the detail contains only maskForReport(text). maskForReport returns '**' for every 2-character value, '***' for every 3-character value, and '13******' for any 11-digit phone that starts with 13. So different values of the same type in the same field get the same key, and only the first issue survives. Its non-enumerable `review.text` (the one value the reviewer can replace) is kept, and the rest are dropped. review-items.json is built from these deduped issues (line 705/729). finishReview marks the batch completed and calls deliverStaged once every listed item has a decision. reviewDecide 'replace' swaps only item.text. The list is also cut to 60 entries after deduping (`.slice(0, 60)`), which hides issues in the same way.
- 失败场景：Reproduced with a fake model and maxRounds=1 (with the default of 3, it happens when the verifier first reports in the last round, or when two values are disputed with the same reason). Input note.txt is '今日查房，张三与李四同住一室。' and the verifier reports both 张三 and 李四. file.issues contains a single 'model-residual:独立盲审报出：姓名 **', and review-items.json contains only ["张三"]. The reviewer replaces 张三, the batch is marked completed and released, and 李四 is delivered unchanged and was never shown to a person.
- 建议修法：Dedupe errors that carry review data by (code, type, field, original text), using the non-enumerable review.text, not by the masked detail. Alternatively, add a stable non-identifying discriminator to the key, such as a hash of the text. Never let the 60-entry cap drop error issues. If errors must be capped, keep the run withheld and say that items were hidden.
- 核实：dedupeIssues keys on `${severity}|${code}|${detail}` (2226) and the detail holds only maskForReport(text), which returns '**' for any 2-char value. Repro: $TMPDIR/rv0/r0.mjs, a stub verifier reports 张三 and 李四 in note.txt '今日查房，张三与李四同住一室。'. `node r0.mjs txt 1 review` gives: status review; issues [{code:'model-residual',detail:'独立盲审报出：姓名 **'}]; review-items [["张三"]]; reviewDecide(replace) -> {completed:true,status:'completed'}; delivered in/note.txt = '今日查房，化名-011BC1与李四同住一室。'. So 李四 was released without anyone seeing it. With maxRounds=3, carryOver replaced both in a later round and the file came out clean, so this needs a last-round report (or same-reason disputes), as the reviewer said. The other codes (disputed, residual, not-removed) mask the same way.

### #1 Layered write-back fails for multi-line text chunks, so the output keeps originals while the layer view shows them replaced

- 位置：`lib/layers.js:712`（detection，privacy-leak，confirmed）
- 问题：sync() turns all of an entry's edits into ONE base replacement covering everything from the first changed character to the last (lines 707-712). The text base (formats.js apply) skips any replacement whose slice contains '\n'. In a .txt chunk (up to 1400 chars) that layered() explodes, two edits on different lines produce a slice that crosses a newline. A chunk is exploded when it has an inline data: URI or base64 run, at least 3 %XX escapes, or \u escapes. decodeUrl and decodeUnicodeEscapes also re-encode every non-ASCII character in the chunk, so even a single edit produces a diff that crosses lines. Either way base.apply returns 0, sync() returns false, and apply() throws. The 'undo' at line 773 undoes nothing: leaf.text already holds the new text, so pieces are rebuilt from the edited text. Entries after the failing one are never synced at all.
- 失败场景：Verified with loadDocument + layered. a.txt contains '姓名：张三\n报告链接：http://his.local/report?dept=%E5%BF%83%E5%86%85\n'. Applying 张三→化名-BBBBBB throws '字段 t0 写回编码内容失败'. doc.segments() then shows '姓名：化名-BBBBBB…', but doc.serialize() still contains '姓名：张三'. The same happens with a data:image URI in the chunk plus a name and a phone on separate lines. The round loop aborts and the file is written with every original in that chunk. Residual scans and the review/compare view (doc.leaves()) read the layer, so they show those identifiers as already replaced.
- 建议修法：In sync(), emit one base replacement per changed region (or per line) instead of one spanning diff, or let text chunks accept multi-line write-back from layers. On failure, restore leaf.parts and pieces from leaf.orig before throwing, and sync every touched entry independently. Avoid re-encoding characters outside the edited region for url and unicode-escape layers.
- 核实：Repro $TMPDIR/rv/r0.mjs: I loaded a.txt '姓名：张三\n报告链接：http://his.local/report?dept=%E5%BF%83%E5%86%85\n' with loadDocument and wrapped it in layered(). The chunk is exploded via decodeUrl (segment t0~0, via 'url'). apply(张三→化名-BBBBBB) throws '字段 t0 写回编码内容失败'. Afterwards doc.segments() and doc.leaves() show '姓名：化名-BBBBBB…', but doc.serialize() still returns the original '姓名：张三…%E5%BF%83%E5%86%85'. Cause: decodeUrl.encode re-escapes every non-ASCII character, so the diff that sync() builds runs from line 1 into line 2. formats.js:201 then skips any slice containing '\n', base.apply returns 0, and sync() returns false. The 'undo' at line 773 rebuilds the pieces from the already-edited leaf.text. In pipeline.js the throw is caught at 1676 as a 'pipeline' error, so the file goes to 'review'. It is not silent, but writeOutput still writes the file with the originals.

### #2 HL7 decoder hides every all-digit component, so patient IDs, phones, ID-card numbers and DOBs are never scanned

- 位置：`lib/layers.js:463`（detection，privacy-leak，confirmed）
- 问题：decodeHl7: `if (!comp || /^\d+$/.test(comp)) return` only exposes non-numeric components as parts. Once a field is exploded, its base segment is replaced by those parts in doc.segments(), so all-digit components are invisible to the rules, the model, the residual scan and the blind review. encode() copies them back verbatim.
- 失败场景：Verified: a JSON/CSV/xlsx field (always exploded) holds 'MSH|^~\&|...\rPID|1||987654321^^^HOSP^MR||张三^^||19800101|M|||杭州市西湖区||13800138000|||||||110105194912310021'. explode() leaves include only HIS, HOSP, …, 张三, M, 杭州市西湖区. The MRN 987654321, phone 13800138000, ID card 110105194912310021 and DOB are never shown to any detector and pass through to the output unchanged.
- 建议修法：Expose numeric components as parts as well, at least for fields with an HL7_HINTS entry and for anything 7 digits or longer. Alternatively, run scan() on the raw HL7 text and map hits back to components.
- 核实：Repro r0.mjs: explode() on 'MSH|^~\\&|HIS|HOSP|...\rPID|1||987654321^^^HOSP^MR||张三^^||19800101|M|||杭州市西湖区||13800138000|||||||110105194912310021' gives leaves [HIS,HOSP,LIS,HOSP,ADT,A01,P,2.5,HOSP,MR,张三,M,杭州市西湖区]. The MRN, DOB, phone and ID card are never exposed. The base segment is replaced by these leaves in layered().segments(), which feeds segmentsOf (pipeline.js:946), so rules, model and residual scan never see the numbers. The HL7 hints for PID-3/13/20 are therefore dead for numeric values. test/layers.mjs:120 only asserts the name.

### #3 Markup decoder drops non-text attribute values (href, extension, etc.) from inspection entirely

- 位置：`lib/layers.js:397`（detection，privacy-leak，confirmed）
- 问题：An attribute is exposed only if it is in TEXT_ATTRS, starts with data-, or is non-structural AND contains CJK. Every other attribute (href, src, extension, root, onclick, action, name, …) is copied verbatim into the template. Because the markup segment is replaced by its parts, nothing ever scans these values.
- 失败场景：Verified. Case 1: '<div>联系方式：<a href="mailto:zhangsan@example.com">发邮件</a><a href="tel:13800138000">拨打</a></div>' produces the single leaf '联系方式：发邮件拨打', so the email and phone leak. Case 2: a Chinese CDA document (WS/T 500 style) '<id root="2.16.156.10011.1.3" extension="110105194912310021"/>…<id … extension="ZY20240301"/>' in a JSON field produces only the leaf '张三'. The ID-card number and admission number are output unchanged and never flagged.
- 建议修法：Expose every attribute value that is not a pure structural token (or at least href/src/extension/value/root) as a wrapped part. Or run the rule scanner over the hidden attribute values and send any hits to review.
- 核实：Repro r0.mjs: explode('<div>联系方式：<a href="mailto:zhangsan@example.com">发邮件</a><a href="tel:13800138000">拨打</a></div>') gives the single leaf '联系方式：发邮件拨打'. A CDA-style '<id root="2.16.156.10011.1.3" extension="110105194912310021"/><id root="x" extension="ZY20240301"/>…<name>张三</name>' gives only ['张三']. At line 397, an attribute that is not in TEXT_ATTRS, not data-*, and not CJK-bearing is skipped with `continue` and copied verbatim in the fixed template.

### #4 Text lines longer than 1400 chars are hard-split, so identifiers that cross the split are never detected

- 位置：`lib/formats.js:155`（formats，privacy-leak，confirmed）
- 问题：chunkText cuts any line over CHUNK_CHARS at exactly 1400 characters (`chunks.push({... text: line.slice(0, CHUNK_CHARS) ...})`), with no overlap and without looking for a boundary. Each chunk is a separate segment. Rules, the batch dictionary and the model each see only half of a value that crosses the cut, and apply() can only replace inside one chunk.
- 失败场景：I ran this end to end. d.txt is one line: '患者' + 1390×'某' + '身份证110101199003071233结束'. The valid 18-digit ID covers offsets 1395-1413. Output: the ID is unchanged, the file is 'clean' and the batch is 'completed'. The same ID placed at offset ~100 is replaced (证件-4E8150). This is common in Chinese clinical notes, where a whole record is often one long paragraph with no newlines.
- 建议修法：Do not cut mid-token. Split long lines at a sentence or whitespace boundary, or overlap chunks by at least the longest identifier length (about 32 chars) and dedupe spans. Or run the deterministic rules on the whole line before chunking and map hits back by offset.
- 核实：Repro: $TMPDIR/rv1/gen.mjs creates d.txt = '患者'+1390×'某'+'身份证110101199003071233结束\n'. `node run.mjs in out`, where run.mjs calls runBatch with rules only. Batch status is 'completed', d.txt is 'clean', and the tail of out/in/d.txt is still '...身份证110101199003071233结束'. chunkText (formats.js:152-158) cuts at exactly CHUNK_CHARS with no overlap. Rules, batch expansion and the residual checks all iterate doc.segments(), so a value that crosses the cut is never seen whole.

### #5 CSV row 0 is never scanned: a header-less CSV leaks its whole first record

- 位置：`lib/formats.js:289`（formats，privacy-leak，confirmed）
- 问题：segments() starts at `for (let r = 1; ...)` because row 0 is assumed to be a header. Nothing checks whether row 0 really is a header (for example, whether hintForHeader matches any cell). Its cells are never segments for rules, the model or the residual checks. The structure check then requires the header to be unchanged.
- 失败场景：I ran this end to end. n.csv = '张三,110101199003071233,13800138000\r\n李四,110101199003071233,13900139000\r\n'. Output: '张三,110101199003071233,13800138000\n李四,证件-6E0899,电话-FC30BC\n'. Status is 'clean' and the batch is 'completed'. The first patient's name, ID and phone are delivered as-is. Even with a real header, title or identifier text in row 0 (for example '患者：张三 检验单') is never checked.
- 建议修法：Always scan row 0 (as the xlsx path does, with hint null), and use it as a header only for hints. If no cell of row 0 looks like a header, at least run the rules and residual scan on it.
- 核实：Repro: n.csv = '张三,110101199003071233,13800138000\r\n李四,110101199003071233,13900139000\r\n'. The output is '张三,110101199003071233,13800138000\n李四,证件-1DEF77,电话-F5C26D\n' and the file status is 'clean'. segments() starts at r=1 with no check that row 0 is a header, and structure() then requires row 0 to be unchanged.

### #6 XLSX text outside cell values (sheet names, comments, hyperlinks, defined names, document properties, formula literals) is copied unchanged

- 位置：`lib/formats.js:486`（formats，privacy-leak，confirmed）
- 问题：createXlsxDocument only makes segments from string cell values (`cell.v`). XLSX.read keeps cell comments (`cell.c`), hyperlinks (`cell.l.Target`), formulas (`cell.f`), workbook defined names, `wb.Props` (Author, Title, LastModifiedBy...) and sheet names, and XLSX.write writes them all back. The structure check even requires sheet names to be unchanged.
- 失败场景：I verified this. Sheet named '张三_13800138000', A2 comment '患者张三 电话13800138000', D2 with formula '"张三"', C2 hyperlink 'mailto:zhangsan@example.com', defined name Ref '"张三13800138000"', Props {Author:'张三医生', Title:'张三病历'}. After replacing the A2/D2 values, the output still has all of these strings. structure() reports ok. In the formula case, recalculation in Excel restores the original value over the replaced cached value.
- 建议修法：Expose comments, hyperlink targets and display text, formula string literals, defined-name refs, sheet names and Props as segments, or strip them (drop Props, comments and hyperlinks). Clear `cell.f` when a formula cell's cached value is replaced. At minimum, raise a review issue when any of these are present.
- 核实：Repro: gen2.mjs builds c.xlsx with sheet name '张三_13800138000', an A2 comment '患者张三 电话13800138000', a C2 hyperlink 'mailto:zhangsan@example.com', a defined name Ref '"张三13800138000"' and Props Author '张三医生' / Title '张三病历'. After runBatch the file status is 'clean' with structure ok. chk.mjs on the output shows all of these strings unchanged, and the E2 formula f:'"张三"' is preserved. Only cell.v strings ever become segments.

### #7 Numeric identifiers in xlsx number cells and JSON number values are never checked

- 位置：`lib/formats.js:345`（formats，privacy-leak，confirmed）
- 问题：JSON flattenStrings only collects strings. xlsx segments require `typeof cell.v === 'string'`. A phone number, 住院号 or MRN stored as a number is invisible to the rules, the column/key hints, the model and every residual check. The pipeline only warns about this for quasi-identifiers (pipeline.js:482), not for direct identifiers.
- 失败场景：I ran this end to end. a.json {"patient":{"name":"张三","age":40,"phone":13800138000,"mrn":573453}}: the output has the name pseudonymized but phone 13800138000 and mrn 573453 unchanged. c.xlsx with header 姓名/电话/住院号 and row ['李四', 13900139000, 20230001]: the phone and 住院号 stay in the output. All files are 'clean' and the batch is 'completed'.
- 建议修法：Make number leaves and numeric cells segments (text = String(value)). Where a replacement happens, write a string (or put a review item where the type must stay numeric). At least, values under identifier-hinted keys or columns, and numbers that match phone or ID rules, must be replaced or sent to review.
- 核实：Repro: a.json {patient:{name:'张三',age:40,phone:13800138000,mrn:573453}} gives output with the name pseudonymized (化名-384C60) but "phone": 13800138000 and "mrn": 573453 unchanged, status 'clean'. c.xlsx row ['李四',13900139000,20230001] under headers 姓名/电话/住院号: the output keeps B2 v=13900139000 and C2 v=20230001, status clean. flattenStrings only collects strings, and the xlsx code requires typeof cell.v === 'string' (line 486).

### #8 Non-UTF-8 text and CSV files (GBK, UTF-16) are silently destroyed and pass every check

- 位置：`lib/formats.js:129`（formats，correctness，confirmed）
- 问题：loadDocument reads txt/md/csv/json with `readFile(path, 'utf8')`, with no encoding detection. GBK bytes become U+FFFD or random characters. The output is written as UTF-8 from that string, so the original Chinese text is lost for good. Structure checks compare against the already-garbled snapshot, so they pass. The codebase already has GBK decoding (zip.js, layers.js) but the top-level loader does not use it.
- 失败场景：I verified this. A GBK CSV '姓名,电话\n张三,13800138000\n' loads as segments ['����', '13800138000'] with field '�绰', and structure().ok === true. serialize() returns '����,�绰\n����,13800138000\n'. Excel on Chinese Windows saves 'CSV' as GBK by default, so a typical hospital export is delivered as unrecoverable garbage with status clean. Names are not detected either, because the model sees mojibake.
- 建议修法：Decode with a strict UTF-8 TextDecoder (fatal). On failure, detect UTF-16 BOM or fall back to GBK/GB18030, keep the detected encoding and re-encode on serialize (layers.js already has gbkEncode). If decoding is uncertain, fail the file or send it to review instead of writing lossy output.
- 核实：Repro: g.csv is the GBK bytes of '姓名,电话\n张三,13800138000\n'. The run reports it 'clean' with all structure checks ok. od -c of the output shows EF BF BD (U+FFFD) sequences in place of 姓名 and 张三, so the original text is lost. loadDocument uses readFile(path,'utf8'). No GBK or FFFD detection exists outside layers.js and zip.js.

### #9 DICOM file and folder names keep original UIDs and Latin patient names while the header is cleaned

- 位置：`lib/paths.js:135`（formats，privacy-leak，confirmed）
- 问题：The path anonymizer only knows batchKnown (seeded from text files) plus CJK, ID and phone rules. UIDs in names are split on '.' into digit tokens and nothing matches. DICOM PatientName and the UIDs remapped by the profile are never fed into the path mapper. isDicomCandidate explicitly expects files named like '1.2.840....123', which is the SOPInstanceUID naming that many PACS exports use, with StudyInstanceUID or PatientName folders.
- 失败场景：I ran this end to end. Input in/ZHANG_SAN/<StudyInstanceUID>/<SOPInstanceUID>.dcm, with header PatientName ZHANG^SAN. The output path is out/in/ZHANG_SAN/1.2.840.113619.2.55.3.604688119.868/1.2.840.113619.2.55.3.604688119.868.1234567890.123.dcm and the batch is 'completed'. Inside the file the UIDs were remapped to 2.25.* and the name emptied. The path still carries the patient name and the original PACS UIDs, and anyone with PACS access can look those UIDs up.
- 建议修法：Map DICOM output paths after reading headers. Replace any path token equal to an original UID with remapUid(), and feed PatientName components and PatientID into the path mapper's known set. Otherwise rename DICOM files to neutral names (for example the remapped SOPInstanceUID).
- 核实：Repro: in3/ZHANG_SAN/1.2.840.113619.2.55.3.604688119.868/<SOP>.dcm with PatientName ZHANG^SAN. The output path is out3/in3/ZHANG_SAN/1.2.840.113619.2.55.3.604688119.868/1.2.840.113619.2.55.3.604688119.868.1234567890.123.dcm and the batch is 'completed'. Inside the file 'ZHANG' and '604688119' are gone. pipeline.js:519 seeds the path mapper only from batchKnown (text files); DICOM names and UIDs are never fed into it.

### #10 Headerless CSV: first row is never scanned, so it ships verbatim and the batch reports 'completed'

- 位置：`lib/formats.js:286`（host，privacy-leak，confirmed，同 #5）
- 问题：createCsvDocument treats rows[0] as the header. segments() starts at `for (let r = 1; r < rows.length; r += 1)`, and structure() requires the header to be unchanged ('表头 未改动'). The XLSX loader, by contrast, does emit the header row as segments (formats.js ~478-490). For a CSV with no header row, every identifier in line 1 is never shown to the rules or to the model, and is never flagged for review.
- 失败场景：Reproduced with the rules-only pipeline. Input p.csv = `13800138000,a@b.com\n13900139000,c@d.com\n`. Result: status=completed, and the delivered p.csv is `13800138000,a@b.com\n电话-8962E3,邮箱-B6B1F2`. The first patient's phone and email are delivered in clear text with no issue raised. A row like `张三,110101199003071234,...` leaks the same way.
- 建议修法：Scan the header row as well. At minimum, run the rule layer over rows[0] and raise an error-level review item when any header cell matches an identifier rule (ID checksum, phone, email). Alternatively, detect a headerless file (first-row cells look like data rather than field names) and treat row 0 as data. The structure check then needs to allow identifier replacement in that row.
- 核实：Ran runBatch (rules-only) on in/p.csv = '13800138000,a@b.com\n13900139000,c@d.com\n'. Output: status 'completed', issues [], delivered out/in/p.csv = "13800138000,a@b.com\n电话-DC0BFF,邮箱-8C550E\n". segments() loops from r=1, so row 0 is never scanned and no guard elsewhere flags it. Severity lowered to high only because it needs a headerless CSV; the leak itself is silent.

### #11 start() has a check-then-act race: concurrent starts run two batches, losing vault mappings and failing one batch

- 位置：`lib/service.js:230`（host，correctness，confirmed）
- 问题：`if (active) throw ...` is checked first. `active = { runId }` is only set at line 336, after several awaits in between: `await list()`, `stat`, `listInputFiles`, `mkdir`, `rememberRoot`, and the legacy `rename`. Two start calls (parallel agent tool calls, agent plus panel, or a panel double-click) both pass the check. Each batch builds its own Vault instance over the same vault.json. Both also use the same temp name `vault.json.tmp-${pid}`. activeController is overwritten, so the first batch cannot be cancelled. When the second batch finishes, its `.finally` sets active=null while the first is still running, so isRunning() returns false and saveDefaults can then reapply the plugin mid-batch.
- 失败场景：Reproduced: `Promise.allSettled([svc.start({inputDir:'race/a'}), svc.start({inputDir:'race/b'})])` with sibling inputs that share the default `_medical-anonymizer` root. Both starts were fulfilled. The vault ended with 30 entries instead of the expected 60. One batch failed with `ENOENT ... rename 'vault.json.tmp-<pid>' -> 'vault.json'`. Pseudonyms already written to delivered files no longer map back to their originals, and undo cannot remove them.
- 建议修法：Claim the slot synchronously before the first await, e.g. `if (active) throw ...; active = { runId: pending }`, and release it in a try/finally on every early-exit path. Separately, make vault writes safe across instances: use a per-instance or random temp name, and merge with the on-disk entries under a lock rather than overwriting the whole file.
- 核实：Ran Promise.allSettled([svc.start({inputDir:'race/a'}), svc.start({inputDir:'race/b'})]) against createService with sibling folders of 6 files each. Both starts were fulfilled with different runIds. One batch failed with 'ENOENT ... rename .../_records/vault.json.tmp-18848 -> vault.json'. The other completed. vault.json ended with 12 entries, although each batch produced 12 entities. The check at line 230 and the assignment `active = {runId}` at line 336 are separated by several awaits (stat, mkdir, rememberRoot, legacy stat).

## 中（34）

### #12 Output file/folder names are fixed before processing and never checked against identifiers found in the content

- 位置：`lib/pipeline.js:513`（pipeline，privacy-leak，confirmed）
- 问题：All output paths are computed once with `createPathAnonymizer({ vault, policy, known: [...batchKnown.values()] })`, before any file is processed. For a single-file input batchKnown is an empty Map (`items.length > 1 ? seedBatchKnown(...) : new Map()`). paths.js only uses `known` when the value is bounded by separators. Identifiers found later by rules or the model are never applied to item.outRel, and no residual check runs on output paths. paths.js says such false negatives are 'listed by the residual check like any other leftover', but no such check exists. The original name therefore ends up in the delivered file name and also in relPath in report.json, report.md, index.json, compare/index.json and calls.json.
- 失败场景：Reproduced: a single input file `患者刘洋出院小结.txt` containing '姓名：刘洋…'. The content is anonymized and the run ends 'completed' with the file 'clean'. The delivered file is `out/患者刘洋出院小结.txt`, and report.md contains '刘洋'. The same happens in multi-file batches whenever the name in the path is not separator-bounded or was found only by the model.
- 建议修法：After processing (before writeCompare and delivery), scan every outRel and archive output name for each pseudonym-strategy value in pendingOriginals/batchKnown, without requiring separators for CJK names. Rename the outputs, or at minimum add a blocking review issue so the batch is withheld. Also seed known values for single-file inputs.
- 核实：batchKnown is an empty Map when items.length<=1 (513-515). Paths are mapped once, at 519-523, before any content is processed. No later step feeds content findings back into outRel, and no residual check on paths exists (grep finds none), so the paths.js:10 comment about one is wrong. The reviewer's own example (a glued name, 患者刘洋出院小结) is a limitation README.md:337 already documents. A separator-bounded name shows a real gap, though. Repro $TMPDIR/rv1/r1.mjs with content '姓名：阿依古丽'. Single file `阿依古丽_出院记录.txt` gives status completed, content '姓名：化名-ACD1D5', delivered as in/阿依古丽_出院记录.txt, and report.md has 阿依古丽: true. The same file in a 2-file batch is delivered as '化名-B4317D_出院记录.txt', and report.md has 阿依古丽: false. Model-only findings never reach paths in any batch.

### #13 The last chunk can miss the cross-file re-check for identifiers that a slower file in an earlier chunk finds

- 位置：`lib/pipeline.js:652`（pipeline，correctness，confirmed）
- 问题：finishChunk(i) runs when chunk i's own files are done. Chunk files are gated only on `released[chunk - 2]`, so all files of the last chunk N-1 can finish while a large file of chunk N-2 is still running. The last chunk's recheck then runs without that file's `found` values, which are only added to batchKnown when it finishes. The cross-chunk pass afterwards covers only `chunkFiles.slice(0, -1)`, so the last chunk is never re-checked against them. This breaks the promise that cross-chunk identifiers get one final re-check at the end.
- 失败场景：Reproduced with maxFiles=1 and two files. a.txt '主诉：王建国自述头痛三天。' (chunk 0): the model finds 王建国 after an 800 ms delay. b.txt '陪同人员：家属王建国' (chunk 1): the model finds nothing. Result: status completed, a.txt becomes '化名-…', and b.txt is delivered as '陪同人员：家属王建国'. With no delay, b.txt is correctly replaced, so the outcome depends on timing.
- 建议修法：In the final cross-chunk pass, include the last chunk as well, or every chunk whose recheck started before all chunks had finished. Simplest: after the pool settles, re-check all chunks (reloading from output) against the final batchKnown.
- 核实：finishChunk(i) runs as soon as chunk i's own files finish (633). recheckChain only orders the rechecks in the order they are called. The cross-chunk pass covers chunkFiles.slice(0,-1) (652), so the last chunk is never re-checked against findings that arrive later. Repro $TMPDIR/rv2/r2.mjs with maxFiles=1 and a stub model that finds 王建国 in a.txt after a delay. `node r2.mjs 800` gives: status completed, a.txt '主诉：化名-018617自述头痛三天。', b.txt '陪同人员：家属王建国' (leaked). `node r2.mjs 0` gives b.txt '陪同人员：家属化名-13BA82'. The result depends on timing.

### #14 A verifier finding inside a per-field value list is silently discarded when it is not an entire value

- 位置：`lib/pipeline.js:1617`（pipeline，correctness，confirmed）
- 问题：For numeric/short-code value lists, `const members = segment.members.filter((member) => (vocabField(member) ? member.text.includes(text) : member.text.trim() === text)); if (members.length === 0) continue`. A finding that matches only part of a listed value is dropped with no carryOver, no review issue and no dropItems count. The memo correctly does not cache that value as clean, but the current file is still marked clean.
- 失败场景：Reproduced: CSV `visit,ref_no\nA,12345678/87654321`. The verifier reports {segment:'num:ref_no#0', type:'病历号', text:'12345678'}. The file has no issues at all, `run.totals.dropped` is undefined, and the run completes and delivers `12345678/87654321` unchanged.
- 建议修法：For non-vocabulary lists, attribute the finding to members whose value contains the text with edgesOk boundaries (as locate does), not only to exact matches. When no member matches, push an error issue (model-residual with the list context) instead of `continue`.
- 核实：For a non-vocab value list, members require member.text.trim()===text. If none match, the code does `continue`: no carryOver, no issue, no dropItems. Repro $TMPDIR/rv0/r0.mjs csv 3 (CSV 'visit,ref_no\nA,12345678/87654321'; the verifier reports {segment:'num:ref_no#0', type:'病历号', text:'12345678'}). Output: status completed, dropped undefined, a.csv clean [], no review-items, delivered content 'visit,ref_no\nA,12345678/87654321\n'.

### #15 A verifier finding with a wrong segment id is only counted as dropped, and the real segment is cached as clean

- 位置：`lib/pipeline.js:1609`（pipeline，correctness，confirmed）
- 问题：`let segment = batch.find((item) => item.id === issue.segment); if (!segment || !segment.text.includes(text)) { dropItems(reply.entry, '盲审'); continue }`. The text is not searched for in the batch's other segments. The memo block above keys `flagged` by issue.segment, so the segment that actually holds the text has no flags and gets `memo.set(verifyKeys.get(id), [])`. Later files with the same (field, text) then skip verification too. This is the only safety net after detection, and its finding disappears into a counter.
- 失败场景：Reproduced: note.txt '今日查房，张三与李四同住一室。'. The verifier returns {segment:'t9', type:'姓名', text:'张三'} (wrong id). Result: status completed, file issues [], totals.dropped {盲审:1}, and the output still contains 张三 and 李四.
- 建议修法：When the id does not match or the text is not in that segment, look for the text in the other batch segments (and list members). If it is found, attribute the finding there and keep those segments out of the memo. If it is found nowhere, add a warning, or an error if the text exists anywhere in the document.
- 核实：At 1608-1609 a segment id that does not match goes only to dropItems (a counter in run.totals.dropped), and the text is not searched for in the other segments of the batch. The memo block (1584-1598) keys flagged by issue.segment, so the real segment is cached as clean. Repro `node r0.mjs wrongid 3` (the verifier returns segment 't9' for 张三 and 李四): status completed, dropped {"盲审":2}, note.txt clean [], delivered in/note.txt '今日查房，张三与李四同住一室。'. This needs the model to return a wrong id, but the finding is reduced to a counter and the file is called clean.

### #16 A failed write in recheckBatch leaves the stale output in place, and the batch is still delivered as completed

- 位置：`lib/pipeline.js:1942`（pipeline，robustness，confirmed）
- 问题：recheckBatch updates run.totals.unresolved (`errors - errorsBefore`) and filesReview before it calls `await writeOutput(file, doc, ...)`. If that write fails, writeOutput sets file.status='failed' and pushes a 'write' error, but run.totals.unresolved and run.totals.filesFailed are never incremented. Run status is decided only from those totals (line 782-783), so it can become 'completed' and be delivered. The file on disk is still the earlier write, which contains the batch-known originals the recheck meant to replace.
- 失败场景：In a multi-file batch, file 2 contains a name that file 7 revealed. During the chunk recheck, writeFile fails (for example ENOSPC, or guard.check throws). The run ends 'completed' with filesFailed=0 and unresolved=0. deliverStaged moves the old file 2 output, still holding the name, into the output root.
- 建议修法：After writeOutput in recheckBatch, if file.status becomes 'failed', increment run.totals.filesFailed and run.totals.unresolved (or recompute both from the issues). Better still, delete the stale output on write failure so it cannot be delivered.
- 核实：recheckBatch adds to unresolved and filesReview (1938-1939) before writeOutput (1942). When writeOutput fails it sets status 'failed' and pushes a 'write' error, but no totals change, and run.status is taken only from the totals (782-783). Repro $TMPDIR/rv5/r5.mjs: b.txt's staged output is chmod 0400 while a.txt's model call is in flight, and the model then reveals 王建国 in a.txt. Output: status completed totals {ff:0,un:0}, b.txt status 'failed' with issues [batch-recheck, write], output delivered to out/in, delivered b.txt '陪同人员：家属王建国'.

### #17 Embedded JSON documents: numeric values are never inspected, and rewriting corrupts large integers

- 位置：`lib/layers.js:291`（detection，privacy-leak，confirmed）
- 问题：decodeJsonString walk() collects only string leaves, so numbers such as phone or ID values stored as JSON numbers are never scanned. When any string leaf changes, encode() re-serialises with JSON.parse/JSON.stringify. That loses precision on integers above 2^53 and normalises number formatting. structure() compares only string leaves, so it does not catch the change.
- 失败场景：Verified: a field holding '{"name":"张三","phone":13800138000,"orderId":1234567890123456789}' exposes only the segment '张三'. After 张三 is pseudonymised, serialize() gives '{"name":"化名-ABCDEF","phone":13800138000,"orderId":1234567890123456800}'. The phone leaks unchecked and the 19-digit order/snowflake ID is silently changed.
- 建议修法：Also expose number leaves (as their source text) for scanning. Write back by splicing the edited string tokens into the original JSON text (track token offsets) instead of a parse/stringify round-trip.
- 核实：Repro r3.mjs: a JSON file {payload:'{"name":"张三","phone":13800138000,"orderId":1234567890123456789}'} exposes only segment payload~0='张三'. After applying the pseudonym, serialize() gives orderId 1234567890123456800, and structure() still reports ok:true for both 'JSON 结构' and '编码还原'. The phone stored as a JSON number is never scanned. Lowered to medium: this needs an embedded JSON string holding identifiers as numbers or large ints.

### #18 Identifiers written as '<label>-<digits>' look like pseudonyms and are silently skipped by rules, the model guard and residual checks

- 位置：`lib/rules.js:91`（detection，privacy-leak，confirmed）
- 问题：The pseudonym-lookalike pattern `(?:化名|…|电话|证件|病历|住院|…)-[0-9A-F]{6,10}` has no right boundary. It is used in rules.scan pseudoSpans and in policy.insideProtected PSEUDONYM_TOKEN (policy.js:272). Any real number written after one of these words plus '-' gets its first 6-10 digits treated as a pseudonym. Every detection overlapping that span is dropped. Model detections of the value are also discarded without warning, because echoesPseudonym() returns true for them.
- 失败场景：Verified. scan('联系人：张三 电话-13800138000') returns only the name, and insideProtected('电话-13800138000', 3, 14) is true. scan('证件-11010519491231002X') returns []. The phone or ID card reaches the output, the residual rescan stays silent, and no 'unlocated' warning is raised.
- 建议修法：Anchor the token to the real pseudonym format: exactly 6 hex characters followed by a boundary, e.g. `-[0-9A-F]{6}(?![0-9A-Za-z])`. Better, protect only pseudonyms this vault or run actually produced (the produced/usedPseudonyms sets) instead of any lookalike.
- 核实：Repro r4.mjs: scan('联系人：张三 电话-13800138000') returns only [姓名 张三]. scan('证件-11010519491231002X') returns [], although the bare ID is detected. insideProtected('电话-13800138000',3,14) is true. r4b.mjs: echoesPseudonym(text,'13800138000') and echoesPseudonym(text,'11010519491231002X') both return true, so pipeline.js:1383 drops the model detection without an 'unlocated' warning. Lowered to medium because the 'label-digits' layout is uncommon in Chinese records.

### #19 Labeled-name capture `[一-龥·]{2,4}` truncates long names, misses padded names, and swallows the next label

- 位置：`lib/rules.js:128`（detection，privacy-leak，confirmed）
- 问题：The value is limited to 2-4 contiguous Han/· characters. (a) Minority names with '·' are cut at 4 characters and the rest is left in the output. (b) Names padded with a space, common in forms ('姓  名：张  三'), never match, even though the label regex allows padding. (c) Without a delimiter, the next label is captured as part of the name. Rule detections are not plausibility-checked, and document-wide expansion uses the wrong key. (d) Markdown bold labels ('**姓名**：张三') never match because of the '**'. The same problem applies to the address and record-number labels.
- 失败场景：Verified. '姓名：买买提·艾力江 性别：男' detects '买买提·' and the output is '化名-XXXXXX艾力江'. '姓名：张 三' detects nothing. '姓名:张三性别:男' detects '张三性别', so the '性别' label is destroyed and the bare '张三' elsewhere in the prose is not expanded. '**姓名**：张三，**住址**：杭州市西湖区文三路100号' detects nothing. In rules-only mode these names and addresses leak, and the residual rescan cannot flag them.
- 建议修法：Allow internal spaces and longer '·'-joined names (e.g. `[一-鿿]{1,6}(?:·[一-鿿]{1,10})*`), with spaces stripped for validation. Stop the value at the next known label word. Allow optional markdown emphasis or table pipes between the label and the colon/value.
- 核实：Repro r4.mjs: '姓名：买买提·艾力江 性别：男' detects only '买买提·'. '姓名：张 三' detects nothing. '姓名:张三性别:男' detects '张三性别'. '**姓名**：张三，**住址**：杭州市西湖区文三路100号' detects nothing. These are rule-layer recall gaps that the model may cover, so medium.

### #20 Hospital detector discards real hospital names preceded by 在/于/到/从, and its split leaves '…附属' fragments

- 位置：`lib/rules.js:173`（detection，privacy-leak，confirmed）
- 问题：(1) After a punctuation mark or digit, the greedy match starts at the connective ('在北京协和医院'). The `^[去到在住本该我于从]` check then `continue`s, dropping the whole match without retrying the rest of it. (2) The tail split on `[前后在至于到送往了着的为因系患家属就诊入出转]` includes 属, so '…大学附属第一医院' keeps only '第一医院' and leaves the institution prefix in the output. Connectives that are not in the set (从) end up inside the token.
- 失败场景：Verified. '2周前，在北京协和医院就诊', '，于浙江省人民医院行手术' and '，到杭州市第一人民医院复查' detect nothing. '就诊于中山大学附属第一医院' detects only '第一医院', so the output reads '中山大学附属医院-XXXXXX'. '转浙江大学医学院附属邵逸夫医院' leaves '浙江大学医学院附属'. '1月前从温州市中心医院转入' detects '从温州市中心医院', which gives a different pseudonym than '温州市中心医院' elsewhere.
- 建议修法：Strip leading connectives from the match instead of skipping it. Remove 属 (and other characters that occur inside institution names) from the split set, or split only on multi-character prose patterns. Add 从 to the stripped prefix set.
- 核实：Repro r4.mjs: '2周前，在北京协和医院就诊', '，于浙江省人民医院行手术' and '，到杭州市第一人民医院复查' detect nothing (the leading-connective `continue` at line 173). '就诊于中山大学附属第一医院' gives only '第一医院', and '转浙江大学医学院附属邵逸夫医院' gives '邵逸夫医院' (属 is in the split set). '1月前从温州市中心医院转入' gives '从温州市中心医院'.

### #21 Phone regexes miss common formats: glued +86, spaced/dashed mobiles, landlines in parentheses or with a space

- 位置：`lib/rules.js:107`（detection，privacy-leak，confirmed）
- 问题：The mobile regex requires 11 contiguous digits with `(?<!\d)`. The landline regex requires exactly `0\d{2,3}-\d{7,8}`. The labeled landline regex accepts only bare 7-8 digit numbers.
- 失败场景：Verified: each of these yields no detection: '手机：+8613800138000' (the 6 of 86 fails the lookbehind), '手机：138 0013 8000', 'Tel: 138-0013-8000', '电话：(010)66809363', '电话：010 66809363', '电话：0571 88888888', '电话：01066809363'. Without a model, or if the model misses them, they leak, and the residual rescan, which uses the same regexes, raises no flag.
- 建议修法：Allow an optional (?:\+?86|0086)[ -]? prefix (lookbehind on non-digit before it). Allow 3-4-4 grouping with space/dash. Accept parenthesised or space-separated area codes and 11-12 digit numbers starting with 0 (area code plus local number) after phone labels.
- 核实：Repro r4.mjs, with landline:true: none of these produce a detection: '+8613800138000', '138 0013 8000', 'Tel: 138-0013-8000', '(010)66809363', '010 66809363', '0571 88888888', '01066809363'. The residual rescan at pipeline.js:1503 uses the same scan(), so it raises no flag.

### #22 ID-card rule misses 15-digit IDs and full-width digits

- 位置：`lib/rules.js:104`（detection，privacy-leak，confirmed）
- 问题：Only `\d{17}[\dXx]` with checksum is scanned. plausible() accepts 15-digit IDs, but scan() never produces them, so old-format IDs are caught only by headers or the model. Text is not NFKC-normalised before scanning (the vault normalises keys, the scanner does not), so full-width digits from Chinese IMEs never match the ID, phone, or card rules.
- 失败场景：Verified: scan('身份证：110105491231002') returns [] and scan('身份证：１１０１０５１９４９１２３１００２Ｘ') returns []. In rules-only mode both leak, and the residual check cannot flag them.
- 建议修法：Add a 15-digit ID pattern (6-digit region, YYMMDD with a date check, 3 digits), labelled or validated by date. Scan an NFKC-normalised copy with an index map back to the original offsets (full-width to ASCII is 1:1 in UTF-16 here, so offsets stay valid).
- 核实：Repro r4.mjs: scan('身份证：110105491231002') returns []. Full-width ID '１１０１０５…Ｘ' and full-width mobile '１３８００１３８０００' also return []. NFKC appears only in pseudonym.js and pipeline.js:2085 key normalisation, never before scan().

### #23 Labeled address dropped entirely when a phone or ID follows after a single space

- 位置：`lib/rules.js:191`（detection，privacy-leak，confirmed）
- 问题：cutAddress only stops at a tab, 2 or more whitespace characters, or a known label. With one space before a bare phone or ID, the address span contains that number. resolveOverlaps then gives the higher-priority phone or ID precedence and drops the address completely rather than trimming it.
- 失败场景：Verified: scan('住址：杭州市西湖区文三路100号 13800138000') returns only [电话]. The full street address goes through untouched in rules-only mode, and the residual scan never reports it, for the same reason.
- 建议修法：In resolveOverlaps, trim a lower-priority span to its non-overlapping prefix or suffix instead of discarding it. Or also cut addresses at a bare phone/ID/email match.
- 核实：Repro r4.mjs: scan('住址：杭州市西湖区文三路100号 13800138000') returns only [电话 13800138000]. ADDRESS_STOP needs a tab, 2+ spaces or a label, so the address span includes the phone. resolveOverlaps then drops the lower-priority address.

### #24 Bank-card regex: greedy capture both misses real cards and turns date pairs into 'bank cards'

- 位置：`lib/rules.js:118`（detection，correctness，confirmed）
- 问题：`(?:\d[ -]?){15,19}\d` is matched once per position and validated afterwards. A valid card followed by ' <digit>' is absorbed into a 17-20 digit run that fails the Luhn or length check, and no shorter retry is made. Conversely, any 16-19 digits joined by single spaces or dashes that pass Luhn (about 1 in 10) become a 银行卡号 with priority 95, with no plausibility check for rule hits.
- 失败场景：Verified. '卡号 6222020200001234562 1张' detects nothing, while the card alone is detected. '入院日期 2024-03-01 2024-03-09' (also -17, -25) is detected as 银行卡号 '2024-03-01 2024-03-09'. The two dates are replaced by '银行卡-XXXXXX' and spread document-wide by expansion.
- 建议修法：Require consistent 4-digit grouping or no separators (e.g. `\d{16,19}|\d{4}(?:[ -]\d{4}){3}(?:[ -]?\d{1,3})?`) with non-digit boundaries. Try candidate lengths within a run rather than only the greedy one. Reject runs that parse as dates.
- 核实：Repro r4.mjs: '卡号 6222020200001234562 1张' returns [], while '卡号 6222020200001234562' is detected. '入院日期 2024-03-01 2024-03-09', -17 and -25 each detect a 银行卡号 '2024-03-01 2024-03-XX'.

### #25 Mask strategy reveals almost the whole value for 8-digit landlines and short codes, and returns some addresses verbatim

- 位置：`lib/policy.js:231`（detection，privacy-leak，confirmed）
- 问题：For 电话, keepClass(text, /\d/, 3, 4) keeps 7 of 8 digits for an 8-digit local landline. The labelled landline rule is always on. For 病历号/住院号/就诊号/社保号, keepClass(…, 0, 4) keeps 4 of 5-6 characters. For 地址, `if (keep >= chars.length) return text` returns the original when it ends in 省/市/区/县 within 12 characters. The pipeline then adds that original to `produced`, so later detections overlapping it are treated as protected output.
- 失败场景：Verified. maskValue('电话','66809363') gives '668*9363', with only 10 candidates for the original. maskValue('病历号','123456') gives '**3456'. maskValue('地址','浙江省杭州市西湖区') gives '浙江省杭州市西湖区' unchanged, and from then on that text is exempt in insideProtected for the rest of the file.
- 建议修法：Hide at least half of the digits and never keep more than total-4 (e.g. a landline keeps only the last 2-4). Fall back to a full mask when the value is short. For addresses, always mask at least the final component, and never add an output equal to its input to `produced`.
- 核实：Repro r4.mjs: maskValue('电话','66809363')='668*9363', maskValue('病历号','123456')='**3456', and maskValue('地址','浙江省杭州市西湖区') returns the input unchanged (line 231). pipeline.js:1454 adds any non-pseudonym output to `produced`, which insideProtected (policy.js:278) exempts afterwards. This applies only when the user opts into the mask strategy. Minor inaccuracy in the claim: the labelled-landline rule depends on the policy.landline option and is not always on.

### #26 Implicit-VR DICOM: person-name and other identifying tags missing from the small dictionary are kept

- 位置：`lib/dicom/profile.js:544`（formats，privacy-leak，confirmed）
- 问题：In implicit VR the VR comes from dictVr(), which only knows TABLE plus EXTRA_VR. Any other standard PN tag becomes vr 'UN'/implicitUnknown. The generic `if (vr === 'PN') return removed(...)` therefore never fires, and processUnknown only removes text when rules.scan finds a phone or ID pattern. verifyHeader's PN check also tests `el.vr === 'PN'`, so it passes. Also, LO tags such as (0040,4036) Human Performer's Organization are not in TABLE, so they are kept in either VR when the rules do not fire.
- 失败场景：I verified this with processDicomFile. An implicit-VR LE file with (0008,009C) ConsultingPhysicianName 'CONSULT^DOCTOR', (0040,4035)>(0040,4037) HumanPerformerName 'PERFORMER^NAME' and (3006,00A6) ROIInterpreter 'ROI^INTERPRETER' keeps all three names, with status 'clean' and no issues. The same file in explicit VR removes them. (0040,4036) 'Peking Union Hospital' is kept in both encodings.
- 建议修法：Ship a full PS3.6 VR dictionary (at least every PN, LO/SH/ST/LT, AE and DA tag in Annex E), or treat any implicit unknown printable value under a standard tag as removable unless allow-listed. Add the Annex E tags that are missing (0008,009C/009D, 0040,4036/4037, 3006,00A6, 0040,A027 ...). Make the verification PN check use the dictionary rather than el.vr.
- 核实：Repro: gen3.mjs writes an implicit-VR LE file with (0008,009C) 'CONSULT^DOCTOR', (300600A6) 'ROI^INTERPRETER' and (0040,4035) SQ containing (0040,4036) 'Peking Union Hospital' and (0040,4037) 'PERFORMER^NAME'. Output: all four strings are present, status 'clean', issues []. The same dataset in explicit VR (exp/e.dcm) removes the three names but keeps 'Peking Union Hospital'. Severity is lowered to medium because patient-level PN/ID tags are in TABLE; the gap covers staff/performer names and organizations.

### #27 Known names glued to other CJK text or brackets in file names are not replaced, and the original names reach report.md

- 位置：`lib/paths.js:172`（formats，privacy-leak，confirmed）
- 问题：Known-value matches need separator boundaries, and the separators are only '_', '-', whitespace and '.'. Rule tokens are whole separator-delimited words, and NON_NAME_CHARS rejects '张三病历'. So '张三病历.txt', '张三(1).txt', '【张三】.txt' and '患者张三.txt' keep the name even when 张三 is a known identifier from the batch contents. No residual check scans paths, and the unmapped relPath is written into report.md/report.json. report.js:316 even still says file names are copied unchanged.
- 失败场景：I ran this end to end. With list.csv containing 姓名=张三, the files 张三病历.txt and 张三(1).txt are delivered under those names with status clean. report.md contains them.
- 建议修法：For CJK known values, match as substrings (CJK has no word boundaries), as the DICOM containsToken does, and treat brackets and full-width punctuation as separators. Add a residual scan of output paths against batchKnown and the rules that raises review items.
- 核实：Repro: with list.csv 姓名=张三 in the same batch, the outputs keep the names out3/in3/张三病历.txt and out3/in3/张三(1).txt. report.md lines 114 and 123 contain '### 张三(1).txt' and '### 张三病历.txt'. The known-value match requires SEP_CHAR boundaries (line 172), and NON_NAME_CHARS rejects '张三病历' as a rule token.

### #28 Any path segment containing 'rcd' or 'gehr' is skipped entirely, IDs and phone numbers included

- 位置：`lib/paths.js:210`（formats，privacy-leak，confirmed）
- 问题：`PROTECTED_SEGMENT = /gehr|rcd/i` is a substring test. mapSegment returns the segment untouched before both known-value and rule matching, so one schema word protects every identifier in the same segment.
- 失败场景：I ran this end to end. Files GEHR_110101199003071233.txt and rcd_110101199003071233/x.txt are delivered with the valid ID card number in the name, status clean. report.md contains the ID twice.
- 建议修法：Protect only the matching token(s), not the whole segment, or still run validIdCard, MOBILE and known-value matching on the other tokens of a protected segment.
- 核实：Repro: GEHR_110101199003071233.txt and rcd_110101199003071233/x.txt are delivered with the valid ID unchanged. A control file ctl_110101199003071233.txt becomes ctl_证件-0A85E0.txt. report.md lines 84 and 105 contain the ID. mapSegment returns early on the PROTECTED_SEGMENT substring test.

### #29 An unchanged path can collide with a renamed one, and one file silently overwrites the other

- 位置：`lib/paths.js:242`（formats，correctness，confirmed）
- 问题：The collision loop runs only for changed segments, and only against outputs claimed earlier. An unchanged segment that sorts after a changed one producing the same output name is not checked (`if (!claimed.has(out)) claimed.set(...)` just skips it), and it is not suffixed. writeOutput uses writeFile without 'wx', so the second file overwrites the first.
- 失败场景：I ran this end to end. Batch 1 maps folder 丁一 to 化名-E320D2. Batch 2 on the same output root, with input folders 丁一/r.txt ('NEW-RAW') and 化名-E320D2/r.txt ('OLD-ANON', a previously anonymized copy). Both files map to 化名-E320D2/r.txt. The output holds only NEW-RAW, both files are reported 'clean' and the batch is 'completed'. One record is lost with no warning.
- 建议修法：Claim unchanged outputs too and resolve collisions for every segment, changed or not. Or compute all outputs first and suffix any duplicate. Write outputs with flag 'wx' so a collision fails loudly.
- 核实：Repro: batch 1 (in4/丁一/r.txt) maps 丁一 to 化名-C2300C. Batch 2 on the same root has in5/丁一/r.txt 'NEW-RAW' and in5/化名-C2300C/r.txt 'OLD-ANON'. Output: only out4/in5/化名-C2300C/r.txt exists, containing 'OLD-ANON'. Both files are reported with relPath '化名-C2300C/r.txt', status 'clean', and the batch is 'completed'. An unchanged segment is never collision-checked: `if (!claimed.has(out))` just skips the claim.

### #30 JSON object keys are never scanned, so identifiers used as keys leak

- 位置：`lib/formats.js:351`（formats，privacy-leak，confirmed）
- 问题：flattenStrings walks values only; keys are just path parts. Exports keyed by patient ID, name or phone ({"110101...": {...}}, {"张三": [...]}) are common. Those keys are never segments, never replaced and never residual-checked. shapeOf compares key sets, so the structure check would even prevent renaming a key.
- 失败场景：I ran this end to end. a.json contains the key "110101199003071234" (an ID number). The output keeps the key unchanged and the file status is 'clean'.
- 建议修法：Expose keys as segments (for example id 'k:'+path), apply replacements by renaming the key while preserving order, and adjust the structure check to compare shape modulo replaced keys. At least run the rules on keys and raise review items.
- 核实：Repro: a.json key "110101199003071234" is unchanged in the output and the status is clean. flattenStrings only recurses into values, and shapeOf compares sorted key sets, so a key rename would also fail the structure check. Note: the reviewer's sample key has an invalid checksum (validIdCard false). The code path is the same for any key, so the issue stands.

### #31 JSON round-trip silently changes large integers (and reformats numbers)

- 位置：`lib/formats.js:392`（formats，correctness，confirmed）
- 问题：`JSON.parse` turns integers above 2^53 into doubles, and `JSON.stringify` writes the rounded value back. shapeOf only compares types, so the structure check passes. The same round trip rewrites 1.0 as 1 and 1e5 as 100000, and normalizes indentation.
- 失败场景：I verified this. b.json {"id":110101199003071234} is delivered as {"id":110101199003071230}. 18-digit order, record and snowflake IDs (or numeric ID card numbers) are corrupted, which breaks linkage across files, with status 'clean'. The value is also left semi-identifying instead of pseudonymized.
- 建议修法：Parse with a lossless number representation (keep the raw number text via a custom tokenizer or JSON.parse's source-text reviver on Node 21+), or do targeted in-place string replacement on the original text. Fail or flag files with unsafe integers.
- 核实：Repro: {"id":110101199003071234} in a.json comes out as "id": 110101199003071230 with status clean and the JSON structure check ok. JSON.parse/JSON.stringify lose precision, and shapeOf only compares types.

### #32 XLSX round-trip drops number formats, so date cells become serial numbers

- 位置：`lib/formats.js:459`（formats，correctness，confirmed）
- 问题：The workbook is read with `cellStyles:false` and without `cellNF`, then written back. Cell number formats (z) are lost, along with styles. The structure check compares raw `v` only, so it passes.
- 失败场景：I verified this. Cell B2 with format 'm/d/yy' (shows 3/15/23) comes back with format 'General' and shows 45000.33333. Every admission or birth date column in the delivered workbook shows serial numbers. This breaks the promise that non-text xlsx cells never move.
- 建议修法：Read with cellNF:true and cellStyles:true (and bookVBA etc. as needed) so formats survive. Include `z` in the snapshot and structure comparison.
- 核实：Repro: c.xlsx D2 is {v:45000.33333, z:'m/d/yy', w:'3/15/23'}. After the run it is {z:'General', w:'45000.33333'}, and the structure check '非文本单元格' reports ok because it compares only v.

### #33 Zip-bomb limits are per archive and not cumulative across nested zips; ratio check skips entries of 1 MiB or less; whole archive held in memory

- 位置：`lib/zip.js:415`（formats，robustness，confirmed）
- 问题：The ratio check applies only when `rec.size > MiB`, so any number of exactly-1 MiB, roughly 1000:1 entries are accepted up to maxTotalBytes (2 GiB). readZip then inflates all of them into memory at once. stageArchives calls extractZip(zipPath, dest, limits) separately for every nested archive (depth up to 3), with no shared budget.
- 失败场景：An outer zip of a few MB holds about 2000 inner zips of 1 MiB each, stored or deflated. Each inner zip holds about 1000 entries of 1 MiB of zeros (about 1 KB compressed each). Every archive passes its own checks. The outer extraction allocates about 2 GiB in the plugin's (Harness's) process, and each inner one about 1 GiB more and writes it to tmp. Total disk is in the TB range, so the host process runs out of memory or the disk fills.
- 建议修法：Apply the ratio check to the archive as a whole (sum of sizes / file size) as well as per entry. Share one byte and entry budget across all nesting levels of a staging run. Stream entries to disk one at a time instead of buffering the whole archive.
- 核实：Code read, not run at scale. readZip checks the ratio only when rec.size > MiB (line 415), and maxRatio 1000 is near deflate's maximum anyway. It inflates every entry into an in-memory entries[] array up to maxTotalBytes (2 GiB) before extractZip writes anything. stageArchives.expand (pipeline.js:136-163) calls extractZip(zipPath, dest, limits) separately for each nested zip to depth 3 with no shared byte budget, and no global disk or byte cap exists.

### #34 Explicit-VR 'UN' elements that contain sequences are kept unparsed, including nested identifiers and original UIDs

- 位置：`lib/dicom/profile.js:590`（formats，privacy-leak，confirmed）
- 问题：In explicit VR, a defined-length UN element is stored as a raw value. processUnknown returns it unchanged when it is not printable, which is always the case for an encoded sequence (it has binary length fields). Tags in TABLE are still removed by tag. A sequence not in TABLE that was converted to UN by a node unaware of the tag keeps nested AccessionNumber, RequestedProcedureID, names and original instance UIDs. verifyHeader skips non-printable UN, so it raises nothing.
- 失败场景：An explicit-VR LE file has (0040,0270) ScheduledStepAttributesSequence, or (0008,1140) ReferencedImageSequence, encoded as UN with defined length, holding AccessionNumber or ReferencedSOPInstanceUID. I verified a UN blob containing 'ACC99887': it is copied verbatim and the file is 'clean'.
- 建议修法：For UN elements whose value starts with an item tag (FFFE,E000), parse the value as an implicit-VR LE sequence (PS3.5 §6.2.2) and process its items. Otherwise remove UN elements of standard tags that are not allow-listed, or flag them for review.
- 核实：Repro: gen6.mjs writes an explicit-VR LE file with (0040,0270) as defined-length UN holding an implicit-encoded item with (0008,0050) 'ACC99887' and (0008,1155) original UID '...1698710000.999999'. Output: both strings are present byte-for-byte, the file status is 'clean', issues []. processUnknown returns non-printable values unchanged (line 590), and verifyHeader skips non-printable UN.

### #35 Encapsulated documents (PDF/CDA in DICOM) pass through unexamined with status clean

- 位置：`lib/dicom/profile.js:546`（formats，privacy-leak，confirmed）
- 问题：(0042,0011) EncapsulatedDocument (OB) has no rule and falls through to `return el`. Encapsulated PDF and CDA instances usually carry a full report with patient name, ID and hospital. Unlike the opaque-content handling for text formats, nothing raises a review item, and the warning about pixel data does not cover these objects.
- 失败场景：A DICOM Encapsulated PDF (SOP class 1.2.840.10008.5.1.4.1.1.104.1) whose PDF contains '姓名：张三 身份证…' is delivered byte-identical, with status 'clean' and the batch 'completed'.
- 建议修法：Remove (0042,0011) or mark such files 'review' with an opaque-content issue. Treat other non-pixel binary payloads (waveforms, (0042,0011), overlays 60xx,3000) the same way.
- 核实：Repro: same u.dcm (SOP class 1.2.840.10008.5.1.4.1.1.104.1) with (0042,0011) OB '%PDF-1.4\n姓名：张三 身份证110101199003071233...'. The output still contains '110101199003071233', status 'clean', issues []. OB with no rule falls through to `return el` at line 546, and nothing in dicom/index.js flags encapsulated documents.

### #36 undoMappings and reviewDecide 'replace' load and save the vault while another batch on the same root holds it in memory: the undo is silently reverted and review mappings are lost

- 位置：`lib/service.js:860`（host，correctness，confirmed）
- 问题：undoMappings only refuses when `active?.runId === id`. reviewDecide likewise only blocks its own run id. Both create a fresh `new Vault(paths.vault)`, change it, and save the whole file. A batch running on the same output root loaded the vault at its start and rewrites the full entry list on every `vault.save()` (after each file). Entries the undo removed come back, and entries reviewDecide added (`vault.token(...)` at line 713) disappear.
- 失败场景：Batch B is running on root R. The agent calls anonymize_undo_mappings for an earlier batch A on R, which reports 'removed 12' and saves. Seconds later B finishes a file and calls vault.save() with its in-memory entries, restoring A's 12 mappings, so the undo never took effect. In the other direction: a reviewer replaces a value in batch A's deliverable while B runs. The new pseudonym's mapping is overwritten by B's next save, so the delivered pseudonym has no original in the vault.
- 建议修法：Refuse vault-mutating operations (undoMappings, reviewDecide replace) while any batch is running on the same output root. Better, serialize all vault access per root through one shared Vault instance or a file lock, and re-read and merge before each save.
- 核实：Code reading. undoMappings (line 851) and reviewDecide (line 692) refuse only when active.runId equals their own id. Each builds a new Vault, loads it, edits it and saves the whole file. The running batch's Vault (pipeline.js:306) loaded every entry at its start, and saveNow() rewrites `entries: [...this.entries.values()]` whenever it is dirty, which is after any new mapping. That restores entries removed by undo and drops entries added by reviewDecide. Not reproduced live; it needs a long-running concurrent batch on the same root.

### #37 Original input folder/file name (e.g. containing patient name/ID) persists in report.md, report.json, index.json and agent tool results when a batch is cancelled or fails before path mapping

- 位置：`lib/pipeline.js:532`（host，privacy-leak，confirmed）
- 问题：run.inputDir is set to the raw inputDir and only replaced with the anonymized shownName at line 532, which runs after seedBatchKnown. On a cancel during '批次预扫', or on any exception before that point, the report is written with the original name. Separately, service.js's `.catch` (lines 407-417) writes `{...placeholder, error}` to report.json, where placeholder.inputDir = absoluteInput (original), and error messages such as `无法读取输入路径: EACCES ... '/data/张三_.../x.txt'` embed original nested paths. While a batch is still in its prescan, anonymize_status and list() also return the original inputDir to the agent.
- 失败场景：Reproduced: start on `/tmp/x/张三_110101199003071234` (3 files), then cancel immediately. status() shows inputDir `/tmp/x/张三_110101199003071234`. report.md contains ``- 输入：`/tmp/x/张三_110101199003071234` ``, and _records/index.json contains the name as well. A completed batch would have shown the anonymized name. anonymize_report then hands this text to the agent's (possibly cloud) model.
- 建议修法：Compute the displayed input name before emitting any run state, or store a neutral placeholder until the path mapper exists. In service.js's catch path, never persist absoluteInput or raw error messages. Reduce errors to a code or category the way zipProblem does.
- 核实：Ran service.start on .../x/张三_11010519491231002X (3 files) followed by an immediate cancel. status inputDir, final run.inputDir and the report.md line '- 输入：`.../x/张三_11010519491231002X`' all held the original name, and _records/index.json contains '张三'. The same input run to completion showed '.../x/化名-862902_证件-23801B'. While a batch is running, status shows the original name until line 532.

### #38 Parser error messages (V8 JSON.parse quotes the source) are copied verbatim into issue details, report.md and the agent report

- 位置：`lib/pipeline.js:928`（host，privacy-leak，confirmed）
- 问题：`file.issues.push({ severity: 'error', code: 'load', detail: String(error.message ?? error) })`. Since Node 20, V8 SyntaxError messages include a window of the input text. renderMarkdown prints every issue.detail under '问题：', and anonymize_report returns report.md to the agent. The same pattern applies to `pipeline` (1682), `write`, and `quasi` errors.
- 失败场景：Reproduced: a malformed record `{"name": 张三, "id": "110101199003071234"}` produces report.md line `- ❌ Unexpected token '张', "{"name": 张三, "id": "... is not valid JSON`, so the patient name is in the report and in the agent's tool result.
- 建议修法：For load and parse errors, report only a fixed category ('JSON 格式错误，位置 N') and drop error.message, or strip anything after the first comma or quote in SyntaxError messages. Apply the same treatment to the other places that copy raw error.message into issue.detail.
- 核实：Ran runBatch on r.json = '{"name": 张三, "id": "110101199003071234"}'. The issue detail and report.md contained the line `- ❌ Unexpected token '张', "{"name": 张三, "id": "... is not valid JSON`. Nothing scrubs issue.detail before report.js:209/238.

### #39 Field names (CSV/XLSX header cells, JSON keys) are printed unmasked in issue details and the report's 字段画像 table, even when the header cell itself is an identifier

- 位置：`lib/pipeline.js:1508`（host，privacy-leak，confirmed）
- 问题：fieldSuffix(field) returns `（字段 ${field}）` and is appended to residual, suspect, disputed and model-residual details. XLSX fields are `${sheet}!${headerCell}`, and CSV fields are header[c]. report.js:270 also lists every profiled field name. The values are masked with maskForReport, but the field names are not. In headerless CSVs or pivoted sheets the 'field name' is patient data (advisor.js's own comment acknowledges this).
- 失败场景：Reproduced: CSV first row `张三,110101199003071234,13800138000`. report.md contains `⚠️ 疑似身份证号但校验位不符：11******（字段 110101199003071234）`, so the masked value sits next to a full ID number taken from the header. In an XLSX with patient names as column headers, the header cell is replaced in the output, but the same name still appears in report.md through `（字段 Sheet1!张三）`.
- 建议修法：Run field names through the same rule check before they go into reports, and mask any name that matches an identifier rule or that was replaced in the document. Alternatively, refer to columns by index or letter in report-bound text and keep the real field names only in 0600 review files.
- 核实：Ran runBatch on an XLSX with header row ['项目','张三丰','李四光'] and a bad-checksum ID under 李四光. report.md contains '- ⚠️ 疑似身份证号但校验位不符：11******（字段 Sheet1!李四光）'. The field name comes from fieldSuffix (line 2096) unmasked, and report.js:270 likewise prints profiled field names raw.

### #40 Model-authored 'reason' text is inserted unmasked into report-bound issue details

- 位置：`lib/pipeline.js:1633`（host，privacy-leak，plausible）
- 问题：The disputed detail ends with `（识别模型认为不是标识符：${dispute.reason || '未说明'}）`. verify-dismissed (line 1689) appends `（${item.reason || '未说明'}）`. The reason is the adjudicator's free text, truncated to 120 characters (line 1286). The candidate text itself is masked with maskForReport, but models routinely quote the candidate in their reason, and adjudicatePrompt does not forbid it. Endpoint error bodies (llm.js:169 `text.slice(0, 400)`) are similarly copied into model-unchecked details (lines 1648 and 1659) and the profile warning (1190).
- 失败场景：The verifier flags '王建国' and the adjudicator replies `{"i":0,"identifier":false,"reason":"王建国为药品生产厂家联系人，不是患者"}`. report.md then shows `核验与识别意见不一致：姓名 王建** ...（识别模型认为不是标识符：王建国为药品生产厂家联系人，不是患者）`, and the full name reaches anonymize_report and the agent.
- 建议修法：Remove every occurrence of the candidate text, and any known vault original, from model reasons before storing them in issue.detail. Alternatively, keep reasons only in the 0600 review-items.json and use a fixed phrase in the report. Reduce endpoint error bodies to a status code or category in report-bound details.
- 核实：Code reading. The reason is taken from verdict.reason (line 1286, sliced to 120 characters) and interpolated raw into disputed details (line 1633) and verify-dismissed details (line 1689). No scrub or redact pass exists in pipeline/report (grep found none). The http-error detail from llm.js:169 (text.slice(0,400)) also flows into issue details. Whether an original value leaks depends on the model quoting it, so this was not demonstrated.

### #41 Request timeouts are classified as 'network', not 'aborted': timed-out batches are retried at full size and never split

- 位置：`lib/llm.js:175`（host，robustness，confirmed）
- 问题：`controller.abort(new Error('模型请求超时'))` aborts with a custom reason, so fetch rejects with that plain Error (name 'Error'), not an AbortError. The check `error?.name === 'AbortError'` fails, and the timeout becomes `LlmError(..., 'network')`. chatJson then retries the same oversized request once more (2 × timeoutMs). pipeline.splitting() only splits on code 'aborted', so its documented 'timed out → split in two' path never runs. The segments end up in 'model-unchecked' (manual review), and the call log shows 'network' instead of 'timeout'. Note: simply switching to 'aborted' would trip pipeline.js lines 1265 and 1646, which treat any 'aborted' as user cancellation (`throw new Error('已取消')`).
- 失败场景：Verified in Node 22: aborting fetch with `new Error('模型请求超时')` rejects with name='Error'. A 60-segment detection batch that needs longer than timeoutMs (default 120 s) takes 240 s, fails both attempts, is not split into smaller requests, and the file's segments go unchecked by the model. The advisor then suggests raising the timeout instead.
- 建议修法：Give the timeout its own code, e.g. `if (controller.signal.aborted && !signal?.aborted) throw new LlmError('模型请求超时', 'timeout')`. Have splitting() treat 'timeout' as splittable. Reserve 'aborted' for user cancellation (signal?.aborted).
- 核实：Repro: a local HTTP server that never answers, with createLlm({timeoutMs:1000}).chatJson(...). Result: code 'network', message '无法连接模型端点: 模型请求超时', attempts 2, about 3205 ms, 2 server hits. The abort carries a custom Error reason, so error.name is not 'AbortError'. pipeline.js:1089 splits only on 'aborted', so a timed-out batch is never split, and line 1064 never labels it 'timeout'.

### #42 Vault passphrase change has no re-key path, and enabling a passphrase can leave an existing vault in plaintext

- 位置：`lib/pseudonym.js:72`（host，security，confirmed）
- 问题：normalizeDefaults accepts any new vaultPassphrase and saveDefaults stores it, but nothing re-encrypts existing vaults. After a change, every vault encrypted with the old passphrase fails in decrypt() with the bare crypto error 'Unsupported state or unable to authenticate data'. That breaks new batches (thrown from runBatch before its try, so service writes only report.json and no index entry), undoMappings, and reviewDecide replace. Conversely, when a passphrase is first set over a plaintext vault, saveNow() returns early unless `dirty`. A batch that creates no new mapping leaves vault.json in plaintext while configInfo reports `vaultEncrypted: true`.
- 失败场景：(1) The user changes the passphrase from 'old-secret' to 'new-secret' on the page. The next batch on any existing output root fails with a cryptic auth error, and the earlier batches' mappings cannot be undone or extended unless the old passphrase is restored. (2) The user enables encryption, then reruns a dataset whose identifiers are all already mapped. vault.json, holding every original, stays plaintext indefinitely while the page says it is encrypted.
- 建议修法：On load, record whether the file was plaintext and force `dirty = true` when a passphrase is configured, so the next save encrypts it. Turn the decrypt failure into a clear message ('映射库口令不匹配'). For passphrase changes, either require the old passphrase and re-encrypt known vaults (knownRoots), or warn the user that existing vaults will need the old passphrase.
- 核实：Repro via createService: (1) First batch run without a passphrase. Rerunning the same data with vaultPassphrase 'old-secret' gave status completed, vault.json still plaintext (no 'aes-256-gcm'), and configInfo().vaultEncrypted === true. The vault became encrypted only after a later batch added a new mapping. (2) A service with 'new-secret' then failed with 'Unsupported state or unable to authenticate data'. No re-key code exists in the repo (grep for dirty/passphrase).

### #43 Review items, comparison list and advice are fetched before the batch's records exist, and the failure is cached for good, so manual review can't be reached

- 位置：`client.js:3218`（client，correctness，confirmed）
- 问题：`runs` in lib/service.js keeps the live pipeline `run` object (`onEvent: ({ run: current }) => runs.set(runId, current)`). lib/pipeline.js sets `run.status = 'review'|'completed'` at line 782. It writes report.json and advice.json much later, at lines 851 and 882. Between those points it hashes every source file (`changedSince`), delivers or stages the output, saves the vault and writes calls.json. During that window `status` already reports a non-running status, so `adviceRunId` becomes set. Three effects then fire: `loadReview(adviceRunId)` (line 3218), `loadCompareList` (line 3267) and `call('advice')` (line 3298). reviewItems and compareList both call `loadRunRecord`, which reads report.json; it is missing, so they throw and the client stores `null`. `advice()` returns null. Each effect only loads when the cached value is `=== undefined`. Their deps (`[adviceRunId, current?.status]` and `[adviceRunId]`) do not change again, so they never retry.
- 失败场景：The user starts a batch from the page and it ends with unresolved items. Source hashing over a large input takes several seconds, so the 2-second tick sees the 'review' status before report.json is written. reviewByRun[id] and compareByRun[id] become null and adviceByRun[id] becomes null. Result: reviewOpen = 0, the '打开复核' link and clickable file rows are gone, the advice tab says there are no suggestions, and the review station shows '0 held'. The withheld deliverable can only be released by deciding every review item, so it stays withheld until the user reloads the whole page.
- 建议修法：Don't cache failures or nulls as final: store `undefined`, or an error marker with a retry. Better, only fetch once the batch is really finished (`activeRunId !== id`, or `current.finishedAt`). Re-run the effects when `activeRunId` changes. On the server, set `run.status` only after report.json and advice.json have been written.
- 核实：pipeline.js emit() passes the live `run` object, and service.js onEvent does runs.set(runId, current), so status() hands back that live object. pipeline.js:782 sets status to review/completed. report.json is only written at :881, after changedSince, deliver, advise, vault.save, replay flush and calls.json. Client adviceRunId (client.js:3205) only checks current.status !== 'running', not anyRunning. loadReview and loadCompareList cache null when the call throws, and advice caches null. All three only reload while the cached value is === undefined. Their deps ([adviceRunId, current?.status] and [adviceRunId]) do not change again. The report fetch in tick, by contrast, deletes from reportLoaded on error so it retries. Repro: $TMPDIR/r0/r0.mjs (300 files, 40 of them 2 MB, model '') polls svc.status every 5 ms. `node r0.mjs` printed: `status= completed report.json exists= false active= 20261109150002-fdfd22 / reviewItems threw: ENOENT / compareList threw: ENOENT / advice= null / report written; window polls without report = 2`. The window is real and also hits completed batches, where the comparison list gets cached as null.

### #44 A 'replace' review decision is allowed while another batch is running, so two writers race on the shared vault

- 位置：`client.js:3861`（client，robustness，confirmed）
- 问题：The 'allow' button is disabled with `anyRunning`, but the 'replace' button is only gated by `reviewBusy !== null || !file.editable || !item.text`. On the server, `reviewDecide` (lib/service.js:689) only refuses when `active?.runId === id`, i.e. when the same batch is running. For 'replace' it creates a new `Vault(paths.vault)`, loads it, calls `vault.token(...)` and saves it. A batch running into the same output root keeps its own in-memory Vault loaded at start and saves the whole map on every `vault.save()` (pipeline.js:581/612/665/862) without merging. Both instances write to the same temp path `${file}.tmp-${process.pid}` (same process) and then rename it over the vault.
- 失败场景：Batch A finished with review items. The user starts batch B into the same output root (the default, beside the same input parent) and, while B runs, clicks '替换' on an item of A. A new mapping X -> 病历-1A2B3C is saved and written into A's deliverable. B's next or final save overwrites the vault with B's in-memory entries, which don't include that mapping. A's delivered file now contains a pseudonym that can't be reversed from the vault, which is supposed to be the only place holding originals. In the worse case, the two writeFile calls interleave on the same tmp file and a mixed or truncated vault gets renamed into place; an encrypted vault then fails GCM authentication and every mapping is lost.
- 建议修法：Disable 'replace', 'remove' and the bulk actions in the UI while `anyRunning`. Also make reviewDecide and reviewBulk refuse while any batch is active. Or route vault writes through a single shared Vault instance / lock per vault path, merging on save and using unique temp names.
- 核实：The replace button (client.js:3860-3862) is gated only by reviewBusy, file.editable and item.text; allow (3863) also has anyRunning. Server reviewDecide (service.js:691) only refuses when active?.runId === id. If item.replacement is missing, it does new Vault(paths.vault).load(), then token(), then save() (708-714). The pipeline Vault (pipeline.js:306) is loaded once, and saveNow writes all of its in-memory entries with no merge (pseudonym.js:164-191). The tmp name `${file}.tmp-${process.pid}` is the same in both. Save serialization is per instance, so two instances can share the tmp file. Repro $TMPDIR/r1/r1.mjs: batch B instance loads, review instance tokens 王五 and saves, then B tokens 李四 and saves. Output: `review token 化名-0229FF -> still in vault? false`. undoMappings (service.js:851) has the same pattern.

### #45 Testing or listing models for a new, unsaved detection endpoint sends the saved API key to that host, even when 'clear saved key' is checked

- 位置：`client.js:2157`（client，security，confirmed）
- 问题：The model picker calls `call('ping', { baseURL: endpoint.trim(), apiKey })` when the model field gets focus. 'Test connection' sends `{ baseURL: endpoint.trim(), model, apiKey }` (line 2052). When the key field is empty (placeholder '已保存，留空表示不修改') or `clearKey` is checked, `apiKey` is ''. `service.ping` → `resolveModel` uses `request.apiKey || settings.apiKey`, so the saved key goes to whatever endpoint was just typed. The verify path deliberately prevents this: 'the detection key only when the endpoint is the detection one (never sent to another server)'. The detection path has no such check, and the UI gives no hint that the saved key will be sent.
- 失败场景：A user has a paid cloud key saved for endpoint A. To check another server, they type `http://some-other-host/v1` into 端点 and click the 模型名称 field, or click 测试连接. `Authorization: Bearer <saved key>` is sent to the other host before anything is saved. Checking '清除已保存的 API Key' first doesn't help: ping still falls back to the saved key.
- 建议修法：In the client, send a flag such as `useSavedKey: !clearKey` and the original baseURL. On the server, apply the same rule as for verify: only fall back to `settings.apiKey` when the normalized request baseURL equals the saved `settings.baseURL` and the user hasn't asked to clear the key.
- 核实：client.js:2157 fetchModels and :2052 testConnection both send { baseURL: endpoint.trim(), apiKey } with apiKey possibly ''. The clearKey checkbox (2168) only does setApiKey(''). service.ping -> resolveModel (service.js:191) uses request.apiKey || settings.apiKey. The sameEndpoint guard only applies when keySource==='verify'. Repro $TMPDIR/r2/r2.mjs: service config apiKey 'sk-SAVED-SECRET', then ping({ baseURL: 'http://127.0.0.1:18999/v1', apiKey: '' }). Output: `other host received: [ 'Bearer sk-SAVED-SECRET' ]`.

## 低（17）

### #46 Batches that time out are never split, because timeouts surface as 'network' errors, not 'aborted'

- 位置：`lib/pipeline.js:1089`（pipeline，correctness，confirmed，同 #41）
- 问题：`splitting` retries a smaller batch only for bad-json, bad-shape, or `error?.code === 'aborted' && !signal?.aborted`. llm.js aborts timeouts with `controller.abort(new Error('模型请求超时'))`, and Node fetch then rejects with that reason (name 'Error', not 'AbortError'), so request() turns it into LlmError code 'network'. Verified on Node 22: name 'Error', message '模型请求超时'. As a result the timeout split path never runs, and timedCall never logs 'timeout' (it logs 'network').
- 失败场景：A slow local model times out on a 60-segment, 4000-character detection batch. chatJson retries the same batch once (2 × timeoutMs), the batch is not split, and every segment is marked 'model-unchecked'. The file goes to manual review even though halving the batch would have succeeded.
- 建议修法：In llm.js request(), map an abort caused by the timer (controller.signal.aborted while the user signal is not) to code 'aborted' (or 'timeout'), and accept that code in `splitting`. Alternatively, in splitting, treat 'network' errors whose message is the timeout message as retriable.
- 核实：llm.js request() aborts with controller.abort(new Error('模型请求超时')). fetch rejects with that reason (name 'Error', not 'AbortError'), so it becomes LlmError 'network'. Repro $TMPDIR/rv6/r6.mjs (a server that answers after 2 s, timeoutMs 200): `v22.23.1 code= network msg= 无法连接模型端点: 模型请求超时 attempts= 2`. So splitting's `error?.code==='aborted'` branch (1089) never fires on a timeout, and timedCall logs 'network' rather than 'timeout'. The batch is retried once at full size and is never halved. The impact is extra manual review, not a leak.

### #47 Write guard accepts symlinks under the output root that resolve to input files (default layout)

- 位置：`lib/guard.js:69`（detection，security，confirmed）
- 问题：check() treats a target as inside the output root if either the real path OR the lexical absolute path is inside it. In the input check, the exemption `inside(absolute, root)` applies whenever the output root lies inside the input (the default _medical-anonymizer next to the input). A symlink in the output tree pointing to a source file therefore passes, and writeFile follows it, despite the header's promise to resolve symlinks.
- 失败场景：Verified on a symlink-free temp path. Input D contains patient.txt. D/_medical-anonymizer/index.json is a symlink to D/patient.txt (for example, copied in with an old output folder, or created by a sync tool). check('D/_medical-anonymizer/index.json') returns '…/patient.txt' instead of throwing, so updateIndex() would overwrite the read-only source.
- 建议修法：Decide using only the real path: require real inside a real output root, and refuse when real is inside an input root unless real (not absolute) is inside a real output root that sits inside that input. Alternatively, lstat the target and refuse existing symlinks.
- 核实：Repro r12.mjs on a symlink-free path (realpath of TMPDIR): D/patient.txt plus D/_medical-anonymizer/index.json -> ../patient.txt. check(index.json) returns '/private/.../D/patient.txt' without throwing, because the exemption accepts inside(absolute, root). On the raw /var TMPDIR path, the /var->/private/var mismatch happens to block it. Lowered to low: it requires a pre-existing symlink inside the output tree, and the fingerprint check would detect the change after the fact.

### #48 Vault saves are last-writer-wins across instances; undo or review edits made during another batch are silently reverted

- 位置：`lib/pseudonym.js:164`（detection，robustness，confirmed，与 #36 同根）
- 问题：Each Vault instance loads the file once and saveNow() writes its own entries map wholesale, with no reload, merge or lock. service.undoMappings and review 'replace' create separate Vault instances and only block when the *same* runId is active. A different batch on the same output root keeps its stale in-memory copy and overwrites the file on its next save.
- 失败场景：Batch B is running on output root R. The user undoes batch A on the same root, and forgetRun removes A's mappings and saves. B's next vault.save() rewrites the full entry list it loaded at start, including A's entries, so the undo is silently reverted. Likewise, a review-replace mapping saved during B is lost.
- 建议修法：Serialize vault access per file across the service: refuse undo or review while any batch on the same root is active, or re-read and merge (respecting deletions) under a lock file in saveNow().
- 核实：Code reading: Vault.load reads the file once, and saveNow writes [...this.entries.values()] wholesale with no reload or merge. service.js only allows one active batch, but undoMappings (854) and reviewDecide (691) refuse only when active.runId === their own id. A running batch B on the same root therefore keeps A's entries in memory and rewrites them on its next dirty save, which reverts the undo. A review-replace mapping saved during B is lost the same way. Not run end to end.

### #49 Date shift leaves month-only dates unshifted next to shifted full dates, exposing the real timeline and the offset

- 位置：`lib/policy.js:394`（detection，privacy-leak，confirmed）
- 问题：In CJK_DATE handling, `if (!ds) continue` under the 'shift' strategy leaves '2024年3月' as is. ISO 'YYYY-MM' is not matched at all. Full dates in the same document are shifted by up to ±365 days.
- 失败场景：'2024年3月起病，2024年3月15日入院' becomes, for example, '2024年3月起病，2024年04月21日入院'. The unshifted true month sits next to shifted dates, revealing the real onset month and bounding the secret per-root offset. That offset applies to every file under the output root.
- 建议修法：Shift month-only dates by shifting the 15th of that month and printing year and month, or apply the 'month' generalisation to them. Do the same for ISO YYYY-MM.
- 核实：Repro r14.mjs: quasiReplacements('2024年3月起病，2024年3月15日入院，2024-03 复查', {日期:'shift'}, 37) returns only the 3月15日→4月21日 replacement. '2024年3月' and '2024-03' are left unchanged, and nothing warns about it. This is intentional per the comment at line 394, but it exposes the real month next to shifted dates.

### #50 CSV output converts CRLF line endings to LF

- 位置：`lib/formats.js:321`（formats，correctness，confirmed）
- 问题：parseCsv accepts \r\n, but serialize() always joins rows with '\n' and writes a '\n' trailing newline. The structure checks do not compare line endings.
- 失败场景：I verified this. A Windows CSV 'a,b\r\nc,d\r\n' is delivered as 'a,b\nc,d\n'. Tools that diff or expect CRLF see every line changed. This breaks the promise that structure never moves.
- 建议修法：Record the original line terminator (CRLF if the first record ends with \r\n) and use it in serialize().
- 核实：Repro: crlf.csv '姓名,备注\r\n王五,无\r\n' produces output lines ending in '$' with no \r (sed -n l), status clean. serialize joins rows with '\n' and appends '\n'.

### #51 Output-root detection misses legacy custom-named roots, and the selected directory itself is never checked

- 位置：`lib/layout.js:108`（formats，privacy-leak，confirmed）
- 问题：isOutputRoot recognizes only the default names or `_records/vault.json|index.json`. A pre-0.8 root with a custom name still has vault.json, index.json and runs/ at its top level until migrateLegacy runs, and that only happens for the current run's root. In listInputFiles the select branch calls walk(path) on a chosen directory without calling isOutputRoot on it.
- 失败场景：An input folder contains an old, un-migrated output root 'anon-2024/' with vault.json (original values + salt) and runs/*/path-map.json. It is not excluded, so these .json files are read as patient records and their processed copies are delivered with the data. The same happens when the user multi-selects a sibling '_medical-anonymizer' folder while writing to a different output root.
- 建议修法：Also treat a directory as an output root when it holds vault.json/index.json at its top level (legacy layout). Apply isOutputRoot to selected directories and to the input root itself, refusing or skipping them.
- 核实：Repro run7.mjs: listInputFiles(p7, {select:['a','_medical-anonymizer']}) returns p7/_medical-anonymizer/_records/vault.json as an input file. listInputFiles(p7) on a tree with legacy/vault.json + legacy/index.json (a pre-0.8 custom-named root) returns both as input files. The select branch (pipeline.js:108) walks a chosen directory without isOutputRoot, and isOutputRoot (layout.js:34) only checks _records/*. Severity stays low because it needs the user to select an output root or keep an un-migrated legacy root inside the input.

### #52 Plugin reapply (config save) orphans a running batch: the isRunning() check races, and no dispose effect cancels or tracks the batch

- 位置：`index.js:316`（host，correctness，plausible）
- 问题：saveDefaults checks `service.isRunning()` and then awaits `editor.edit(...)`, which reapplies the plugin and creates a fresh service with `active = null`. A start RPC or tool call that arrives during that await (or the start race above, which can make isRunning() false mid-batch) begins a batch in the old service. Nothing in apply() registers an effect that aborts or hands over the active batch on dispose. The same happens on any external reapply, such as the profile YAML being edited.
- 失败场景：The user clicks Save while the agent's anonymize_start call is in flight. The plugin reloads, and the batch keeps running in the disposed service. anonymize_cancel and anonymize_status in the new instance cannot see it ('当前没有运行中的批次'), and a new batch on the same root can start and race the old one on vault.json (mappings lost, as in the start-race finding).
- 建议修法：Register `ctx.effect(() => () => service.dispose())`, where dispose aborts the active controller (or waits for it). Inside saveDefaults, take a synchronous 'saving' lock that start() also checks, so no batch can start between the check and the reapply.
- 核实：Code reading. saveDefaults checks isRunning() and then awaits editor.edit, which reapplies the plugin. apply() registers effects only for the command and the rpc route; nothing cancels or hands over an active batch on dispose. The start() window between line 230 and line 336 (see #1) also lets isRunning() be false while a start is in flight. Not demonstrated, because it depends on the Harness reapply and dispose behaviour and on narrow timing.

### #53 Saved API keys are sent to ad-hoc endpoints (ping with a typed URL, /anonymize --endpoint)

- 位置：`lib/service.js:191`（host，security，confirmed）
- 问题：resolveModel uses `apiKey = request.apiKey || settings.apiKey` together with `baseURL = request.baseURL || settings.baseURL`. For a detection-model ping, and for `/anonymize --endpoint URL` (index.js:229), the saved detection key goes to whatever URL was typed. For a verify ping, `settings.verifyApiKey` goes to any request.baseURL. The comment at line 870 says the key is 'never sent to another server', but only the detection-key fallback in the verify branch is guarded.
- 失败场景：The user's saved config uses a paid cloud endpoint with key sk-A. While evaluating another provider, they type `https://other-provider.example/v1` on the page and click Test, or run `/anonymize data --endpoint https://other.example/v1`. sk-A is sent as a Bearer token to the third-party host.
- 建议修法：Send a saved key only when the target baseURL equals the saved baseURL it belongs to (after normalization). Otherwise use only a key supplied explicitly in the same request.
- 核实：resolveModel: `apiKey = request.apiKey || settings.apiKey` with `baseURL = request.baseURL || settings.baseURL`. ping (detection path), panel start with baseURL, and `/anonymize --endpoint` (index.js:229) therefore send the saved key to the typed URL. Only the verify ping guards the detection key, and even it sends settings.verifyApiKey to any request.baseURL. Only user-initiated paths are affected: the agent tool does not accept baseURL.

### #54 listModels ignores HTTP status, so 'test connection' reports success on 401/403 with a JSON error body

- 位置：`lib/llm.js:261`（host，correctness，confirmed）
- 问题：There is no `response.ok` check. An OpenAI-style 401 body `{"error":{...}}` parses fine, `data.data` is undefined, and the function returns []. ping() then returns `{ ok: true, models: [] }`.
- 失败场景：The user enters a wrong API key and clicks test. The page shows the connection as OK with an empty model list. The batch then fails on every call, or falls back to manual review.
- 建议修法：If !response.ok, throw an LlmError with the status code (without echoing the body).
- 核实：Repro: a local server answering /v1/models with 401 and body '{"error":{"message":"bad key"}}'. llm.listModels() returned [] with no error, so ping() returns {ok:true, models:[]}.

### #55 Agent tools for status/report/undo cannot find batches after a restart unless list() ran first

- 位置：`lib/service.js:447`（host，correctness，confirmed）
- 问题：report(), status() (via loadRunFromDisk) and undoMappings() resolve the root with `runRoots.get(id) ?? configuredRoot()`. runRoots is only filled by start() or list(). With the default empty outputRoot (output beside the input), after a Harness restart the knownRoots in roots.json are never consulted on these paths. start(resumeFrom) and deleteRun call `await list()`, but these three do not.
- 失败场景：After a restart, the agent calls anonymize_undo_mappings with a valid runId and gets '找不到批次 … 的输出位置', or anonymize_status returns found:false, even though anonymize_runs would list the batch.
- 建议修法：Call `await list()` (or a lighter root lookup over knownRoots) before runRoot(id) in report, status/loadRunFromDisk and undoMappings, as deleteRun does.
- 核实：Repro: s1 = createService({stateDir}) ran a batch with the default (beside-input) root. A fresh s2 with the same stateDir gave status found:false, report ERR '找不到批次 ... 的输出位置；请先在本次会话中运行...', and undoMappings ERR '找不到批次 ... 的输出位置'. After `await s2.list()`, status found:true.

### #56 /anonymize splits arguments on whitespace, so paths with spaces cannot be used

- 位置：`index.js:217`（host，correctness，confirmed）
- 问题：`String(invocation.rawInput).trim().split(/\s+/)` uses the first token as inputDir and makes every later token an option. There is no quoting support.
- 失败场景：`/anonymize "/data/Patient Records"` is parsed as inputDir '"/data/Patient' and fails with `未知参数 Records"`. Common macOS folder names cannot be passed.
- 建议修法：Parse with quote support, or treat everything before the first `--flag` as the path.
- 核实：Code reading. `String(invocation.rawInput ?? '').trim().split(/\s+/)` has no quote handling. The first token is inputDir and any further token that is not a known flag returns '未知参数 ...'. A path containing a space cannot be passed.

### #57 The calls tab of a finished batch loads only its first 2000 calls, but labels them as the latest and computes totals from them

- 位置：`client.js:3471`（client，correctness，confirmed）
- 问题：`calls()` in service.js returns `log.filter(seq > since).slice(0, 2000)`, and the call log keeps up to 20000 entries. The client polls only while `running` (`const timer = running ? setInterval(pull, 2000) : null`). For a finished batch it calls `pull()` once. The tab then computes count, average, P95, timeouts, failures, retries, dropped calls, tokens and the speed fit over those 2000 entries. It shows `entries.slice(-500)` under the label `ws.calls.latest` ('最近 N 条').
- 失败场景：After a page reload, the user selects a finished 1,500-file, 3-round batch with 9,000 model calls and opens 模型调用. They see '2000 次调用', with failure and timeout counts and averages for the first 22% of the batch only. The rows labelled as the latest 500 are actually calls #1501–#2000. Later timeouts and failures don't appear.
- 建议修法：Keep pulling while `value.entries.length === 2000` (loop until `last` stops advancing), or allow a larger limit for finished runs. Label the window correctly. Use server-side totals (`totals.models`) for the summary figures.
- 核实：service.calls slices to 2000 (`log.filter(seq > after).slice(0, 2000)`), and CALL_LOG_LIMIT is 20000 (pipeline.js:2385). The client effect at 3455-3473 calls pull() once and only sets the interval when `running`. Totals, P95, timeouts, failures, retries, dropped counts and the fit (3715-3762) are computed over these entries. shown = entries.slice(-500), labelled ws.calls.latest '仅显示最近 {count} 条' (3763). For a finished batch with more than 2000 calls, only seq 1..2000 is shown or counted.

### #58 Retry (↻N) and dropped-items (−N) markers in the call table are passed into t() as arguments and never shown

- 位置：`client.js:3787`（client，ui，confirmed）
- 问题：The status cell reads `t(`ws.calls.r.${entry.result}`) === ... ? entry.result : t(`ws.calls.r.${entry.result}`, entry.attempts > 1 ? h('i', ...`↻${n}`) : null, entry.dropped ? h('i', ...`−${n}`) : null)`. The closing parenthesis comes after the two `h('i')` nodes, so they are t's `vars` argument (and an ignored third argument), not children of the span. For results without a translation (e.g. `http-500`, `error`), the first branch returns `entry.result` alone and the markers are dropped there too.
- 失败场景：A call that succeeded after 2 retries, or that dropped items as bad-shape, shows a plain 'ok' / '成功' chip with no ↻2 or −3 marker. The per-call retry and dropped information that commit f378507 added never reaches the table, and the user can't see which rows were retried or lost items.
- 建议修法：Close `t(...)` before the markers: `h('span', {className}, label, entry.attempts > 1 ? h('i', ...) : null, entry.dropped ? h('i', ...) : null)` where `label` is the translated result or the raw code.
- 核实：client.js:3787-3789: `t(`ws.calls.r.${entry.result}`,` ends the line with a comma. The two h('i') nodes follow as the 2nd and 3rd arguments, then `))))))))` closes t first. services.t returns a string, so the nodes become ignored vars. Pipeline does set entry.attempts and entry.dropped (pipeline.js:1023, 1046, 1062), so the data exists but is never rendered. The untranslated branch also returns entry.result alone.

### #59 Report stays at '加载中…' forever when the view falls back to a run whose report was loaded earlier

- 位置：`client.js:3321`（client，stale-state，confirmed）
- 问题：`reportLoaded` records every run id whose report was requested, but `reportText` holds only one report. Deleting the viewed run calls `setSelectedId(null); setReportText('')` without clearing `reportLoaded`. The next tick shows `runs[0]`; if that id is already in `reportLoaded`, `call('report')` is skipped. The same happens if a report fetch finishes after `alive` went false: the id stays in `reportLoaded` but the text is never set.
- 失败场景：The user opens the page, so the latest run Y and its report load. They start batch X from the page; it finishes and they delete X. The view falls back to Y, but Y is already in reportLoaded, so the report tab shows '加载中…' indefinitely. Clicking Y in the history works around it.
- 建议修法：Clear `reportLoaded` (or delete the fallback id) whenever `reportText` is reset, or key the loaded-report cache by run id (`{[id]: markdown}`) and render `reportById[current.id]`.
- 核实：tick (client.js:2959-2964) skips call('report') when reportLoaded has the id. confirmDelete (3321) does setSelectedId(null) and setReportText('') but never clears reportLoaded for the fallback run. After X is deleted, viewId falls back to runs[0] (Y), which is already in reportLoaded from page open. reportText stays '', and the report drawer renders t('detail.loading') (3796). Only selectRun() deletes the id. This follows from the code; not run in a browser.

### #60 Bulk review leaves the open comparison file stuck on '加载中…'

- 位置：`client.js:3822`（client，stale-state，confirmed）
- 问题：`bulkReview` calls `setCompareFiles({})`. The only effect that loads a compare file depends on `[modal, adviceRunId, compareSel]`, and none of those change after a bulk action, so the selected file is never re-fetched.
- 失败场景：In 结果比对 the user clicks '全部确认保留' or the bulk remove. The file pane on the right switches to '加载中…' and stays there until they move to another file and back.
- 建议修法：After bulk, re-fetch the current selection (`loadCompareFile(adviceRunId, compareSel, true)` when it is numeric), or include a cache version counter in the effect deps.
- 核实：bulkReview (3812-3836) calls setCompareFiles({}). The only loader effect (3263-3265) depends on [modal, adviceRunId, compareSel], and none of these change. For a selected numeric entry, compareSel stays the same: reviewByPath still has the file after decisions, so the filtered list is unchanged. adviceRunId stays the same id even when setDetail(null), because current falls back to the runs entry. data = compareFiles[key] is undefined, so the pane shows loading until the selection changes.

### #61 'Clear all records' while a batch runs leaves the page pointing at a deleted run, hiding the running batch and its Stop button

- 位置：`client.js:3312`（client，stale-state，confirmed）
- 问题：For `deleting.all` the selection is only reset when there is no active run: `if (!activeRunId) { setSelectedId(null); ... }`. If the user had selected a finished run, `selectedId` still points at a now-deleted id. `status` returns `run: null`, `current` becomes null and the page shows the empty state. The 'take the floor' logic only fires when `list.active` changes, so it doesn't recover.
- 失败场景：Batch B is running. The user clicks an older finished run A in the history, then '清空记录'. A is deleted, the center and monitor show '还没有批次', and the ■ 停止批次 button disappears although B is still running. The user has to find and click B in the history to regain control.
- 建议修法：After clearAll, reset `selectedId` to null whenever it isn't the active run (e.g. `if (selectedId !== activeRunId) setSelectedId(null)`), and likewise clear stale detail and report text.
- 核实：confirmDelete all (3312) resets selection only when !activeRunId. clearRuns -> deleteRun removes A from runs/runRoots and deletes report.json, so status(A) -> loadRunFromDisk returns null and tick calls setDetail(null). runs.find(A) is null, so current is null and 3680 renders ws.noRun. The take-the-floor logic (2945-2951) needs list.active !== lastActive.current, but lastActive is already B. The Stop button (4118) needs `running`, which comes from current, so it disappears while B keeps running.

### #62 Call-strip tooltips show raw locale keys for HTTP and other error codes

- 位置：`client.js:3747`（client，i18n，confirmed）
- 问题：The pipeline records results such as `http-${status}` and `String(error.code ?? 'error')` (pipeline.js:1063-1068). The locale only has `ws.calls.r.{ok,cached,timeout,bad-json,bad-shape,cancelled,network,empty-response}`. The table cell and failure hints fall back to the raw code, but the strip tooltip uses `t(`ws.calls.r.${bar.result}`)` directly.
- 失败场景：An endpoint returns 429 or 500. Hovering the bar in the duration strip shows '12:01:03 · 4.2 s · ws.calls.r.http-429' instead of a readable label.
- 建议修法：Use the same fallback helper as `FAIL_LABEL` in the tooltip, and add entries for `http-*` (or a generic `ws.calls.r.http`) and `error` to both ZH and EN.
- 核实：Strip tooltip at 3747 uses t(`ws.calls.r.${bar.result}`) directly. Locales only define ok/cached/timeout/bad-json/bad-shape/cancelled/network/empty-response (lines 298, 486, 533-538). Pipeline emits `http-${status}` and String(error.code ?? 'error') (pipeline.js:1063-1068). The client's own check at 3787 (`t(key) === key`) shows that t returns the raw key for missing entries, so the tooltip shows e.g. 'ws.calls.r.http-429'.

