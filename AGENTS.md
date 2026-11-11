# 给开发代理的约定

## 更新本机安装的插件

- **有批次在运行时，不要更新、重装、启用或停用插件。** 重装会重新加载插件，正在运行的批次会被中断。
- 每次 `remove_bundle` / `install_bundle`（或任何会重新加载插件的操作，包括在设置页保存）之前，先用 `anonymize_runs` 确认最近的批次里没有 `running` 状态；有的话等它结束，或先问用户。
- 只检查一次不够：从构建到安装之间如果隔了一段时间，安装前要重新检查。

## 本机开发版

- `node scripts/build.mjs <版本>` 生成 `dist/<版本>`，再从 profile 安装该目录；版本号用 `0.x.y-dev.N` 递增。
- 提交前跑 `npm test` 和 `npm run check:public`。
