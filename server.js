// server.js
const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const bcrypt    = require('bcrypt');
const chokidar  = require('chokidar');
const WebSocket = require('ws');

const { handleCreateAccount, handleSignIn, handleForgotPassword, handleUpdateAccount, parseFormBody } = require('./auth.js');

const sqlite3 = require('sqlite3').verbose();
const DB_PATH = path.join(__dirname, 'users.db');
const db = new sqlite3.Database(DB_PATH, err => {
    if (err) console.error('Could not open users.db for projects:', err.message);
});

const PORT    = 3000;
const WS_PORT = 35729;

const mimeTypes = {
    '.html': 'text/html',
    '.css' : 'text/css',
    '.js'  : 'application/javascript',
};

const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);

    // — GET /projects?account_id=...
    if (req.method === 'GET' && urlObj.pathname === '/projects') {
        const accountId = urlObj.searchParams.get('account_id');
        if (!accountId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'account_id is required' }));
        }
        return db.all(
            'SELECT id, name, date_created FROM projects WHERE account_id = ?;',
            [accountId],
            (err, rows) => {
                if (err) {
                    console.error('DB error on SELECT projects:', err.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: 'Internal Server Error' }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(rows));
            }
        );
    }

    // — POST /projects
    if (req.method === 'POST' && urlObj.pathname === '/projects') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            let payload;
            try {
                payload = JSON.parse(body);
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success:false, message: 'Invalid JSON' }));
            }
            const { account_id, name } = payload;
            if (!account_id || !name) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'account_id and name are required' }));
            }
            db.run(
                'INSERT INTO projects (account_id, name) VALUES (?, ?);',
                [account_id, name],
                function(err) {
                    if (err) {
                        console.error('DB error on INSERT project:', err.message);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Internal Server Error' }));
                    }
                    res.writeHead(201, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true, project_id: this.lastID }));
                }
            );
        });
        return;
    }

    // — DELETE /projects/:id
    if (req.method === 'DELETE' && urlObj.pathname.startsWith('/projects/')) {
        const projId = urlObj.pathname.split('/')[2];
        db.run(
            'DELETE FROM projects WHERE id = ?;',
            [projId],
            function(err) {
                if (err) {
                    console.error('DB error on DELETE projects:', err.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: 'Internal Server Error' }));
                }
                res.writeHead(204);
                return res.end();
            }
        );
        return;
    }

    // — Authentication routes
    if (req.method === 'POST' && urlObj.pathname === '/create-account') {
        return handleCreateAccount(req, res);
    }
    if (req.method === 'POST' && urlObj.pathname === '/sign-in') {
        return handleSignIn(req, res);
    }

    // — Change Password route
    if (req.method === 'POST' && urlObj.pathname === '/change-password') {
        try {
            const { username, password: newPassword } = await parseFormBody(req);
            if (!username || !newPassword) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Missing data' }));
            }
            const hash = await bcrypt.hash(newPassword, 10);
            db.run(
                'UPDATE accounts SET password_hash = ? WHERE username = ?',
                [hash, username],
                function(err) {
                    if (err) {
                        console.error('DB error on CHANGE-PASSWORD:', err.message);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'DB error' }));
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true }));
                }
            );
        } catch (err) {
            console.error('Server error on CHANGE-PASSWORD:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Server error' }));
        }
        return;
    }

    if (req.method === 'GET' && urlObj.pathname === '/account') {
        const username = urlObj.searchParams.get('username');
        if (!username) {
            res.writeHead(400, {'Content-Type':'application/json'});
            return res.end(JSON.stringify({success: false, message: 'username required' }));
        }
        const sql = 'SELECT username, first_name, last_name, email, date_created FROM accounts WHERE username = ?';
        return db.get(sql, [username], (err, row) => {
            if (err) {
                console.error('DB error on GET /account:', err);
                res.writeHead(500, {'Content-Type':'application/json'});
                return res.end(JSON.stringify({success: false, message: 'DB error' }));
            }
            if (!row) {
                res.writeHead(404, {'Content-Type':'application/json'});
                    return res.end(JSON.stringify({sucess: false, message: 'DB error'}));
            }
            res.writeHead(200, {'Content-Type':'application/json'});
            return res.end(JSON.stringify(row));
        });
    }

    if (req.method === 'POST' && urlObj.pathname === '/update-account') {
        return handleUpdateAccount(req, res);
    }

    // — GET /projects/:id
    if (req.method === 'GET' && /^\/projects\/\d+$/.test(urlObj.pathname)) {
        const projId = urlObj.pathname.split('/')[2];
        return db.get(
            'SELECT id, name, date_created FROM projects WHERE id = ?;',
            [projId],
            (err, row) => {
                if (err) {
                    console.error('DB error on SELECT project:', err.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: 'Internal Server Error' }));
                }
                if (!row) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: 'Not Found' }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(row));
            }
        );
    }

    if (req.method === 'POST' && urlObj.pathname === '/forgot-password') {
        return handleForgotPassword(req, res);
    }

    // — Static file serving
    const pathname = urlObj.pathname;
    const file     = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.join(__dirname, file);
    const ext      = path.extname(filePath);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            return res.end('404 Not Found');
        }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
        return res.end(data);
    });
});

server.listen(PORT, () => console.log(`HTTP: http://localhost:${PORT}`));

const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`WS: ws://localhost:${WS_PORT}`);

const watcher = chokidar.watch(['./index.html','./styles.css','./scripts.js']);
watcher.on('change', filePath => {
    console.log(`File changed: ${filePath}, reloading browser...`);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send('reload');
        }
    });
});
