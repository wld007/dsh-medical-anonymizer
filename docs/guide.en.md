# Guide

[Back to README](../README.en.md) · [简体中文](guide.md)

## Settings page

Configuration only, with a collapsible **How it works** guide at the top:

- **Local model**: endpoint, model, API key, disable thinking, model call timeout, temperature, **Test
  connection** (flags a model name the endpoint does not serve).
- **Batch defaults**: output root, max rounds, files per chunk, files processed at the same time, DICOM cap per batch.
- **Vault encryption**: set, change, or clear `vaultPassphrase` (entered twice, never shown again). Saving a new passphrase (or clearing it) on the settings page immediately re-encrypts the vaults in the output locations used on this machine (clearing turns them back into plaintext); vaults elsewhere that were encrypted with the old passphrase need the old passphrase to be read. After a passphrase is first enabled, a still-plaintext vault is encrypted at the next batch's save at the latest.
- **Anonymization rules**: treatment per identifier type, the quasi-identifier
  switch, and treatment per quasi-identifier type, each with a live example; content
  that cannot be checked (images …), and "read images with the model" (on by default;
  images under review go to the detection model, which sorts them and suggests
  remove or keep, nothing is decided automatically).
- **Interface**: show or hide the **Medical Anonymization** entry in the left
  sidebar. When hidden, `/anonymize` and the agent tools still work.
- The save bar lists unsaved fields; **Save** writes them into the profile's own
  config layer, so they survive restarts and plugin updates. The API key is
  saved only when you type or clear it, is never shown again, and lives in the
  profile config file (mode 600). Saving is refused while a batch is running,
  because it re-applies the plugin.

## Agent tools

| Tool | Purpose |
| --- | --- |
| `anonymize_start` | Start a batch and return its `runId` |
| `anonymize_cancel` | Cancel the running batch; written files stay |
| `anonymize_status` | Progress, entity counts, unresolved issues |
| `anonymize_report` | Read the Markdown report |
| `anonymize_runs` | List recent batches |
| `anonymize_undo_mappings` | Remove the mappings a batch added to the vault (output files are not deleted) |

`anonymize_start` parameters: `inputDir` (a directory, a single file, or a `.zip`), `outputRoot`, `maxRounds`.

The agent tools cannot choose the model endpoint, model, API key, or thinking
mode: those always come from the user's saved settings, so an agent cannot
redirect patient text to another service. The tool description names the
plugin and this data boundary, which helps the agent pick it over similarly
named tools. Only the human-typed `/anonymize` command accepts `--endpoint` and
`--model` overrides.

## How it works

1. **Rule pre-scan.** Chinese ID (checksum-validated), mobile/landline, email,
   bank card (Luhn), MRN/admission/visit numbers, labeled names/addresses/
   hospitals/doctors, and EMR template fields whose label and value are split
   by markup (`F=[引用值:姓名]…[<isele 0>value<isele 1>]`).
2. **Column and key policy.** Dedicated fields are pseudonymized as a whole,
   including common hospital-export keys such as `PTT_NM`, `ID_CRD_NO`,
   `CTCT_TEL_NO`, `*_ADDR*`, `*_DCT_NM`, `*_STFF_NM`, `MDC_ORG_NM`, `PID`,
   `INHOS_NO`, `*_DCT_CD`/`*_NUS_CD` (staff codes) and `*_SGNT` (signatures);
   from regional health-platform exports also `SLF_NM` (self name), `*_PSN_NM`
   (sample collector, reviewer, …), `WRK_UNT_NM` (employer), linkage keys
   `USER_ID`, `VST_UNQ_ID`, `OTPT_EMG_NO`, `RGST_NO`, and institution codes
   `*_ORG_CD`. Item/value records such as `{"ITM_NM": "姓名", "ITM_VLU": "…"}`
   are judged by the item name. Columns that describe an identifier (`ID_CRD_CGY_CD` card type, `*_TP_*`,
   `*_FLG`, …) are not identifier columns.
