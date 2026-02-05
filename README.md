# SSH MCP Server

基于 Model Context Protocol (MCP) 的 SSH 服务器工具集，支持在远程服务器上执行命令和传输文件。

## 两种使用方式

本工具支持**两种连接 SSH 服务器的方式**：

### 方式一：直接参数（临时连接）

直接在工具调用中指定服务器信息，适合临时操作：

```json
{
  "tool": "ssh_execute_command",
  "arguments": {
    "host": "192.168.1.100",
    "port": 22,
    "username": "root",
    "password": "your_password",
    "command": "docker ps"
  }
}
```

### 方式二：配置文件（推荐）

预先配置服务器信息，通过名称调用，适合频繁使用的服务器：

1. 创建 `ssh-mcp.config.json` 配置文件
2. 使用 `server` 参数指定服务器名称

```json
{
  "tool": "ssh_execute_command",
  "arguments": {
    "server": "production",
    "command": "docker ps"
  }
}
```

**优势：**
- 无需每次输入密码
- 支持多服务器配置
- 通过 `ssh_list_servers` 工具查询可用服务器
- Agent 可自主发现并使用服务器

## 安装

```bash
npm install
npm run build
```

## MCP 客户端配置

### OpenCode

配置文件位置：`C:\Users\<用户名>\.config\opencode\opencode.jsonc`

```json
{
  "mcp": {
    "ssh-mcp": {
      "type": "local",
      "command": ["node", "path/to/ssh-mcp/dist/index.js"],
      "enabled": true
    }
  }
}
```

### Claude Code

配置文件位置：`C:\Users\<用户名>\.claude\CLAUDE.json`

```json
{
  "mcpServers": {
    "ssh-mcp": {
      "command": "node",
      "args": ["/path/to/ssh-mcp/dist/index.js"],
      "disabled": false
    }
  }
}
```

### Claude Desktop

配置文件位置：
- Windows: `%APPDATA%/Claude/claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ssh-mcp": {
      "command": "node",
      "args": ["/path/to/ssh-mcp/dist/index.js"],
      "disabled": false
    }
  }
}
```

## SSH 配置文件

### 创建配置文件

```json
{
  "servers": {
    "production": {
      "host": "192.168.1.100",
      "port": 22,
      "username": "root",
      "password": "your_password",
      "timeout": 60000
    },
    "development": {
      "host": "192.168.1.50",
      "port": 2222,
      "username": "admin",
      "password": "dev_password"
    }
  },
  "defaultServer": "development"
}
```

### 配置文件位置（按优先级）

1. `SSH_MCP_CONFIG` 环境变量指定路径
2. 当前项目目录 `ssh-mcp.config.json`
3. 当前项目目录 `.ssh-mcp-config.json`
4. 用户主目录 `.ssh-mcp-config.json`

### 配置文件参数说明

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `host` | 是 | - | SSH 服务器地址 |
| `port` | 否 | 22 | SSH 端口 |
| `username` | 是 | - | 用户名 |
| `password` | 是 | - | 密码 |
| `timeout` | 否 | 30000 | 超时时间（毫秒） |

## 使用示例

### 列出所有已配置的服务器

```json
{
  "tool": "ssh_list_servers"
}
```

### ssh_execute_command - 执行命令

**使用配置文件中的服务器：**

```json
{
  "tool": "ssh_execute_command",
  "arguments": {
    "server": "production",
    "command": "docker ps -a"
  }
}
```

**直接指定参数：**

```json
{
  "tool": "ssh_execute_command",
  "arguments": {
    "host": "192.168.1.100",
    "port": 22,
    "username": "root",
    "password": "123",
    "command": "df -h",
    "response_format": "markdown"
  }
}
```

**指定工作目录：**

```json
{
  "tool": "ssh_execute_command",
  "arguments": {
    "server": "production",
    "working_dir": "/var/www/app",
    "command": "npm run build"
  }
}
```

### ssh_upload_file - 上传文件

**使用配置文件：**

```json
{
  "tool": "ssh_upload_file",
  "arguments": {
    "server": "production",
    "local_path": "./config/app.yml",
    "remote_path": "/etc/myapp/config.yml"
  }
}
```

**直接指定参数：**

```json
{
  "tool": "ssh_upload_file",
  "arguments": {
    "host": "192.168.1.100",
    "port": 22,
    "username": "root",
    "password": "123",
    "local_path": "./deploy.sh",
    "remote_path": "/opt/deploy/deploy.sh"
  }
}
```

### ssh_download_file - 下载文件

