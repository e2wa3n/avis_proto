// server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const WebSocket = require('ws');

const PORT = 3000;
const WS_PORT = 35729;

const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js' : 'application/javascript',
};

const server = http.createServer((req, res) => {
    let file = req.url === '/' ? '/index.html' : req.url;
    let filePath = path.join(__dirname, file);
    let ext = path.extname(filePath);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            return res.end('404 Not Found');
        }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
        res.end(data);
    });
});

server.listen(PORT, () =>
    console.log(`HTTP: http://localhost:${PORT}`)
);

const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`WS: ws://localhost:${WS_PORT}`);

const watcher = chokidar.watch(['./index.html','.styles.css', './scripts.js']);
watcher.on('change', (filePath) => {
    console.log(`File changed: ${filePath}, reloading browser...`);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send('reload');
        }
    });
});
