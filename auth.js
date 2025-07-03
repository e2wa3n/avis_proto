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
        email TEXT UNIQUE NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
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
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            const params = new URLSearchParams(body);
            const obj = {};
            for (const [k, v] of params.entries()) obj[k] = v.trim();
            resolve(obj);
        });
        req.on('error', reject);
    });
}

async function handleCreateAccount(req, res) {
    const { username, email, first_name, last_name, password } = await parseFormBody(req);
    console.log('Create-account body:', {username, email, first_name, last_name, password });
    try {
        if (!username || !password) {
            res.writeHead(400, {'Content-Type': 'application/json' });
            return res.end(
                JSON.stringify({
                    success: false,
                    message: 'Username and password are required'
                })
            );
        }

        if (!email) {
            res.writeHead(400, {'Content-Type':'application/json'});
            return res.end(JSON.stringify({
                success: false,
                message: 'Email is required'
            }));
        }

        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const stmt = db.prepare(
            `INSERT INTO accounts (username, email, first_name, last_name, password_hash) 
                VALUES (?, ?, ?, ?, ?);`
        );

        stmt.run(username, email, first_name, last_name, passwordHash, function (err) {
            if (err) {
                if (err.code === 'SQLITE_CONSTRAINT') {
                    const msg = /accounts\.username/.test(err.message)
                        ? 'That username is already taken'
                        : /accounts\.email/.test(err.message)
                            ? 'That email is already registered'
                            : 'That username or email is already in use';
                    res.writeHead(409, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({
                        success: false,
                        message: msg
                    }));
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
            `SELECT id AS account_id,
                password_hash,
                date_created
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
                    username: username,
                    account_id: row.account_id,
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

async function handleForgotPassword(req, res) {
  try {
    const { username, first_name, last_name, email } = await parseFormBody(req);
    if (!username || !first_name || !last_name || !email) {
      res.writeHead(400, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ success: false, message: 'All fields are required' }));
    }

    db.get(
      `SELECT id FROM accounts
       WHERE username = ? AND email = ? AND first_name = ? AND last_name = ?;`,
      [username, email, first_name, last_name],
      (err, row) => {
        if (err) {
          console.error('DB error on forgot-password:', err.message);
          res.writeHead(500, {'Content-Type':'application/json'});
          return res.end(JSON.stringify({ success: false, message: 'Internal Server Error' }));
        }
        if (!row) {
          res.writeHead(404, {'Content-Type':'application/json'});
          return res.end(JSON.stringify({ success: false, message: 'Account not found or details incorrect' }));
        }
        // match! let the client redirect them:
        res.writeHead(200, {'Content-Type':'application/json'});
        return res.end(JSON.stringify({ success: true }));
      }
    );
  } catch (err) {
    console.error('Error in handleForgotPassword:', err);
    res.writeHead(500, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ success: false, message: 'Server Error' }));
  }
}

module.exports = {
    handleCreateAccount,
    handleSignIn,
    handleForgotPassword,
    parseFormBody
};

