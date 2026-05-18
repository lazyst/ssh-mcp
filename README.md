# agents-ssh-cli

SSH 远程管理 CLI 工具，支持在远程服务器上执行命令和传输文件。可独立作为 CLI 使用，也可作为 MCP Server 运行。

## 安装

### 全局安装

```bash
npm install -g agents-ssh-cli
agents-ssh-cli --help
```

### 本地安装

```bash
npm install
npm run build
node dist/cli.js --help
```

### 本地 link（发布前）

```bash
npm link
agents-ssh-cli --help
```

## CLI 命令

| 命令 | 功能 |
|------|------|
| `exec <command>` | 远程执行命令 |
| `upload <local> <remote>` | 上传文件 |
| `download <remote> <local>` | 下载文件 |
| `upload-dir <local> <remote>` | 上传目录 |
| `download-dir <remote> <local>` | 下载目录 |
| `list-servers` | 列出已配置的服务器 |
| `serve` | 以 MCP Server 模式运行 |

### 使用示例

```bash
# 使用配置文件中的服务器
agents-ssh-cli exec "df -h" -s production
agents-ssh-cli upload ./file.txt /root/file.txt -s development
agents-ssh-cli download /var/log/app.log ./logs/ -s production
agents-ssh-cli list-servers

# 直接指定连接参数
agents-ssh-cli exec "ls -la" -H 192.168.1.100 -u root -p password
agents-ssh-cli upload ./deploy.sh /opt/deploy.sh -H 192.168.1.100 -u root --private-key ~/.ssh/id_rsa

# JSON 格式输出
agents-ssh-cli exec "uname -a" -s production --json
```

## 配置文件

创建 `.agents-ssh-cli/config.json` 在命令执行的目录下：

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
      "privateKey": "/path/to/id_rsa",
      "timeout": 30000
    }
  },
  "defaultServer": "development"
}
```

### 配置文件搜索顺序

1. `AGENTS_SSH_CLI_CONFIG` 环境变量指定路径
2. 当前目录下的 `.agents-ssh-cli/config.json`
3. 项目目录下的 `ssh-cli.config.json`
4. 当前目录下的 `ssh-cli.config.json`
5. 用户主目录下的 `.ssh-cli-config.json`

### 配置参数说明

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `host` | 是 | - | SSH 服务器地址 |
| `port` | 否 | 22 | SSH 端口 |
| `username` | 是 | - | 用户名 |
| `password` | 否 | - | 密码（与 privateKey 二选一） |
| `privateKey` | 否 | - | 私钥路径或内容（与 password 二选一） |
| `timeout` | 否 | 30000 | 超时时间（毫秒） |

## 认证方式

支持两种认证方式，`password` 和 `privateKey` 二选一即可：

**密码认证：**
```bash
agents-ssh-cli exec "ls" -H 192.168.1.100 -u root -p mypassword
```

**私钥认证：**
```bash
agents-ssh-cli exec "ls" -H 192.168.1.100 -u root -k ~/.ssh/id_rsa
```

## MCP Server 模式

保留完整的 MCP 协议兼容性，可作为 Agent 的 MCP Server 使用。

```bash
# 方式一：通过 CLI 启动
agents-ssh-cli serve

# 方式二：直接运行
node dist/index.js
```

### 可用 MCP 工具

| 工具 | 说明 |
|------|------|
| `ssh_list_servers` | 列出所有已配置的服务器 |
| `ssh_execute_command` | 执行命令 |
| `ssh_upload_file` | 上传文件 |
| `ssh_download_file` | 下载文件 |
| `ssh_upload_directory` | 上传目录 |
| `ssh_download_directory` | 下载目录 |

### MCP 客户端配置

```json
{
  "mcpServers": {
    "agents-ssh-cli": {
      "command": "node",
      "args": ["/path/to/agents-ssh-cli/dist/index.js"]
    }
  }
}
```


