/**
 * File Transfer Utilities
 *
 * Provides utilities for uploading and downloading files and directories
 * using SFTP protocol over SSH connections.
 *
 * Key improvements over SCP-based approach:
 * - Uses native SFTP protocol for reliable file transfer
 * - Supports large files with streaming
 * - Better error handling and progress tracking
 */

import { Client } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';
import { executeCommand } from './ssh.js';

/**
 * Convert Git Bash style paths to Windows paths
 * Git Bash: /d/project/file.js -> Windows: D:\project\file.js
 */
function convertGitBashPathToWindows(gitPath: string): string {
  // Match patterns like /d/, /c/, /e/ etc. at the start
  if (/^\/[a-zA-Z]\//.test(gitPath)) {
    const driveLetter = gitPath[1].toUpperCase();
    const windowsPath = gitPath.substring(2); // Remove /X/
    return driveLetter + ':' + windowsPath;
  }
  return gitPath;
}

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
  error?: string;
  [key: string]: unknown;
}

// Configuration for transfer operations
export interface TransferConfig {
  /** Maximum file size in bytes (default: 500MB) */
  maxFileSize?: number;
  /** Chunk size for streaming transfers (default: 64KB) */
  chunkSize?: number;
  /** Number of retry attempts on failure (default: 3) */
  retryCount?: number;
  /** Delay between retries in ms (default: 1000) */
  retryDelay?: number;
}

const DEFAULT_CONFIG: Required<TransferConfig> = {
  maxFileSize: 500 * 1024 * 1024, // 500MB
  chunkSize: 64 * 1024, // 64KB
  retryCount: 3,
  retryDelay: 1000
};

/**
 * Upload a single file to the remote server using SFTP
 * This replaces the unreliable base64+echo approach with native SFTP
 */
export async function uploadFile(
  conn: Client,
  localPath: string,
  remotePath: string,
  config?: TransferConfig
): Promise<TransferResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let sftp: any = null;

  // Validate local file first
  if (!fs.existsSync(localPath)) {
    return {
      success: false,
      message: `Error: Local file does not exist: ${localPath}`,
      details: { source: localPath, destination: remotePath },
      error: 'LOCAL_FILE_NOT_FOUND'
    };
  }

  const stats = fs.statSync(localPath);
  if (!stats.isFile()) {
    return {
      success: false,
      message: `Error: Local path is not a file: ${localPath}`,
      details: { source: localPath, destination: remotePath },
      error: 'PATH_IS_NOT_FILE'
    };
  }

  if (stats.size > cfg.maxFileSize) {
    return {
      success: false,
      message: `Error: File size (${formatBytes(stats.size)}) exceeds maximum allowed (${formatBytes(cfg.maxFileSize)})`,
      details: { source: localPath, destination: remotePath, size: stats.size },
      error: 'FILE_TOO_LARGE'
    };
  }

  // Normalize paths: convert Git Bash paths to Windows, then standardize separators
  const windowsPath = convertGitBashPathToWindows(localPath);
  const normalizedLocalPath = windowsPath.replace(/\\/g, '/');
  const normalizedRemotePath = remotePath.replace(/\\/g, '/');

  // Retry loop for reliability
  for (let attempt = 1; attempt <= cfg.retryCount; attempt++) {
    let sftp: any = null;
    try {
      // Use SFTP for reliable upload with streaming
      sftp = await new Promise<any>((resolve, reject) => {
        conn.sftp((err: any, sftp: any) => {
          if (err) reject(err);
          else resolve(sftp);
        });
      });

      // Ensure remote directory exists
      const normalizedRemoteDir = path.dirname(normalizedRemotePath).replace(/\\/g, '/');
      await executeCommand(conn, `mkdir -p "${normalizedRemoteDir}"`);

      // Use fastPut for reliable upload (reads local file and uploads via SFTP)
      await new Promise<void>((resolve, reject) => {
        sftp.fastPut(normalizedLocalPath, normalizedRemotePath, (err: any) => {
          if (err) {
            reject(new Error(`SFTP upload error: ${err.message}`));
          } else {
            resolve();
          }
        });
      });

      // Verify upload by checking remote file
      const verifyResult = await executeCommand(conn, `stat -c %s "${normalizedRemotePath}" 2>/dev/null || echo "ERROR"`);
      const remoteSize = parseInt(verifyResult.stdout.trim(), 10);
      if (isNaN(remoteSize)) {
        throw new Error(`Failed to verify remote file size: stat command returned unexpected output`);
      }
      if (remoteSize !== stats.size) {
        throw new Error(`Upload verification failed: local=${stats.size}, remote=${remoteSize}`);
      }

      // Clean up SFTP handle
      sftp.end();

      return {
        success: true,
        message: `Successfully uploaded file: ${normalizedLocalPath} -> ${normalizedRemotePath}`,
        details: {
          source: normalizedLocalPath,
          destination: normalizedRemotePath,
          size: stats.size
        }
      };
    } catch (error) {
      if (sftp) {
        try { sftp.end(); } catch { /* ignore */ }
      }

      const errorMsg = error instanceof Error ? error.message : String(error);

      // Last attempt failed
      if (attempt === cfg.retryCount) {
        return {
          success: false,
          message: `Failed to upload file after ${cfg.retryCount} attempts: ${errorMsg}`,
          details: { source: normalizedLocalPath, destination: normalizedRemotePath, size: stats.size },
          error: 'UPLOAD_FAILED'
        };
      }

      // Wait before retry
      await sleep(cfg.retryDelay * attempt);
    }
  }

  // Should not reach here
  return {
    success: false,
    message: 'Unexpected error in upload',
    details: { source: normalizedLocalPath, destination: normalizedRemotePath },
    error: 'UNEXPECTED_ERROR'
  };
}

