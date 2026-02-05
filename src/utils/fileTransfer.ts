/**
 * File Transfer Utilities
 * 
 * Provides utilities for uploading and downloading files and directories
 * using SCP protocol over SSH connections.
 */

import { Client } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';
import { executeCommand, isDirectory } from './ssh.js';

// Response format enum
export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json'
}

// Result interface for operations
export interface TransferResult {
  success: boolean;
  message: string;
  details?: {
    source: string;
    destination: string;
    size?: number;
    filesTransferred?: number;
    directoriesTransferred?: number;
  };
  [key: string]: unknown;
}

/**
 * Upload a single file to the remote server using SCP
 */
export async function uploadFile(
  conn: Client,
  localPath: string,
  remotePath: string
): Promise<TransferResult> {
  try {
    // Verify local file exists
    if (!fs.existsSync(localPath)) {
      return {
        success: false,
        message: `Error: Local file does not exist: ${localPath}`,
        details: { source: localPath, destination: remotePath }
      };
    }

    // Check if localPath is a file
    const stats = fs.statSync(localPath);
    if (!stats.isFile()) {
      return {
        success: false,
        message: `Error: Local path is not a file: ${localPath}`,
        details: { source: localPath, destination: remotePath }
      };
    }

    const fileContent = fs.readFileSync(localPath);
    const base64Content = fileContent.toString('base64');

    // Create remote directory if it doesn't exist
    const remoteDir = path.dirname(remotePath);
    await executeCommand(conn, `mkdir -p "${remoteDir}"`);

    // Write file using base64 decode
    const tempScript = `
      echo '${base64Content}' | base64 -d > "${remotePath}"
      chmod 644 "${remotePath}"
    `;

    await executeCommand(conn, tempScript);

    return {
      success: true,
      message: `Successfully uploaded file: ${localPath} -> ${remotePath}`,
      details: {
        source: localPath,
        destination: remotePath,
        size: stats.size
      }
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to upload file: ${error instanceof Error ? error.message : String(error)}`,
      details: { source: localPath, destination: remotePath }
    };
  }
}

/**
 * Download a single file from the remote server using SCP
 */
export async function downloadFile(
  conn: Client,
  remotePath: string,
  localPath: string
): Promise<TransferResult> {
  try {
    // Check if remote file exists
    const exists = await executeCommand(conn, `test -f "${remotePath}" && echo "exists"`);
    if (!exists.stdout.trim()) {
      return {
        success: false,
        message: `Error: Remote file does not exist: ${remotePath}`,
        details: { source: remotePath, destination: localPath }
      };
    }

    // Get remote file size
    const sizeResult = await executeCommand(conn, `stat -c %s "${remotePath}" 2>/dev/null || echo "0"`);
    const size = parseInt(sizeResult.stdout.trim(), 10) || 0;

    // Create local directory if it doesn't exist
    const localDir = path.dirname(localPath);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    // Read remote file content and write locally
    const tempScript = `cat "${remotePath}" | base64`;
    const contentResult = await executeCommand(conn, tempScript);

    // Decode base64 and write to local file
    const fileContent = Buffer.from(contentResult.stdout, 'base64');
    fs.writeFileSync(localPath, fileContent);

    return {
      success: true,
      message: `Successfully downloaded file: ${remotePath} -> ${localPath}`,
      details: {
        source: remotePath,
        destination: localPath,
        size
      }
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to download file: ${error instanceof Error ? error.message : String(error)}`,
      details: { source: remotePath, destination: localPath }
    };
  }
}

/**
 * Upload a directory to the remote server recursively
 */
