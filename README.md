# SSH MCP Server

基于 Model Context Protocol 的 SSH 服务器工具集，支持在远程服务器上执行命令和传输文件。

## 功能

- 执行命令、传输文件/目录
- 支持多服务器配置
- 配置文件 + 工具参数两种方式

## 安装

```bash
npm install
npm run build
```

## 配置

### OpenCode 配置

配置文件位置：`C:\Users\<用户名>\.config\opencode\opencode.jsonc`

```json
{
  "mcp": {
    "ssh-mcp": {
      "type": "local",
      "command": [
        "node",
        "C:/Users/<用户名>/.opencode/mcps/ssh-mcp/dist/index.js"
      ],
      "enabled": true
    }
  }
}
```

### Claude Code 配置

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

### Claude Desktop 配置

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

### 其他 MCP 客户端配置

通用配置格式：

```json
{
  "mcp": {
    "ssh-mcp": {
      "type": "local",
      "command": ["node", "/path/to/ssh-mcp/dist/index.js"],
      "enabled": true
    }
  }
}
```

## SSH 配置文件

创建 `ssh-mcp.config.json` 文件：

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

配置文件位置（按优先级）：
1. `SSH_MCP_CONFIG` 环境变量指定路径
2. 当前目录 `ssh-mcp.config.json`
3. 当前目录 `.ssh-mcp-config.json`
4. 用户主目录 `.ssh-mcp-config.json`

## 使用

```json
{
  "tool": "ssh_execute_command",
  "arguments": {
    "server": "production",
    "command": "docker ps"
  }
}
```

直接指定参数：

```json
{
  "tool": "ssh_upload_file",
  "arguments": {
    "host": "192.168.1.100",
    "port": 22,
    "username": "root",
    "password": "123",
    "local_path": "./config.yml",
    "remote_path": "/etc/app/config.yml"
  }
}
```

## 工具

| 工具 | 说明 |
|------|------|
| `ssh_list_servers` | 列出所有已配置的服务器 |
| `ssh_execute_command` | 执行命令 |
| `ssh_upload_file` | 上传文件 |
| `ssh_download_file` | 下载文件 |
| `ssh_upload_directory` | 上传目录 |
| `ssh_download_directory` | 下载目录 |