3. **Optional model discovery.** Batches of text are sent to the configured
   endpoint, with field names. Identical texts are sent once; pure numbers/dates
   and already-anonymized values are not sent. The model returns
   `{segment, type, text}`; the plugin locates the exact text in the source.
   Model coordinates are never trusted.
   **Format check:** a result that cannot be of its type is not replaced and is
   listed as a hint — e.g. `01` in an ID-card column, or a department name such
   as `内一科(肾脏病科)(11病区)` returned as a hospital.
   **Document-wide expansion:** a found value is also replaced where it recurs,
   but never inside a longer run of letters/digits (`01` does not hit
   `2001017`), and codes shorter than 6 characters are replaced only where they
   were detected.
   Categories and common nouns such as `区属医院`, `综合医院`, `中医院` or a bare
   `医院` are not hospital names.
   **Across files:** before processing, a model-free pass over all files (column
   policy + rules) builds a batch dictionary, so a name or ID found in one file
   is replaced in every other file. After all files are done, a batch re-check
   catches values that only a later file (or the model) revealed; the report
   lists it as `批次复扫`. Administrative region names (province, city, county)
   do not spread across files.
   Batches larger than `maxFiles` (default 200) are split into chunks
   automatically: each chunk is re-checked and released from memory when done,
   and a final cross-chunk re-check runs over the earlier chunks' output.
   `concurrency` (default 4) files are processed at a time.
   A bare JSON `name` key is treated as a person's name only when its object
   also carries personal attributes such as age, sex, birth date, ID number,
   phone, or address (diagnoses `{icd10, name}`, lab items, and drugs are not
   affected); a full institution name in a name column is treated as a hospital.
4. **Pseudonymization.** `HMAC-SHA256(salt, type + value)` produces a stable
   token per value and type. Only the matched span changes.
5. **Verification.** Model re-check, rule re-scan, original-value absence (with
   the masked value and field names), embedded-pseudonym check (a pseudonym glued
   to letters/digits means a longer value was partly replaced), numbers/dates in
   structured data replaced only as a whole, and a structure diff (line count,
   CSV shape/header, JSON key/type shape, Excel non-text cells).
6. **Bounded repair.** Errors go back to discovery for another round, up to
   `maxRounds`. If no progress is made, the file is marked `review` and listed
   for manual review.

## Anonymization rules

Defaults reproduce the behaviour of earlier versions: every identifier becomes a
stable pseudonym, and quasi-identifiers are left untouched.

| Identifier strategy | Example (`张三`, `13800138000`) | Reversible |
| --- | --- | --- |
| `pseudonym` (default) | `化名-9F3A2C`, `电话-7A8ED8` | yes, through the vault |
| `mask` | `张*`, `138****8000` | no; part of the value remains |
| `redact` | `[姓名]`, `[电话]` | no |
| `keep` | unchanged | — |

Masks: names keep the first character; ID keeps the first 3 and last 4
characters; phone the first 3 and last 4 digits; bank card and record numbers
the last 4; email the first letter and domain; address the province/city/district
prefix; hospital the first 2 characters and the suffix. Digits and codes always
hide at least 4 characters and at least a third, and show at most 7, so short
values show less (`66809363` → `****9363`, `123456` → `****56`, 4 or fewer
fully masked); the last address component is always hidden (`杭州市` → `****`).

Date, age, and sex are processed only when **quasiIdentifiers** is on. Postal
codes are identifiers (one of the HIPAA 18) and are always processed; they cannot
be kept (a stored `keep` is treated as `prefix3`). All of these are handled
deterministically after identifiers, without the model:

| Type | Strategies (default first when enabled) | Example |
| --- | --- | --- |
| Date | `shift`, `month`, `year`, `redact`, `keep` | `2024-03-01` → `2024-04-07` / `2024-03` / `2024` |
| Age | `band10`, `band5`, `redact`, `keep` | `45岁` → `40-49岁` / `45-49岁`; 90 and over → `90岁及以上` |
| Sex | `keep`, `redact` | `男` → `[性别]` |
| Postal code (always) | `prefix3`, `redact` | `100020` → `100***` |

- Detection covers prose (`2024-03-01`, `2024年3月1日`, `45岁`, `年龄：45`,
  `性别：男`, `邮编：100020`) and fields named like `BTH_DT`, `*_DT`, `出生日期`,
  `AGE`, `GDR_NM`, `SEX`, `ZIP`, `邮编`; compact `YYYYMMDD` only in date fields.
