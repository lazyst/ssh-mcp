---
name: agent-ssh
description: "SSH remote management via CLI — execute commands, transfer files/directories to/from remote SSH servers. Use when the user needs to: (1) Run commands on a remote server, (2) Upload or download files/directories via SSH, (3) Manage servers defined in a config file, (4) Run as an MCP server for AI agent integration. The `agent-ssh` package must be installed globally via npm."
---

# agent-ssh

## 前置检查

使用前先检测 `agent-ssh` 是否可用，不可用时提示用户安装：

```bash
# 检测是否可用
if command -v agent-ssh &>/dev/null; then
  echo "agent-ssh is available"
else
  echo "agent-ssh not found"
fi
```

如果不可用，提示用户：`npm install -g agent-ssh`

验证安装：`agent-ssh --version`

## 配置文件

在工作目录下创建 `.agent-ssh/config.json`：

```json
{
  "servers": {
    "my-server": {
      "host": "192.168.1.100",
      "port": 22,
      "username": "root",
      "password": "your_password",
      "timeout": 30000
    }
  },
  "defaultServer": "my-server"
}
```

- `password` 和 `privateKey` 二选一
- 配置文件搜索顺序：环境变量 `AGENT_SSH_CONFIG` > `.agent-ssh/config.json` (CWD)

**如果配置文件不存在**，可以自动创建模板：

```bash
mkdir -p .agent-ssh
# 写入模板内容
```

## CLI 命令

### 执行命令

```bash
# 使用配置文件中的服务器
agent-ssh exec "df -h" -s my-server

# 直接指定连接参数
agent-ssh exec "ls -la" -H 192.168.1.100 -u root -p password

# 指定工作目录
agent-ssh exec "npm run build" -s my-server --cwd /var/www/app

# JSON 格式输出
agent-ssh exec "uname -a" -s my-server --json
```

### 文件传输

```bash
# 上传文件
agent-ssh upload ./local.txt /remote/path.txt -s my-server

# 下载文件
agent-ssh download /remote/file.txt ./local/ -s my-server

# 上传目录
agent-ssh upload-dir ./dist /var/www/app -s my-server

# 下载目录
agent-ssh download-dir /remote/logs ./logs/ -s my-server
```

### 列出服务器

```bash
agent-ssh list-servers
agent-ssh list-servers --json
```

## MCP Server 模式

作为 MCP Server 供 AI Agent 使用：

```bash
agent-ssh --mcp
```

MCP 客户端配置：

```json
{
  "mcpServers": {
    "agent-ssh": {
      "command": "agent-ssh",
      "args": ["--mcp"]
    }
  }
}
```

MCP 模式下注册的工具：

| 工具名 | 功能 |
|---|---|
| `ssh_execute_command` | 执行命令 |
| `ssh_upload_file` | 上传文件 |
| `ssh_download_file` | 下载文件 |
| `ssh_upload_directory` | 上传目录 |
| `ssh_download_directory` | 下载目录 |
| `ssh_list_servers` | 列出服务器 |
