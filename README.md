# MCP Auto Install

MCP Auto Install 是一个自动化工具，用于管理和安装 [Model Context Protocol (MCP)](https://github.com/ModelContextProtocol) 生态系统中的服务器。该工具可以自动发现、安装和管理 MCP 服务器，简化开发和使用过程。

## 功能特性

- **自动发现** - 自动从 npm 注册表中发现 `@modelcontextprotocol` 域下的所有可执行包
- **双重安装方式** - 支持通过 npx 和 git clone 两种方式安装服务器
- **智能消息分析** - 分析用户消息，检测何时需要特定的 MCP 服务器并提供安装建议
- **注册表管理** - 提供命令行工具用于管理 MCP 服务器注册表
- **灵活配置** - 支持自定义安装命令和关键词

## 安装

### 前提条件

- Node.js (>= 16.x)
- npm 或 pnpm

### 安装步骤

```bash
# 使用 npm 安装
npm install -g @myprototypewhat/mcp-auto-install

# 或使用 pnpm 安装
pnpm add -g @myprototypewhat/mcp-auto-install
```

## 使用方法

### 启动服务器

```bash
# 启动 MCP Auto Install 服务器
mcp-auto-install

# 指定端口和主机
mcp-auto-install -p 8000 -h 0.0.0.0
```

### 列出已注册的服务器

```bash
mcp-auto-install list
```

### 安装 MCP 服务器

```bash
# 使用 npx 方式安装服务器（默认）
mcp-auto-install install inspector

# 使用 git clone 方式安装服务器
mcp-auto-install install inspector --clone
```

### 注册新服务器

```bash
mcp-auto-install register my-server \
  -r https://github.com/example/my-server \
  -c my-server-command \
  -d "My custom MCP server" \
  -k keyword1,keyword2
```

### 移除服务器

```bash
mcp-auto-install remove my-server
```

### 更新注册表

```bash
mcp-auto-install update-registry
```

## MCP 服务器交互

MCP Auto Install 服务器使用 stdin/stdout 进行交互，可以与 MCP Inspector 一起使用：

```bash
npx @modelcontextprotocol/inspector node /path/to/mcp-auto-install
```

## 配置

MCP Auto Install 在用户主目录中存储配置：

- 配置目录: `~/.mcp-auto-install/`
- 注册表文件: `~/.mcp-auto-install/registry.json`
- 可执行脚本目录: `~/.mcp-auto-install/bin/`

## 开发

### 克隆仓库

```bash
git clone https://github.com/MyPrototypeWhat/mcp-auto-install.git
cd mcp-auto-install
```

### 安装依赖

```bash
npm install
# 或
pnpm install
```

### 构建项目

```bash
npm run build
# 或
pnpm run build
```

### 运行开发版本

```bash
node build/index.js
```

## 项目结构

```
mcp-auto-install/
├── src/                  # 源代码
│   └── index.ts          # 主程序入口
├── build/                # 构建输出
├── package.json          # 项目配置
├── tsconfig.json         # TypeScript 配置
└── README.md             # 项目文档
```

## 技术栈

- TypeScript - 主要开发语言
- commander - 命令行界面
- npx-scope-finder - 用于发现 npm 作用域内的可执行包
- @modelcontextprotocol/sdk - MCP SDK

## 贡献

欢迎贡献！请遵循以下步骤：

1. Fork 仓库
2. 创建您的特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交您的更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建一个 Pull Request

## 许可证

MIT

## 关于 MCP

Model Context Protocol (MCP) 是一个开放标准，用于定义模型和工具之间的通信。了解更多信息，请访问 [ModelContextProtocol](https://github.com/ModelContextProtocol)。 