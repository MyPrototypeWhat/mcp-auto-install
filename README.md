# MCP Auto Install

MCP Auto Install 是一个自动化工具，用于安装和配置 Model Context Protocol (MCP) 服务器。

## 功能

- 自动发现和安装 MCP 服务器
- 智能配置和管理已安装的服务器
- 提供命令行和 MCP 服务两种使用方式
- 使用 LLM 辅助服务器配置
- **预加载功能**: 启动时自动加载所有可用的MCP包信息到本地
- **新功能**: 根据用户请求自动检测并安装所需的 MCP 服务器

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

### 自动检测并安装服务器

```bash
mcp-auto-install auto "我想要读取xxx文件"
```

使用自定义设置路径:

```bash
mcp-auto-install auto "我想要读取xxx文件" --settings ~/custom/mcp_settings.json
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
- `autoDetect`: 根据用户请求自动检测并安装所需的 MCP 服务器

## 预加载功能

在启动时，MCP Auto Install 会自动从 @modelcontextprotocol 命名空间下获取所有可用的 MCP 包信息，并缓存以下内容：

1. 服务器基本信息（名称、描述、关键词等）
2. README 内容（缓存到本地文件系统）

这样做的好处是：
- 加速自动检测过程，无需每次都检索 npm
- 使系统在离线状态下也能正常工作
- 提供更快的响应速度

## 自动检测功能

自动检测功能可以分析用户的请求，并确定所需的 MCP 服务器类型。当LLM接收到与特定MCP服务器相关的请求时，它会自动调用我们的服务。

### 支持的服务器类型

当前支持自动检测的服务器类型包括：

1. **文件系统 (filesystem)** - 当用户需要读取、写入或操作文件时
2. **数据库 (database)** - 当用户需要查询、存储或操作数据库时
3. **网络请求 (web)** - 当用户需要访问网页、API或执行网络爬取时
4. **图像处理 (image)** - 当用户需要处理、分析或识别图片时
5. **命令执行 (shell)** - 当用户需要执行系统命令或脚本时

### 智能README处理

当返回README给LLM时，系统会自动添加以下提示词：

```
请根据上述README内容:
1. 总结这个MCP服务器的主要功能和用途
2. 指导用户如何配置必要的参数
3. 提供一个简单的使用示例
```

这些提示词可以引导LLM更好地理解README内容，并帮助用户：
- 理解服务器的基本功能
- 了解如何配置必要的参数
- 获得使用示例

### 工作流程

1. 用户向LLM提出需要特定MCP功能的请求（例如："我想要读取xxx文件"）
2. LLM识别出用户需要文件操作功能
3. LLM调用`mcp_auto_install_autoDetect`工具，发送用户请求
4. 服务器从预加载的缓存中快速查找合适的MCP服务器
5. 返回带有提示词的README，引导LLM帮助用户设置参数
6. 用户设置好参数后，LLM可以直接使用已安装的MCP服务器执行文件操作

用户可以通过以下方式调用此功能:

- 通过命令行: `mcp-auto-install auto "我想要读取xxx文件"`
- 通过 MCP 工具: `mcp_auto_install_autoDetect`

## 环境变量

- `MCP_LLM_API_KEY`: LLM API 密钥，用于配置助手功能
- `MCP_LLM_API_ENDPOINT`: LLM API 端点，默认为 OpenAI API

## 许可证

MIT 