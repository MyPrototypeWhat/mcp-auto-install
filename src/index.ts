#!/usr/bin/env node

import { Command } from "commander";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import path from "node:path";
import fs from "node:fs";
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { z } from "zod";

const execAsync = promisify(exec);

// Define interface for MCP server information
interface MCPServerInfo {
  repo: string;
  command: string;
  description: string;
  keywords?: string[];
  installCommands?: string[];
}

// Define interface for MCP registry entry
interface MCPRegistryEntry {
  servers: Record<string, MCPServerInfo>;
  lastUpdated: string;
}

// 定义消息接口
interface MCPMessage {
  role: string;
  content: string;
}

// 定义提示接口
interface MCPPrompt {
  messages: MCPMessage[];
}

// 定义工具调用建议接口
interface ToolCallSuggestion {
  type: string;
  name: string;
  params: Record<string, unknown>;
}

/**
 * Handles the automatic installation of other MCP servers when needed
 */
class MCPAutoInstallServer {
  private program: Command;
  private server!: McpServer; // 使用！告诉TypeScript这个属性会被初始化
  private tempInstallDir: string;
  private configDir: string;
  private registryFile: string;
  private registry: MCPRegistryEntry = { servers: {}, lastUpdated: "" };

  constructor() {
    this.program = new Command();
    this.tempInstallDir = path.join(os.tmpdir(), "mcp-auto-install");

    // Set up config directory in user's home folder
    this.configDir = path.join(os.homedir(), ".mcp-auto-install");
    this.registryFile = path.join(this.configDir, "registry.json");

    this.ensureConfigDirs();
    // 在构造函数中不能直接调用异步方法，我们将注册表初始化为空
    // 实际加载将在 init 方法中完成
    this.registry = { servers: {}, lastUpdated: new Date().toISOString() };

    this.setupCLI();
    this.setupServer();
  }

  /**
   * 初始化服务器，加载注册表
   */
  public async init(): Promise<void> {
    await this.loadRegistry();
  }

  /**
   * Ensures that the configuration directories exist
   */
  private ensureConfigDirs(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }

