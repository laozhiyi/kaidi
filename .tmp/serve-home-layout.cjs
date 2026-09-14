'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const preview = path.join(__dirname, 'home-layout-preview.html');
http.createServer((req, res) => {
  if (req.url.split('?')[0] !== '/' && req.url.split('?')[0] !== '/home-layout-preview.html') {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(preview));
}).listen(8765, '127.0.0.1', () => console.log('Home layout preview: http://127.0.0.1:8765'));
