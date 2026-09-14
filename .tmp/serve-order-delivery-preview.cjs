'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const preview = path.join(__dirname, 'order-delivery-preview.html');
http.createServer((req, res) => {
 if (req.url.split('?')[0] !== '/') { res.writeHead(404); res.end(); return; }
 res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
 res.end(fs.readFileSync(preview));
}).listen(8767, '127.0.0.1', () => console.log('Order delivery preview: http://127.0.0.1:8767'));
