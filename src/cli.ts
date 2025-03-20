#!/usr/bin/env node

import { Command } from "commander";
import {
  startServer,
  getRegisteredServers,
  handleInstallServer,
  handleRegisterServer,
  handleRemoveServer,
  handleConfigureServer,
  handleGetServerReadme,
  // handleAutoDetect,
  saveCommandToExternalConfig,
} from "./server.js";
import { fileURLToPath } from "node:url";
import { MCPServerInfo } from "./types.js";

/**
 * 命令行界面，用于控制MCP自动安装服务器
 */
export class MCPCliApp {
  private program: Command;

  constructor() {
    this.program = new Command();
    this.setupCLI();
  }

  private setupCLI() {
    this.program
      .name("mcp-auto-install")
      .description(
        "MCP server that helps install other MCP servers automatically"
      )
      .version("1.0.0")
      .option("-p, --port <number>", "Port to run the server on", "7777")
      .option("-h, --host <string>", "Host to run the server on", "localhost")
      .option("--llm-api-key <key>", "API key for the LLM service")
      .option("--llm-api-endpoint <url>", "API endpoint for the LLM service");

    // 添加默认命令来启动服务器
    this.program
      .command("start", { isDefault: true })
      .description("Start the MCP Auto Install server")
      .action(async () => {
        try {
          await startServer();
        } catch (error) {
          console.error("Failed to start the server:", error);
          process.exit(1);
        }
      });

    // Add command to register a new server
    this.program
      .command("register <n>")
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
      .action(async (name, options) => {
        try {
          // 注册服务器
          const result = await handleRegisterServer({
            name,
            repo: options.repo,
            command: options.command,
            description: options.description,
            keywords: options.keywords || [],
            installCommands: options.installCommands,
          });

          if (result.success) {
            console.log(result.message);
          } else {
            console.error(result.message);
          }
        } catch (error) {
          console.error(
            `Error registering server: ${(error as Error).message}`
          );
        }
        process.exit(0);
      });

    // Add a command to install a server
    this.program
      .command("install <n>")
      .description("Install an MCP server")
      .option("--clone", "Use git clone method instead of npx", false)
      .action(async (name: string, options) => {
        try {
          const useNpx = !options.clone;
          const result = await handleInstallServer({
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
      .action(async () => {
        try {
          // 获取注册的服务器列表
          const servers = await getRegisteredServers();

          if (servers.length === 0) {
            console.log("No MCP servers are registered.");
          } else {
            console.log("Registered MCP Servers:");
            for (const server of servers) {
              console.log(`- ${server.name}: ${server.description}`);
              console.log(`  Command: ${server.command}`);
              console.log(`  Repository: ${server.repo}`);
              if (server.keywords && server.keywords.length > 0) {
                console.log(`  Keywords: ${server.keywords.join(", ")}`);
              }
              console.log();
            }
          }
        } catch (error) {
          console.error(`Error listing servers: ${(error as Error).message}`);
        }
        process.exit(0);
      });

    // Add command to get help with server configuration
    this.program
      .command("configure <n>")
      .description("Get help configuring an MCP server using LLM assistance")
      .option(
        "-p, --purpose <text>",
        "Describe what you want to do with the server"
      )
      .option(
        "-q, --query <text>",
        "Specific question about server configuration"
      )
      .action(async (name: string, options) => {
        try {
          const purpose = options.purpose || "general use";
          const query = options.query || "";

          const result = await handleConfigureServer({
            serverName: name,
            purpose,
            query,
          });

          if (result.success) {
            console.log(result.message);
            if (result.explanation) {
              console.log("\nExplanation:");
              console.log(result.explanation);
            }
            if (result.suggestedCommand) {
              console.log("\nSuggested Command:");
              console.log(result.suggestedCommand);
            }
          } else {
            console.error(result.message);
          }
        } catch (error) {
          console.error(
            `Error configuring server: ${(error as Error).message}`
          );
        }
        process.exit(0);
      });

    // Add command to get README for a server
    this.program
      .command("readme <n>")
      .description("Get the README content for an MCP server")
      .action(async (name: string) => {
        try {
          const result = await handleGetServerReadme({ serverName: name });

          if (result.success) {
            console.log(`README for ${name}:`);
            console.log();
            console.log(result.readmeContent || "No README content available.");
          } else {
            console.error(result.message || "Failed to fetch README.");
          }
        } catch (error) {
          console.error(`Error getting README: ${(error as Error).message}`);
        }
        process.exit(0);
      });

    // Add command to remove a server
    this.program
      .command("remove <n>")
      .description("Remove a registered MCP server")
      .action(async (name: string) => {
        try {
          const result = await handleRemoveServer({ serverName: name });

          if (result.success) {
            console.log(result.message);
          } else {
            console.error(result.message);
          }
        } catch (error) {
          console.error(`Error removing server: ${(error as Error).message}`);
        }
        process.exit(0);
      });

    // Add a command to automatically detect and install servers
    // this.program
    //   .command("auto <request>")
    //   .description("Automatically detect and install needed MCP servers based on user request")
    //   .option("-s, --settings <path>", "Custom path to mcp_settings.json file")
    //   .action(async (request: string, options) => {
    //     try {
    //       console.log("Analyzing request to detect needed MCP servers...");
    //       const result = await handleAutoDetect({
    //         userRequest: request,
    //         settingsPath: options.settings
    //       });

    //       if (result.success) {
    //         console.log(`✅ ${result.message}`);
    //         if (result.serverName && result.readme) {
    //           console.log(`\nServer: ${result.serverName}`);
    //           console.log("\n=== README ===");
    //           console.log(typeof result.readme === 'string'
    //             ? `${result.readme.substring(0, 500)}...`
    //             : "README not available in string format.");
    //           console.log("...");
    //           console.log("\nFull README available with:");
    //           console.log(`mcp-auto-install readme ${result.serverName}`);
    //         }
    //       } else {
    //         console.error(`❌ ${result.message}`);
    //       }
    //     } catch (error) {
    //       console.error(`Error during auto-detection: ${(error as Error).message}`);
    //     }
    //     process.exit(0);
    //   });

    // Add a command to save user command to config
    this.program
      .command("save-command <server-name> <command>")
      .description("Save a command for a server to external config file")
      .action(async (serverName: string, command: string, cmdObj) => {
        try {
          console.log(`保存命令到外部配置文件: ${serverName} ${command}`);
          const result = await saveCommandToExternalConfig(serverName, command);

          if (result.success) {
            console.log(`✅ ${result.message}`);
          } else {
            console.error(`❌ ${result.message}`);
          }
        } catch (error) {
          console.error(`Error saving command: ${(error as Error).message}`);
        }
        process.exit(0);
      });

    // Uncomment if you want to implement the update-registry command
    /*
    this.program
      .command("update-registry")
      .description("Update the registry from a remote source")
      .option("-u, --url <url>", "URL to fetch registry from")
      .action(async (options: { url?: string }) => {
        try {
          // 初始化服务器实例
          this.server = new MCPAutoInstallServer();
          await this.server.init();
          
          // 实现更新注册表的功能
          console.log("Registry updated successfully");
        } catch (error) {
          console.error("Failed to update registry:", error);
        }
        process.exit(0);
      });
    */

    this.program.parse(process.argv);
  }

  /**
   * 运行CLI应用
   */
  public run() {
    // 检查环境变量
    if (!process.env.MCP_SETTINGS_PATH) {
      console.warn("\n⚠️  警告: 环境变量 MCP_SETTINGS_PATH 未设置");
      console.warn("此环境变量用于指定LLM（如Claude）的MCP服务配置文件路径");
      console.warn("如需将命令保存到LLM配置文件，请设置此环境变量，例如:");
      console.warn(
        'export MCP_SETTINGS_PATH="/Users/username/Library/Application Support/Claude/claude_desktop_config.json"\n'
      );
    } else {
      console.log(`📁 使用LLM配置文件: ${process.env.MCP_SETTINGS_PATH}`);
    }

    this.program.parse(process.argv);
  }
}

// 在ESM模块中不使用模块检测，直接删除这部分代码
export default MCPCliApp;
