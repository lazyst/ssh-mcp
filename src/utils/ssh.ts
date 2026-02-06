/**
 * SSH Connection Utilities
 *
 * Provides utilities for creating SSH connections, executing commands,
 * and transferring files using password or private key authentication.
 *
 * Key improvements:
 * - Support for private key authentication (more reliable than password)
 * - Better connection error handling
 * - Configurable algorithms for compatibility
 */

import { Client, ConnectConfig, ExecOptions } from 'ssh2';
import { z } from 'zod';
import * as fs from 'fs';
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
    .optional()
    .describe("SSH password (optional if privateKey is provided)"),
  privateKey: z.string()
    .optional()
    .describe("Path to private key file or private key content (optional, for key-based auth)"),
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
  privateKey: z.string()
    .optional()
    .describe("Path to private key file or private key content (optional)"),
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
    password: params.password ?? fileConfig?.password ?? undefined,
    privateKey: params.privateKey || fileConfig?.privateKey || undefined,
    timeout: params.timeout ?? fileConfig?.timeout ?? 30000
  };

  // Validate required fields
  if (!resolvedParams.host) {
    throw new Error("Host is required. Provide it as a parameter or in config file.");
  }
  if (!resolvedParams.username) {
    throw new Error("Username is required. Provide it as a parameter or in config file.");
  }

  // Either password or privateKey must be provided
  if (!resolvedParams.password && !resolvedParams.privateKey) {
    throw new Error("Either password or privateKey is required for SSH authentication.");
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
 * Supports both password and private key authentication
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

    // Build connection config
    const connectConfig: any = {
      host: params.host,
      port: params.port,
      username: params.username,
      readyTimeout: params.timeout,
      timeout: params.timeout,
      // Disable host key checking for flexibility
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
    };

    // Add authentication method
    if (params.privateKey) {
      // Check if it's a file path or direct key content
      let privateKeyContent: string;
      if (fs.existsSync(params.privateKey)) {
        privateKeyContent = fs.readFileSync(params.privateKey, 'utf8');
      } else {
        // Assume it's the key content directly
        privateKeyContent = params.privateKey;
      }
      (connectConfig as any).privateKey = privateKeyContent;
    } else if (params.password) {
      (connectConfig as any).password = params.password;
    }

    conn.connect(connectConfig);
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