    if (!fs.existsSync(this.tempInstallDir)) {
      fs.mkdirSync(this.tempInstallDir, { recursive: true });
    }
  }

  /**
   * Loads server registry from configuration file or creates default
   */
  private async loadRegistry(): Promise<void> {
    try {
      if (fs.existsSync(this.registryFile)) {
        const data = fs.readFileSync(this.registryFile, "utf-8");
        this.registry = JSON.parse(data) as MCPRegistryEntry;
      } else {
        // 创建空注册表
        this.registry = {
          servers: {},
          lastUpdated: new Date().toISOString(),
        };

        // 使用 npx-scope-finder 动态获取 @modelcontextprotocol 域下的可执行包
        try {
          // 导入 npx-scope-finder
          const { npxFinder } = await import("npx-scope-finder");

          // 获取 @modelcontextprotocol 作用域下的所有可执行包
          const packages = await npxFinder("@modelcontextprotocol", {
            timeout: 15000,
            retries: 3,
          });

          // 将找到的包转换为 MCP 服务器信息并填充注册表
          let addedCount = 0;
          for (const pkg of packages) {
            // 确保包有可执行命令
            if (pkg.bin && Object.keys(pkg.bin).length > 0) {
              const mainCommand = Object.keys(pkg.bin)[0];
              const serverName = pkg.name.replace("@modelcontextprotocol/", "");
              
              // 从包信息中提取所需数据
              const serverInfo: MCPServerInfo = {
                repo:
                  pkg.links?.repository ||
                  `https://www.npmjs.com/package/${pkg.name}`,
                command: mainCommand,
                description: pkg.description || `MCP server: ${pkg.name}`,
                keywords: pkg.keywords || [],
              };

              // 添加到注册表
              this.registry.servers[serverName] = serverInfo;
              addedCount++;
            }
          }
        } catch (error) {
          console.error(
            "Error fetching from npm, creating empty registry:",
            error
          );
          // 如果动态获取失败，创建一个空的注册表
          this.registry = {
            servers: {},
            lastUpdated: new Date().toISOString(),
          };
        }

        // 保存注册表到文件
        this.saveRegistry();
      }
    } catch (error) {
      console.error("Error loading registry:", error);
      // Fallback to empty registry
      this.registry = { servers: {}, lastUpdated: new Date().toISOString() };
    }
  }

  /**
   * Saves the current registry to the configuration file
   */
  private saveRegistry(): void {
    try {
      fs.writeFileSync(
        this.registryFile,
        JSON.stringify(this.registry, null, 2),
        "utf-8"
      );
    } catch (error) {
      console.error("Error saving registry:", error);
    }
  }

  /**
   * Register a new MCP server in the registry
   */
  private registerServer(name: string, serverInfo: MCPServerInfo): void {
    this.registry.servers[name] = serverInfo;
    this.registry.lastUpdated = new Date().toISOString();
    this.saveRegistry();
  }

  /**
   * Remove an MCP server from the registry
   */
  private removeServer(name: string): boolean {
    if (this.registry.servers[name]) {
      delete this.registry.servers[name];
      this.registry.lastUpdated = new Date().toISOString();
      this.saveRegistry();
      return true;
    }
    return false;
  }

  private setupCLI() {
    this.program
      .name("mcp-auto-install")
      .description(
        "MCP server that helps install other MCP servers automatically"
      )
      .version("1.0.0")
      .option("-p, --port <number>", "Port to run the server on", "7777")
      .option("-h, --host <string>", "Host to run the server on", "localhost");

    // 添加默认命令来启动服务器
    this.program
      .command("start", { isDefault: true })
      .description("Start the MCP Auto Install server")
      .action(() => {
        // 这个方法由main方法调用，所以我们不需要在这里做任何事情
      });

    // Add command to register a new server
    this.program
      .command("register <name>")
      .description("Register a new MCP server")
      .requiredOption("-r, --repo <url>", "GitHub repository URL")
      .requiredOption("-c, --command <command>", "Command to run the server")
      .requiredOption("-d, --description <text>", "Description of the server")
      .option("-k, --keywords <keywords>", "Comma-separated keywords", (val) =>
        val.split(",")
      )
      .option(
        "-i, --install-commands <commands>",
        "Comma-separated custom installation commands",
        (val) => val.split(",")
      )
      .action((name, options) => {
        this.registerServer(name, {
          repo: options.repo,
          command: options.command,
          description: options.description,
          keywords: options.keywords || [],
          installCommands: options.installCommands,
        });
        process.exit(0);
      });

    // Add a command to install a server
    this.program
      .command("install <name>")
      .description("Install an MCP server")
      .option("--clone", "Use git clone method instead of npx", false)
      .action(async (name: string, options) => {
        try {
          const useNpx = !options.clone;
          const result = await this.handleInstallServer({
            serverName: name,
            useNpx,
          });

          if (result.success) {
            console.log(result.message);
          } else {
            console.error(result.message);
          }
      } catch (error) {
          console.error(`Error installing server: ${(error as Error).message}`);
        }
        process.exit(0);
      });

    // Add command to list registered servers
    this.program
      .command("list")
      .description("List all registered MCP servers")
      .action(() => {
        console.log("Registered MCP Servers:");
        for (const [name, info] of Object.entries(this.registry.servers)) {
          console.log(`- ${name}: ${info.description}`);
          console.log(`  Command: ${info.command}`);
          console.log(`  Repository: ${info.repo}`);
          if (info.keywords && info.keywords.length > 0) {
            console.log(`  Keywords: ${info.keywords.join(", ")}`);
          }
          console.log();
        }
        process.exit(0);
      });

    // Add command to remove a server
    this.program
      .command("remove <name>")
      .description("Remove a registered MCP server")
      .action((name: string) => {
        if (this.removeServer(name)) {
          console.log(`Removed server: ${name}`);
        } else {
          console.error(`Server not found: ${name}`);
        }
        process.exit(0);
      });

    // Add command to update registry from remote source
    // this.program
    //   .command("update-registry")
    //   .description("Update the registry from a remote source")
    //   .option("-u, --url <url>", "URL to fetch registry from")
    //   .action(async (options: { url?: string }) => {
    //     try {
    //       await this.updateRegistryFromRemote(options.url);
    //       console.log("Registry updated successfully");
    // } catch (error) {
    //       console.error("Failed to update registry:", error);
    //     }
    //     process.exit(0);
    //   });

    this.program.parse(process.argv);
  }

  /**
   * Updates registry from a remote source (optional feature)
   */
  private async updateRegistryFromRemote(url?: string): Promise<void> {
    try {
      if (url) {
        // 如果提供了 URL，尝试从特定 URL 获取注册表
        // 实际上这部分功能目前不实现，因为来源不稳定
        return;
      }

      // 使用 npx-scope-finder 获取 @modelcontextprotocol 作用域下的所有包
      // 导入 npx-scope-finder
      const { npxFinder } = await import("npx-scope-finder");

      // 获取 @modelcontextprotocol 作用域下的所有可执行包
      const packages = await npxFinder("@modelcontextprotocol", {
        timeout: 15000,
        retries: 3,
      });

      // 将找到的包转换为 MCP 服务器信息并更新注册表
      let updatedCount = 0;
      for (const pkg of packages) {
        // 确保包有可执行命令
        if (pkg.bin && Object.keys(pkg.bin).length > 0) {
          const mainCommand = Object.keys(pkg.bin)[0];
          const serverName = pkg.name.replace("@modelcontextprotocol/", "");

          // 从包信息中提取所需数据
          const serverInfo: MCPServerInfo = {
            repo:
              pkg.links?.repository ||
              `https://www.npmjs.com/package/${pkg.name}`,
            command: mainCommand,
            description: pkg.description || `MCP server: ${pkg.name}`,
            keywords: pkg.keywords || [],
          };

          // 更新或添加到注册表
          this.registry.servers[serverName] = serverInfo;
          updatedCount++;
        }
      }

      // 更新时间戳并保存注册表
      this.registry.lastUpdated = new Date().toISOString();
      this.saveRegistry();
    } catch (error) {
      console.error("Error updating registry from remote:", error);
      throw error;
    }
  }

  private setupServer() {
    const options = this.program.opts();
    const port = Number.parseInt(options.port, 10);
    const host = options.host;

    // 创建McpServer实例，使用正确的配置格式
    this.server = new McpServer(
      { name: "mcp-auto-install", version: "1.0.0" },
      { capabilities: { tools: {}, prompts: {} } }
    );

    // 注册工具(actions) - 使用正确的工具注册方式
    this.registerTools();

    // 添加消息处理的prompt
    this.server.prompt(
      "detect-server-need",
      { message: z.string().describe("The user's message to analyze") },
      async ({ message }) => {
        const response = await this.handleMessage(message);
        return {
          messages: [
            {
              role: "assistant",
              content: {
                type: "text",
                text: response
                  ? response.text
                  : "I couldn't identify any server needs in your message.",
              },
            },
          ],
        };
      }
    );
  }

  /**
   * 注册所有工具处理函数
   */
  private registerTools() {
    // 安装服务器工具
    this.server.tool(
      "installServer",
      {
        serverName: z.string().describe("The name of the server to install"),
        useNpx: z
          .boolean()
          .optional()
          .describe(
            "Whether to use npx method (true) or git clone method (false)"
          ),
      },
      async (params) => {
        const result = await this.handleInstallServer(params);
        return {
          content: [
            {
              type: "text",
              text: result.message,
            },
          ],
          isError: !result.success,
        };
      }
    );

    // 获取可用服务器工具
    this.server.tool("getAvailableServers", {}, async () => {
      const result = await this.handleGetAvailableServers();
      const serverList = result.servers
        .map((server) => `- ${server.name}: ${server.description}`)
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text:
              serverList.length > 0
                ? `Available MCP servers that can be installed:\n\n${serverList}`
                : "No MCP servers are registered. You can register servers using the register command.",
          },
        ],
      };
    });

    // 注册服务器工具
    this.server.tool(
      "registerServer",
      {
        name: z.string().describe("Server name"),
        repo: z.string().describe("GitHub repository URL"),
        command: z.string().describe("Command to run the server"),
        description: z.string().describe("Server description"),
        keywords: z
          .array(z.string())
          .optional()
          .describe("Keywords for server detection"),
        installCommands: z
          .array(z.string())
          .optional()
          .describe("Custom installation commands"),
      },
      async (params) => {
        const result = await this.handleRegisterServer(params);
        return {
          content: [
            {
              type: "text",
              text: result.message,
            },
          ],
          isError: !result.success,
        };
      }
    );

    // 移除服务器工具
    this.server.tool(
      "removeServer",
      {
        serverName: z.string().describe("The name of the server to remove"),
      },
      async (params) => {
        const result = await this.handleRemoveServer(params);
        return {
          content: [
            {
              type: "text",
              text: result.message,
            },
          ],
          isError: !result.success,
        };
      }
    );
  }

  /**
   * Handles MCP messages to detect when a user might need a server installed
   */
  private async handleMessage(
    message: string
  ): Promise<{ text: string; suggestions?: Array<ToolCallSuggestion> } | null> {
    // Check message for indications a user needs a specific server
    for (const [serverName, serverInfo] of Object.entries(
      this.registry.servers
    )) {
      // Check against keywords if available
      if (serverInfo.keywords && serverInfo.keywords.length > 0) {
        const messageLC = message.toLowerCase();
        const matchesKeyword = serverInfo.keywords.some((keyword) =>
          messageLC.includes(keyword.toLowerCase())
        );

        if (matchesKeyword) {
          return {
            text: `It looks like you need ${serverInfo.description}. Would you like me to install the ${serverName} MCP server?`,
            suggestions: [
              {
                type: "tool_call",
                name: "installServer",
                params: { serverName, useNpx: true },
              },
            ],
          };
        }
      }
    }

    return null;
  }

  /**
   * Handles the installation of a specified MCP server
   */
  private async handleInstallServer(params: {
    serverName: string;
    useNpx?: boolean;
  }) {
    const { serverName, useNpx = true } = params;

    try {
      const server = this.registry.servers[serverName];

      if (!server) {
        return {
          success: false,
          message: `Server ${serverName} is not in the registry.`,
        };
      }

      await this.installServer(serverName, server, useNpx);

      const installMethod = useNpx ? "npx method" : "git clone method";
      return {
        success: true,
        message: `Successfully installed ${serverName} using ${installMethod}. You can now start using it.`,
      };
    } catch (error) {
      console.error("Failed to install server:", error);
      return {
        success: false,
        message: `Failed to install ${serverName}: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Returns a list of available servers that can be installed
   */
  private async handleGetAvailableServers() {
    return {
      servers: Object.entries(this.registry.servers).map(([name, info]) => ({
        name,
        description: info.description,
      })),
    };
  }

  /**
   * Handles registering a new server to the registry
   */
  private async handleRegisterServer(params: {
    name: string;
    repo: string;
    command: string;
    description: string;
    keywords?: string[];
    installCommands?: string[];
  }) {
    try {
      const { name, ...serverInfo } = params;

      // Add server to registry
      this.registry.servers[name] = serverInfo;
      this.registry.lastUpdated = new Date().toISOString();

      // Save registry to disk
      await this.saveRegistry();

      return {
        success: true,
        message: `Server ${name} successfully registered.`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to register server: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Handles removing a server from the registry
   */
  private async handleRemoveServer(params: { serverName: string }) {
    const { serverName } = params;

    if (!this.registry.servers[serverName]) {
      return {
        success: false,
        message: `Server ${serverName} is not in the registry.`,
      };
    }

    delete this.registry.servers[serverName];
    this.registry.lastUpdated = new Date().toISOString();

    await this.saveRegistry();

    return {
      success: true,
      message: `Server ${serverName} successfully removed from registry.`,
    };
  }

  /**
   * Installs an MCP server from its GitHub repository
   * or directly from npm package using npx
   */
  private async installServer(
    serverName: string,
    serverInfo: MCPServerInfo,
    useNpx = true
  ): Promise<void> {
    // 首先检查是否可以通过 npx 直接使用
    const npmPackage = `@modelcontextprotocol/${serverName}`;

    if (useNpx) {
      try {
        // 检查是否可以通过 npx 访问
        await execAsync(
          `npx ${npmPackage} --help || npx ${npmPackage} -h || npx ${npmPackage} --version || npx ${npmPackage} -v || true`
        );

        // 创建一个简单的脚本来调用 npx 命令
        const binDir = path.join(this.configDir, "bin");
        if (!fs.existsSync(binDir)) {
          fs.mkdirSync(binDir, { recursive: true });
        }

        const scriptPath = path.join(binDir, serverInfo.command);
        const scriptContent = `#!/usr/bin/env bash
# Auto-generated script to run ${serverName} MCP server
npx ${npmPackage} "$@"
`;

        fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });
        return;
      } catch (error) {
        // 继续使用 git clone 方法
      }
    }

    // 使用 git clone 方法
    const serverDir = path.join(this.tempInstallDir, serverName);

    // Remove the directory if it already exists
    if (fs.existsSync(serverDir)) {
      fs.rmSync(serverDir, { recursive: true, force: true });
    }

    // Create temp installation directory if it doesn't exist
    if (!fs.existsSync(this.tempInstallDir)) {
      fs.mkdirSync(this.tempInstallDir, { recursive: true });
    }

    // Clone the repository
    await execAsync(`git clone ${serverInfo.repo} ${serverDir}`);

    // Use custom install commands if provided
    if (serverInfo.installCommands && serverInfo.installCommands.length > 0) {
      for (const cmd of serverInfo.installCommands) {
        await execAsync(`cd ${serverDir} && ${cmd}`);
      }
    } else {
      // Default installation process
      // Navigate to the directory and install dependencies
      await execAsync(`cd ${serverDir} && npm install`);

      // Build the server
      await execAsync(`cd ${serverDir} && npm run build`);

      // Install globally
      await execAsync(`cd ${serverDir} && npm install -g`);
    }
  }

  /**
   * Starts the MCP Auto Install server
   */
  public start() {
    // 导入StdioServerTransport
    import("@modelcontextprotocol/sdk/server/stdio.js")
      .then((stdioModule) => {
        const { StdioServerTransport } = stdioModule;

        const options = this.program.opts();

        // 创建stdio传输层
        const transport = new StdioServerTransport();

        // 连接服务器到传输层
        return this.server.connect(transport);
      })
      .catch((error: Error) => {
        console.error("Failed to start the server:", error);
        process.exit(1);
      });
  }
}

/**
 * Main function to start the server
 */
async function main() {
  try {
    const server = new MCPAutoInstallServer();
    await server.init();
    server.start();
  } catch (error) {
    console.error("Failed to start the server:", error);
    process.exit(1);
  }
}

// Start the server
main();

export default MCPAutoInstallServer;
