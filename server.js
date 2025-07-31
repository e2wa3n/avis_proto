// server.js
const http       = require('http');
const express    = require('express');
const bodyParser = require('body-parser');
const fs         = require('fs');
const path       = require('path');
const bcrypt     = require('bcrypt');
const chokidar   = require('chokidar');
const WebSocket  = require('ws');

const { handleCreateAccount, handleSignIn, handleForgotPassword, handleUpdateAccount, parseFormBody } = require('./auth.js');

const sqlite3 = require('sqlite3').verbose();
const DB_PATH = path.join(__dirname, 'users.db');
const db = new sqlite3.Database(DB_PATH, err => {
    if (err) console.error('Could not open users.db for sessions:', err.message);
});

const app = express();
app.use(bodyParser.json());

const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });

// Ingest endpoint - UDP listener will POST here
app.post('/api/ingest', async (req, res) => {
    const p = req.body;
    try {
        switch (p.type) {
            case 3: {
                //avoid inserting duplicate sessions for the same timestamp
                const existingSession = await new Promise((resolve, reject) => {
                    db.get(
                        `SELECT node_session_id
                        FROM node_sessions
                        WHERE session_id = ?
                        AND enclosure_id = ?
                        AND activation_timestamp = ?
                        LIMIT 1`,
                        [ p.session_id, p.node_id, p.time_stamp ],
                        (err, row) => err ? reject(err) : resolve(row && row.node_session_id)
                    );
                });
                if (!existingSession) {
                    await run(
                        `INSERT INTO node_sessions
                        (session_id, enclosure_id, altitude, lat, lng, activation_timestamp)
                        VALUES (?, ?, ?, ?, ?, ?)`,
                        [ p.session_id, p.node_id, p.altitude, p.lat, p.long, p.time_stamp ]
                    );
                } else {
                    console.log(
                        `Skipping duplicate node_session: ` +
                        `session_id=${p.session_id}, enclosure_id=${p.node_id}, ` +
                        `activation_timestamp=${p.time_stamp}`
                    );
                }
                break;
            }

            case 2: {
                // look up the most recent node_session_id (or create a blank one)
                let nodeSessionId = await new Promise((resolve, reject) => {
                    db.get(
                        `SELECT node_session_id
                        FROM node_sessions
                        WHERE session_id = ?
                        AND enclosure_id = ?
                        ORDER BY activation_timestamp DESC
                        LIMIT 1`,
                        [ p.session_id, p.node_id ],
                        (err, row) => err ? reject(err) : resolve(row && row.node_session_id)
                    );
                });
                if (!nodeSessionId) {
                    console.warn(
                        `No active node_session for session=${p.session_id}, node=${p.node_id}; ` +
                        `inserting blank placeholder.`
                    );
                    nodeSessionId = await run(
                        `INSERT INTO node_sessions
                        (session_id, enclosure_id, altitude, lat, lng, activation_timestamp)
                        VALUES (?, ?, ?, ?, ?, ?)`,
                        [ p.session_id, p.node_id, 0, 0, 0, p.timestamp ]
                    );
                }

                // check for an existing weather_instance at that timestamp
                const existingWeather = await new Promise((resolve, reject) => {
                    db.get(
                        `SELECT weather_instance_id
                        FROM weather_instances
                        WHERE node_session_id = ?
                        AND timestamp = ?
                        LIMIT 1`,
                        [ nodeSessionId, p.time_stamp ],
                        (err, row) => err ? reject(err) : resolve(row && row.weather_instance_id)
                    );
                });

                // insert only if its not there
                if (!existingWeather) {
                    await run(
                        `INSERT INTO weather_instances
                        (node_session_id, timestamp, temperature, humidity, pressure)
                        VALUES (?, ?, ?, ?, ?, ?)`,
                        [ nodeSessionId, p.time_stamp, p.temp, p.humid, p.b_pressure ]
                    );
                } else {
                    console.log(
                        `Skipping duplicate weather_instance: ` +
                        `node_session_id=${nodeSessionId}, timestamp=${p.time_stamp}`
                    );
                }
                break;
            }

            case 1: {
                await run(
                    `INSERT INTO bird_instances
                        (weather_instance_id, node_session_id, timestamp, species, confidence_level)
                    VALUES (
                        (SELECT weather_instance_id
                        FROM weather_instances
                        WHERE node_session_id = (
                        SELECT node_session_id
                        FROM node_sessions
                        WHERE session_id = ? AND enclosure_id = ?
                        ORDER BY activation_timestamp DESC
                        LIMIT 1
                        )
                        ORDER BY timestamp DESC
                        LIMIT 1
                    ),
                    (SELECT node_session_id
                    FROM node_sessions
                    WHERE session_id = ? AND enclosure_id = ?
                    ORDER BY activation_timestamp DESC
                    LIMIT 1
                    ),
                    ?, ?, ?
                    )`,
                    [
                        p.session_id, p.node_id,
                        p.session_id, p.node_id,
                        p.time_stamp, p.common_name, p.confidence_level
                    ]
                );
                break;
            }
            default:
                throw new Error(`Unknown type: ${p.type}`);
        }
        res.json({ status: 'ok' });
    }   catch (err) {
        console.error('INGEST ERROR:', err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.use((req, res) => server.emit('request', req, res));

const PORT    = 3000;
const WS_PORT = 35729;

const mimeTypes = {
    '.html': 'text/html',
    '.css' : 'text/css',
    '.js'  : 'application/javascript',
};

const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);

    // — GET /sessions?account_id=...
    if (req.method === 'GET' && urlObj.pathname === '/sessions') {
        const accountId = urlObj.searchParams.get('account_id');
        if (!accountId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'account_id is required' }));
        }
        return db.all(
            'SELECT session_id AS id, p_name AS name, p_date AS date_created FROM sessions WHERE account_id = ?;',
            [accountId],
            (err, rows) => {
                if (err) {
                    console.error('DB error on SELECT sessions:', err.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: false, message: 'Internal Server Error' }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(rows));
            }
        );
    }

    // — POST /sessions
    if (req.method === 'POST' && urlObj.pathname === '/sessions') {
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
                'INSERT INTO sessions (account_id, p_name) VALUES (?, ?);',
                [account_id, name],
                function(err) {
                    if (err) {
                        console.error('DB error on INSERT session:', err.message);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Internal Server Error' }));
                    }
                    res.writeHead(201, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true, session_id: this.lastID }));
                }
            );
        });
        return;
    }

    // — DELETE /sessions/:id
    if (req.method === 'DELETE' && urlObj.pathname.startsWith('/sessions/')) {
        const sessionId = urlObj.pathname.split('/')[2];
        db.run(
            'DELETE FROM sessions WHERE session_id = ?;',
            [sessionId],
            function(err) {
                if (err) {
                    console.error('DB error on DELETE sessions:', err.message);
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

    // — GET /sessions/:id
    if (req.method === 'GET' && /^\/sessions\/\d+$/.test(urlObj.pathname)) {
        const sessionId = urlObj.pathname.split('/')[2];
        return db.get(
            'SELECT session_id AS id, p_name AS name, p_date AS date_created FROM sessions WHERE session_id = ?;',
            [sessionId],
            (err, row) => {
                if (err) {
                    console.error('DB error on SELECT session:', err.message);
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

app.listen(PORT, '0.0.0.0', () => 
    console.log(`Server listening on http://0.0.0.0:${PORT} (HTTP & ingest)`));

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
