import fs from 'node:fs';
import { initConfig, loadConfig } from './config.mjs';
import { doctorAgents, defaultAgentsDir, syncAgents } from './agents.mjs';
import { inventory, pickRole, routeRole } from './router.mjs';
import { listWorkflows, loadWorkflow, planWorkflow } from './workflow.mjs';

const HELP = `DevTroupe 开发剧团 · 主控做导演，五岗按需上场

用法：troupe <命令> [参数]

  init [--from <旧技能目录>]   创建用户配置；可从旧技能迁移模型绑定
  doctor                      检查配置与已生成代理（不调用远程模型）
  list                        列出五个角色及其模型顺序
  route <role>                输出一个角色的完整回退顺序
  pick <role>                 只输出当前首选代理名
  sync                        生成或更新本机子代理档案
  workflow list               列出可选工作流模板
  workflow show <id>          查看一个工作流模板
  workflow plan <id>          dry-run 展开批次计划，不写文件
  panel [--port <端口>]        启动本机配置面板，不自动打开浏览器

通用参数：
  --config <文件>              指定用户配置（或设置 TROUPE_CONFIG）
  --project <目录>             读取该目录的 .zcode/dev-troupe.json
  --no-project                 不读取项目覆盖
  --agents-dir <目录>          指定代理生成目录（默认 ~/.zcode/agents）
  --backup-dir <目录>          指定 sync 的覆盖备份目录
  --migrate-legacy             sync 时备份并移除旧十岗代理
  --json                       输出 JSON
  --version                    输出插件版本
  --help                       显示本帮助
`;

const VALUE_FLAGS = new Set(['--config', '--project', '--agents-dir', '--backup-dir', '--from', '--port']);
const BOOLEAN_FLAGS = new Set(['--json', '--no-project', '--migrate-legacy', '--help', '--version']);

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (VALUE_FLAGS.has(argument)) {
      const value = argv[++index];
      if (!value) throw new Error(`${argument} 缺少值`);
      options[argument.slice(2)] = value;
    } else if (BOOLEAN_FLAGS.has(argument)) options[argument.slice(2)] = true;
    else if (argument.startsWith('-')) throw new Error(`未知参数：${argument}`);
    else options._.push(argument);
  }
  return options;
}

function loadFor(options) {
  return loadConfig({
    configPath: options.config,
    projectDir: options.project,
    includeProject: !options['no-project'],
  });
}

function doctorReport(options) {
  const loaded = loadFor(options);
  const issues = [];
  const warnings = [];
  if (!loaded.hasUser) issues.push(`用户配置不存在：${loaded.sources.userPath}；请运行 troupe init`);
  const items = inventory(loaded.config);
  const disabledRoles = items.filter((item) => item.routes.length === 0).map((item) => item.role);
  if (disabledRoles.length === items.length) issues.push('所有角色都未配置模型；请先添加至少一个有效路由');
  const agents = doctorAgents(loaded.config, options['agents-dir'] || defaultAgentsDir());
  issues.push(...agents.issues);
  warnings.push(...agents.warnings);
  return {
    ok: issues.length === 0,
    configPath: loaded.sources.userPath,
    projectOverride: loaded.hasProject ? loaded.sources.projectPath : null,
    roles: items.map((item) => ({ role: item.role, routes: item.routes.length })),
    disabledRoles,
    agents,
    issues,
    warnings,
    remoteModelsChecked: false,
  };
}

