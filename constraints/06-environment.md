# 06 · 环境与平台（ENV）

> 状态：active ｜ 权威：normative ｜ 替代：无

本册承载操作系统、编码、路径、版本与网络类约束。典型触发=新机、迁移、命令失败、编码异常。

## C-ENV-01 Windows 下删文件用 Python
---
id: C-ENV-01
title: Windows 下删文件用 Python
category: environment
triggers: [删文件, Git Bash, rm, Windows]
roles: [executor, implreview]
phases: [implement, review]
severity: warning
enforcement: checklist
check: 逐条删除操作核对运行环境；Windows 面删除走 Python，Git Bash rm 为 0
evidence:
  - project: WaterPrint
    event: Git Bash rm 多次复验卡死，Windows 与 exFAT 文件锁所致
    ref: references/04-lessons.md 四、环境与平台类 WP-14
    date: YYYY-MM-DD
---
Windows 下删除文件用 Python 的删除接口，不用 Git Bash rm。

## C-ENV-02 tar 与 npm 先前置系统目录
---
id: C-ENV-02
title: tar 与 npm 先前置系统目录
category: environment
triggers: [tar, npm, Git Bash, 盘符]
roles: [executor, implreview]
phases: [implement, review]
severity: warning
enforcement: checklist
check: 逐条 tar 与 npm 命令核对系统目录前置；出现把盘符当主机名的报错即改用系统解包工具
evidence:
  - project: WaterPrint
    event: Git Bash GNU tar 把盘符冒号当远程主机名报错，npm 脚本继承 Git Bash PATH；源漂移：`docs/08` §4.2 记 MG-1，现行承载=WP-14 行
    ref: references/04-lessons.md 四、环境与平台类 WP-14
    date: YYYY-MM-DD
---
Git Bash 下运行 tar 或 npm 前置系统目录使系统解包工具优先，避免盘符冒号被当主机名。

## C-ENV-03 时间格式统一 UTC ISO 8601
---
id: C-ENV-03
title: 时间格式统一 UTC ISO 8601
category: environment
triggers: [时间戳, UTC, ISO 8601, 本地时间]
roles: [executor, implreview]
phases: [implement, review]
severity: blocking
enforcement: review
check: 逐处序列化时间戳核对 UTC ISO 8601 含 Z 后缀；本地时间字符串、自选格式、设计态与内容哈希内时间戳为 0
evidence:
  - project: WaterPrint
    event: 本地时间字符串跨机排序错序，进内容哈希后同设计两机哈希不同
    ref: engineering-conventions.md GR-19
    date: YYYY-MM-DD
---
序列化时间戳统一 UTC 加 ISO 8601 含 Z 后缀，禁本地时间字符串与自选格式；时间戳不进设计态与内容哈希。

## C-ENV-04 目录删除失败先核数据
---
id: C-ENV-04
title: 目录删除失败先核数据
category: environment
triggers: [目录删除, 迁移, 残留目录, ENOTEMPTY]
roles: [executor, implreview]
phases: [implement, review]
severity: warning
enforcement: checklist
check: 删除失败时核对落盘清单与数据实测；残留目录留延后清理记录
evidence:
  - project: ai-dev-org
    event: 迁移收尾目录删除报 ENOTEMPTY，索引与杀毒扫描占用新建目录
    ref: references/04-lessons.md 四、环境与平台类 MG-2
    date: YYYY-MM-DD
---
目录删除失败不判数据失败；核对落盘清单与数据实测，残留目录延后清理。

## C-ENV-05 迁移后重建环境再验收
---
id: C-ENV-05
title: 迁移后重建环境再验收
category: environment
triggers: [迁移, 环境重建, manifest, 哈希验收]
roles: [executor, implreview]
phases: [implement, review]
severity: warning
enforcement: checklist
check: 迁移记录含环境重建命令与 manifest 反推清单；验收以哈希零变动为准
evidence:
  - project: ai-dev-org
    event: 随盘环境路径内嵌全废，重锁工具默认根不等于全量根致清单重写
    ref: references/04-lessons.md 四、环境与平台类 MG-3
    date: YYYY-MM-DD
---
迁移后重建环境再验收；重锁必携 manifest 反推全量包路径，以哈希零变动为准。

## C-ENV-06 升级前核对矩阵与安装钩子
---
id: C-ENV-06
title: 升级前核对矩阵与安装钩子
category: environment
triggers: [升级, 预编译, 安装钩子, 兼容矩阵]
roles: [executor, implreview]
phases: [design, implement]
severity: warning
enforcement: checklist
check: 升级前记录预编译兼容矩阵查询结果；核对目标版本安装钩子，钩子移除时附显式安装步骤
evidence:
  - project: Synapse
    event: Electron 43 无预编译、12.11.2 不发 npm，42 起 postinstall 移除须显式串 install-electron
    ref: references/04-lessons.md 四、环境与平台类 SY-11
    date: YYYY-MM-DD
---
升级前查预编译兼容矩阵；安装钩子被移除的版本显式补安装步骤。

## C-ENV-07 标识符守布尔前缀与字符集
---
id: C-ENV-07
title: 标识符守布尔前缀与字符集
category: environment
triggers: [命名, 布尔前缀, 标识符, 字符集]
roles: [executor, implreview]
phases: [design, implement, review]
severity: warning
enforcement: review
check: 新增标识符逐条核对前缀与字符集；否定布尔与非 ASCII 字符为 0
evidence:
  - project: WaterPrint
    event: 双重否定布尔是条件语义缺陷高发区，评审难以逐条心算
    ref: engineering-conventions.md GR-24
    date: YYYY-MM-DD
  - project: WaterPrint
    event: 中文空格斜杠进标识符后拼接、文件命名、URL 与参数四处都要转义
    ref: engineering-conventions.md GR-26
    date: YYYY-MM-DD
---
新增布尔名用 is_/has_/allow_ 前缀并禁否定布尔；标识符只用 ASCII 字母数字下划线。
