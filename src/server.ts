import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import fetch from "node-fetch";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { npxFinder } from "npx-scope-finder";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  MCPServerInfo,
  MCPAutoInstallOptions,
  OperationResult,
  NpmPackageInfo
} from "./types.js";

const exec = promisify(execCb);

/**
 * 简单的Zod转JSON Schema函数
 */
function simpleZodToJsonSchema(
  schema: z.ZodType<unknown>
): Record<string, unknown> {
  // 为了简化，我们只处理基本类型
  if (schema instanceof z.ZodString) {
    return { type: "string" };
  }

  if (schema instanceof z.ZodNumber) {
    return { type: "number" };
  }

  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }

  if (schema instanceof z.ZodArray) {
    return {
      type: "array",
      items: simpleZodToJsonSchema(schema._def.type),
    };
  }

  if (schema instanceof z.ZodObject) {
    const properties: Record<string, Record<string, unknown>> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(schema.shape)) {
      properties[key] = simpleZodToJsonSchema(value as z.ZodType<unknown>);

      if (!(value instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required,
    };
  }

  if (schema instanceof z.ZodOptional) {
    return simpleZodToJsonSchema(schema._def.innerType);
  }

  // 默认返回
  return { type: "object" };
}

// 设置路径
const SETTINGS_PATH = path.join(homedir(), ".mcp", "mcp_settings.json");

// 服务器设置
let serverSettings: { servers: MCPServerInfo[] } = { servers: [] };

// 创建MCP服务器实例
const server = new Server(
  {
    name: "mcp-auto-install",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// 注册工具列表处理程序
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "mcp_auto_install_getAvailableServers",
        description: "获取可用的MCP服务器列表",
        inputSchema: simpleZodToJsonSchema(z.object({
          random_string: z.string().describe("Dummy parameter for no-parameter tools")
        })),
      },
      {
        name: "mcp_auto_install_installServer",
        description: "安装指定的MCP服务器",
        inputSchema: simpleZodToJsonSchema(z.object({
          serverName: z.string().describe("The name of the server to install"),
          useNpx: z.boolean().describe("Whether to use npx method (true) or git clone method (false)").optional(),
        })),
      },
      {
        name: "mcp_auto_install_registerServer",
        description: "注册新的MCP服务器",
        inputSchema: simpleZodToJsonSchema(z.object({
          name: z.string().describe("Server name"),
          repo: z.string().describe("GitHub repository URL"),
          command: z.string().describe("Command to run the server"),
          description: z.string().describe("Server description"),
          keywords: z.array(z.string()).describe("Keywords for server detection").optional(),
          installCommands: z.array(z.string()).describe("Custom installation commands").optional(),
        })),
      },
      {
        name: "mcp_auto_install_removeServer",
        description: "移除已注册的MCP服务器",
        inputSchema: simpleZodToJsonSchema(z.object({
          serverName: z.string().describe("The name of the server to remove"),
        })),
      },
      {
        name: "mcp_auto_install_configureServer",
        description: "获取服务器配置帮助",
        inputSchema: simpleZodToJsonSchema(z.object({
          serverName: z.string().describe("The name of the server to configure"),
          purpose: z.string().describe("What you want to do with the server").optional(),
          query: z.string().describe("Specific question about configuration").optional(),
        })),
      },
      {
        name: "mcp_auto_install_getServerReadme",
        description: "获取服务器的README内容",
        inputSchema: simpleZodToJsonSchema(z.object({
          serverName: z.string().describe("The name of the server to get README for"),
        })),
      },
    ]
  };
});

