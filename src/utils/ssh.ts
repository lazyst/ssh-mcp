/**
 * SSH Connection Utilities
 *
 * Provides utilities for creating SSH connections, executing commands,
 * and transferring files using password authentication.
 */

import { Client, ConnectConfig, ExecOptions } from 'ssh2';
import { z } from 'zod';
import { getServerConfig, getServerNames, ServerConfig } from './config.js';

// Required connection parameters schema
export const RequiredConnectionParamsSchema = z.object({
  host: z.string()
    .min(1, "Host is required")
    .describe("SSH server hostname or IP address"),
  port: z.number()
    .int()
    .min(1)
    .max(65535)
    .default(22)
    .describe("SSH server port (default: 22)"),
  username: z.string()
    .min(1, "Username is required")
    .describe("SSH username"),
  password: z.string()
    .min(1, "Password is required")
    .describe("SSH password"),
  timeout: z.number()
    .int()
    .min(1000)
    .max(60000)
    .default(30000)
    .describe("Connection timeout in milliseconds (default: 30000)")
}).strict();

export type RequiredConnectionParams = z.infer<typeof RequiredConnectionParamsSchema>;

// Optional connection parameters (used when parameters can come from config)
export const OptionalConnectionParamsSchema = z.object({
  host: z.string()
    .optional()
    .describe("SSH server hostname or IP address (optional - can be from config)"),
  server: z.string()
    .optional()
    .describe("Server name from config file (optional)"),
  port: z.number()
    .int()
    .min(1)
    .max(65535)
    .optional()
    .describe("SSH server port (optional - can be from config)"),
  username: z.string()
    .optional()
    .describe("SSH username (optional - can be from config)"),
  password: z.string()
    .optional()
    .describe("SSH password (optional - can be from config)"),
  timeout: z.number()
    .int()
    .min(1000)
    .max(60000)
    .optional()
    .describe("Connection timeout in milliseconds (optional - default: 30000)")
}).strict();

export type OptionalConnectionParams = z.infer<typeof OptionalConnectionParamsSchema>;

// Keep the original schema for backward compatibility
export const ConnectionParamsSchema = RequiredConnectionParamsSchema;
export type ConnectionParams = RequiredConnectionParams;

/**
 * Resolve connection parameters from tool arguments and config file
 * Priority: tool arguments > config file > defaults
 */
export async function resolveConnectionParams(
  params: OptionalConnectionParams
): Promise<RequiredConnectionParams> {
  // Get config from file
  let fileConfig: ServerConfig | null = null;
  if (params.server) {
    fileConfig = getServerConfig(params.server);
  } else {
    fileConfig = getServerConfig();
  }

  // Merge parameters: tool args > config file > defaults
  const resolvedParams: RequiredConnectionParams = {
    host: params.host || fileConfig?.host || '',
    port: params.port ?? fileConfig?.port ?? 22,
    username: params.username || fileConfig?.username || '',
    password: params.password || fileConfig?.password || '',
    timeout: params.timeout ?? fileConfig?.timeout ?? 30000
  };

  // Validate required fields
  if (!resolvedParams.host) {
    throw new Error("Host is required. Provide it as a parameter or in config file.");
  }
  if (!resolvedParams.username) {
    throw new Error("Username is required. Provide it as a parameter or in config file.");
  }
  if (!resolvedParams.password) {
    throw new Error("Password is required. Provide it as a parameter or in config file.");
  }

  return resolvedParams;
}

// Command execution result
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: string;
}

/**
 * Create an SSH client connection with the given parameters
 */
export async function createConnection(params: ConnectionParams): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    
    conn.on('ready', () => {
      resolve(conn);
    });
    
    conn.on('error', (err) => {
      reject(new Error(`SSH connection failed: ${err.message}`));
    });
    
    conn.connect({
      host: params.host,
      port: params.port,
      username: params.username,
      password: params.password,
      readyTimeout: params.timeout,
      timeout: params.timeout,
      // Disable host key checking for flexibility (users can enable in their environment)
      hostHash: 'md5',
      // Allow connecting to servers without known hosts
      strictHostKeyChecking: 'no',
      // Use any available algorithm
      algorithms: {
        kex: [
          'ecdh-sha2-nistp256',
          'ecdh-sha2-nistp384',
          'ecdh-sha2-nistp521',
          'diffie-hellman-group-exchange-sha256',
          'diffie-hellman-group14-sha256',
          'diffie-hellman-group16-sha512',
          'diffie-hellman-group18-sha512',
          'diffie-hellman-group14-sha1'
        ],
        cipher: [
          'aes256-gcm@openssh.com',
          'aes128-gcm@openssh.com',
          'aes256-ctr',
          'aes192-ctr',
          'aes128-ctr',
          'aes256-cbc',
          'aes192-cbc',
          'aes128-cbc',
          '3des-cbc'
        ],
        serverHostKey: [
          'ssh-rsa',
          'ssh-dss',
          'ecdsa-sha2-nistp256',
          'ecdsa-sha2-nistp384',
          'ecdsa-sha2-nistp521',
          'ssh-ed25519'
        ]
      }
    } as ConnectConfig);
  });
}