**从服务器下载日志文件：**

```json
{
  "tool": "ssh_download_file",
  "arguments": {
    "server": "production",
    "remote_path": "/var/log/app/error.log",
    "local_path": "./logs/error.log"
  }
}
```

**指定输出格式：**

```json
{
  "tool": "ssh_download_file",
  "arguments": {
    "server": "development",
    "remote_path": "/etc/nginx/nginx.conf",
    "local_path": "./config/nginx.conf",
    "response_format": "json"
  }
}
```

### ssh_upload_directory - 上传目录

**部署应用到服务器：**

```json
{
  "tool": "ssh_upload_directory",
  "arguments": {
    "server": "production",
    "local_path": "./dist",
    "remote_path": "/var/www/myapp"
  }
}
```

**同步配置目录：**

```json
{
  "tool": "ssh_upload_directory",
  "arguments": {
    "server": "development",
    "local_path": "./config",
    "remote_path": "/etc/myapp/config"
  }
}
```

### ssh_download_directory - 下载目录

**下载服务器日志目录：**

```json
{
  "tool": "ssh_download_directory",
  "arguments": {
    "server": "production",
    "remote_path": "/var/log/myapp",
    "local_path": "./logs"
  }
}
```

**备份项目目录：**

```json
{
  "tool": "ssh_download_directory",
  "arguments": {
    "server": "production",
    "remote_path": "/opt/project",
    "local_path": "./backup/project"
  }
}
```

## 工具列表

| 工具 | 说明 |
|------|------|
| `ssh_list_servers` | 列出所有已配置的服务器 |
| `ssh_execute_command` | 执行命令 |
| `ssh_upload_file` | 上传文件 |
| `ssh_download_file` | 下载文件 |
| `ssh_upload_directory` | 上传目录 |
| `ssh_download_directory` | 下载目录 |

## ssh_execute_command 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `server` | string | 否 | 服务器名称（配置文件） |
| `host` | string | 否 | SSH 服务器地址 |
| `port` | number | 否 | SSH 端口，默认 22 |
| `username` | string | 否 | 用户名 |
| `password` | string | 否 | 密码 |
| `timeout` | number | 否 | 超时时间（毫秒） |
| `command` | string | 是 | 要执行的命令 |
| `working_dir` | string | 否 | 工作目录 |
| `response_format` | string | 否 | 输出格式（markdown/json） |

## ssh_upload_file 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `server` | string | 否 | 服务器名称（配置文件） |
| `host` | string | 否 | SSH 服务器地址 |
| `port` | number | 否 | SSH 端口，默认 22 |
| `username` | string | 否 | 用户名 |
| `password` | string | 否 | 密码 |
| `timeout` | number | 否 | 超时时间（毫秒） |
| `local_path` | string | 是 | 本地文件路径 |
| `remote_path` | string | 是 | 远程目标路径 |
| `response_format` | string | 否 | 输出格式（markdown/json） |

## ssh_download_file 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `server` | string | 否 | 服务器名称（配置文件） |
| `host` | string | 否 | SSH 服务器地址 |
| `port` | number | 否 | SSH 端口，默认 22 |
| `username` | string | 否 | 用户名 |
| `password` | string | 否 | 密码 |
| `timeout` | number | 否 | 超时时间（毫秒） |
| `remote_path` | string | 是 | 远程文件路径 |
| `local_path` | string | 是 | 本地目标路径 |
| `response_format` | string | 否 | 输出格式（markdown/json） |

## ssh_upload_directory 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `server` | string | 否 | 服务器名称（配置文件） |
| `host` | string | 否 | SSH 服务器地址 |
| `port` | number | 否 | SSH 端口，默认 22 |
| `username` | string | 否 | 用户名 |
| `password` | string | 否 | 密码 |
| `timeout` | number | 否 | 超时时间（毫秒） |
| `local_path` | string | 是 | 本地目录路径 |
| `remote_path` | string | 是 | 远程目标目录 |
| `response_format` | string | 否 | 输出格式（markdown/json） |

## ssh_download_directory 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `server` | string | 否 | 服务器名称（配置文件） |
| `host` | string | 否 | SSH 服务器地址 |
| `port` | number | 否 | SSH 端口，默认 22 |
| `username` | string | 否 | 用户名 |
| `password` | string | 否 | 密码 |
| `timeout` | number | 否 | 超时时间（毫秒） |
| `remote_path` | string | 是 | 远程目录路径 |
| `local_path` | string | 是 | 本地目标目录 |
| `response_format` | string | 否 | 输出格式（markdown/json） |
