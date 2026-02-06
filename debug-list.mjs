import { createConnection, closeConnection } from './dist/utils/ssh.js';
import { executeCommand } from './dist/utils/ssh.js';

async function listRemoteDir(conn, remotePath) {
  const command = `ls -1 "${remotePath}"`;
  const result = await executeCommand(conn, command);

  const lines = result.stdout.trim().split('\n').filter(line => line.length > 0);
  console.log('ls -1 输出行数:', lines.length);
  console.log('ls -1 内容:', JSON.stringify(lines, null, 2));

  const items = [];

  for (const name of lines) {
    if (!name || name === '.' || name === '..') continue;
    
    // Check if it's a file or directory using test command
    const testCmd = `test -d "${remotePath}/${name}" && echo "dir" || echo "file"`;
    const testResult = await executeCommand(conn, testCmd);
    const type = testResult.stdout.trim() === 'dir' ? 'directory' : 'file';
    
    console.log(`项目 "${name}" 类型:`, type);
    
    items.push({ name, type });
  }

  return items;
}

async function test() {
  const conn = await createConnection({
    host: '192.168.100.133',
    port: 22,
    username: 'root',
    password: '123',
    timeout: 30000
  });
  
  console.log('=== 调试 listRemoteDir ===\n');
  
  console.log('1. 顶级目录 /tmp/ssh-mcp-test-dir:');
  const items1 = await listRemoteDir(conn, '/tmp/ssh-mcp-test-dir');
  console.log('找到的项:', JSON.stringify(items1, null, 2));
  
  console.log('\n2. 子目录 /tmp/ssh-mcp-test-dir/subdir:');
  const items2 = await listRemoteDir(conn, '/tmp/ssh-mcp-test-dir/subdir');
  console.log('找到的项:', JSON.stringify(items2, null, 2));
  
  console.log('\n3. 深层目录 /tmp/ssh-mcp-test-dir/subdir/deep:');
  const items3 = await listRemoteDir(conn, '/tmp/ssh-mcp-test-dir/subdir/deep');
  console.log('找到的项:', JSON.stringify(items3, null, 2));
  
  closeConnection(conn);
}

test().catch(err => {
  console.error('\n✗ 错误:', err.message);
  process.exit(1);
});
