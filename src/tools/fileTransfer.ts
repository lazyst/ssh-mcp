/**
 * File Transfer Tools
 * 
 * Registers tools for uploading and downloading files and directories via SSH.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OptionalConnectionParamsSchema, createConnection, closeConnection, resolveConnectionParams } from '../utils/ssh.js';
import {
  uploadFile,
  downloadFile,
  uploadDirectory,
  downloadDirectory,
  formatResultJSON,
  formatResultMarkdown
} from '../utils/fileTransfer.js';

// Base connection schema with optional params (for config support)
const ConnectionSchema = z.object({
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
    .describe("Connection timeout in milliseconds (default: 30000)")
}).strict();

// Response format enum
enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json'
}

// Output schema for transfer result (MCP规范要求)
const TransferResultSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', description: 'Whether the transfer was successful' },
    message: { type: 'string', description: 'Human-readable status message' },
    details: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source file/directory path' },
        destination: { type: 'string', description: 'Destination file/directory path' },
        size: { type: 'number', description: 'File size in bytes (for single files)' },
        filesTransferred: { type: 'number', description: 'Number of files transferred (for directories)' },
        directoriesTransferred: { type: 'number', description: 'Number of directories transferred' }
      }
    },
    error: { type: 'string', description: 'Error code if transfer failed' }
  }
};

/**
 * Register file transfer tools with the MCP server
 */
