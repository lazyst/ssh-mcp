#!/usr/bin/env node

import { Command } from 'commander';
import { createConnection, executeCommand, closeConnection, resolveConnectionParams } from './utils/ssh.js';
import { uploadFile, downloadFile, uploadDirectory, downloadDirectory, formatResultJSON, formatResultMarkdown } from './utils/fileTransfer.js';
import { loadConfig, getServerNames } from './utils/config.js';

const program = new Command();

interface CliOptions {
  server?: string;
  host?: string;
  port?: string;
  username?: string;
  password?: string;
  privateKey?: string;
  timeout?: string;
  json?: boolean;
}

function parseOptions(opts: CliOptions) {
  return {
    server: opts.server,
    host: opts.host,
    port: opts.port ? parseInt(opts.port, 10) : undefined,
    username: opts.username,
    password: opts.password,
    privateKey: opts.privateKey,
    timeout: opts.timeout ? parseInt(opts.timeout, 10) : undefined,
  };
}

function output(result: any, json: boolean | undefined) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result);
  }
}

program
  .name('agents-ssh-cli')
  .description('SSH remote management CLI - execute commands, transfer files via SSH')
  .version('1.0.0');

program
  .command('exec')
  .description('Execute a command on a remote SSH server')
  .argument('<command>', 'Command to execute')
  .option('-s, --server <name>', 'Server name from config file')
  .option('-H, --host <host>', 'SSH server hostname or IP address')
  .option('-P, --port <port>', 'SSH server port (default: 22)')
  .option('-u, --username <user>', 'SSH username')
  .option('-p, --password <password>', 'SSH password')
  .option('-k, --private-key <path>', 'Private key file path or key content')
  .option('-t, --timeout <ms>', 'Connection timeout in milliseconds (default: 30000)')
  .option('--cwd <dir>', 'Working directory on remote server')
  .option('--json', 'Output in JSON format')
  .action(async (command: string, opts: CliOptions & { cwd?: string }) => {
    try {
      const connParams = await resolveConnectionParams(parseOptions(opts));
      const conn = await createConnection(connParams);
      try {
        let cmd = command;
        if (opts.cwd) {
          cmd = `cd "${opts.cwd}" && ${cmd}`;
        }
        const result = await executeCommand(conn, cmd);
        if (opts.json) {
          output({
            success: result.exitCode === 0,
            command,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
          }, true);
        } else {
          if (result.stdout) console.log(result.stdout);
          if (result.stderr) console.error(result.stderr);
          if (result.exitCode !== null) process.exitCode = result.exitCode;
        }
      } finally {
        closeConnection(conn);
      }
    } catch (error: any) {
      if (opts.json) {
        output({ success: false, error: error.message }, true);
      } else {
        console.error(`Error: ${error.message}`);
      }
      process.exitCode = 1;
    }
  });

program
  .command('upload')
  .description('Upload a file to a remote SSH server')
  .argument('<local>', 'Local file path')
  .argument('<remote>', 'Remote destination path')
  .option('-s, --server <name>', 'Server name from config file')
  .option('-H, --host <host>', 'SSH server hostname or IP address')
  .option('-P, --port <port>', 'SSH server port (default: 22)')
  .option('-u, --username <user>', 'SSH username')
  .option('-p, --password <password>', 'SSH password')
  .option('-k, --private-key <path>', 'Private key file path or key content')
  .option('-t, --timeout <ms>', 'Connection timeout in milliseconds (default: 30000)')
  .option('--json', 'Output in JSON format')
  .action(async (local: string, remote: string, opts: CliOptions) => {
    try {
      const connParams = await resolveConnectionParams(parseOptions(opts));
      const conn = await createConnection(connParams);
      try {
        const result = await uploadFile(conn, local, remote);
        output(
          opts.json ? formatResultJSON(result) : formatResultMarkdown(result),
          false
        );
        if (!result.success) process.exitCode = 1;
      } finally {
        closeConnection(conn);
      }
    } catch (error: any) {
      if (opts.json) {
        output(JSON.stringify({ success: false, error: error.message }, null, 2), false);
      } else {
        console.error(`Error: ${error.message}`);
      }
      process.exitCode = 1;
    }
  });

program
  .command('download')
  .description('Download a file from a remote SSH server')
  .argument('<remote>', 'Remote file path')
  .argument('<local>', 'Local destination path')
  .option('-s, --server <name>', 'Server name from config file')
  .option('-H, --host <host>', 'SSH server hostname or IP address')
  .option('-P, --port <port>', 'SSH server port (default: 22)')
  .option('-u, --username <user>', 'SSH username')
  .option('-p, --password <password>', 'SSH password')
  .option('-k, --private-key <path>', 'Private key file path or key content')
  .option('-t, --timeout <ms>', 'Connection timeout in milliseconds (default: 30000)')
  .option('--json', 'Output in JSON format')
  .action(async (remote: string, local: string, opts: CliOptions) => {
    try {
      const connParams = await resolveConnectionParams(parseOptions(opts));
      const conn = await createConnection(connParams);
      try {
        const result = await downloadFile(conn, remote, local);
        output(
          opts.json ? formatResultJSON(result) : formatResultMarkdown(result),
          false
        );
        if (!result.success) process.exitCode = 1;
      } finally {
        closeConnection(conn);
      }
    } catch (error: any) {
      if (opts.json) {
        output(JSON.stringify({ success: false, error: error.message }, null, 2), false);
      } else {
        console.error(`Error: ${error.message}`);
      }
      process.exitCode = 1;
    }
  });