/**
 * Download a single file from the remote server using SFTP
 */
export async function downloadFile(
  conn: Client,
  remotePath: string,
  localPath: string,
  config?: TransferConfig
): Promise<TransferResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let sftp: any = null;

  // Normalize paths: convert Git Bash paths to Windows, then standardize separators
  const normalizedRemotePath = remotePath.replace(/\\/g, '/');
  const windowsLocalPath = convertGitBashPathToWindows(localPath);
  const normalizedLocalPath = windowsLocalPath.replace(/\\/g, '/');

  // Check if remote file exists using SFTP stat
  for (let attempt = 1; attempt <= cfg.retryCount; attempt++) {
    try {
      sftp = await new Promise<any>((resolve, reject) => {
        conn.sftp((err: any, sftp: any) => {
          if (err) reject(err);
          else resolve(sftp);
        });
      });

      // Check if remote file exists
      const remoteStats = await new Promise<any>((resolve, reject) => {
        sftp!.stat(normalizedRemotePath, (err: any, stats: any) => {
          if (err) reject(err);
          else resolve(stats);
        });
      });

      if (!remoteStats.isFile()) {
        sftp.end();
        return {
          success: false,
          message: `Error: Remote path is not a file: ${normalizedRemotePath}`,
          details: { source: normalizedRemotePath, destination: normalizedLocalPath },
          error: 'REMOTE_PATH_NOT_FILE'
        };
      }

      if (remoteStats.size > cfg.maxFileSize) {
        sftp.end();
        return {
          success: false,
          message: `Error: Remote file size (${formatBytes(remoteStats.size)}) exceeds maximum allowed (${formatBytes(cfg.maxFileSize)})`,
          details: { source: normalizedRemotePath, destination: normalizedLocalPath, size: Number(remoteStats.size) },
          error: 'FILE_TOO_LARGE'
        };
      }

      // Create local directory if needed
      const normalizedLocalDir = path.dirname(normalizedLocalPath);
      if (!fs.existsSync(normalizedLocalDir)) {
        fs.mkdirSync(normalizedLocalDir, { recursive: true });
      }

      // Use fastGet for reliable download (reads remote file via SFTP and writes locally)
      await new Promise<void>((resolve, reject) => {
        sftp.fastGet(normalizedRemotePath, normalizedLocalPath, (err: any) => {
          if (err) {
            reject(new Error(`SFTP download error: ${err.message}`));
          } else {
            resolve();
          }
        });
      });

      // Verify download
      const localStats = fs.statSync(normalizedLocalPath);
      if (localStats.size !== Number(remoteStats.size)) {
        throw new Error(`Download verification failed: expected=${remoteStats.size}, actual=${localStats.size}`);
      }

      sftp.end();

      return {
        success: true,
        message: `Successfully downloaded file: ${normalizedRemotePath} -> ${normalizedLocalPath}`,
        details: {
          source: normalizedRemotePath,
          destination: normalizedLocalPath,
          size: Number(remoteStats.size)
        }
      };
    } catch (error) {
      if (sftp) {
        try { sftp.end(); } catch { /* ignore */ }
      }

      const errorMsg = error instanceof Error ? error.message : String(error);

      if (attempt === cfg.retryCount) {
        return {
          success: false,
          message: `Failed to download file after ${cfg.retryCount} attempts: ${errorMsg}`,
          details: { source: normalizedRemotePath, destination: normalizedLocalPath },
          error: 'DOWNLOAD_FAILED'
        };
      }

      await sleep(cfg.retryDelay * attempt);
    }
  }

  return {
    success: false,
    message: 'Unexpected error in download',
    details: { source: remotePath, destination: localPath },
    error: 'UNEXPECTED_ERROR'
  };
}

