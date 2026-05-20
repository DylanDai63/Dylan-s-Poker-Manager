# Dylan's Poker Helper (PWA)

iPhone 可安装的扑克助手 PWA, 部署在 GitHub Pages。

## 文件结构

```
index.html               主页面
manifest.webmanifest     PWA 清单 (名称 / 图标 / 启动地址)
sw.js                    Service Worker (离线缓存)
icons/                   PWA 图标 (192 / 512 / apple-touch-icon)
scripts/gen_icons.py     重新生成图标的脚本
.nojekyll                关闭 GitHub Pages 的 Jekyll 处理
```

## 本地预览

任何静态服务器都行。比如:

```bash
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
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
