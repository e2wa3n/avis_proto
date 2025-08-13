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
app.use(express.urlencoded({ extended: true })); // For parsing HTML form data
app.use(express.static(__dirname)); // For serving index.html, styles.css, etc.

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

// SESSION API ENDPOINTS
app.get('/sessions', async (req, res) => {
    const { account_id } = req.query;
    if (!account_id) {
        return res.status(400).json({ success: false, message: 'account_id is required' });
    }
    try {
        const rows = await all(
            'SELECT session_id AS id, p_name AS name, p_date AS date_created FROM sessions WHERE account_id = ?;',
            [account_id]
        );
        res.json(rows);
    } catch (err) {
        console.error('DB error on SELECT sessions:', err.message);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

app.post('/sessions', async (req, res) => {
    // It now expects a device_id along with the other data
    const { account_id, name, device_id } = req.body;
    if (!account_id || !name || !device_id) {
        return res.status(400).json({ success: false, message: 'account_id, name, and device_id are required.' });
    }
    try {
        // Step 1: Create the main session entry
        const sessionId = await run(
            'INSERT INTO sessions (account_id, p_name) VALUES (?, ?);',
            [account_id, name]
        );

        // Step 2: Link the chosen device to this new session
        await run(
            'INSERT INTO session_devices (session_id, device_id) VALUES (?, ?);',
            [sessionId, device_id]
        );

        res.status(201).json({ success: true, session_id: sessionId });
    } catch (err) {
        console.error('DB error on INSERT session:', err.message);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

app.delete('/sessions/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await run('DELETE FROM sessions WHERE session_id = ?;', [id]);
        res.status(204).end(); // 204 No Content is standard for a successful delete
    } catch (err) {
        console.error('DB error on DELETE sessions:', err.message);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

app.get('/sessions/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const row = await get(
            'SELECT session_id AS id, p_name AS name, p_date AS date_created FROM sessions WHERE session_id = ?;',
            [id]
        );
        if (!row) {
            return res.status(404).json({ success: false, message: 'Not Found' });
        }
        res.json(row);
    } catch (err) {
        console.error('DB error on SELECT session:', err.message);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

// --- AUTHENTICATION & ACCOUNT ROUTES (Converted) ---
app.post('/create-account', handleCreateAccount);
app.post('/sign-in', handleSignIn);
app.post('/forgot-password', handleForgotPassword);
app.post('/update-account', handleUpdateAccount);

app.post('/change-password', async (req, res) => {
    const { username, password: newPassword } = req.body;
    if (!username || !newPassword) {
        return res.status(400).json({ success: false, message: 'Missing data' });
    }
    try {
        const hash = await bcrypt.hash(newPassword, 10);
        await run(
            'UPDATE accounts SET password_hash = ? WHERE username = ?',
            [hash, username]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('DB error on CHANGE-PASSWORD:', err.message);
        res.status(500).json({ success: false, message: 'DB error' });
    }
});

app.get('/account', async (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ success: false, message: 'username required' });
    }
    try {
        const sql = 'SELECT id, username, first_name, last_name, email, date_created FROM accounts WHERE username = ?';
        const row = await get(sql, [username]);
        if (!row) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        res.json(row);
    } catch (err) {
        console.error('DB error on GET /account:', err);
        res.status(500).json({ success: false, message: 'DB error' });
    }
});

const mimeTypes = {
    '.html': 'text/html',
    '.css' : 'text/css',
    '.js'  : 'application/javascript',
};

const PORT = 3000;
const WS_PORT = 35729;
// Create the HTTP server from our Express app
const server = http.createServer(app);

// Attach the WebSocket server to the *same* HTTP server
const wss = new WebSocket.Server({ server });
console.log(`WebSocket server is running.`);

// Start the server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT} (HTTP, ingest, and WebSocket)`);
});