- Year-month dates (`2024年3月`, `2024-03`, `YYYYMM` in date fields) are handled
  like full dates: shifting moves the 15th of the month and keeps year and month,
  so a true month never sits next to shifted dates and reveals the offset.
  A number with a unit right after the month is a count, not a day
  (`2019年5月2型糖尿病`, `2024年3月2周后`, `2024年3月3次化疗`): only the year and
  month change, the number stays.
- Date shifting uses one offset (±1–365 days) per output root, derived from the
  vault salt, so intervals between dates and across batches are preserved. The
  offset never appears in reports. Do not re-run shifting on its own output.
- Only text values change: Excel numeric/date cells and JSON numbers are left
  as-is, and the report says so.

### Excluding false positives

When the report shows a false positive, add it under Settings → Anonymization
rules → Exclude false positives (one item per line) and run again:

- `allowValues`: never treated as identifiers, e.g. `01`, `居民身份证`, a
  department name. Mappings an earlier run stored for them are removed from the
  vault on the next run.
- `skipFields`: column or JSON key names (case-insensitive) that are not
  scanned, replaced, or sent to the model, e.g. `ADMN_BED_NO`.

## DICOM images

Metadata de-identification for CT and other DICOM images. Pixel data is kept
byte for byte: never decoded, modified, or sent to a model.

- Detection: `.dcm`/`.dicom`/`.dic`/`.ima`, extensionless, or numeric-extension
  files (typical PACS exports), confirmed by the `DICM` marker.
- Rules: DICOM PS3.15 Annex E Basic Application Level Confidentiality Profile
  with the Retain Longitudinal (modified dates) and Retain Patient
  Characteristics options:
  - patient and physician names emptied or removed; every PN attribute removed;
  - birth date emptied; addresses, phones, other IDs, accession number, study ID,
    institution, department, device serial, station name, comments and request
    details removed;
  - private (odd-group) attributes, curves, overlay comments, icon images and
    digital signatures removed;
  - **PatientID** becomes a cuid-style code, consistent per patient within one
    batch. The key lives only in memory for that run and is never stored, so the
    code cannot be traced back (and is not written to the vault). Process all
    images of one patient in the same batch;
  - instance UIDs become `2.25.<decimal>`, derived from the vault salt, so
    cross-file references and re-runs stay consistent; class/syntax UIDs are kept;
  - dates shift by the same offset as text; times kept; age kept (≥90 → `090Y`);
    sex, size and weight kept;
  - study/series description and protocol name kept but rule-scanned; any hit
    (phone, ID number, …) removes the whole attribute;
  - attributes of unknown VR (standard tags missing from the dictionary in
    implicit-VR files, explicit UN) are removed, with a notice, when they hold
    free text; numbers and codes are kept. UN attributes holding a sequence are
    parsed as implicit VR and processed item by item; unparseable ones are removed;
  - encapsulated documents ((0042,0011), e.g. encapsulated PDF/CDA reports)
    cannot be inspected: by default the file goes to manual review and is not
    delivered before it; with opaque content set to remove, the attribute is emptied.
- With quasi-identifier handling on, DICOM follows the same date/age/sex policy
  (age bands are written as their lower bound, e.g. `040Y`).
- Writes `PatientIdentityRemoved=YES`, the de-identification method and code
  sequence, and `LongitudinalTemporalInformationModified`.
- Checks: header re-parse; leftover names/private tags/original UIDs; removed
  identity values (names, IDs, birth date, institution) reappearing in kept
  attributes are flagged for review; pixel data SHA-256 compared with the source.
- Implicit/explicit VR little endian and all encapsulated syntaxes are
  supported. Explicit VR big endian, deflated data sets and broken/truncated
  files fail. `DICOMDIR` is not copied; regenerate it on the output.
- `maxDicomFiles` (default 50000) caps DICOM files per batch, independently of
  the text-file chunk size `maxFiles`. The report lists only DICOM files with issues and summarizes the
  rest per directory.
- Not handled: text burned into pixels, face reconstruction, NIfTI, whole-slide
  pathology.

## Output

