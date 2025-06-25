// auth.js

const sqlite3 = require('sqlite3').verbose();
const bcrypt  = require('bcrypt');
const path    = require('path');

const DB_PATH = path.join(__dirname, 'users.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Could not open users.db', err.message);
    } else {
        console.log('Opened users.db');
    }
});

db.run(
    `CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        date_created DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    (err) => {
        if (err) console.error('Error creating accounts table:', err.message);
        else console.log('Accounts table ready');
    }
);

function parseFormBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString();
        });
        req.on('end', () => {

            const params = new URLSearchParams(body);
            resolve({
                username: params.get('username') || '',
                password: params.get('password') || ''
            });
        });
        req.on('error', (err) => reject(err));
    });
}

async function handleCreateAccount(req, res) {
    try {
        const { username, password } = await parseFormBody(req);
        if (!username || !password) {
            res.writeHead(400, {'Content-Type': 'application/json' });
            return res.end(
                JSON.stringify({
                    success: false,
                    message: 'Username and password are required'
                })
            );
        }

        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const stmt = db.prepare(
            `INSERT INTO accounts (username, password_hash) VALUES (?, ?);`
        );

        stmt.run(username, passwordHash, function (err) {
            if (err) {
                if (err.code === 'SQLITE_CONSTRAINT') {
                    res.writeHead(409, {'Content-Type': 'application/json' });
                    return res.end(
                        JSON.stringify({
                            success: false,
                            message: 'That username is already taken'
                        })
                    );
                }
                console.error('DB error on INSERT:', err.message);
                res.writeHead(500, {'Content-Type': 'application/json' });
                return res.end(
                    JSON.stringify({
                        success: false,
                        message: 'Internal Server Error'
                    })
                );
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true }));
        });
        stmt.finalize();
    }   catch (err) {
        console.error('Error in handleCreateAccount:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(
            JSON.stringify({
                success: false,
                message: 'Internal Server Error'
            })
        );
    }
}

async function handleSignIn(req, res) {
    try {
        const { username, password } = await parseFormBody(req);
        if (!username || !password) {
            res.writeHead(400, {'Content-Type': 'application/json' });
            return res.end(
                JSON.stringify({
                    success: false,
                    message: 'Username and password are required'
                })
            );
        }

        db.get(
            `SELECT password_hash, date_created
               FROM accounts
              WHERE username = ?;`,
            [username],
            async (err, row) => {
                if (err) {
                    console.error('DB error on SELECT:', err.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    return res.end(
                        JSON.stringify({
                            success: false,
                            message: 'Internal Server Error'
                        })
                    );
                }

                if (!row) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(
                        JSON.stringify({
                        success: false,
                        message: 'Invalid username or password'
                       })
                    );
                }



                const match = await bcrypt.compare(password, row.password_hash);
                if (!match) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(
                        JSON.stringify({
                            success: false,
                            message: 'Invalid username or password'
                        })
                    );
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({
                    success: true,
                    username,
                    date_created: row.date_created
                }));
            }
        );
    }   catch (err) {
        console.error('Error in handleSignIn', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
            JSON.stringify({
                success: false,
                message: 'Internal Server Error'
            })
        );
    }
}

module.exports = {
    handleCreateAccount,
    handleSignIn
};

