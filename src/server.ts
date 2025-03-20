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
  NpmPackageInfo,
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
const SETTINGS_PATH = path.join("mcp", "mcp_settings.json");

// 服务器设置
let serverSettings: { servers: MCPServerInfo[] } = { servers: [] };

/**
 * 预加载MCP包信息到本地注册文件中
 */
async function preloadMCPPackages(): Promise<void> {
  try {
    console.log("预加载MCP包信息...");

    // 从@modelcontextprotocol域获取所有可用包
    const packages = await npxFinder("@modelcontextprotocol", {
      timeout: 15000,
      retries: 3,
      retryDelay: 1000,
    });

    console.log(`发现 ${packages.length} 个MCP包`);

    // 过滤和处理包信息
    for (const pkg of packages) {
      if (!pkg.name || pkg.name === "@modelcontextprotocol/sdk") {
        continue; // 跳过SDK本身
      }

      try {
        // 提取服务器类型（从包名中）
        const nameParts = pkg.name.split("/");
        const serverName = nameParts[nameParts.length - 1];
        const serverType = serverName.replace("mcp-", "");

        // 构建服务器信息
        const serverInfo: MCPServerInfo = {
          name: pkg.name,
          repo: pkg.links?.repository || "",
          command: `npx ${pkg.name}`,
          description: pkg.description || `MCP ${serverType} server`,
          keywords: [...(pkg.keywords || []), serverType, "mcp"],
        };

        // 直接从npxFinder返回的数据中获取README内容并添加到serverInfo
        if (pkg.original?.readme) {
          serverInfo.readme = pkg.original.readme;
        }

        // 检查服务器是否已注册
        const existingServer = serverSettings.servers.find(
          (s) => s.name === pkg.name
        );
        if (!existingServer) {
          serverSettings.servers.push(serverInfo);
        } else {
          // 更新现有服务器的readme（如果有的话）
          if (serverInfo.readme && !existingServer.readme) {
            existingServer.readme = serverInfo.readme;
          }
        }
      } catch (pkgError) {
        console.warn(
          `处理包 ${pkg.name} 时出错: ${(pkgError as Error).message}`
        );
      }
    }

    // 保存更新后的设置
    await saveSettings();
    console.log(
      `预加载完成，已加载 ${serverSettings.servers.length} 个MCP服务器`
    );
  } catch (error) {
    console.error(`预加载MCP包信息失败: ${(error as Error).message}`);
  }
}

// 创建MCP服务器实例
const server = new Server(
  {
    name: "mcp-auto-install",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 注册工具列表处理程序
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "mcp_auto_install_getAvailableServers",
        description: "获取可用的MCP服务器列表",
        inputSchema: simpleZodToJsonSchema(
          z.object({
            random_string: z
              .string()
              .describe("Dummy parameter for no-parameter tools"),
          })
        ),
      },
      {
        name: "mcp_auto_install_removeServer",
        description: "移除已注册的MCP服务",
        inputSchema: simpleZodToJsonSchema(
          z.object({
            serverName: z.string().describe("The name of the server to remove"),
          })
        ),
      },
      {
        name: "mcp_auto_install_configureServer",
        description: "获取mcp服务配置帮助",
        inputSchema: simpleZodToJsonSchema(
          z.object({
            serverName: z
              .string()
              .describe("The name of the server to configure"),
            purpose: z
              .string()
              .describe("What you want to do with the server")
              .optional(),
            query: z
              .string()
              .describe("Specific question about configuration")
              .optional(),
          })
        ),
      },
      {
        name: "mcp_auto_install_getServerReadme",
        description: "获取mcp服务的README内容",
        inputSchema: simpleZodToJsonSchema(
          z.object({
            serverName: z
              .string()
              .describe("The name of the server to get README for"),
          })
        ),
      },
      {
        name: "mcp_auto_install_saveNpxCommand",
        description: "保存用户输入的npx命令到mcp配置文件",
        inputSchema: simpleZodToJsonSchema(
          z.object({
            serverName: z
              .string()
              .describe("The name of the server to configure"),
            commandInput: z
              .string()
              .describe("User input command (e.g., npx server-name arg1 arg2)"),
          })
        ),
      },
      {
        name: "mcp_auto_install_parseJsonConfig",
        description: "解析用户发送的MCP服务器Json配置",
        inputSchema: simpleZodToJsonSchema(
          z.object({
            config: z.string().describe("用户发送的JSON配置字符串"),
          })
        ),
      },
    ],
  };
});