export async function uploadDirectory(
  conn: Client,
  localDir: string,
  remoteDir: string
): Promise<TransferResult> {
  try {
    // Verify local directory exists
    if (!fs.existsSync(localDir)) {
      return {
        success: false,
        message: `Error: Local directory does not exist: ${localDir}`,
        details: { source: localDir, destination: remoteDir }
      };
    }

    // Check if localPath is a directory
    const stats = fs.statSync(localDir);
    if (!stats.isDirectory()) {
      return {
        success: false,
        message: `Error: Local path is not a directory: ${localDir}`,
        details: { source: localDir, destination: remoteDir }
      };
    }

    // Create remote directory
    await executeCommand(conn, `mkdir -p "${remoteDir}"`);

    let filesTransferred = 0;
    let directoriesTransferred = 1; // Count the main directory

    // Walk through local directory
    const walkDir = async (localPath: string, remotePath: string) => {
      const entries = fs.readdirSync(localPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullLocalPath = path.join(localPath, entry.name);
        const fullRemotePath = path.join(remotePath, entry.name).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          directoriesTransferred++;
          await executeCommand(conn, `mkdir -p "${fullRemotePath}"`);
          await walkDir(fullLocalPath, fullRemotePath);
        } else if (entry.isFile()) {
          const result = await uploadFile(conn, fullLocalPath, fullRemotePath);
          if (result.success) {
            filesTransferred++;
          }
        }
      }
    };

    await walkDir(localDir, remoteDir);

    return {
      success: true,
      message: `Successfully uploaded directory: ${localDir} -> ${remoteDir}`,
      details: {
        source: localDir,
        destination: remoteDir,
        filesTransferred,
        directoriesTransferred
      }
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to upload directory: ${error instanceof Error ? error.message : String(error)}`,
      details: { source: localDir, destination: remoteDir }
    };
  }
}

/**
 * Download a directory from the remote server recursively
 */
export async function downloadDirectory(
  conn: Client,
  remoteDir: string,
  localDir: string
): Promise<TransferResult> {
  try {
    // Check if remote directory exists
    const exists = await executeCommand(conn, `test -d "${remoteDir}" && echo "exists"`);
    if (!exists.stdout.trim()) {
      return {
        success: false,
        message: `Error: Remote directory does not exist: ${remoteDir}`,
        details: { source: remoteDir, destination: localDir }
      };
    }

    // Create local directory
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    let filesTransferred = 0;
    let directoriesTransferred = 1; // Count the main directory

    // Walk through remote directory
    const walkRemoteDir = async (remotePath: string, localPath: string) => {
      const result = await listRemoteDir(conn, remotePath);

      for (const entry of result) {
        const fullRemotePath = (remotePath + '/' + entry.name).replace(/\\/g, '/');
        const fullLocalPath = localPath + '/' + entry.name;

        if (entry.type === 'directory') {
          directoriesTransferred++;
          if (!fs.existsSync(fullLocalPath)) {
            fs.mkdirSync(fullLocalPath, { recursive: true });
          }
          await walkRemoteDir(fullRemotePath, fullLocalPath);
        } else if (entry.type === 'file') {
          const downloadResult = await downloadFile(conn, fullRemotePath, fullLocalPath);
          if (downloadResult.success) {
            filesTransferred++;
          }
        }
      }
    };

    await walkRemoteDir(remoteDir, localDir);

    return {
      success: true,
      message: `Successfully downloaded directory: ${remoteDir} -> ${localDir}`,
      details: {
        source: remoteDir,
        destination: localDir,
        filesTransferred,
        directoriesTransferred
      }
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to download directory: ${error instanceof Error ? error.message : String(error)}`,
      details: { source: remoteDir, destination: localDir }
    };
  }
}

/**
 * List remote directory contents
 */
async function listRemoteDir(
  conn: Client,
  remotePath: string
): Promise<Array<{ name: string; type: 'file' | 'directory' | 'other'; size: number }>> {
  const command = `ls -1 "${remotePath}"`;
  const result = await executeCommand(conn, command);

  const lines = result.stdout.trim().split('\n').filter(line => line.length > 0);
  const items: Array<{ name: string; type: 'file' | 'directory' | 'other'; size: number }> = [];

  for (const name of lines) {
    const cleanName = name.replace(/\r$/, '').trim();
    if (!cleanName || cleanName === '.' || cleanName === '..') continue;
    
    const testResult = await executeCommand(conn, `test -d "${remotePath}/${cleanName}" && echo "dir" || echo "file"`);
    const type = testResult.stdout.trim() === 'dir' ? 'directory' : 'file';
    
    const sizeResult = await executeCommand(conn, `stat -c %s "${remotePath}/${cleanName}" 2>/dev/null || echo "0"`);
    const size = parseInt(sizeResult.stdout.trim(), 10) || 0;
    
    items.push({
      name: cleanName,
      type,
      size
    });
  }

  return items;
}

/**
 * Format transfer result for JSON output
 */
export function formatResultJSON(result: TransferResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Format transfer result for Markdown output
 */
export function formatResultMarkdown(result: TransferResult): string {
  const icon = result.success ? '✓' : '✗';
  let output = `${icon} ${result.message}\n\n`;
  
  if (result.details) {
    output += `**Details:**\n`;
    output += `- **Source:** ${result.details.source}\n`;
    output += `- **Destination:** ${result.details.destination}\n`;
    
    if (result.details.size !== undefined) {
      output += `- **Size:** ${formatBytes(result.details.size)}\n`;
    }
    if (result.details.filesTransferred !== undefined) {
      output += `- **Files transferred:** ${result.details.filesTransferred}\n`;
    }
    if (result.details.directoriesTransferred !== undefined) {
      output += `- **Directories transferred:** ${result.details.directoriesTransferred}\n`;
    }
  }
  
  return output;
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