export function registerFileTransferTools(server: McpServer): void {
  // Tool: ssh_upload_file
  server.registerTool(
    'ssh_upload_file',
    {
      title: 'Upload File to SSH Server',
      description: `Upload a single file from the local machine to a remote SSH server.

This tool establishes an SSH connection and transfers a local file to the specified remote path using SFTP protocol for reliable file transfer.

Args:
  - host (string): SSH server hostname or IP address
  - port (number): SSH server port (default: 22)
  - username (string): SSH username
  - password (string): SSH password (optional if privateKey is provided)
  - privateKey (string): Path to private key file or private key content (optional)
  - timeout (number): Connection timeout in milliseconds (default: 30000)
  - local_path (string): Local file path to upload
  - remote_path (string): Destination path on the remote server
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Features:
  - Uses native SFTP protocol (more reliable than SCP/base64)
  - Supports automatic retry on transient failures (3 attempts)
  - Streaming transfer for large files
  - File verification after upload

Returns:
  For Markdown format:
  - Success/failure status
  - Source and destination paths
  - File size
  - Transfer confirmation

  For JSON format:
  {
    "success": boolean,
    "message": string,
    "details": {
      "source": string,
      "destination": string,
      "size": number
    }
  }

Examples:
  - Use when: "Upload a configuration file to the server" -> local_path="./config/app.yml", remote_path="/etc/myapp/config.yml"
  - Use when: "Deploy a script to the server" -> local_path="./scripts/deploy.sh", remote_path="/opt/deploy/scripts/deploy.sh"
  - Use with private key: privateKey="/home/user/.ssh/id_rsa"

Error Handling:
  - Returns "Error: Local file does not exist" if the local file path is invalid
  - Returns "Error: Local path is not a file" if the local path is a directory
  - Returns "Error: Authentication failed" if credentials are incorrect
  - Returns "Error: Connection refused" if the SSH server is not accessible
  - Returns "Error: File too large" if file exceeds 500MB limit`,
      inputSchema: ConnectionSchema.extend({
        local_path: z.string()
          .min(1, "Local path is required")
          .describe("Local file path to upload"),
        remote_path: z.string()
          .min(1, "Remote path is required")
          .describe("Destination path on the remote server"),
        response_format: z.enum(['markdown', 'json'])
          .default('markdown')
          .describe("Output format: 'markdown' or 'json'")
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params) => {
      let conn = null;
      try {
        const connectionParams = await resolveConnectionParams({
          server: params.server,
          host: params.host,
          port: params.port,
          username: params.username,
          password: params.password,
          privateKey: params.privateKey,
          timeout: params.timeout
        });

        conn = await createConnection(connectionParams);
        const result = await uploadFile(conn, params.local_path, params.remote_path);

        return {
          content: [{ 
            type: 'text', 
            text: params.response_format === ResponseFormat.JSON 
              ? formatResultJSON(result) 
              : formatResultMarkdown(result)
          }],
          structuredContent: result
        };
      } catch (error) {
        const errorResult = {
          success: false,
          message: `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
          details: {
            source: params.local_path,
            destination: params.remote_path
          }
        };
        return {
          content: [{ 
            type: 'text', 
            text: params.response_format === ResponseFormat.JSON
              ? JSON.stringify(errorResult, null, 2)
              : `✗ ${errorResult.message}\n\n**Details:**\n- **Source:** ${params.local_path}\n- **Destination:** ${params.remote_path}`
          }],
          structuredContent: errorResult
        };
      } finally {
        if (conn) closeConnection(conn);
      }
    }
  );

  // Tool: ssh_download_file
  server.registerTool(
    'ssh_download_file',
    {
      title: 'Download File from SSH Server',
      description: `Download a single file from a remote SSH server to the local machine.

This tool establishes an SSH connection and transfers a remote file to the specified local path using SFTP protocol.

Args:
  - host (string): SSH server hostname or IP address
  - port (number): SSH server port (default: 22)
  - username (string): SSH username
  - password (string): SSH password (optional if privateKey is provided)
  - privateKey (string): Path to private key file or private key content (optional)
  - timeout (number): Connection timeout in milliseconds (default: 30000)
  - remote_path (string): Remote file path to download
  - local_path (string): Local destination path
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Features:
  - Uses native SFTP protocol (more reliable than SCP/base64)
  - Supports automatic retry on transient failures (3 attempts)
  - Streaming transfer for large files
  - File verification after download

Examples:
  - Use when: "Download a log file from the server" -> remote_path="/var/log/app.log", local_path="./logs/app.log"
  - Use when: "Get a configuration file from production" -> remote_path="/etc/nginx/nginx.conf", local_path="./config/nginx.conf"

Error Handling:
  - Returns "Error: Remote file does not exist" if the remote file path is invalid
  - Returns "Error: Authentication failed" if credentials are incorrect
  - Returns "Error: Connection refused" if the SSH server is not accessible`,
      inputSchema: ConnectionSchema.extend({
        remote_path: z.string()
          .min(1, "Remote path is required")
          .describe("Remote file path to download"),
        local_path: z.string()
          .min(1, "Local path is required")
          .describe("Local destination path"),
        response_format: z.enum(['markdown', 'json'])
          .default('markdown')
          .describe("Output format: 'markdown' or 'json'")
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params) => {
      let conn = null;
      try {
        const connectionParams = await resolveConnectionParams({
          server: params.server,
          host: params.host,
          port: params.port,
          username: params.username,
          password: params.password,
          privateKey: params.privateKey,
          timeout: params.timeout
        });

        conn = await createConnection(connectionParams);
        const result = await downloadFile(conn, params.remote_path, params.local_path);

        return {
          content: [{ 
            type: 'text', 
            text: params.response_format === ResponseFormat.JSON 
              ? formatResultJSON(result) 
              : formatResultMarkdown(result)
          }],
          structuredContent: result
        };
      } catch (error) {
        const errorResult = {
          success: false,
          message: `Download failed: ${error instanceof Error ? error.message : String(error)}`,
          details: {
            source: params.remote_path,
            destination: params.local_path
          }
        };
        return {
          content: [{ 
            type: 'text', 
            text: params.response_format === ResponseFormat.JSON
              ? JSON.stringify(errorResult, null, 2)
              : `✗ ${errorResult.message}\n\n**Details:**\n- **Source:** ${params.remote_path}\n- **Destination:** ${params.local_path}`
          }],
          structuredContent: errorResult
        };
      } finally {
        if (conn) closeConnection(conn);
      }
    }
  );

  // Tool: ssh_upload_directory
  server.registerTool(
    'ssh_upload_directory',
    {
      title: 'Upload Directory to SSH Server',
      description: `Upload a local directory and all its contents to a remote SSH server.

This tool recursively transfers a local directory to the specified remote path, preserving the directory structure using SFTP protocol.

Args:
  - host (string): SSH server hostname or IP address
  - port (number): SSH server port (default: 22)
  - username (string): SSH username
  - password (string): SSH password (optional if privateKey is provided)
  - privateKey (string): Path to private key file or private key content (optional)
  - timeout (number): Connection timeout in milliseconds (default: 30000)
  - local_path (string): Local directory path to upload
  - remote_path (string): Destination path on the remote server
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Features:
  - Uses native SFTP protocol for reliable transfers
  - Each file supports automatic retry (3 attempts)
  - Reports partial failures with list of failed files
  - Preserves directory structure

Examples:
  - Use when: "Deploy a project to the server" -> local_path="./dist", remote_path="/var/www/app"
  - Use when: "Sync a configuration directory" -> local_path="./config", remote_path="/etc/myapp"

Error Handling:
  - Returns "Error: Local directory does not exist" if the local directory path is invalid
  - Returns "Error: Local path is not a directory" if the local path is a file
  - Returns "Error: Authentication failed" if credentials are incorrect`,
      inputSchema: ConnectionSchema.extend({
        local_path: z.string()
          .min(1, "Local path is required")
          .describe("Local directory path to upload"),
        remote_path: z.string()
          .min(1, "Remote path is required")
          .describe("Destination path on the remote server"),
        response_format: z.enum(['markdown', 'json'])
          .default('markdown')
          .describe("Output format: 'markdown' or 'json'")
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params) => {
      let conn = null;
      try {
        const connectionParams = await resolveConnectionParams({
          server: params.server,
          host: params.host,
          port: params.port,
          username: params.username,
          password: params.password,
          privateKey: params.privateKey,
          timeout: params.timeout
        });

        conn = await createConnection(connectionParams);
        const result = await uploadDirectory(conn, params.local_path, params.remote_path);

        return {
          content: [{ 
            type: 'text', 
            text: params.response_format === ResponseFormat.JSON 
              ? formatResultJSON(result) 
              : formatResultMarkdown(result)
          }],
          structuredContent: result
        };
      } catch (error) {
        const errorResult = {
          success: false,
          message: `Upload directory failed: ${error instanceof Error ? error.message : String(error)}`,
          details: {
            source: params.local_path,
            destination: params.remote_path
          }
        };
        return {
          content: [{ 
            type: 'text', 
            text: params.response_format === ResponseFormat.JSON
              ? JSON.stringify(errorResult, null, 2)
              : `✗ ${errorResult.message}\n\n**Details:**\n- **Source:** ${params.local_path}\n- **Destination:** ${params.remote_path}`
          }],
          structuredContent: errorResult
        };
      } finally {
        if (conn) closeConnection(conn);
      }
    }
  );

  // Tool: ssh_download_directory
  server.registerTool(
    'ssh_download_directory',
    {
      title: 'Download Directory from SSH Server',
      description: `Download a remote directory and all its contents from an SSH server to the local machine.

This tool recursively transfers a remote directory path to the specified local directory using SFTP protocol.

Args:
  - host (string): SSH server hostname or IP address
  - port (number): SSH server port (default: 22)
  - username (string): SSH username
  - password (string): SSH password (optional if privateKey is provided)
  - privateKey (string): Path to private key file or private key content (optional)
  - timeout (number): Connection timeout in milliseconds (default: 30000)
  - remote_path (string): Remote directory path to download
  - local_path (string): Local destination path
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Features:
  - Uses native SFTP protocol for reliable transfers
  - Each file supports automatic retry (3 attempts)
  - Reports partial failures with list of failed files
  - Preserves directory structure

Examples:
  - Use when: "Download logs from the server" -> remote_path="/var/log/myapp", local_path="./logs"
  - Use when: "Backup a project directory" -> remote_path="/opt/project", local_path="./backup/project"

Error Handling:
  - Returns "Error: Remote directory does not exist" if the remote directory path is invalid
  - Returns "Error: Authentication failed" if credentials are incorrect`,
      inputSchema: ConnectionSchema.extend({
        remote_path: z.string()
          .min(1, "Remote path is required")
          .describe("Remote directory path to download"),
        local_path: z.string()
          .min(1, "Local path is required")
          .describe("Local destination path"),
        response_format: z.enum(['markdown', 'json'])
          .default('markdown')
          .describe("Output format: 'markdown' or 'json'")
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params) => {
      let conn = null;
      try {
        const connectionParams = await resolveConnectionParams({
          server: params.server,
          host: params.host,
          port: params.port,
          username: params.username,
          password: params.password,
          privateKey: params.privateKey,
          timeout: params.timeout
        });

        conn = await createConnection(connectionParams);
        const result = await downloadDirectory(conn, params.remote_path, params.local_path);

        return {
          content: [{ 
            type: 'text', 
            text: params.response_format === ResponseFormat.JSON 
              ? formatResultJSON(result) 
              : formatResultMarkdown(result)
          }],
          structuredContent: result
        };
      } catch (error) {
        const errorResult = {
          success: false,
          message: `Download directory failed: ${error instanceof Error ? error.message : String(error)}`,
          details: {
            source: params.remote_path,
            destination: params.local_path
          }
        };
        return {
          content: [{ 
            type: 'text', 
            text: params.response_format === ResponseFormat.JSON
              ? JSON.stringify(errorResult, null, 2)
              : `✗ ${errorResult.message}\n\n**Details:**\n- **Source:** ${params.remote_path}\n- **Destination:** ${params.local_path}`
          }],
          structuredContent: errorResult
        };
      } finally {
        if (conn) closeConnection(conn);
      }
    }
  );
}
