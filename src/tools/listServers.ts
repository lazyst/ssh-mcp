/**
 * List Servers Tool
 *
 * Registers the ssh_list_servers tool for listing configured SSH servers.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getServerNames, hasConfig } from '../utils/config.js';

// Output schema for structured data
const ListServersOutputSchema = z.object({
  servers: z.array(z.string()).describe('List of configured server names'),
  count: z.number().describe('Number of configured servers'),
  message: z.string().describe('Status message'),
  error: z.string().optional().describe('Error message if listing failed')
});

type ListServersOutput = z.infer<typeof ListServersOutputSchema>;

/**
 * Register the list_servers tool with the MCP server
 */
export function registerListServersTool(server: McpServer): void {
  server.registerTool(
    'ssh_list_servers',
    {
      title: 'List SSH Servers',
      description: `List all configured SSH servers from the configuration file.

This tool helps you discover available servers that you can use with other SSH tools.

Returns:
  - List of server names
  - Number of configured servers
  - Status message

Examples:
  - Use when: "What servers are configured?" -> lists all available servers
  - Use when: "Show me my SSH servers" -> returns server names

Args:
  - This tool takes no arguments`,
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async () => {
      try {
        const serverNames = getServerNames();
        const hasConfiguration = hasConfig();

        if (!hasConfiguration || serverNames.length === 0) {
          return {
            content: [{
              type: 'text',
              text: '# SSH Servers\n\nNo servers configured. Create a .agent-ssh/config.json file in the working directory with server configurations.'
            }],
            structuredContent: {
              servers: [],
              count: 0,
              message: 'No servers configured',
              error: undefined
            } as ListServersOutput
          };
        }

        const output = [
          '# SSH Servers',
          '',
          `**Total: ${serverNames.length} server(s)**`,
          '',
          '## Available Servers:',
          ''
        ];

        for (const name of serverNames) {
          output.push(`- \`${name}\``);
        }

        output.push('');
        output.push('## Usage Example:');
        output.push('```json');
        output.push('{');
        output.push(`  "tool": "ssh_execute_command",`);
        output.push('  "arguments": {');
        output.push(`    "server": "${serverNames[0]}",`);
        output.push('    "command": "ls /root"');
        output.push('  }');
        output.push('}');
        output.push('```');

        return {
          content: [{
            type: 'text',
            text: output.join('\n')
          }],
          structuredContent: {
            servers: serverNames,
            count: serverNames.length,
            message: `Found ${serverNames.length} configured server(s)`,
            error: undefined
          } as ListServersOutput
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text',
            text: `# Error listing servers\n\n${errorMessage}`
          }],
          structuredContent: {
            servers: [],
            count: 0,
            message: 'Error listing servers',
            error: errorMessage
          } as ListServersOutput
        };
      }
    }
  );
}