/**
 * Upload a directory to the remote server recursively
 * Uses SFTP streaming for reliable file transfers
 */
export async function uploadDirectory(
  conn: Client,
  localDir: string,
  remoteDir: string,
  config?: TransferConfig
): Promise<TransferResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Normalize Windows path separators to forward slashes for consistency
  const normalizedLocalDir = localDir.replace(/\\/g, '/');
  const normalizedRemoteDir = remoteDir.replace(/\\/g, '/');

  // Validate local directory
  if (!fs.existsSync(normalizedLocalDir)) {
    return {
      success: false,
      message: `Error: Local directory does not exist: ${normalizedLocalDir}`,
      details: { source: normalizedLocalDir, destination: normalizedRemoteDir },
      error: 'LOCAL_DIR_NOT_FOUND'
    };
  }

  const stats = fs.statSync(normalizedLocalDir);
  if (!stats.isDirectory()) {
    return {
      success: false,
      message: `Error: Local path is not a directory: ${normalizedLocalDir}`,
      details: { source: normalizedLocalDir, destination: normalizedRemoteDir },
      error: 'PATH_IS_NOT_DIR'
    };
  }

  try {
    // Create remote directory
    await executeCommand(conn, `mkdir -p "${normalizedRemoteDir}"`);

    let filesTransferred = 0;
    let directoriesTransferred = 1; // Count the main directory
    const failedFiles: Array<{ path: string; error: string }> = [];

    // Walk through local directory
    const walkDir = async (localPath: string, remotePath: string) => {
      const entries = fs.readdirSync(localPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullLocalPath = path.join(localPath, entry.name).replace(/\\/g, '/');
        const fullRemotePath = path.join(remotePath, entry.name).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          directoriesTransferred++;
          await executeCommand(conn, `mkdir -p "${fullRemotePath}"`);
          await walkDir(fullLocalPath, fullRemotePath);
        } else if (entry.isFile()) {
          const result = await uploadFile(conn, fullLocalPath, fullRemotePath, {
            chunkSize: cfg.chunkSize,
            retryCount: cfg.retryCount,
            retryDelay: cfg.retryDelay
          });
          if (result.success) {
            filesTransferred++;
          } else {
            failedFiles.push({
              path: fullLocalPath,
              error: result.error || 'Unknown error'
            });
          }
        }
      }
    };

    await walkDir(localDir, remoteDir);

    if (failedFiles.length > 0) {
      return {
        success: filesTransferred > 0,
        message: failedFiles.length === 0
          ? `Successfully uploaded directory: ${normalizedLocalDir} -> ${normalizedRemoteDir}`
          : `Partially uploaded directory: ${filesTransferred}/${filesTransferred + failedFiles.length} files transferred`,
        details: {
          source: normalizedLocalDir,
          destination: normalizedRemoteDir,
          filesTransferred,
          directoriesTransferred
        },
        error: failedFiles.length === 0 ? undefined : 'PARTIAL_FAILURE'
      };
    }

    return {
      success: true,
      message: `Successfully uploaded directory: ${normalizedLocalDir} -> ${normalizedRemoteDir}`,
      details: {
        source: normalizedLocalDir,
        destination: normalizedRemoteDir,
        filesTransferred,
        directoriesTransferred
      }
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to upload directory: ${error instanceof Error ? error.message : String(error)}`,
      details: { source: localDir, destination: remoteDir },
      error: 'UPLOAD_DIR_FAILED'
    };
  }
}

/**
 * Download a directory from the remote server recursively
 * Uses SFTP streaming for reliable file transfers
 */
export async function downloadDirectory(
  conn: Client,
  remoteDir: string,
  localDir: string,
  config?: TransferConfig
): Promise<TransferResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Normalize Windows path separators to forward slashes for consistency
  const normalizedRemoteDir = remoteDir.replace(/\\/g, '/');
  const normalizedLocalDir = localDir.replace(/\\/g, '/');

  try {
    // Check if remote directory exists
    const exists = await executeCommand(conn, `test -d "${normalizedRemoteDir}" && echo "exists"`);
    if (!exists.stdout.trim()) {
      return {
        success: false,
        message: `Error: Remote directory does not exist: ${normalizedRemoteDir}`,
        details: { source: normalizedRemoteDir, destination: normalizedLocalDir },
        error: 'REMOTE_DIR_NOT_FOUND'
      };
    }

    // Create local directory
    if (!fs.existsSync(normalizedLocalDir)) {
      fs.mkdirSync(normalizedLocalDir, { recursive: true });
    }

    let filesTransferred = 0;
    let directoriesTransferred = 1; // Count the main directory
    const failedFiles: Array<{ path: string; error: string }> = [];

    // Walk through remote directory using SFTP
    const walkRemoteDir = async (remotePath: string, localPath: string) => {
      let sftp: any = null;
      try {
        sftp = await new Promise<any>((resolve, reject) => {
          conn.sftp((err: any, sftp: any) => {
            if (err) reject(err);
            else resolve(sftp);
          });
        });

        const listResult = await new Promise<any[]>((resolve, reject) => {
          sftp!.readdir(remotePath, (err: any, list: any[]) => {
            if (err) reject(err);
            else resolve(list);
          });
        });

        for (const entry of listResult) {
          // Skip . and ..
          if (entry.filename === '.' || entry.filename === '..') continue;

          const fullRemotePath = (remotePath + '/' + entry.filename).replace(/\\/g, '/');
          const fullLocalPath = path.join(localPath, entry.filename).replace(/\\/g, '/');

          const isDir = (entry.attrs.mode & 0o40000) !== 0; // S_IFDIR = 0o40000

          if (isDir) {
            directoriesTransferred++;
            if (!fs.existsSync(fullLocalPath)) {
              fs.mkdirSync(fullLocalPath, { recursive: true });
            }
            await walkRemoteDir(fullRemotePath, fullLocalPath);
          } else {
            const result = await downloadFile(conn, fullRemotePath, fullLocalPath, {
              chunkSize: cfg.chunkSize,
              retryCount: cfg.retryCount,
              retryDelay: cfg.retryDelay
            });
            if (result.success) {
              filesTransferred++;
            } else {
              failedFiles.push({
                path: fullRemotePath,
                error: result.error || 'Unknown error'
              });
            }
          }
        }
      } finally {
        if (sftp) {
          try { sftp.end(); } catch { /* ignore */ }
        }
      }
    };

    await walkRemoteDir(normalizedRemoteDir, normalizedLocalDir);

    if (failedFiles.length > 0) {
      return {
        success: filesTransferred > 0,
        message: failedFiles.length === 0
          ? `Successfully downloaded directory: ${normalizedRemoteDir} -> ${normalizedLocalDir}`
          : `Partially downloaded directory: ${filesTransferred}/${filesTransferred + failedFiles.length} files transferred`,
        details: {
          source: normalizedRemoteDir,
          destination: normalizedLocalDir,
          filesTransferred,
          directoriesTransferred
        },
        error: failedFiles.length === 0 ? undefined : 'PARTIAL_FAILURE'
      };
    }

    return {
      success: true,
      message: `Successfully downloaded directory: ${normalizedRemoteDir} -> ${normalizedLocalDir}`,
      details: {
        source: normalizedRemoteDir,
        destination: normalizedLocalDir,
        filesTransferred,
        directoriesTransferred
      }
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to download directory: ${error instanceof Error ? error.message : String(error)}`,
      details: { source: normalizedRemoteDir, destination: normalizedLocalDir },
      error: 'DOWNLOAD_DIR_FAILED'
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

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