/**
 * Execute a command on the SSH server
 */
export async function executeCommand(
  conn: Client, 
  command: string, 
  options?: Partial<ExecOptions>
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    conn.exec(command, { ...options, pty: true }, (err, stream) => {
      if (err) {
        reject(new Error(`Failed to execute command: ${err.message}`));
        return;
      }

      let stdout = '';
      let stderr = '';
      let exitCode: number | null = null;
      let signal: string | undefined;

      stream.on('close', (code: number, sig: string | undefined) => {
        exitCode = code;
        signal = sig;
        resolve({ stdout, stderr, exitCode, signal });
      });

      stream.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      stream.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      stream.on('error', (err: Error) => {
        reject(new Error(`Stream error: ${err.message}`));
      });
    });
  });
}

/**
 * Close the SSH connection
 */
export function closeConnection(conn: Client): void {
  if (conn) {
    try {
      conn.end();
    } catch {
      // Ignore errors when closing connection
    }
  }
}

/**
 * Create a shell session for interactive commands
 */
export async function createShell(
  conn: Client,
  term: string = 'xterm'
): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.shell({ term }, (err: Error | undefined, stream: any) => {
      if (err) {
        reject(new Error(`Failed to create shell: ${err.message}`));
        return;
      }
      
      // Shell is ready
      stream.on('ready', () => {
        resolve();
      });
      
      stream.on('error', (shellErr: Error) => {
        reject(new Error(`Shell error: ${shellErr.message}`));
      });
    });
  });
}

/**
 * Check if a path exists on the remote server
 */
export async function pathExists(conn: Client, path: string): Promise<boolean> {
  const result = await executeCommand(conn, `test -e "${path}" && echo "exists" || echo "not_exists"`);
  return result.stdout.trim() === 'exists';
}

/**
 * Check if a path is a directory
 */
export async function isDirectory(conn: Client, path: string): Promise<boolean> {
  const result = await executeCommand(conn, `test -d "${path}" && echo "dir" || echo "file"`);
  return result.stdout.trim() === 'dir';
}

/**
 * Get file statistics
 */
export async function getFileStats(conn: Client, path: string): Promise<{
  size: number;
  mode: string;
  mtime: string;
  isDirectory: boolean;
  isFile: boolean;
  permissions: string;
}> {
  const command = `
    if [ -d "${path}" ]; then
      echo "TYPE=dir"
    elif [ -f "${path}" ]; then
      echo "TYPE=file"
    else
      echo "TYPE=unknown"
    fi
    stat -c "SIZE=%s MODE=%a MTIME=%Y" "${path}" 2>/dev/null || echo "SIZE=0 MODE=0 MTIME=0"
  `;
  
  const result = await executeCommand(conn, command);
  const output = result.stdout;
  
  const typeMatch = output.match(/TYPE=(\w+)/);
  const sizeMatch = output.match(/SIZE=(\d+)/);
  const modeMatch = output.match(/MODE=(\d+)/);
  const mtimeMatch = output.match(/MTIME=(\d+)/);
  
  const mode = modeMatch ? modeMatch[1] : '0';
  const permissions = parseInt(mode, 8)
    .toString(8)
    .padStart(4, '0');
  
  return {
    size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0,
    mode: modeMatch ? modeMatch[1] : '0',
    mtime: mtimeMatch ? new Date(parseInt(mtimeMatch[1], 10) * 1000).toISOString() : '',
    isDirectory: typeMatch?.[1] === 'dir',
    isFile: typeMatch?.[1] === 'file',
    permissions
  };
}

/**
 * List directory contents
 */
export async function listDirectory(conn: Client, path: string): Promise<Array<{
  name: string;
  type: 'file' | 'directory' | 'other';
  size: number;
  permissions: string;
}>> {
  const command = `ls -la "${path}"`;
  const result = await executeCommand(conn, command);
  
  const lines = result.stdout.trim().split('\n').filter(line => line.length > 0);
  const items: Array<{ name: string; type: 'file' | 'directory' | 'other'; size: number; permissions: string }> = [];
  
  for (const line of lines.slice(1)) { // Skip the total line
    const match = line.match(/^([d-])([rwxs-]{9})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(.+)$/);
    if (match) {
      const [_, type, permissions, size, name] = match;
      items.push({
        name,
        type: type === 'd' ? 'directory' : type === '-' ? 'file' : 'other',
        size: parseInt(size, 10),
        permissions
      });
    }
  }
  
  return items;
}
