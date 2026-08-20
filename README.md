# 小宇数字人

Windows数字人口播视频制作软件。

## 环境要求

- Windows 10 或更高版本（64 位）
- Node.js 20 或更高版本
- PowerShell 5.1 或更高版本

## 本地配置

复制 `.env.example` 为 `.env.local`，只在本机填写 API Key。`.env.local` 已被 Git 忽略，不要将密钥写入源码、截图或提交记录。

## 开发模式

```bash
npm install
npm run dev
```

首次运行会从 Gyan.dev 官方 Windows 构建站下载 FFmpeg Essentials，并校验官方 SHA-256 后保存到 `resources/bin/ffmpeg.exe`。该文件不会进入 Git。运行后会直接打开“小宇数字人”Windows桌面窗口。

## Windows打包

```bash
npm run dist:installer
npm run dist:portable
```

生成结果保存在 `release` 文件夹。安装版允许用户选择安装目录，便携版可直接双击运行。

`release` 目录和安装包不会进入 Git；对外发布时应上传到 GitHub Releases。

## 当前功能

- DeepSeek AI 文案与严格使用原文两种模式。
- 目标时长、预计播报时长、人物描述与重新生成。
- 火山 Seedream 无水印人物图片与 Seedance 自然动作视频。
- 支持上传本人或已获授权的 JPG、PNG、WebP 人物照片，并在本地准备口型同步素材。
- MiMo 音色选择、语音生成、试听与真实时长显示。
- 阿里云 VideoRetalk 口型同步，长音频自动延展待机视频。
- 内置 FFmpeg 字幕压制、1080×1920 成片预览与文件定位。
- 所有生成步骤均显示实时状态，任务进行时禁止重复提交。

## 本机配置与输出

在“设置中心”分别配置 DeepSeek、火山方舟、MiMo 和阿里云百炼 API Key。密钥由 Electron 主进程使用 Windows 安全存储加密，浏览器界面无法直接读取。

默认输出目录为：`文档\\小宇数字人\\outputs`。

## 第三方组件

本项目打包时会附带 GPLv3 许可的 FFmpeg Essentials。来源与许可说明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。公开分发安装包前还应确认图标、示例素材和所有第三方组件的授权。
