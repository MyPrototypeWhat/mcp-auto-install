# MCP Auto Install

MCP Auto Install 是一个自动化工具，用于安装和配置 Model Context Protocol (MCP) 服务器。

## 功能

- 自动发现和安装 MCP 服务器
- 智能配置和管理已安装的服务器
- 提供命令行和 MCP 服务两种使用方式
- 使用 LLM 辅助服务器配置

## 安装

```bash
npm install -g mcp-auto-install
```

或者使用 npx:

```bash
npx mcp-auto-install
```

## 命令行使用

### 启动服务器

```bash
mcp-auto-install
```

### 列出可用服务器

```bash
mcp-auto-install list
```

### 安装服务器

```bash
mcp-auto-install install <服务器名称>
```

使用 git clone 方式安装:

```bash
mcp-auto-install install <服务器名称> --clone
```

### 获取服务器配置帮助

```bash
mcp-auto-install configure <服务器名称> -p "用途描述" -q "配置问题"
```

### 获取服务器 README

```bash
mcp-auto-install readme <服务器名称>
```

### 注册新服务器

```bash
mcp-auto-install register <服务器名称> -r <仓库URL> -c <命令> -d <描述> -k <关键词>
```

### 移除服务器

```bash
mcp-auto-install remove <服务器名称>
```

## 作为 MCP 服务器使用

MCP Auto Install 同时也是一个 MCP 服务器，可以被其他支持 MCP 的应用程序调用。它提供以下工具:

- `installServer`: 安装指定的 MCP 服务器
- `getAvailableServers`: 获取可用的 MCP 服务器列表
- `registerServer`: 注册新的 MCP 服务器
- `removeServer`: 移除已注册的 MCP 服务器
- `configureServer`: 获取服务器配置帮助
- `getServerReadme`: 获取服务器的 README 内容

## 环境变量

- `MCP_LLM_API_KEY`: LLM API 密钥，用于配置助手功能
- `MCP_LLM_API_ENDPOINT`: LLM API 端点，默认为 OpenAI API

## 许可证

MIT 