program
  .command('upload-dir')
  .description('Upload a directory to a remote SSH server')
  .argument('<local>', 'Local directory path')
  .argument('<remote>', 'Remote destination path')
  .option('-s, --server <name>', 'Server name from config file')
  .option('-H, --host <host>', 'SSH server hostname or IP address')
  .option('-P, --port <port>', 'SSH server port (default: 22)')
  .option('-u, --username <user>', 'SSH username')
  .option('-p, --password <password>', 'SSH password')
  .option('-k, --private-key <path>', 'Private key file path or key content')
  .option('-t, --timeout <ms>', 'Connection timeout in milliseconds (default: 30000)')
  .option('--json', 'Output in JSON format')
  .action(async (local: string, remote: string, opts: CliOptions) => {
    try {
      const connParams = await resolveConnectionParams(parseOptions(opts));
      const conn = await createConnection(connParams);
      try {
        const result = await uploadDirectory(conn, local, remote);
        output(
          opts.json ? formatResultJSON(result) : formatResultMarkdown(result),
          false
        );
        if (!result.success) process.exitCode = 1;
      } finally {
        closeConnection(conn);
      }
    } catch (error: any) {
      if (opts.json) {
        output(JSON.stringify({ success: false, error: error.message }, null, 2), false);
      } else {
        console.error(`Error: ${error.message}`);
      }
      process.exitCode = 1;
    }
  });

program
  .command('download-dir')
  .description('Download a directory from a remote SSH server')
  .argument('<remote>', 'Remote directory path')
  .argument('<local>', 'Local destination path')
  .option('-s, --server <name>', 'Server name from config file')
  .option('-H, --host <host>', 'SSH server hostname or IP address')
  .option('-P, --port <port>', 'SSH server port (default: 22)')
  .option('-u, --username <user>', 'SSH username')
  .option('-p, --password <password>', 'SSH password')
  .option('-k, --private-key <path>', 'Private key file path or key content')
  .option('-t, --timeout <ms>', 'Connection timeout in milliseconds (default: 30000)')
  .option('--json', 'Output in JSON format')
  .action(async (remote: string, local: string, opts: CliOptions) => {
    try {
      const connParams = await resolveConnectionParams(parseOptions(opts));
      const conn = await createConnection(connParams);
      try {
        const result = await downloadDirectory(conn, remote, local);
        output(
          opts.json ? formatResultJSON(result) : formatResultMarkdown(result),
          false
        );
        if (!result.success) process.exitCode = 1;
      } finally {
        closeConnection(conn);
      }
    } catch (error: any) {
      if (opts.json) {
        output(JSON.stringify({ success: false, error: error.message }, null, 2), false);
      } else {
        console.error(`Error: ${error.message}`);
      }
      process.exitCode = 1;
    }
  });

program
  .command('list-servers')
  .description('List all configured SSH servers from config file')
  .option('--json', 'Output in JSON format')
  .action(async (opts: { json?: boolean }) => {
    try {
      loadConfig();
      const names = getServerNames();
      if (opts.json) {
        output({ servers: names, count: names.length }, true);
      } else {
        if (names.length === 0) {
          console.log('No servers configured. Create a .agents-ssh-cli/config.json file.');
        } else {
          console.log(`Configured servers (${names.length}):`);
          for (const name of names) {
            console.log(`  - ${name}`);
          }
        }
      }
    } catch (error: any) {
      if (opts.json) {
        output({ servers: [], count: 0, error: error.message }, true);
      } else {
        console.error(`Error: ${error.message}`);
      }
      process.exitCode = 1;
    }
  });

program
  .command('serve')
  .description('Run as MCP server via stdio (original mode)')
  .action(async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const { registerExecuteCommandTool } = await import('./tools/executeCommand.js');
    const { registerFileTransferTools } = await import('./tools/fileTransfer.js');
    const { registerListServersTool } = await import('./tools/listServers.js');

    const server = new McpServer({ name: 'agents-ssh-cli', version: '1.0.0' });
    registerExecuteCommandTool(server);
    registerFileTransferTools(server);
    registerListServersTool(server);

    try {
      const configPath = (await import('./utils/config.js')).getConfigPath();
      loadConfig();
      const serverNames = getServerNames();
      console.error(`SSH MCP server loaded config from: ${configPath}`);
      console.error(`Available servers: ${serverNames.join(', ') || 'none'}`);
    } catch (error: any) {
      console.error(`SSH MCP server started without config file: ${error.message}`);
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('SSH MCP server running via stdio');
  });

program.parse(process.argv);
