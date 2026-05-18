/**
 * Execute Command Tool
 *
 * Registers the ssh_execute_command tool for executing commands on SSH servers.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OptionalConnectionParamsSchema, createConnection, executeCommand, closeConnection, resolveConnectionParams } from '../utils/ssh.js';
import { getServerNames } from '../utils/config.js';

// Input schema for command execution (with optional connection params for config support)
const ExecuteCommandInputSchema = z.object({
  // Server selection (for config file)
  server: z.string()
    .optional()
    .describe("Server name from config file (optional)"),
  // Connection parameters (optional - can be from config)
  host: z.string()
    .optional()
    .describe("SSH server hostname or IP address (optional - can be from config)"),
  port: z.number()
    .int()
    .min(1)
    .max(65535)
    .optional()
    .describe("SSH server port (default: 22)"),
  username: z.string()
    .optional()
    .describe("SSH username (optional - can be from config)"),
  password: z.string()
    .optional()
    .describe("SSH password (optional - can be from config)"),
  privateKey: z.string()
    .optional()
    .describe("Path to private key file or private key content (optional)"),
  timeout: z.number()
    .int()
    .min(1000)
    .max(60000)
    .optional()
    .describe("Connection timeout in milliseconds (default: 30000)"),
  // Command parameters
  command: z.string()
    .min(1, "Command is required")
    .describe("Command to execute on the remote server"),
  working_dir: z.string()
    .optional()
    .describe("Working directory for the command (optional)"),
  response_format: z.enum(['markdown', 'json'])
    .default('markdown')
    .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable")
}).strict();

type ExecuteCommandInput = z.infer<typeof ExecuteCommandInputSchema>;

// Response format enum
enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json'
}

/**
 * Register the execute_command tool with the MCP server
 */
export function registerExecuteCommandTool(server: McpServer): void {
  server.registerTool(
    'ssh_execute_command',
    {
      title: 'Execute SSH Command',
      description: `Execute a command on a remote SSH server.

**Connection Options:**

1. Named server from config file (recommended)
    - Create .agents-ssh-cli/config.json in the working directory
   - Use 'server' parameter to specify which server

2. Direct parameters
   - Provide host, username, password directly
   - Or use privateKey for key-based authentication

Args:
  - server (string, optional): Server name from config file
  - host (string, optional): SSH server hostname or IP address
  - port (number, optional): SSH server port (default: 22)
  - username (string, optional): SSH username
  - password (string, optional): SSH password (optional if privateKey is provided)
  - privateKey (string, optional): Path to private key file or private key content
  - timeout (number, optional): Connection timeout (default: 30000)
  - command (string): Command to execute
  - working_dir (string, optional): Working directory
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Examples:
  - Use when: "Check disk space on the server" -> command="df -h"
  - Use when: "List files in /var/log" -> command="ls -la /var/log", working_dir="/var/log"
  - Use when: "Get system information" -> command="uname -a"
  - Use with private key: privateKey="/home/user/.ssh/id_rsa"

Error Handling:
  - Returns "Error: Authentication failed" if credentials are incorrect
  - Returns "Error: Connection refused" if the SSH server is not accessible
  - Returns "Error: Command timed out" if the command exceeds the timeout
  - Returns "Error: Command failed with exit code X" if the command returns non-zero exit code`,
      inputSchema: ExecuteCommandInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: ExecuteCommandInput) => {
      const startTime = Date.now();
      let conn = null;

      try {
        // Resolve connection parameters (from config or tool arguments)
        const connectionParams = await resolveConnectionParams({
          server: params.server,
          host: params.host,
          port: params.port,
          username: params.username,
          password: params.password,
          privateKey: params.privateKey,
          timeout: params.timeout
        });

        // Create SSH connection
        conn = await createConnection(connectionParams);

        // Execute command
        let command = params.command;
        if (params.working_dir) {
          command = `cd "${params.working_dir}" && ${command}`;
        }

        const result = await executeCommand(conn, command);
        const executionTime = Date.now() - startTime;

        // Format output based on response format
        if (params.response_format === ResponseFormat.JSON) {
          const output = {
            success: result.exitCode === 0,
            command: params.command,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            executionTime: `${executionTime}ms`
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output
          };
        }

        // Markdown format
        const lines = [
          `# SSH Command Execution: ${params.command}`,
          '',
          `**Status:** ${result.exitCode === 0 ? '✓ Success' : '✗ Failed'}`,
          `**Exit Code:** ${result.exitCode ?? 'N/A'}`,
          `**Execution Time:** ${executionTime}ms`,
          ''
        ];

        if (result.stdout) {
          lines.push('## Standard Output (stdout)', '');
          lines.push('```');
          lines.push(result.stdout);
          lines.push('```');
          lines.push('');
        }

        if (result.stderr) {
          lines.push('## Standard Error (stderr)', '');
          lines.push('```');
          lines.push(result.stderr);
          lines.push('```');
          lines.push('');
        }

        const output = {
          success: result.exitCode === 0,
          command: params.command,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          executionTime: `${executionTime}ms`
        };

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
          structuredContent: output
        };

      } catch (error) {
        const executionTime = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (params.response_format === ResponseFormat.JSON) {
          const output = {
            success: false,
            command: params.command,
            error: errorMessage,
            executionTime: `${executionTime}ms`
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: output
          };
        }

        const output = {
          success: false,
          command: params.command,
          error: errorMessage,
          executionTime: `${executionTime}ms`
        };

        return {
          content: [{
            type: 'text',
            text: `# SSH Command Execution: ${params.command}\n\n**Status:** ✗ Error\n**Error:** ${errorMessage}\n**Execution Time:** ${executionTime}ms`
          }],
          structuredContent: output
        };

      } finally {
        // Always close the connection
        if (conn) {
          closeConnection(conn);
        }
      }
    }
  );
}
