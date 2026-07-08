/**
 * 启动全部服务：
 * - 8787: nc/telnet 纯终端桌
 * - 3001: WebSocket 服务器（网页端后端）
 * - 8080: 静态网页（Web 前端）
 */
const { TelnetPokerServer } = require('../src/telnet-server');
const { WsPokerServer } = require('../src/ws-server');
const { RoomManager } = require('../src/room-manager');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  // 共享 RoomManager，房间数据互通
  const manager = new RoomManager({ adminToken: 'admin', allowMultipleRooms: false });
  const adminToken = manager.adminToken;

  // 1. Telnet 服务器（端口 8787）
  const telnet = new TelnetPokerServer({ host: "0.0.0.0", port: 8787 });
  await telnet.listen();
  console.log(`✅ Telnet 服务: nc <ip> 8787`);

  // 2. WebSocket 服务器（端口 3001）
  const wsServer = new WsPokerServer({ host: "0.0.0.0", port: 3001, manager });
  await wsServer.listen();
  console.log(`✅ WebSocket 服务: ws://<ip>:3001`);

  // 3. 静态网页服务器（端口 8080）
  const distDir = path.join(__dirname, '..', 'web', 'dist');
  const mimeMap = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.woff2':'font/woff2',
  };
  const httpServer = http.createServer((req, res) => {
    let filePath = path.join(distDir, req.url === '/' ? 'index.html' : req.url);
    // SPA fallback
    if (!fs.existsSync(filePath)) filePath = path.join(distDir, 'index.html');
    const ext = path.extname(filePath);
    const contentType = mimeMap[ext] || 'application/octet-stream';
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
  httpServer.listen(8080, '0.0.0.0', () => {
    console.log(`✅ Web 前端: http://<ip>:8080`);
  });

  console.log('');
  console.log(`═══ 管理口令: ${adminToken} ═══`);
  console.log('');
}

main().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
