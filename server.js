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
    
    //uncomment line below to print ingested .jsons
    //console.log('--- INGEST PAYLOAD RECEIVED ---', req.body);

    const p = req.body;

    // The LoRa packet's 'node_id' MUST match the 'devEUI' in the database.
    const deviceEUI = p.node_id;

    if (!deviceEUI) {
        return res.status(400).json({ message: 'Missing node_id in payload' });
    }

    try {
        // Step 1: Find the active, open session associated with this device.
        // An active session is one that has NOT been closed (`closed_at` is NULL).
        const sessionQuery = `
            SELECT s.session_id FROM sessions s
            JOIN session_devices sd ON s.session_id = sd.session_id
            JOIN devices d ON sd.device_id = d.device_id
            WHERE d.devEUI = ? AND s.closed_at IS NULL
            ORDER BY s.p_date DESC
            LIMIT 1
        `;
        const activeSession = await get(sessionQuery, [deviceEUI]);

        if (!activeSession) {
            console.warn(`Data from device ${deviceEUI} received, but no active session found.`);
            return res.status(404).json({ message: 'No active session found for this device.' });
        }

        const { session_id } = activeSession;
        if (p.temperature != null) p.temp = p.temperature;
        if (p.humidity != null) p.humid = p.humidity;

        // The rest of the logic uses this `session_id`.
        switch (p.type) {
            case 3: { // GPS / Node Session Start
                // First, check if a node_session already exists for this session_id
                const existingNodeSession = await get(
                    `SELECT node_session_id FROM node_sessions WHERE session_id = ? LIMIT 1`,
                    [session_id]
                );

                // Only create a new node_session if one doesn't already exist.
                if (!existingNodeSession) {
                    await run(
                        `INSERT INTO node_sessions (session_id, enclosure_id, altitude, lat, lng, activation_timestamp)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [session_id, deviceEUI, p.altitude, p.lat, p.long, p.time_stamp]
                    );
                } else {
                    console.log(`Ignoring subsequent telemetry for active session_id: ${session_id}`);
                }
                break;
            }
            case 2: { // Weather
                const nodeSession = await get(`SELECT node_session_id FROM node_sessions WHERE session_id = ? ORDER BY activation_timestamp DESC LIMIT 1`, [session_id]);
                if (!nodeSession) throw new Error(`Cannot log weather, no node_session exists for session_id ${session_id}`);

                await run(
                    `INSERT INTO weather_instances (node_session_id, timestamp, temperature, humidity, pressure)
                     VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT(node_session_id, timestamp) DO NOTHING`, // Prevents duplicates
                    [nodeSession.node_session_id, p.time_stamp, p.temp, p.humid, p.b_pressure]
                );
                break;
            }
            case 1: { // Bird
                const nodeSession = await get(`SELECT node_session_id FROM node_sessions WHERE session_id = ? ORDER BY activation_timestamp DESC LIMIT 1`, [session_id]);
                if (!nodeSession) throw new Error(`Cannot log bird, no node_session exists for session_id ${session_id}`);

                // --- MODIFIED LOGIC START ---

                // 1. First, try to find the ideal weather instance (at or before the bird's timestamp)
                let weatherInstance = await get(
                    `SELECT weather_instance_id FROM weather_instances WHERE node_session_id = ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT 1`,
                    [nodeSession.node_session_id, p.time_stamp]
                );
                
                // 2. If none was found, fall back to the absolute most recent weather instance for this session.
                //    This makes the system resilient to small clock drifts.
                if (!weatherInstance) {
                    console.warn(`Could not find weather at or before ${p.time_stamp}. Falling back to most recent.`);
                    weatherInstance = await get(
                        `SELECT weather_instance_id FROM weather_instances WHERE node_session_id = ? ORDER BY timestamp DESC LIMIT 1`,
                        [nodeSession.node_session_id]
                    );
                }

                // 3. If there's STILL no weather data at all, then it's a real error.
                if (!weatherInstance) {
                    throw new Error(`Cannot log bird, no weather data found for node_session_id ${nodeSession.node_session_id}`);
                }

                // Define species and parse confidence from the label
                const species = p.common_name || 'Unknown';
                const confidenceLabel = p.confidence_label || '0%';
                const confidence = parseInt(confidenceLabel.split('-')[0], 10); // Extracts the first number from "86-90%"

                // Now run the insert with the corrected variables
                await run(
                    `INSERT INTO bird_instances (weather_instance_id, node_session_id, timestamp, species, confidence_level)
                    VALUES (?, ?, ?, ?, ?)`,
                    [weatherInstance.weather_instance_id, nodeSession.node_session_id, p.time_stamp, species, confidence]
                );
                break;
            }
            default:
                throw new Error(`Unknown type: ${p.type}`);
        }
        res.json({ status: 'ok' });
    } catch (err) {
        console.error('INGEST ERROR:', err.message);
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
            'SELECT session_id AS id, p_name AS name, p_date AS date_created, closed_at FROM sessions WHERE account_id = ?;',
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

        //bug finders
        console.log(`--- SERVER DATA FETCH ---`);
        console.log(`Fetching data for Session ID: ${id}`);
        console.log(`Weather records found in DB: ${weather.length}`);
        console.log(`-------------------------`);
        //bug finders

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

app.put('/sessions/:id/close', async (req, res) => {
    const { id } = req.params;
    try {
        await run(
            `UPDATE sessions SET closed_at = CURRENT_TIMESTAMP WHERE session_id = ?`,
            [id]
        );
        res.status(200).json({ success: true, message: 'Session closed.' });
    } catch (err) {
        console.error(`Error closing session ${id}:`, err.message);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.get('/sessions/:id/data', async (req, res) => {
    const { id } = req.params;
    try {
        // Run all queries concurrently for better performance
        const [sessionDetails, nodeSessions, weather, birds] = await Promise.all([
            get(`SELECT session_id, p_name, p_date, closed_at FROM sessions WHERE session_id = ?`, [id]),
            all(`SELECT * FROM node_sessions WHERE session_id = ? ORDER BY activation_timestamp`, [id]),
            all(`SELECT w.* FROM weather_instances w JOIN node_sessions ns ON w.node_session_id = ns.node_session_id WHERE ns.session_id = ? ORDER BY w.timestamp`, [id]),
            all(`SELECT b.* FROM bird_instances b JOIN node_sessions ns ON b.node_session_id = ns.node_session_id WHERE ns.session_id = ? ORDER BY b.timestamp`, [id])
        ]);

        if (!sessionDetails) {
            return res.status(404).json({ message: 'Session not found' });
        }

        res.json({
            details: sessionDetails,
            nodes: nodeSessions,
            weather: weather,
            birds: birds
        });

    } catch (err) {
        console.error(`Error fetching data for session ${id}:`, err);
        res.status(500).json({ message: 'Error fetching session data.' });
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