// 注册工具调用处理程序
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  
  switch (name) {
    case "mcp_auto_install_getAvailableServers":
      return { 
        result: await getRegisteredServers() 
      };
      
    case "mcp_auto_install_installServer":
      return { 
        result: await handleInstallServer(args as unknown as { serverName: string; useNpx?: boolean }) 
      };
      
    case "mcp_auto_install_registerServer":
      return { 
        result: await handleRegisterServer(args as unknown as MCPServerInfo) 
      };
      
    case "mcp_auto_install_removeServer":
      return { 
        result: await handleRemoveServer(args as unknown as { serverName: string }) 
      };
      
    case "mcp_auto_install_configureServer":
      return { 
        result: await handleConfigureServer(
          args as unknown as { serverName: string; purpose?: string; query?: string }
        ) 
      };
      
    case "mcp_auto_install_getServerReadme":
      return { 
        result: await handleGetServerReadme(args as unknown as { serverName: string }) 
      };
      
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

/**
 * 初始化设置
 */
async function initSettings(): Promise<void> {
  try {
    // 创建设置目录
    const settingsDir = path.dirname(SETTINGS_PATH);
    await fs.mkdir(settingsDir, { recursive: true });

    // 尝试加载现有设置
    try {
      const data = await fs.readFile(SETTINGS_PATH, "utf-8");
      serverSettings = JSON.parse(data);
    } catch (error) {
      // 如果文件不存在，使用默认设置
      serverSettings = { servers: [] };
      // 保存默认设置
      await saveSettings();
    }
  } catch (error) {
    console.error("初始化设置失败:", error);
  }
}

/**
 * 保存设置
 */
async function saveSettings(): Promise<void> {
  try {
    // 确保目录存在
    const settingsDir = path.dirname(SETTINGS_PATH);
    await fs.mkdir(settingsDir, { recursive: true });
    
    // 保存设置文件
    await fs.writeFile(
      SETTINGS_PATH,
      JSON.stringify(serverSettings, null, 2),
      "utf-8"
    );
  } catch (error) {
    console.error("保存设置失败:", error);
    throw new Error("Failed to save settings");
  }
}

/**
 * 查找服务器
 */
function findServer(name: string): MCPServerInfo | undefined {
  return serverSettings.servers.find((s) => s.name === name);
}

/**
 * 从GitHub仓库URL获取npm包名
 */
async function getPackageNameFromRepo(repoUrl: string): Promise<string | null> {
  try {
    // 首先尝试使用CLI方式和-r选项
    try {
      const { stdout } = await exec(`npx npx-scope-finder find ${repoUrl}`);
      const trimmedOutput = stdout.trim();
      if (trimmedOutput) {
        return trimmedOutput;
      }
    } catch (cliError) {
      console.warn(`CLI npx-scope-finder failed: ${(cliError as Error).message}`);
      // 继续使用其他方法
    }
    
    // 提取GitHub路径
    const repoPath = extractGitHubPathFromUrl(repoUrl);
    if (!repoPath) {
      throw new Error(`Invalid GitHub repository URL: ${repoUrl}`);
    }
    
    // 使用 npxFinder API 查找 @modelcontextprotocol 域下的所有可执行包
    try {
      const packages = await npxFinder('@modelcontextprotocol', {
        timeout: 10000,
        retries: 3,
        retryDelay: 1000
      });
      
      // 查找匹配 repo URL 的包
      const matchingPackage = packages.find((pkg) => 
        pkg.links?.repository?.includes(repoPath)
      );
      
      if (matchingPackage) {
        return matchingPackage.name;
      }
      
      // 如果没有找到匹配的包，尝试匹配名称
      const [owner, repo] = repoPath.split('/');
      const nameMatchingPackage = packages.find((pkg) => 
        pkg.name.endsWith(`/${repo}`)
      );
      
      if (nameMatchingPackage) {
        return nameMatchingPackage.name;
      }
    } catch (npmError) {
      console.warn(`npx-scope-finder API failed: ${(npmError as Error).message}`);
      // 继续使用备用方法
    }
    
    // 备用方法：假设包名格式为 @modelcontextprotocol/repo
    const repo = repoPath.split('/')[1];
    return `@modelcontextprotocol/${repo}`;
  } catch (error) {
    console.error("Failed to find package name:", error);
    
    // 如果上述方法失败，尝试从URL提取包名
    const parts = repoUrl.split("/");
    if (parts.length >= 2) {
      const repo = parts[parts.length - 1].replace(".git", "");
      
      // 假设包名格式为 @modelcontextprotocol/repo
      return `@modelcontextprotocol/${repo}`;
    }
    
    return null;
  }
}

/**
 * 从GitHub URL提取仓库路径
 */
function extractGitHubPathFromUrl(url: string): string | null {
  // 匹配GitHub URL
  const githubPattern = /github\.com[\/:]([^\/]+)\/([^\/\.]+)(\.git)?/;
  const match = url.match(githubPattern);

  if (match && match.length >= 3) {
    const owner = match[1];
    const repo = match[2];
    return `${owner}/${repo}`;
  }

  return null;
}

/**
 * 启动MCP服务器
 */
export async function startServer(): Promise<void> {
  // 初始化设置
  await initSettings();

  // 使用标准输入输出启动服务器
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("MCP Auto Install Server is running");
}

/**
 * 获取已注册的服务器列表
 */
export async function getRegisteredServers(): Promise<MCPServerInfo[]> {
  // 确保设置已加载
  await initSettings();
  return serverSettings.servers;
}

/**
 * 以下是为CLI工具提供的接口函数
 */

export async function handleInstallServer(args: {
  serverName: string;
  useNpx?: boolean;
}): Promise<OperationResult> {
  const { serverName, useNpx = true } = args;
  const server = findServer(serverName);

  if (!server) {
    return {
      success: false,
      message: `Server '${serverName}' not found in the registry. Use getAvailableServers to see available servers.`,
    };
  }

  try {
    if (useNpx) {
      // 使用npx安装
      const packageName = await getPackageNameFromRepo(server.repo);
      if (!packageName) {
        throw new Error(`Could not determine package name for ${server.repo}`);
      }

      const { stdout, stderr } = await exec(`npx ${packageName}`);

      return {
        success: true,
        message: `Successfully installed ${serverName} using npx. Output: ${stdout}`,
        output: stdout,
        error: stderr,
      };
    }

    // 使用git clone安装
    const repoName =
      server.repo.split("/").pop()?.replace(".git", "") || serverName;
    const cloneDir = path.join(homedir(), ".mcp", "servers", repoName);

    // 创建目录
    await fs.mkdir(path.join(homedir(), ".mcp", "servers"), {
      recursive: true,
    });

    // 克隆仓库
    await exec(`git clone ${server.repo} ${cloneDir}`);

    // 安装依赖
    await exec(`cd ${cloneDir} && npm install`);

    if (server.installCommands && server.installCommands.length > 0) {
      // 运行自定义安装命令
      for (const cmd of server.installCommands) {
        await exec(`cd ${cloneDir} && ${cmd}`);
      }
    }

    return {
      success: true,
      message: `Successfully installed ${serverName} using git clone to ${cloneDir}`,
      installPath: cloneDir,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to install ${serverName}: ${(error as Error).message}`,
      error: (error as Error).message,
    };
  }
}

export async function handleRegisterServer(
  serverInfo: MCPServerInfo
): Promise<OperationResult> {
  // 检查服务器是否已存在
  const existingIndex = serverSettings.servers.findIndex(
    (s) => s.name === serverInfo.name
  );

  if (existingIndex !== -1) {
    // 更新现有服务器
    serverSettings.servers[existingIndex] = serverInfo;
  } else {
    // 添加新服务器
    serverSettings.servers.push(serverInfo);
  }

  // 保存更新后的设置
  await saveSettings();

  return {
    success: true,
    message: `Server '${serverInfo.name}' has been registered successfully.`,
  };
}

export async function handleRemoveServer(args: {
  serverName: string;
}): Promise<OperationResult> {
  const { serverName } = args;
  const initialLength = serverSettings.servers.length;

  // 移除指定的服务器
  serverSettings.servers = serverSettings.servers.filter(
    (s) => s.name !== serverName
  );

  if (serverSettings.servers.length === initialLength) {
    return {
      success: false,
      message: `Server '${serverName}' not found in the registry.`,
    };
  }

  // 保存更新后的设置
  await saveSettings();

  return {
    success: true,
    message: `Server '${serverName}' has been removed successfully.`,
  };
}

export async function handleConfigureServer(args: {
  serverName: string;
  purpose?: string;
  query?: string;
}): Promise<OperationResult> {
  const { serverName, purpose = "", query = "" } = args;
  const server = findServer(serverName);

  if (!server) {
    return {
      success: false,
      message: `Server '${serverName}' not found in the registry.`,
    };
  }

  // 获取README内容
  const readmeResult = await handleGetServerReadme({ serverName });

  if (!readmeResult.success || !readmeResult.readmeContent) {
    return {
      success: false,
      message: `Failed to get README for ${serverName}: ${readmeResult.message}`,
    };
  }

  // 这里应该调用LLM API来获取配置建议
  // 为简化示例，我们仅返回README内容和提示信息

  return {
    success: true,
    message: `Configuration help for ${serverName}`,
    readmeContent: readmeResult.readmeContent,
    explanation:
      "Please refer to the README content for configuration instructions.",
    suggestedCommand: `mcp-auto-install install ${serverName}`,
  };
}

export async function handleGetServerReadme(args: {
  serverName: string;
}): Promise<OperationResult> {
  const { serverName } = args;
  const server = findServer(serverName);

  if (!server) {
    return {
      success: false,
      message: `Server '${serverName}' not found in the registry.`,
    };
  }

  try {
    // 从GitHub获取README内容
    const repoPath = extractGitHubPathFromUrl(server.repo);
    if (!repoPath) {
      throw new Error(`Invalid GitHub repository URL: ${server.repo}`);
    }

    const readmeUrl = `https://raw.githubusercontent.com/${repoPath}/main/README.md`;
    const response = await fetch(readmeUrl);

    if (!response.ok) {
      // 尝试使用master分支
      const masterReadmeUrl = `https://raw.githubusercontent.com/${repoPath}/master/README.md`;
      const masterResponse = await fetch(masterReadmeUrl);

      if (!masterResponse.ok) {
        throw new Error(`Failed to fetch README: ${response.statusText}`);
      }

      const readmeContent = await masterResponse.text();
      return {
        success: true,
        message: "README fetch successful",
        readmeContent,
      };
    }

    const readmeContent = await response.text();
    return {
      success: true,
      message: "README fetch successful",
      readmeContent,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to fetch README: ${(error as Error).message}`,
    };
  }
}
