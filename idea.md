# Poker Helper — 功能 Idea 记录

> 这个文件用来记录想法和设计决策，不是开发文档。代码实现以实际仓库为准。

## 1. Session 计时器 (优先级 P0)

### 核心需求
- 一个 section / session 默认 **3 小时**倒计时
- 打开页面看到一个 **Start** 按钮，点击 = 开始牌局，开始倒计时
- 倒计时归零时**响铃**提醒
- 提醒后可以：
  - **Stop**：停止响铃
  - **Restart**：重新计时（继续打）

### 中途操作
- **End** 按钮：随时结束当前 section（提前结束的场景）
  - 提前结束也要弹"记录"页面
- **延长**：到时间响铃后选 Restart，相当于又开始 3 小时；也可以考虑做"再延长 30 分钟"按钮
- 中途**离开页面 / 锁屏**：计时不能停。
  - 实现思路：存"开始时刻"的时间戳，每次进入页面用 `Date.now() - startTime` 算剩余，不用 setInterval 累加
  - 响铃如果在后台触发不了（iOS 限制），需要在打开页面那一刻立刻补上声音 + 红色横幅

### 结束后的录入页 (P0 配套)
弹出一个表单，填：
- **Buy-in 总额**（可能多次补码，先按总额填，后面再考虑分次记录）
- **Cash-out 金额**
- 自动带入：
  - 开始时刻
  - 结束时刻
  - 持续时长
- 提交后保存到云端，回到主页

### UX 草图
```
[ 主页 ]
   ♠ Poker Helper
   ─────────────
   时长: [3h ▼]  ← 默认 3h，可改 (2h/3h/4h/自定义)
   ▢ Start Session    (未在牌局时显示)

   倒计时:  02:47:13   (牌局中显示)
   开始于 19:30
   [ End Session ]

   ─────────────
   最近 session:
     5/19  +$245  3h12m
     5/17  -$80   2h05m
     ...
```

### 时间到了的提醒
**三重轰炸**：
1. 响铃（一段循环铃声直到点 Stop）
2. 手机震动（`navigator.vibrate`，iOS PWA 可能没效，但加上保险）
3. 全屏红色横幅闪烁，大字显示：
   > **🚨 不要做没有纪律的臭鱼！！！**

横幅上有两个按钮：
- `Stop` — 停止响铃震动，但 session 继续（用于"我看到了，先静音"）
- `Restart` — 重置倒计时，继续打（同时停止响铃）
- `End Session` — 结束牌局，进入录入页

页面再次打开（哪怕之前在后台被 iOS 杀掉）若发现已经超时，立刻补上视觉提醒（响铃可能要等用户交互才能播）。

```
[ 录入页 (End 后弹出) ]
   Session 结束
   开始 19:30 → 结束 22:14  (2h 44m)

   Buy-in:   $ ___
   Cash-out: $ ___
   备注:     ___________

   [ 保存 ]  [ 取消 ]
```

---

## 2. 数据存储 → **Supabase** (已定)

### 需求
- 跨设备同步（手机 / 电脑访问同一个 URL 都能看到自己的数据）
- 数据量小（每条 session 几十字节，一年也就几十 KB）
- 单用户为主（先做自己用）

### 认证策略
- **不做登录** — 点开即用
- 隐私模型："URL 没人会主动搜" + "数据不敏感"
- 代价：拿到 URL 的人能看 / 写数据；想锁起来再加登录

### 数据模型
```sql
create table sessions (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid references auth.users(id),  -- nullable, 暂不用
  started_at                timestamptz not null,
  ended_at                  timestamptz not null,
  planned_duration_minutes  int not null,
  buy_in                    numeric(10,2) not null,  -- USD
  cash_out                  numeric(10,2) not null,  -- USD
  notes                     text,
  created_at                timestamptz default now()
);

-- RLS 关闭，匿名读写
alter table sessions disable row level security;
```

### 当前 session 状态怎么存
- "正在倒计时"这个状态存 **localStorage**（开始时间戳、目标时长）
- 这样断网 / 关掉浏览器 / 切后台都没事，重新打开还能继续
- 只有点 End 提交录入页后，才把整条 session 写进 Supabase

