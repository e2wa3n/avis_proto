// server.js
const http       = require('http');
const express    = require('express');
// const bodyParser = require('body-parser');
const fs         = require('fs');
const path       = require('path');
const bcrypt     = require('bcrypt');
const chokidar   = require('chokidar');
const WebSocket  = require('ws');

const { handleCreateAccount, handleSignIn, handleForgotPassword, handleUpdateAccount, parseFormBody } = require('./auth.js');

const sqlite3 = require('sqlite3').verbose();
const DB_PATH = path.join(__dirname, 'users.db');
const db = new sqlite3.Database(DB_PATH, err => {
    if (err) {
        console.error('Could not open users.db:', err.message);
    } else {
        db.run('PRAGMA foreign_keys = ON;');
    }
});

const app = express()
app.use(express.json());

const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });

const get = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject (err);
            else resolve(row);
        });
    });

const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

// Ingest endpoint - UDP listener will POST here
app.post('/api/ingest', async (req, res) => {
    const p = req.body;

    if (p.temperature != null) p.temp = p.temperature;
    if (p.humidity != null) p.humid = p.humidity
    if (!p.session_id || !p.node_id || !p.time_stamp) throw new Error('Missing required ingestion fields');

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
                // look up the most recent node_session_id
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
                    throw new Error(
                        `No active node_session for session=${p.session_id} node=${p.node_id}`
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
                        VALUES (?, ?, ?, ?, ?)`,
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
                    // must have a node_session before you can record a bird
                    throw new Error(
                        `No active node_session for session=${p.session_id} node=${p.node_id}`
                    );
                }
                
                // 1 try to find the latest weather at or before this bird
                let weatherInstanceId = await new Promise((resolve, reject) => {
                    db.get(
                        `SELECT weather_instance_id
                         FROM weather_instances
                         WHERE node_session_id = ?
                         AND timestamp <= ?
                         ORDER BY timestamp DESC
                         LIMIT 1`,
                        [ nodeSessionId, p.time_stamp ],
                        (err, row) => err ? reject(err) : resolve(row && row.weather_instance_id)
                    );
                });

                // 2 if none found, fall back to the overall most-recent weather_instance
                if (!weatherInstanceId) {
                    console.warn(
                        `No weather ≤ ${p.time_stamp}, ` +
                        `falling back to most recent weather for node_session_id=${nodeSessionId}`
                    );
                    const fallbackRow = await new Promise((resolve, reject) => {
                        db.get(
                            `SELECT weather_instance_id
                             FROM weather_instances
                             WHERE node_session_id = ?
                             ORDER BY timestamp DESC
                             LIMIT 1`,
                            [ nodeSessionId ],
                            (err, row) => err ? reject(err) : resolve(row)
                        );
                    });
                    weatherInstanceId = fallbackRow && fallbackRow.weather_instance_id;
                }
                // 3 still none? REAL error
                if (!weatherInstanceId) {
                    // must have a weather_instance before you can record a bird
                    throw new Error(
                        `No weather data at all for node_session_id=${nodeSessionId}`
                    );
                }

                // insert the bird
                const species = p.common_name || '';
                const confidence = p.confidence_level != null ? p.confidence_level : 0;
                await run(
                    `INSERT INTO bird_instances
                     (weather_instance_id, node_session_id, timestamp, species, confidence_level)
                     VALUES (?, ?, ?, ?, ?)`,
                    [ weatherInstanceId, nodeSessionId, p.time_stamp, species, confidence ]
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

// --- DEVICE API ENDPOINTS ---

// This endpoint registers a device and links it to a user.
// The frontend will send a request here when the user fills out the "Register Device" form.
app.post('/devices', async (req, res) => {
    // 1. Get the account ID and device EUI from the request.
    const { account_id, devEUI } = req.body;
    if (!account_id || !devEUI) {
        return res.status(400).json({ message: 'account_id and devEUI are required.' });
    }

    try {
        // 2. Add the device to the main `devices` table.
        // `INSERT OR IGNORE` means it won't crash if the device already exists.
        await run(`INSERT OR IGNORE INTO devices (devEUI) VALUES (?)`, [devEUI]);
        
        // 3. Find the device's primary key (`device_id`).
        const device = await get(`SELECT device_id FROM devices WHERE devEUI = ?`, [devEUI]);
        if (!device) {
            throw new Error('Failed to create or find device in the devices table.');
        }

        // 4. Create the link between the user and the device in the `user_devices` table.
        await run(
            `INSERT INTO user_devices (account_id, device_id) VALUES (?, ?)`,
            [account_id, device.device_id]
        );
        
        // 5. Send a success message back to the frontend.
        res.status(201).json({ success: true, message: 'Device registered and linked successfully.' });

    } catch (err) {
        // This handles specific errors, like if the user tries to link the same device twice.
        if (err.message.includes('UNIQUE constraint failed: user_devices.account_id, user_devices.device_id')) {
            return res.status(409).json({ message: 'This device is already linked to your account.' });
        }
        // This handles any other unexpected errors.
        console.error('Device registration error:', err.message);
        res.status(500).json({ message: 'Server error during device registration.' });
    }
});

// This endpoint gets all devices linked to a specific user.
// The frontend will use this to show the user a list of their registered devices.
app.get('/devices', async (req, res) => {
    // 1. Get the user's account ID from the URL's query string (e.g., /devices?account_id=123)
    const { account_id } = req.query;
    if (!account_id) {
        return res.status(400).json({ message: 'account_id is required.' });
    }

    try {
        // 2. Run a database query to find all devices linked to this user.
        // It JOINS three tables to connect accounts to devices via the user_devices table.
        const devices = await all(
            `SELECT d.device_id, d.devEUI, d.enclosureID FROM devices d
             JOIN user_devices ud ON d.device_id = ud.device_id
             WHERE ud.account_id = ?`,
            [account_id]
        );
        // 3. Send the list of found devices back to the frontend as JSON.
        res.json(devices);
    } catch (err) {
        console.error('Get devices error:', err.message);
        res.status(500).json({ message: 'Server error fetching devices.' });
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
    
    //app.use((req, res) => server.emit('request', req, res));

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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT} (HTTP & ingest)`);
});

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