```text
<outputRoot>/
  <input folder name>/       # result: anonymized data only, same layout (identifiers in names replaced); take it as is
  <input folder name> (2)/   # the same input run again: numbered, earlier results are never overwritten
  note.txt                   # result of a single-file input
  _records/
    vault.json               # original <-> pseudonym, mode 0600
    index.json               # recent batches
    runs/<runId>/
      report.md
      report.json
      path-map.json          # original <-> new path, only when a path was renamed; mode 0600, as sensitive as the vault
      advice.json            # improvement suggestions (allow-list candidates hold original values; mode 0600), shown in the Improvements panel
      calls.json             # model-call log: time, file, stage, duration, tokens, outcome (no prompts or replies)
      model-cache.jsonl      # model replies of an unfinished batch, replayed by Resume; quotes originals, mode 0600, deleted once a batch finishes
      resume.json            # original input path of an unfinished batch, for Resume (mode 0600)
      review-items.json      # review items with original context (holds originals, mode 0600)
      cross-check.json       # cross-check detail: each blind-review finding, its outcome and both models' reasons (holds originals, mode 0600)
      compare/               # per-file comparison: changed segments, original and result (holds originals, mode 0600)
      review/                # anonymized copies of files that need review, taken out of zips too (x.zip becomes x (zip)/)
      output/                # staging while running; moved to the output root when the batch finishes. Partial results of a cancelled/failed batch stay here
```

A result appears in the output root only once its batch has finished
(including Needs review), so everything there is complete. `vault.json`,
`index.json`, and `runs/` left in the output root by 0.7 and earlier move into
`_records` on the next run; the vault keeps working and pseudonyms stay the same.

`vault.json` is the re-identification key. Keep it separate from the output and
protect it accordingly. The report deliberately contains no original values.
Set `vaultPassphrase` on the settings page (Batches & UI → Vault encryption) or in the plugin config to encrypt the vault with
AES-256-GCM; without it the vault is plaintext JSON with mode 0600.

Without an explicit or configured `outputRoot`, output goes to a
`_medical-anonymizer` folder (visible in Finder) **beside** the input directory, so sibling
batches (for example one folder per patient) share one vault and keep
consistent pseudonyms. When a parent directory is anonymized later, folders
named `_medical-anonymizer` or holding `_records/vault.json` are skipped, so the
vault is never read in as records. 0.7 and earlier used the hidden
`.medical-anonymizer`; if no `_medical-anonymizer` exists yet, it is renamed and reused. The output root may not equal the input directory. If
you place it inside the input directory, it is excluded from scanning, so the
vault and earlier outputs are never read back in as records.

Files with unsupported extensions and archives that cannot be extracted are
listed in the report's **注意** section; a batch with an unextractable archive
is marked `review`.

### Source protection

The plugin never modifies its input:

- Before every write, symlinks are resolved and the target must be inside this
  batch's output directory and outside the input directory; otherwise the
  write is refused. A batch whose output root equals or contains the input is
  refused at start.
- The size and modification time of every source file (including the archives
  themselves) are recorded before the run and re-checked afterwards; the result
  appears in the report under "源文件检查". If another program changes a source
  file during the run, the batch is marked `review`.
- The tests assert, for every input type, that the input directory is
  byte-for-byte identical before and after a run.

### Undo mappings

Every new mapping in the vault records the batch that first created it. If a
rule misfired, call `anonymize_undo_mappings` (parameter `runId`) to remove the
mappings that batch added; after fixing the rules, a re-run creates them again.
Output files are not deleted.

## Zip archives

- `.zip` files (including ZIP64 and GBK file names produced on Windows) are
  extracted to a system temporary directory and processed. The result is not
  re-packed: it is delivered in a folder named after the zip, with the original
  internal layout (`records.zip` → `records/`, nested zips unpacked too;
  `records (zip)/` when a folder of that name already exists). The temporary
  directory is deleted when the batch ends, including on cancel or failure. The original archive is read-only.
- Nested archives are expanded up to 3 levels deep. Only stored and Deflate
  entries are supported; encrypted and multi-volume archives are not processed.