### 待定
- 是否记录场地、牌局类型（NLH/PLO/...）、盲注大小 → 先不做，P1 再加字段
- 多次买入怎么处理 → 先合并成一个 buy-in 总额

---

## 3. 后续功能 (P1+，先记下来)

- 统计页面：累计盈亏、小时时薪、胜率、按月图表
- 标签：场地名、桌型、对手强度
- 时区：默认本地时区，跨时区出差时注意
- 导出 CSV
- 多账号 / 多人共享（暂时不做）
- 实时手牌建议（这个是另一个大功能，先把日志做好）

---

## 4. 技术决策记录

| 时间 | 决策 | 备注 |
|---|---|---|
| 2026-05-20 | PWA 部署到 GitHub Pages | 仓库 public 即可免费，Pro 太贵 |
| 2026-05-20 | iOS 主要靠 Safari "添加到主屏幕" | Chrome 不支持完整 PWA |
| 2026-05-20 | 数据存 Supabase（免费档） | 初版含登录 |
| 2026-05-20 | 去掉登录，点开即用 | RLS 关闭；隐私靠 URL 不公开 |
| 2026-05-20 | 货币 USD | 显示 $ 符号 |
| 2026-05-20 | 倒计时默认 3h，Start 前可改 | 提供 2h/3h/4h/自定义 |
| 2026-05-20 | 超时三重提醒：声 + 振动 + 红色横幅 | 横幅文字"不要做没有纪律的臭鱼！！！" |

---

## 5. 开放问题

- [x] 数据存储 → Supabase
- [x] 货币 → USD
- [x] 自定义时长 → 默认 3h，可改
- [x] 提醒 → 声 + 振动 + 红色横幅 + "臭鱼"标语
- [x] 登录 → 不要，点开即用
- [ ] 响铃用什么具体声音？(先用一段合成 beep，以后可换 mp3)
- [ ] 提前 End 时，Cash-out 是否预填 0 ？(暂定不预填，留空让用户填)
- [ ] Restart 按钮是"再加 3 小时"还是"重置为当前选的时长"？(暂定重置为当前选的时长)

---

## v2 计划（2026-05-20 起）

### v2-A. 编辑 / 删除历史 session
- 点 recent 列表里任一条 → 弹出编辑页
- 全部字段可改：开始时间、结束时间、目标时长、buy-in、cash-out、备注
- 同一页可以删除（需 confirm）

### v2-B. 翻前范围 helper
- **入口**：running view 加一个大按钮 `📊 翻前范围`
- **全屏弹出**新页面，结构：
  - 顶部：场景切换 `开池 RFI` ↔ `vs UTG open`
  - 顶部：位置选择 chips（UTG / UTG+1 / MP / LJ / HJ / CO / BTN / SB / BB）
    - 开池场景：BB 不可选（不开池）
    - vs UTG 场景：UTG 不可选（不能对自己开池）
  - 主体：13×13 翻前手牌矩阵
  - 每格 3 色横向条：红 = 加注，绿 = 跟注，蓝 = 弃牌，宽度 = 频率
  - 关闭按钮 → 回到 running view
- **数据**：硬编码近似 9-max 100bb 无 ante 现金局 GTO 范围
  - 数据放 `js/ranges.js`
  - 不追求和 GTO Wizard 100% 一致；以后能换准数据
- **不在运行状态时**：暂时不开放（按用户要求只在 session 中显示），将来可考虑加到主页

### v2 技术决策
| 项 | 决策 |
|---|---|
| 范围数据存哪 | 静态 JS 常量，不进 Supabase |
| 范围数据来源 | tyloo/poker-range-analyzer (MIT) 的 6-max GTO 频率版作为底；早位 (UTG/UTG+1/MP/LJ) 自己写了更紧的 9-max 版本，CO/BTN/SB 直接用 6-max 数据 |
| 范围数据格式 | 每手牌 → `[raise, call]`（0..1），fold 隐式 = 1 - r - c |
| 编辑时间选择 | `<input type="datetime-local">`，iOS 原生选择器 |
| 删除确认 | 简单 `confirm()` |

---

## v3 计划（2026-05-21）

