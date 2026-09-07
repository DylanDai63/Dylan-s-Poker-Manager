# Dylan's Poker Helper (PWA)

iPhone 可安装的扑克助手 PWA, 部署在 GitHub Pages。

## 文件结构

```
index.html               主页面
manifest.webmanifest     PWA 清单 (名称 / 图标 / 启动地址)
sw.js                    Service Worker (离线缓存)
icons/                   PWA 图标 (192 / 512 / apple-touch-icon)
scripts/gen_icons.py     重新生成图标的脚本
js/ranges.js             翻前范围数据 (GTO Wizard 8-max, 从 Copy Range 解析)
js/range-grid.js         13×13 范围矩阵渲染 (范围参考页 / 练习页共用)
js/trainer-core.js       翻前练习纯逻辑 (发牌 / 查表 / 判定, 无 DOM)
js/trainer.js            翻前练习视图
scripts/test_trainer_core.mjs  练习逻辑断言 (node 直接跑)
.nojekyll                关闭 GitHub Pages 的 Jekyll 处理
```

## 本地预览

任何静态服务器都行。比如:

```bash
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

## 翻前练习

主页 / 牌局中都有「🎯 翻前练习」入口; 桌面上也可直接打开 `index.html#trainer`。
选场景 (开池 RFI / vs UTG 开池) 和位置 (或随机) → 随机发一手 (1326 组合均匀) → Fold / Call / Raise 三选一 →
✓✓ 最高频动作、✓ 对但低频、✗ 该动作频率为 0; 三个按钮下方显示各动作频率; 可展开范围表高亮当前手牌。
键盘: F / C / R (或 1 / 2 / 3) 作答, Space / Enter 下一手。

逻辑测试 (无需安装任何依赖):

```bash
node scripts/test_trainer_core.mjs
```

## 部署到 GitHub Pages

1. 推送到 `main` 分支。
2. 在仓库 Settings → Pages 里:
   - **Source**: Deploy from a branch
   - **Branch**: `main`, 目录选 `/ (root)`
   - 保存。
3. 等 1-2 分钟, 页面会在
   `https://dylandai63.github.io/dylan-s-poker-manager/` 上线。

## iPhone 安装

1. 用 **Safari** 打开上面的 URL (Chrome 不支持加到主屏幕的 PWA 完整体验)。
2. 点底部 **分享** 按钮 → **添加到主屏幕**。
3. 主屏幕会出现一个图标, 点开后是全屏 App 模式。

## 更新图标

```bash
pip install Pillow
python3 scripts/gen_icons.py
```