// 注册工具调用处理程序
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  switch (name) {
    case "mcp_auto_install_getAvailableServers": {
      const servers = await getRegisteredServers();
      return {
        content: [
          {
            type: "text",
            text: `获取到 ${servers.length} 个已搜索到的MCP服务器`,
          },
          {
            type: "text",
            text: `${servers
              .map((server) => server.name)
              .join("\n")}\n 从其中找到名称类似的mcp服务`,
          },
        ],
      };
    }

    case "mcp_auto_install_removeServer": {
      const result = await handleRemoveServer(
        args as unknown as { serverName: string }
      );
      return {
        content: [
          {
            type: "text",
            text: result.message,
          },
        ],
      };
    }

    case "mcp_auto_install_configureServer": {
      const result = await handleConfigureServer(
        args as unknown as {
          serverName: string;
          purpose?: string;
          query?: string;
        }
      );

      const contentItems = [];

      // 添加消息
      contentItems.push({
        type: "text",
        text: result.message,
      });

      // 添加说明（如果有）
      if (result.explanation) {
        contentItems.push({
          type: "text",
          text: result.explanation,
        });
      }

      // 添加建议命令（如果有）
      if (result.suggestedCommand) {
        contentItems.push({
          type: "text",
          text: `建议命令: ${result.suggestedCommand}`,
        });
      }

      // 添加README内容（如果有）
      if (result.readmeContent) {
        contentItems.push({
          type: "text",
          text: result.readmeContent,
        });
      }

      return {
        content: contentItems,
      };
    }

    case "mcp_auto_install_getServerReadme": {
      const result = await handleGetServerReadme(
        args as unknown as { serverName: string }
      );

      return {
        content: [
          {
            type: "text",
            text: result.message,
          },
          {
            type: "text",
            text: result.readmeContent || "没有找到README内容。",
          },
        ],
      };
    }

    case "mcp_auto_install_saveNpxCommand": {
      const result = await saveCommandToExternalConfig(
        args.serverName as string,
        args.commandInput as string
      );
      return {
        content: [
          {
            type: "text",
            text: result.message,
          },
        ],
      };
    }

    case "mcp_auto_install_parseJsonConfig": {
      const result = await handleParseConfig(
        args as unknown as { config: string }
      );
      return {
        content: [
          {
            type: "text",
            text: result.message,
          },
          ...(result.config ? [
            {
              type: "text",
              text: `解析后的配置:\n${JSON.stringify(result.config, null, 2)}`,
            },
          ] : []),
        ],
      };
    }

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
async function findServer(name: string): Promise<MCPServerInfo | undefined> {
  // 确保设置已加载
  await initSettings();
  return serverSettings.servers.find((s) => s.name.includes(name));
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
      console.warn(
        `CLI npx-scope-finder failed: ${(cliError as Error).message}`
      );
      // 继续使用其他方法
    }

    // 提取GitHub路径
    const repoPath = extractGitHubPathFromUrl(repoUrl);
    if (!repoPath) {
      throw new Error(`Invalid GitHub repository URL: ${repoUrl}`);
    }

    // 使用 npxFinder API 查找 @modelcontextprotocol 域下的所有可执行包
    try {
      const packages = await npxFinder("@modelcontextprotocol", {
        timeout: 10000,
        retries: 3,
        retryDelay: 1000,
      });

      // 查找匹配 repo URL 的包
      const matchingPackage = packages.find((pkg) =>
        pkg.links?.repository?.includes(repoPath)
      );

      if (matchingPackage) {
        return matchingPackage.name;
      }

      // 如果没有找到匹配的包，尝试匹配名称
      const [owner, repo] = repoPath.split("/");
      const nameMatchingPackage = packages.find((pkg) =>
        pkg.name.endsWith(`/${repo}`)
      );

      if (nameMatchingPackage) {
        return nameMatchingPackage.name;
      }
    } catch (npmError) {
      console.warn(
        `npx-scope-finder API failed: ${(npmError as Error).message}`
      );
      // 继续使用备用方法
    }

    // 备用方法：假设包名格式为 @modelcontextprotocol/repo
    const repo = repoPath.split("/")[1];
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

  // 预加载MCP包信息
  await preloadMCPPackages();

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
  const server = await findServer(serverName);

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
  const server = await findServer(serverName);
  console.error("handleConfigureServer", server);

  if (!server) {
    return {
      success: false,
      message: `Server '${serverName}' not found in the registry.`,
    };
  }
  console.error("server_live");
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

/**
 * 获取服务器的README内容
 */
export async function handleGetServerReadme(args: {
  serverName: string;
}): Promise<OperationResult> {
  const { serverName } = args;
  const server = await findServer(serverName);

  if (!server) {
    return {
      success: false,
      message: `Server '${serverName}' not found in the registry.`,
    };
  }

  try {
    // 获取README内容（直接从服务器对象中获取）
    const readmeContent = server.readme || "未能获取README。";

    // 添加提示词，引导LLM总结内容并指导用户配置参数
    const promptedReadme = `# ${serverName} README

${readmeContent}

---

请根据上述README内容:
1. 总结这个MCP服务器的主要功能和用途
2. 指导用户如何配置必要的参数
3. 提供一个简单的使用示例`;

    return {
      success: true,
      message: "README fetch successful",
      readmeContent: promptedReadme,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to fetch README: ${(error as Error).message}`,
    };
  }
}

/**
 * 自动检测用户请求所需的MCP服务器
 */
// export async function handleAutoDetect(args: {
//   userRequest: string;
//   settingsPath?: string;
// }): Promise<OperationResult> {
//   try {
//     const { userRequest, settingsPath } = args;
//     const customSettingsPath = settingsPath || SETTINGS_PATH;

//     // 通过分析用户请求确定所需的MCP服务器类型
//     // 注意：在MCP架构中，实际上LLM已经分析了用户请求并选择调用了这个工具
//     // 我们只需要提供合适的服务器类型即可
//     let serverType = "";

//     // 关键词匹配（基本规则）
//     const requestLower = userRequest.toLowerCase();

//     // 检测文件系统操作
//     if (
//       requestLower.includes("读取文件") ||
//       requestLower.includes("read file") ||
//       requestLower.includes("filesystem") ||
//       requestLower.includes("file system") ||
//       requestLower.includes("打开文件") ||
//       requestLower.includes("open file") ||
//       requestLower.includes("写入文件") ||
//       requestLower.includes("write file") ||
//       requestLower.includes("文件操作") ||
//       requestLower.includes("file operation")
//     ) {
//       serverType = "filesystem";
//     }
//     // 检测数据库操作
//     else if (
//       requestLower.includes("数据库") ||
//       requestLower.includes("database") ||
//       requestLower.includes("查询数据") ||
//       requestLower.includes("query data") ||
//       requestLower.includes("保存数据") ||
//       requestLower.includes("save data") ||
//       requestLower.includes("sql") ||
//       requestLower.includes("mongodb") ||
//       requestLower.includes("sqlite")
//     ) {
//       serverType = "database";
//     }
//     // 检测Web请求
//     else if (
//       requestLower.includes("网页") ||
//       requestLower.includes("web") ||
//       requestLower.includes("http") ||
//       requestLower.includes("url") ||
//       requestLower.includes("抓取") ||
//       requestLower.includes("爬取") ||
//       requestLower.includes("scrape") ||
//       requestLower.includes("fetch") ||
//       requestLower.includes("api") ||
//       requestLower.includes("网络请求") ||
//       requestLower.includes("网站")
//     ) {
//       serverType = "web";
//     }
//     // 检测图像处理
//     else if (
//       requestLower.includes("图像") ||
//       requestLower.includes("image") ||
//       requestLower.includes("图片") ||
//       requestLower.includes("picture") ||
//       requestLower.includes("照片") ||
//       requestLower.includes("photo") ||
//       requestLower.includes("视觉") ||
//       requestLower.includes("vision") ||
//       requestLower.includes("ocr") ||
//       requestLower.includes("识别文字") ||
//       requestLower.includes("识别图像")
//     ) {
//       serverType = "image";
//     }
//     // 检测命令执行
//     else if (
//       requestLower.includes("执行命令") ||
//       requestLower.includes("run command") ||
//       requestLower.includes("shell") ||
//       requestLower.includes("命令行") ||
//       requestLower.includes("command line") ||
//       requestLower.includes("执行脚本") ||
//       requestLower.includes("run script") ||
//       requestLower.includes("terminal") ||
//       requestLower.includes("终端")
//     ) {
//       serverType = "shell";
//     }

//     // 如果确定了服务器类型，尝试安装该类型的MCP服务器
//     if (serverType) {
//       // 在本地已注册的服务器中查找
//       const matchingServers = serverSettings.servers.filter(
//         (server) =>
//           server.keywords?.includes(serverType) ||
//           server.name.includes(serverType) ||
//           server.description.toLowerCase().includes(serverType)
//       );

//       if (matchingServers.length > 0) {
//         // 直接使用预加载的服务器信息
//         const bestMatch = matchingServers[0];
//         const readme = readmeCache[bestMatch.name] || "未能获取README。";

//         // 添加提示词，引导LLM总结内容并指导用户配置参数
//         const promptedReadme = `# ${bestMatch.name} README

// ${readme}

// ---

// 请根据上述README内容:
// 1. 总结这个MCP服务器的主要功能和用途
// 2. 指导用户如何配置必要的参数
// 3. 提供一个简单的使用示例`;

//         return {
//           success: true,
//           message: `找到匹配的MCP服务器: ${bestMatch.name}`,
//           serverName: bestMatch.name,
//           readme: promptedReadme,
//           packageInfo: bestMatch,
//         };
//       }
//       // 如果本地没有找到，则尝试从npm查找
//       return await detectAndInstallServer(serverType, customSettingsPath);
//     }

//     return {
//       success: false,
//       message: "未能识别出需要的MCP服务器类型。请尝试提供更具体的请求。",
//       suggestedTypes: ["filesystem", "database", "web", "image", "shell"],
//     };
//   } catch (error) {
//     return {
//       success: false,
//       message: `自动检测失败: ${(error as Error).message}`,
//     };
//   }
// }

/**
 * npm搜索结果项的接口
 */
interface NpmSearchResultItem {
  name: string;
  description?: string;
  keywords?: string[];
  version?: string;
  date?: string;
  links?: {
    npm?: string;
    homepage?: string;
    repository?: string;
    bugs?: string;
  };
  author?: {
    name?: string;
    email?: string;
    url?: string;
  };
  publisher?: {
    name?: string;
    email?: string;
  };
}

/**
 * npm包注册信息接口
 */
interface NpmRegistryInfo {
  name?: string;
  description?: string;
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, unknown>;
  readme?: string;
  maintainers?: Array<{ name?: string; email?: string }>;
  author?: { name?: string; email?: string; url?: string };
  repository?: { type?: string; url?: string };
  homepage?: string;
  keywords?: string[];
  bugs?: { url?: string };
}

/**
 * 检测并安装指定类型的服务器
 */
// async function detectAndInstallServer(
//   serverType: string,
//   settingsPath: string
// ): Promise<OperationResult> {
//   try {
//     // 通过npm搜索相关包
//     console.log(`Searching for MCP ${serverType} packages...`);

//     // 搜索npm包
//     const { stdout } = await exec(`npm search mcp-${serverType} --json`);
//     const searchResults = JSON.parse(stdout) as NpmSearchResultItem[];

//     if (!searchResults || !searchResults.length) {
//       return {
//         success: false,
//         message: `未找到匹配的MCP ${serverType}服务器。`,
//       };
//     }

//     // 找到最匹配的包
//     const bestMatch =
//       searchResults.find(
//         (pkg) =>
//           pkg.name.includes(`mcp-${serverType}`) &&
//           pkg.keywords &&
//           pkg.keywords.includes("mcp") &&
//           pkg.keywords.includes(serverType)
//       ) || searchResults[0];

//     // 获取包的详细信息
//     const packageInfo = await getNpmPackageInfo(bestMatch.name);

//     if (!packageInfo) {
//       return {
//         success: false,
//         message: `无法获取包 ${bestMatch.name} 的信息。`,
//       };
//     }

//     // 获取README - 先检查缓存，如果没有则使用packageInfo中的readme
//     const readme = readmeCache[bestMatch.name] || packageInfo.readme || "未能获取README。";

//     // 如果获取到README且不在缓存中，则缓存它
//     if (readme && !readmeCache[bestMatch.name]) {
//       readmeCache[bestMatch.name] = readme;
//       const readmePath = path.join(
//         README_CACHE_DIR,
//         `${bestMatch.name.replace("/", "_")}.md`
//       );
//       await fs.mkdir(README_CACHE_DIR, { recursive: true });
//       await fs.writeFile(readmePath, readme, "utf-8");
//     }

//     // 检查服务器是否已注册
//     const existingServer = await findServer(bestMatch.name);
//     if (existingServer) {
//       console.log(`Server ${bestMatch.name} is already registered.`);
//     } else {
//       // 注册服务器
//       const repoUrl = packageInfo.links?.repository || "";
//       const serverInfo: MCPServerInfo = {
//         name: bestMatch.name,
//         repo: repoUrl,
//         command: `npx ${bestMatch.name}`,
//         description: bestMatch.description || `MCP ${serverType} server`,
//         keywords: bestMatch.keywords || [serverType, "mcp"],
//       };

//       // 注册服务器
//       await handleRegisterServer(serverInfo);
//     }

//     // 添加提示词，引导LLM总结内容并指导用户配置参数
//     const promptedReadme = `# ${bestMatch.name} README

// ${readme}

// ---

// 请根据上述README内容:
// 1. 总结这个MCP服务器的主要功能和用途
// 2. 指导用户如何配置必要的参数
// 3. 提供一个简单的使用示例`;

//     return {
//       success: true,
//       message: `成功找到并注册 ${bestMatch.name} 服务器！`,
//       serverName: bestMatch.name,
//       readme: promptedReadme,
//       packageInfo,
//     };
//   } catch (error) {
//     return {
//       success: false,
//       message: `检测和安装服务器失败: ${(error as Error).message}`,
//     };
//   }
// }

/**
 * 获取npm包的README (仅从缓存获取)
 */
async function getPackageReadme(packageName: string): Promise<string> {
  try {
    // 确保设置已加载
    await initSettings();

    // 从服务器设置中查找README
    const server = serverSettings.servers.find((s) =>
      s.name.includes(packageName)
    );
    if (server?.readme) {
      return server.readme;
    }

    return "未能获取README。该服务器没有预加载README信息。";
  } catch (error) {
    return `获取README失败: ${(error as Error).message}`;
  }
}

/**
 * 获取npm包信息
 */
async function getNpmPackageInfo(
  packageName: string
): Promise<NpmPackageInfo | null> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${packageName}`);
    const data = (await response.json()) as NpmPackageInfo;
    return data;
  } catch (error) {
    console.error(`获取包信息失败: ${(error as Error).message}`);
    return null;
  }
}

/**
 * 保存命令到外部配置文件（如Claude的配置文件）
 * @param serverName MCP服务器名称
 * @param commandInput 用户输入的命令，例如 "npx @modelcontextprotocol/server-filesystem ~/Desktop ~/Documents"
 * @returns 操作结果
 */
export async function saveCommandToExternalConfig(
  serverName: string,
  commandInput: string
): Promise<OperationResult> {
  try {
    // 解析命令
    const parts = commandInput.trim().split(/\s+/);
    if (parts.length < 2) {
      return {
        success: false,
        message: "命令格式不正确，至少需要包含命令名和参数",
      };
    }

    const command = parts[0]; // 通常是 npx
    const args = parts.slice(1); // 其余部分作为参数

    // 检查环境变量 - 这里是指向LLM（如Claude）配置文件的路径，而不是mcp_settings.json
    const externalConfigPath = process.env.MCP_SETTINGS_PATH;
    if (!externalConfigPath) {
      return {
        success: false,
        message:
          "未设置MCP_SETTINGS_PATH环境变量，无法更新LLM配置文件。请设置此环境变量指向LLM（如Claude）的配置文件路径。",
      };
    }

    // 检查服务器是否存在（在我们自己的MCP服务器注册表中）
    const server = await findServer(serverName);
    if (!server) {
      return {
        success: false,
        message: `服务器 '${serverName}' 在MCP服务器注册表中不存在`,
      };
    }

    try {
      // 读取外部LLM配置文件
      const configData = await fs.readFile(externalConfigPath, "utf-8");
      const config = JSON.parse(configData);

      // 确保存在mcpServers字段
      if (!config.mcpServers) {
        config.mcpServers = {};
      }

      // 添加/更新服务器配置到LLM配置文件
      config.mcpServers[serverName] = {
        command,
        args,
      };

      // 保存配置到LLM配置文件
      await fs.writeFile(
        externalConfigPath,
        JSON.stringify(config, null, 2),
        "utf-8"
      );

      // 同时更新内部服务器配置 - 保存到我们自己的MCP服务器注册表
      server.commandConfig = {
        command,
        args,
      };
      await saveSettings();

      return {
        success: true,
        message: `成功将命令 "${commandInput}" 保存到LLM配置文件 ${externalConfigPath}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `读取或写入LLM配置文件失败: ${(error as Error).message}`,
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `保存命令失败: ${(error as Error).message}`,
    };
  }
}

/**
 * 处理用户配置解析
 */
export async function handleParseConfig(args: {
  config: string;
}): Promise<OperationResult> {
  try {
    // 解析用户发送的JSON字符串
    const userConfig = JSON.parse(args.config);

    // 确保存在mcpServers字段
    if (!userConfig.mcpServers) {
      userConfig.mcpServers = {};
    }

    // 验证每个服务器的配置格式
    for (const [serverName, serverConfig] of Object.entries(userConfig.mcpServers)) {
      const config = serverConfig as { command: string; args: string[] };
      
      // 验证必要的字段
      if (!config.command || !Array.isArray(config.args)) {
        return {
          success: false,
          message: `服务器 ${serverName} 的配置格式不正确。需要包含 command 和 args 字段。`,
        };
      }
    }

    // 保存配置到外部文件
    const externalConfigPath = process.env.MCP_SETTINGS_PATH;
    if (!externalConfigPath) {
      return {
        success: false,
        message: "未设置MCP_SETTINGS_PATH环境变量，无法保存配置。",
      };
    }

    // 读取现有配置（如果存在）
    let existingConfig = {};
    try {
      const existingData = await fs.readFile(externalConfigPath, "utf-8");
      existingConfig = JSON.parse(existingData);
    } catch (error) {
      // 如果文件不存在或解析失败，使用空对象
      console.log("No existing config found, creating new one");
    }

    // 合并配置
    const mergedConfig = {
      ...existingConfig,
      mcpServers: {
        ...(existingConfig as any).mcpServers,
        ...userConfig.mcpServers,
      },
    };

    // 保存合并后的配置
    await fs.writeFile(
      externalConfigPath,
      JSON.stringify(mergedConfig, null, 2),
      "utf-8"
    );

    return {
      success: true,
      message: "配置解析成功并已保存",
      config: mergedConfig,
    };
  } catch (error) {
    return {
      success: false,
      message: `配置解析失败: ${(error as Error).message}`,
    };
  }
}