- Safety limits: entries with absolute paths, `..`, or otherwise escaping the
  extraction root are rejected. By default at most 20000 entries, 2 GiB
  extracted in total (one budget per top-level archive, shared with the zips
  nested in it, an inner zip itself not counted twice; independent archives
  of a batch are counted separately), 500 MiB per file, and a 1000:1
  compression ratio (for entries over 64 KiB, and for the archive as a whole);
  anything beyond is rejected (a ratio over the limit is reported as a
  suspected zip bomb). Entries are streamed to
  disk one at a time and every CRC is verified; on an error, whatever was
  already extracted is deleted.
- For an archive that cannot be extracted, the report gives only the reason
  category, never the names of files inside it (they may contain names).

## File and folder names

Identifiers in output paths are replaced before writing, using the same vault
as the content, so the same person gets the same pseudonym in the file name and
in the text:

- `64_张三_<ID number>.zip` → `64_化名-XXXXXX_证件-XXXXXX.zip`
- `patient_573453/stays/zyh_1008593/` → `patient_病历-XXXXXX/stays/zyh_住院-XXXXXX/`
- `visits/mzh_3444733_check.json` → `visits/mzh_就诊-XXXXXX_check.json`

Category folders (inpatient, outpatient, lab, …), year/month folders, table
names (`p_doc_gehr_*_rcd`), campus codes (`h5650`), and sequence numbers are
kept. The mapping from original to new paths is written to
`_records/runs/<runId>/path-map.json` (mode 0600); reports and the batch list show only
the replaced paths.

## Configuration

Defaults live in `cordis.patch.yml` and can be overridden in the profile patch
layer:

```yaml
- id: medical-anonymizer
  config:
    baseURL: http://127.0.0.1:11434/v1
    model: qwen2.5:14b
    outputRoot: ''
    maxRounds: 3
    maxFiles: 200
    concurrency: 4
    maxDicomFiles: 50000
    timeoutMs: 120000
    temperature: 0
    disableThinking: true
    vaultPassphrase: ''
    identifierPolicy: { name: pseudonym, phone: mask, hospital: keep }  # unlisted types: pseudonym
    quasiIdentifiers: false
    quasiPolicy: { date: shift, age: band10, sex: keep, postalCode: prefix3 }
    allowValues: ['01', '居民身份证']
    skipFields: [ADMN_BED_NO]
```

- `maxFiles` is the chunk size for automatic grouping (files beyond it are not
  dropped); `concurrency` is the number of files processed at a time. Model
  calls are not capped.
- Labeled 7–8 digit landline numbers without an area code (e.g. `电话：`)
  are phone numbers and always detected; hospital switchboard numbers are
  replaced too (exempt them with `allowValues`). An old `landline` setting no
  longer has an effect.
- `timeoutMs` is the per-call model timeout.
- `outputRoot` empty means `<parent of input>/_medical-anonymizer`.

## Supported formats and limits

- Input: `.txt`, `.md`, `.csv`, `.json`, `.xlsx`, `.zip`, and DICOM (metadata only).
- Direct identifiers and postal codes by default; quasi-identifier handling
  (date, age, sex) is opt-in. Department, institution code, and order numbers are
  never generalized. Record keys matching `PRM_KEY`/`RCD_NO` are treated as
  record identifiers; order numbers are not.
- Field hints cover common Chinese and English hospital schemas. Unusual field
  names need an extra pattern in `lib/formats.js` (`HEADER_HINTS`).
- No Word, PDF, or plain images; DICOM pixels are not processed. JSON output is pretty-printed; keys, arrays,
  and value types are unchanged.
- The model pass is optional and its quality depends on the model. The
  deterministic layer is the baseline.

## Troubleshooting

- **The model times out or returns empty content.** Enable disable-thinking,
  use an instruct (non-reasoning) model, or leave the model empty and rely on
  the rule layer. The run continues and records a model warning.
- **No identifiers are found in a structured file.** Check whether its field
  names are in `HEADER_HINTS`; add a pattern for your schema.
- **The settings page is missing.** Confirm the profile is on DSH `>= 0.2.1`,
  the bundle is enabled, and the page was reloaded after installation.
- **`vault.json` cannot be read.** It was encrypted with a `vaultPassphrase`;
  configure the same passphrase to read it.
