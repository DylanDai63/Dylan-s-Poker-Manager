# Dylan's Poker Helper (PWA)

iPhone 可安装的扑克 bankroll 记账 + session 计时 + 翻前练习, 纯静态页面部署在 GitHub Pages, 数据存 Supabase。
配色与字体按 GTO Wizard(黑 / 薄荷绿 `#aafbb2` / 白, Poppins)。

- 网页版: `https://dylandai63.github.io/Dylan-s-Poker-Manager/`
- 手机版: 同一个 URL, Safari「添加到主屏幕」即是 App(见下)

## 功能

- **记账**: 场地(Wind Creek / Home game / Online poker, 设置里可加)、开始 / 结束时间、buy-in / cash-out。
  线上局按 **bb** 录入 + 级别(z2 / NL2 = $0.02/bb, 可加), 自动换算美元; 填手数就算 **bb/100**。所有金额美元。
- **Bankroll 曲线**: 每个场地一条固定颜色的累计线, 点 chip 选显示哪些; 选了 ≥2 个场地可叠一条「合计」虚线。点折点编辑那场。
- **计时打一场**: 倒计时 + 休息暂停 + 到点响铃(「臭鱼」横幅)+ limp 计数, 结束后直接进记账表单。
- **翻前范围 / 翻前练习**: GTO Wizard 8-max 范围, RFI 与 vs UTG。桌面可直接开 `index.html#trainer`。
- **设置**: 加场地 / 加级别, 看「上次保活」时间, 手动 ping 一次。

## 文件结构

```
index.html               主页面(所有 view 都在这一个文件里)
manifest.webmanifest     PWA 清单 (名称 / 图标 / 启动地址)
sw.js                    Service Worker (离线缓存, 网络优先)
icons/                   PWA 图标 (192 / 512 / apple-touch-icon)
css/styles.css           主题变量在文件顶部 :root, 换皮只改那一块
js/config.js             Supabase URL + publishable key
js/db.js                 数据层: Supabase 实现 + ?mock=1 假数据实现(同一接口)
js/bankroll-core.js      纯逻辑: bb 换算 / bb/100 / 表单校验 / 曲线序列 / 统计 (无 DOM)
js/bankroll-chart.js     Chart.js 包装 (曲线怎么画)
js/app.js                视图与交互 (计时器 / 表单 / bankroll / 设置 / 范围)
js/ranges.js             翻前范围数据 (GTO Wizard 8-max, 从 Copy Range 解析)
js/range-grid.js         13×13 范围矩阵渲染
js/trainer-core.js       翻前练习纯逻辑
js/trainer.js            翻前练习视图
supabase/schema.sql      数据库建表脚本 (v4)
scripts/keepalive.ps1    Supabase 保活: POST 一次 keepalive RPC 就退出
scripts/install_keepalive_task.ps1   把上面那个注册成 Windows 每日计划任务
scripts/test_bankroll_core.mjs       记账逻辑断言 (node 直接跑)
scripts/test_trainer_core.mjs        练习逻辑断言 (node 直接跑)
scripts/gen_icons.py                 重新生成图标
.nojekyll                关闭 GitHub Pages 的 Jekyll 处理
```

## 本地预览

任何静态服务器都行。比如:

```bash
python -m http.server 8000
# 浏览器打开 http://localhost:8000            真数据
# 浏览器打开 http://localhost:8000/?mock=1     假数据, 不连库, 看版式用
```

逻辑测试 (无需安装任何依赖):

```bash
node scripts/test_bankroll_core.mjs
node scripts/test_trainer_core.mjs
```

## 数据库 (Supabase)

- 建表: Supabase Dashboard → SQL Editor → 把 `supabase/schema.sql` 整个贴进去 → Run。
  **会 drop 旧的 v1 `sessions` 表**(2026-10-20 决定清空旧记录)。
- 表: `venues`(场地)、`stakes`(级别, `bb_usd` = 1 bb 多少美元)、`sessions`(每场, 金额一律美元, 线上另存 bb 与手数)、`keepalive_log`(保活记录)。
- 隐私模型沿用 v1: 不登录, RLS 关, 拿到 URL 的人能读写。URL 别公开。

### 保活

Supabase 免费档「7 天低活跃」就暂停项目(官方口径: 每天几次数据库请求足以避免)。
`scripts/keepalive.ps1` 调一次 `keepalive()` RPC(只写 `keepalive_log`, 不碰记账数据), 由 Windows 任务计划程序**每天 09:30** 拉起, 不驻留进程;
电脑那会儿关着就开机后补跑。装一次:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install_keepalive_task.ps1
```

日志在 `%LOCALAPPDATA%\PokerHelper\keepalive.log`; App 设置页也显示库里记到的最近一次 ping。
卸载: `Unregister-ScheduledTask -TaskName "PokerHelper Supabase keepalive" -Confirm:$false`。

## 部署到 GitHub Pages

1. 推送到 `main` 分支。
2. 仓库 Settings → Pages: **Source** = Deploy from a branch, **Branch** = `main` / `/ (root)`(已配好)。
3. 等 1-2 分钟即上线。改了 js/css 记得把 `index.html` 与 `sw.js` 里的 `v=` 版本号 +1, 不然手机上可能吃到旧缓存。

## iPhone 安装

1. 用 **Safari** 打开上面的 URL (Chrome 不支持加到主屏幕的 PWA 完整体验)。
2. 点底部 **分享** 按钮 → **添加到主屏幕**。
3. 主屏幕会出现一个图标, 点开后是全屏 App 模式。换过图标 / 颜色后要删掉旧图标重新添加一次才会换新图标。

## 更新图标

```bash
pip install Pillow
python scripts/gen_icons.py
```
