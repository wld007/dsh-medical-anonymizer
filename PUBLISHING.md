# 发布到 DSH 插件市场

目标列表是 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)：
**发布 = 一个公开 GitHub 仓库 + 一个 YAML 条目 PR**。`dsh-market` / `dsh.market`
只是前端，会自动读取列表索引。

## 0. 发布前替换 `OWNER`

这个目录里的 `OWNER` 是占位符，发布前统一替换成你的 GitHub 账号：

- `package.json`：`author`、`repository`、`homepage`、`bugs`
- `README.md`：安装命令和中文说明里的 `github:wld007/...`
- `submission/wld007__dsh-medical-anonymizer.yml`：`url`、`name`、`icon`
- 如果仓库名不是 `dsh-medical-anonymizer`，同步替换所有 `dsh-medical-anonymizer`

替换后把条目文件重命名为 `<owner>__dsh-medical-anonymizer.yml`。

## 1. 本地自检

```bash
npm test
npm pack --dry-run          # 确认包里没有 test/、dist/、vault、个人路径
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"
```

再跑一遍公开前检查（应该通过）：

```bash
npm run check:public
```

它会扫描源码、文档和测试里的本机绝对路径、内网 IP、`@local/` 作用域和数据集标识。

`package.json` 必须同时有 `dsh.bundle` 和 `dsh.client`；只有 `dsh.client`
不能安装，是最常见的被拒原因。根目录必须有 `cordis.patch.yml`。

## 2. 建公开仓库

```bash
git init -b main
git add .
git commit -m "dsh-medical-anonymizer 0.3.0"
gh repo create wld007/dsh-medical-anonymizer --public --source . --remote origin --push
gh repo edit wld007/dsh-medical-anonymizer --add-topic dsh-plugin
```

两条硬要求：

1. 仓库必须加 **`dsh-plugin`** topic；
2. 仓库**创建满 1 天**才能提收录 PR，CI 会检查仓库年龄。

`dist/`、`test/.tmp/`、`labs.xlsx` 已在 `.gitignore` 里，不要提交。
永远不要提交 `vault.json`、患者数据或本机 profile 配置。

> 注意：如果你用 `node scripts/build.mjs` 在本机装过开发版，profile 链接的是
> `dist/<版本>`。`.gitignore` 会忽略它，但 `git clean -xdf` 会把它删掉，导致本机
> 插件失效。

## 3.（可选）发 npm

不发 npm 也能上架，只是没有下载量数字。

```bash
npm publish --access public
```

- 包名 `dsh-medical-anonymizer`；发布前用 `npm view dsh-medical-anonymizer` 确认仍未被占用（返回 404 即可用）；
- `package.json` 的 `repository` 必须指回被收录的仓库，否则 npm 与条目不会关联；
- 条目 YAML 里**不要**手写 `npm:` 字段，映射由 CI 从 registry 采集，手写会被校验拒绝。

## 4. 提收录 PR

1. Fork `awesome-dsh-plugin/awesome-dsh-plugin`。
2. 新建分支，复制条目：

```bash
cp submission/wld007__dsh-medical-anonymizer.yml \
   data/plugins/<owner>__dsh-medical-anonymizer.yml
```

3. 只提交这一个文件。**不要手工改 `README.md`**，它们由 `data/plugins/*.yml`
   生成。
4. 开 PR。一个 PR 最多 3 条；描述里的 `: `（冒号加空格）必须加引号，条目已经
   全部用引号包住。
5. 条目内容：

```yaml
url: https://github.com/wld007/dsh-medical-anonymizer
name: wld007/dsh-medical-anonymizer
category: security
description:
  en: '...'
  zh: '...'
icon: https://raw.githubusercontent.com/wld007/dsh-medical-anonymizer/main/assets/icon-180.png
```

分类用 `security`（隐私/去标识化）。如果维护者认为 `tools` 更合适，他们会直接
调整，不会因此打回。

如果 CI 报 `icon` 是未知字段，把 `icon:` 一行删掉即可；市场会回退到你的
GitHub 头像，不影响收录。

## 5. CI 会检查

按顺序：

1. 条目数 ≤ 3；
2. 仓库 `package.json` 有 `dsh.bundle`；
3. 仓库创建满 1 天；
4. `awesome-lint` 与站点构建（双语、分隔符、日期、图标/截图）。

失败会在 PR 里说明；在同一分支 push 修复即可。

## 6. 合并后验证

在干净 profile 里按用户的安装路径装一遍：

```bash
dsh plugin --profile test add github:wld007/dsh-medical-anonymizer
dsh --profile test --dump-config | grep -A4 medical-anonymizer
```

重启后检查：

- 设置 → 医疗数据匿名化能打开；
- `/` 菜单里有 `anonymize`；
- Agent 工具里有 `anonymize_start` / `anonymize_cancel` / `anonymize_status` /
  `anonymize_report` / `anonymize_runs`；
- 对一个合成目录跑 dry run，报告与结构检查正常。

## 7.（可选）截图

市场详情页支持 `screenshots.json`（仓库根，1–8 张、相对路径、不能以 `/` 开头、
不能含 `..`）。没有截图也能上架；有的话更容易被点开：

```json
["docs/screenshots/settings.png", "docs/screenshots/report.png"]
```

推自己的仓库即可，不需要再提列表 PR。

## 提交前清单

- [ ] `OWNER` 全部替换，条目文件已重命名
- [ ] `CHANGELOG.md` 已补充本版本条目，`package.json` 的 `version` 已同步修改
- [ ] `npm test` 通过
- [ ] `npm pack --dry-run` 里没有 test/dist/vault/个人路径
- [ ] `package.json` 同时有 `dsh.bundle` 和 `dsh.client`
- [ ] 默认配置是 `127.0.0.1:11434/v1`、空模型、空输出根
- [ ] 仓库公开，已加 `dsh-plugin` topic
- [ ] 仓库创建满 1 天
- [ ] 条目只有一个文件，描述与代码一致，没有夸大
- [ ] README 写清模型端点、vault 风险和“不是合规认证”

## 注意

- 收录**不等于**安全审查，也不等于医疗合规认证。
- 描述会被维护者逐句对照代码核对；不要写“HIPAA compliant”之类无法证明的话。
- 插件默认不联网，只访问用户配置的模型端点；发布版不要带任何个人端点、
  数据集路径或映射库。
