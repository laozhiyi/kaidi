'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const file = path.join(__dirname, 'order-receipt-preview.html');
http.createServer((request, response) => {
 if (request.url === '/' || request.url === '/order-receipt-preview.html') {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(fs.readFileSync(file));
 } else { response.writeHead(404); response.end(); }
}).listen(0, '127.0.0.1', function () {
 console.log('Receipt preview: http://127.0.0.1:' + this.address().port + '/');
});