### v3-A. Bankroll 折线图
- **主页下方**：紧凑 mini chart 显示累计盈亏曲线
  - 一条线，无 axis label，节省空间
  - 顶部显示当前总盈亏 `+$X` / `-$X`
  - 点击进入详情页
- **详情页 (新 view: view-bankroll)**：
  - 大图 (~280px 高)，含日期轴 + 金额轴
  - 顶部统计：总盈亏 / session 数 / 胜率 / 时薪
  - **点折点**：下方显示那场 session 的详情 + "编辑"按钮
  - 折点颜色：盈利绿、亏损红
- **数据源**：Supabase 全部 sessions（升序按时间）
- **空状态**：还没数据时显示提示

### v3 技术决策
| 项 | 决策 |
|---|---|
| 图表实现 | 手写 SVG (无依赖) |
| 折点交互 | 点击 circle → 下方显示 session card |
| 数据缓存 | 一次 fetch 全部，切片用于"最近"列表 |
| 累计起点 | 从 $0 起 (不要求初始 bankroll) |

---

## v4 计划（2026-10-20）— bankroll 管理重做

### 起因
- 几个月没用, Supabase 免费项目因「低活跃」被暂停 → 要一个不靠人记得打开 App 的保活。
- 记账要分场地、线上按 bb 记、算 bb/100; 配色改成 GTO Wizard 风格。

### v4-A. 保活
- Supabase 官方: Free 项目「7 天低活跃」暂停, 「每天几次数据库请求」足以避免; 暂停后可 Resume, 数据不丢。
- 方案: 本机 Windows 任务计划程序每天 09:30 跑 `scripts/keepalive.ps1`(POST `keepalive()` RPC, 只写 `keepalive_log`), 错过就开机补跑, 无驻留进程。
- 否决: GitHub Actions 定时任务(public 仓 60 天无 commit 自动停用, 正撞「几个月不用」); cron-job.org(可用, 但要多开一个账号, 电脑常开时本机更简单); Cloudflare Worker(为一个 GET 多一层部署)。
- App 设置页显示库里最近一次 ping, 超过 24 h 变红。

### v4-B. 数据模型
- 旧 `sessions` 表 drop(旧记录清空)。
- `venues`(name, kind live/online)种 Wind Creek / Home game / Online poker, 可在 App 里加。
- `stakes`(code, bb_usd)种 z2 / NL2 = 0.02, 升级别在设置里加一行, 不改代码。
- `sessions`: 金额一律美元; 线上另存 `buy_in_bb / cash_out_bb / hands / stakes_id`, 保存时按级别换算美元。
- 为什么存两份(美元 + bb): 账是钱, 级别以后改了也不能回头改历史金额; bb 是原始录入, 算 bb/100 用。

### v4-C. 曲线
- Chart.js 4.4.1(MIT, cdnjs 固定版本 + SRI)取代手写 SVG: 多线 + 图例 + tooltip 手写不值。
- x 轴 = 所选场地的 session 按时间排, 每条场地线是累计盈亏, 在别人的 session 处**持平延续**, 这样每条线每个 x 都有值, 「合计」就是逐点相加。
- 只选一个场地时不画合计(会和那条线完全重合)。

### v4-D. 界面
- 主题变量集中在 `styles.css` 顶部 `:root`: 黑 `#0f0f0f / #161618 / #202022`、白 `#fdfdfd`、灰 `#b3b3b8`、薄荷绿 `#aafbb2`(GTO Wizard Vuetify 主题的 primary)、Poppins。
- 手机: PWA 不变; 桌面 ≥900px 两栏(左图表 + 列表, 右操作)。
- 记账 / 编辑 / 计时结束 三种入口共用一个表单; 计时器、休息、翻前练习只换皮不改逻辑。
- `?mock=1` 假数据模式: 看版式、离线演示。

### v4 技术决策
| 项 | 决策 |
|---|---|
| 保活周期 | 每天一次(官方说「每天几次」才稳; 电脑偶尔关机 + 错过补跑, 6 天一次太贴边) |
| 图表库 | Chart.js 4.4.1 UMD, cdnjs + integrity |
| 字体 | Google Fonts Poppins, 离线退回系统字体 |
| 场地 / 级别 | 库表 + 设置页增加, 不硬编码 |
| 旧记录 | 清空(老板 2026-10-20 定) |
