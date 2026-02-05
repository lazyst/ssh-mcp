/**
 * Configuration Loader
 *
 * Loads SSH server configurations from JSON configuration file.
 *
 * Configuration file example (ssh-mcp.config.json):
 * {
 *   "servers": {
 *     "production": {
 *       "host": "192.168.1.100",
 *       "port": 22,
 *       "username": "root",
 *       "password": "your_password",
 *       "timeout": 30000
 *     },
 *     "development": {
 *       "host": "192.168.1.50",
 *       "port": 2222,
 *       "username": "admin",
 *       "password": "dev_password"
 *     }
 *   },
 *   "defaultServer": "development"
 * }
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

// Configuration file schema
export const ServerConfigSchema = z.object({
  host: z.string().min(1, "Host is required"),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  timeout: z.number().int().min(1000).max(60000).default(30000)
}).strict();

export const ConfigFileSchema = z.object({
  servers: z.record(ServerConfigSchema),
  defaultServer: z.string().optional()
}).strict();

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type ConfigFile = z.infer<typeof ConfigFileSchema>;

// Configuration cache
let cachedConfig: ConfigFile | null = null;

/**
 * Get configuration file path
 * Searches in the following order:
 * 1. SSH_MCP_CONFIG environment variable
 * 2. Project directory (where dist/index.js is located)
 * 3. Current working directory
 * 4. User home directory
 */
export function getConfigPath(): string {
  if (process.env.SSH_MCP_CONFIG) {
    return process.env.SSH_MCP_CONFIG;
  }

  // Get the directory where the main script is located
  let serverDir: string;
  
  if (process.argv[1]) {
    serverDir = path.dirname(process.argv[1]);
  } else {
    try {
      serverDir = path.dirname(fileURLToPath(import.meta.url));
      // Go up from dist/utils to project root
      serverDir = path.join(serverDir, '..', '..');
    } catch {
      serverDir = process.cwd();
    }
  }

  const configPaths = [
    // Project directory
    path.join(serverDir, 'ssh-mcp.config.json'),
    path.join(serverDir, '.ssh-mcp-config.json'),
    // Current working directory
    'ssh-mcp.config.json',
    '.ssh-mcp-config.json',
    // User home directory
    path.join(process.env.HOME || process.env.USERPROFILE || process.cwd(), '.ssh-mcp-config.json')
  ];

  for (const p of configPaths) {
    try {
      if (fs.existsSync(p)) {
        return path.resolve(p);
      }
    } catch {
      continue;
    }
  }

  return configPaths[0];
}

/**
 * Load configuration from file
 */
export function loadConfig(configFilePath?: string): ConfigFile {
  const filePath = configFilePath || getConfigPath();

  if (!fs.existsSync(filePath)) {
    throw new Error(`Configuration file not found: ${filePath}`);
  }

  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const config = JSON.parse(fileContent);
  const parsedConfig = ConfigFileSchema.parse(config);

  cachedConfig = parsedConfig;
  return parsedConfig;
}

/**
 * Get server configuration by name
 */
export function getServerConfig(serverName?: string): ServerConfig | null {
  if (!cachedConfig) {
    try {
      loadConfig();
    } catch {
      return null;
    }
  }

  if (!cachedConfig) {
    return null;
  }

  // If server name specified, find it
  if (serverName) {
    const server = cachedConfig.servers[serverName];
    if (!server) {
      const availableServers = Object.keys(cachedConfig.servers).join(', ');
      throw new Error(
        `Server "${serverName}" not found. Available: ${availableServers || 'none'}`
      );
    }
    return server;
  }

  // Return default server or single server
  const defaultServer = cachedConfig.defaultServer;
  if (defaultServer && cachedConfig.servers[defaultServer]) {
    return cachedConfig.servers[defaultServer];
  }

  const serverNames = Object.keys(cachedConfig.servers);
  if (serverNames.length === 1) {
    return cachedConfig.servers[serverNames[0]];
  }

  return null;
}

/**
 * Get all server names
 */
export function getServerNames(): string[] {
  if (!cachedConfig) {
    try {
      loadConfig();
    } catch {
      return [];
    }
  }

  return cachedConfig ? Object.keys(cachedConfig.servers) : [];
}

/**
 * Check if configuration is available
 */
export function hasConfig(): boolean {
  if (cachedConfig) {
    return true;
  }

  try {
    loadConfig();
  } catch {
    return false;
  }

  return cachedConfig !== null;
}

/**
 * Clear cached configuration
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}
