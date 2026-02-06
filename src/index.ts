/**
 * SSH MCP Server
 *
 * A Model Context Protocol server for SSH connections - execute commands,
 * upload/download files and directories on remote SSH servers.
 *
 * Supports configuration file and tool arguments for connection parameters.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerExecuteCommandTool } from './tools/executeCommand.js';
import { registerFileTransferTools } from './tools/fileTransfer.js';
import { registerListServersTool } from './tools/listServers.js';
import { loadConfig, getConfigPath, getServerNames } from './utils/config.js';

// Create MCP server instance
const server = new McpServer({
  name: 'ssh-mcp',
  version: '1.0.0'
});

// Register all tools
registerExecuteCommandTool(server);
registerFileTransferTools(server);
registerListServersTool(server);

// Try to load configuration file at startup
try {
  const configPath = getConfigPath();
  loadConfig();
  const serverNames = getServerNames();
  console.error(`SSH MCP server loaded config from: ${configPath}`);
  console.error(`Available servers: ${serverNames.join(', ') || 'none'}`);
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`SSH MCP server started without config file: ${errorMessage}`);
}

// Main function for stdio transport
async function runStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('SSH MCP server running via stdio');
}

// Run the server
const transport = process.env.TRANSPORT || 'stdio';
if (transport === 'stdio') {
  runStdio().catch(error => {
    console.error('Server error:', error);
    process.exit(1);
  });
} else {
  console.error('Error: Only stdio transport is supported. Set TRANSPORT=stdio or use default.');
  process.exit(1);
}