export async function runCli(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const write = (text) => stdout.write(`${text}\n`);
  try {
    const options = parseArgs(argv);
    const [command = 'help', role, ...extra] = options._;
    if (command !== 'workflow' && extra.length) throw new Error(`多余参数：${extra.join(' ')}`);
    if (options.version) {
      const manifest = JSON.parse(fs.readFileSync(new URL('../.zcode-plugin/plugin.json', import.meta.url), 'utf8'));
      write(manifest.version);
      return 0;
    }
    if (options.help || command === 'help') {
      write(HELP);
      return 0;
    }

    if (command === 'workflow') {
      const action = role || 'list';
      if (action === 'list') {
        if (extra.length) throw new Error('workflow list 不接受工作流 id');
        const workflows = listWorkflows().map((workflow) => ({
          id: workflow.id,
          title: workflow.title,
          description: workflow.description,
          steps: workflow.steps.length,
        }));
        if (options.json) write(JSON.stringify(workflows, null, 2));
        else for (const workflow of workflows) {
          write(`${workflow.id} · ${workflow.title} · ${workflow.steps} 批`);
          write(`  ${workflow.description}`);
        }
        return 0;
      }
      if (action === 'show' || action === 'plan') {
        const [id, ...remaining] = extra;
        if (!id) throw new Error(`workflow ${action} 需要工作流 id`);
        if (remaining.length) throw new Error(`多余参数：${remaining.join(' ')}`);
        const workflow = loadWorkflow(id);
        if (action === 'show') {
          if (options.json) write(JSON.stringify(workflow, null, 2));
          else {
            write(`${workflow.id} · ${workflow.title}`);
            write(workflow.description);
            for (const step of workflow.steps) {
              write(`  ${step.id} · ${step.role} · dependsOn=${step.dependsOn.join(',') || '无'} · optional=${step.optional}`);
              write(`    时机：${step.when}`);
              write(`    验收：${step.acceptance}`);
            }
          }
        } else {
          const plan = planWorkflow(workflow);
          if (options.json) write(JSON.stringify(plan, null, 2));
          else {
            write(`工作流 ${plan.workflow} 的 dry-run 批次计划（未写入文件）：`);
            for (const batch of plan.batches) {
              write(`  ${batch.id} · ${batch.role} · ${batch.status}${batch.optional ? ' · 可选' : ''}`);
              write(`    时机：${batch.when}`);
              write(`    验收：${batch.acceptance}`);
            }
          }
        }
        return 0;
      }
      throw new Error(`未知 workflow 子命令：${action}；可选：list, show, plan`);
    }

    if (extra.length) throw new Error(`多余参数：${extra.join(' ')}`);

    if (command === 'init') {
      if (role) throw new Error('init 不接受位置参数；旧技能目录请用 --from 指定');
      const legacyRoot = options.from || null;
      const result = initConfig({ configPath: options.config, legacyRoot });
      if (!options.json) for (const warning of result.warnings) write(`警告：${warning}`);
      write(options.json
        ? JSON.stringify(result, null, 2)
        : `${result.existing ? '配置已存在，未覆盖' : '配置已创建'}：${result.configPath}`);
      if (!options.json && !result.existing && !result.migratedFrom) write('当前为空配置；请添加模型槽位和角色顺序后运行 troupe sync。');
      if (!options.json && result.migratedFrom) write(`配置来源已保留，未改写原文件：${result.migratedFrom}`);
      return 0;
    }

    if (command === 'list') {
      if (role) throw new Error('list 不接受角色名');
      const items = inventory(loadFor(options).config);
      if (options.json) write(JSON.stringify(items, null, 2));
      else for (const item of items) {
        write(`${item.role} · ${item.title}`);
        if (!item.routes.length) write('  (未配置)');
        for (const route of item.routes) write(`  ${route.agent}  ${route.model}  ${route.level}`);
      }
      return 0;
    }

    if (command === 'route' || command === 'pick') {
      if (!role) throw new Error(`${command} 需要角色名`);
      const config = loadFor(options).config;
      if (command === 'route') {
        const routes = routeRole(config, role);
        if (options.json) write(JSON.stringify(routes, null, 2));
        else for (const route of routes) write(`${route.agent}\t${route.model}\t${route.level}`);
      } else {
        const picked = pickRole(config, role);
        write(options.json ? JSON.stringify(picked, null, 2) : picked.agent);
      }
      return 0;
    }

    if (command === 'sync') {
      if (role) throw new Error('sync 不接受位置参数');
      const result = syncAgents({
        config: loadFor(options).config,
        agentsDir: options['agents-dir'] || defaultAgentsDir(),
        backupDir: options['backup-dir'],
        migrateLegacy: options['migrate-legacy'],
      });
      if (options.json) write(JSON.stringify(result, null, 2));
      else {
        write(`代理目录：${result.agentsDir}`);
        write(`生成 ${result.generated} 份；写入 ${result.written.length}，无需变更 ${result.unchanged}，移除 ${result.removed.length}`);
        if (result.backupDir) write(`覆盖前文件已备份：${result.backupDir}`);
      }
      return 0;
    }

    if (command === 'doctor') {
      if (role) throw new Error('doctor 不接受位置参数');
      const report = doctorReport(options);
      if (options.json) write(JSON.stringify(report, null, 2));
      else {
        write(`配置：${report.configPath}`);
        if (report.disabledRoles.length < report.roles.length && report.disabledRoles.length) write(`已停用角色：${report.disabledRoles.join(', ')}`);
        write(`远程模型实测：未执行（doctor 只做本地检查）`);
        for (const warning of report.warnings) write(`警告：${warning}`);
        for (const issue of report.issues) write(`问题：${issue}`);
        write(report.ok ? 'OK：配置与代理生成物一致' : `FAIL：${report.issues.length} 项待处理`);
      }
      return report.ok ? 0 : 1;
    }

    if (command === 'panel') {
      if (role) throw new Error('panel 不接受位置参数');
      const { startPanel } = await import('./panel.mjs');
      const server = await startPanel({
        port: options.port === undefined ? 8787 : Number(options.port),
        configPath: options.config,
        agentsDir: options['agents-dir'] || defaultAgentsDir(),
      });
      write(`面板已启动：http://127.0.0.1:${server.address().port} （不会自动打开浏览器；Ctrl+C 停止）`);
      return 0;
    }

    throw new Error(`未知命令：${command}\n\n${HELP}`);
  } catch (error) {
    stderr.write(`troupe: ${error.message}\n`);
    return 1;
  }
}
