const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'dist');
const port = Number(process.argv[2] || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const requested = path.resolve(root, `.${pathname}`);
  const safePath = requested.startsWith(root) && fs.existsSync(requested) && fs.statSync(requested).isFile()
    ? requested
    : path.join(root, 'index.html');
  response.setHeader('Content-Type', mime[path.extname(safePath)] || 'application/octet-stream');
  fs.createReadStream(safePath).pipe(response);
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`H5 preview: http://127.0.0.1:${port}\n`);
});
