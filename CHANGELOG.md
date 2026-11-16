# Changelog

## [6.1.0] - 2026-11-16

### Added

- 新增 `panel/start.sh` 桌面启动器：后台启动本地面板，确认页面就绪后调用 Linux `xdg-open` 或 macOS `open`；启动前检查依赖，也支持 `TROUPE_OPEN` 覆盖。
- 新增 GitHub 插件市场发布清单，分发仓根目录可直接作为 ZCode 市场添加。
- CI 增加 npm 打包白名单检查，发布流程使用真实 tarball 暂存并试装。

### Changed

- 工作区移除旧技能治理文档、账本和检查脚本；插件源码、测试与市场清单位于 `plugins/`。
- 本机旧技能调度钩子和代理清单退出使用，现行 DevTroupe 代理保持不变。
