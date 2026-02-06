// auth.js
// SQli version

const sqlite3 = require('sqlite3').verbose();
const bcrypt  = require('bcrypt');
const path    = require('path');

const DB_PATH = path.join(__dirname, 'users_hacked.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Could not open users_hacked.db', err.message);
    } else {
        console.log('Opened users_hacked.db');
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

// 1. VULNERABLE CREATE ACCOUNT (Stops hashing passwords)
async function handleCreateAccount(req, res) {
    const { username, email, first_name, last_name, password } = req.body;
    console.log('Create-account body:', {username, email, first_name, last_name, password });
    
    try {
        if (!username || !password || !email) {
            res.writeHead(400, {'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'All fields required' }));
        }

        // ❌ VULNERABILITY: Storing password in PLAIN TEXT (No bcrypt)
        // Ideally we would hash this, but we are removing it to demonstrate the SQLi impact easier.
        const passwordPlain = password; 

        const stmt = db.prepare(
            `INSERT INTO accounts (username, email, first_name, last_name, password_hash) 
             VALUES (?, ?, ?, ?, ?);`
        );

        stmt.run(username, email, first_name, last_name, passwordPlain, function (err) {
            if (err) {
                console.error('DB error on INSERT:', err.message);
                res.writeHead(500, {'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Error creating account' }));
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true }));
        });
        stmt.finalize();

    } catch (err) {
        console.error('Error in handleCreateAccount:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Internal Server Error' }));
    }
}

// 2. VULNERABLE SIGN IN (Checks password in SQL string)
async function handleSignIn(req, res) {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            res.writeHead(400, {'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: 'Missing credentials' }));
        }

        // VULNERABILITY: SQL Injection + Insecure Authentication Logic
        // We are checking the password INSIDE the query string.
        const query = `SELECT * FROM accounts WHERE username = '${username}' AND password_hash = '${password}'`;

        console.log(`[SQLi DEMO] Executing Query: ${query}`);

        db.get(query, (err, row) => {
            if (err) {
                console.error('DB error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Server Error' }));
            }

            if (!row) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Invalid username or password' }));
            }

            // If the SQL returns a row, we trust it immediately. No further checks.
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                success: true,
                username: row.username,
                account_id: row.id,
                email: row.email,
                first_name: row.first_name // This is where we will see the spilled data
            }));
        });

    } catch (err) {
        console.error('Error:', err);
        res.writeHead(500);
        res.end(JSON.stringify({ success: false }));
    }
}

async function handleForgotPassword(req, res) {
  try {
    const { username, first_name, last_name, email } = req.body;
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

async function handleUpdateAccount(req, res) {
    const {
        username,
        new_username,
        new_email,
        new_first_name,
        new_last_name,
        password
    } = req.body;

    // 1) Basic validation
    if (!username || !new_username || !new_email || !new_first_name || !new_last_name || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'All fields are required' }));
    }

    // 2) Look up account and verify current password
    db.get(
        'SELECT id, password_hash FROM accounts WHERE username = ?',
        [username],
        async (err, row) => {
            if (err) {
                console.error('DB error on update lookup:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Internal Server Error' }));
            }
            if (!row) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Account not found' }));
            }

            const match = await bcrypt.compare(password, row.password_hash);
            if (!match) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, message: 'Current password is incorrect' }));
            }

            // 3) Perform the atomic update
            const stmt = db.prepare(
                'UPDATE accounts SET username = ?, email = ?, first_name = ?, last_name = ? WHERE id = ?'
            );
            stmt.run(
                new_username,
                new_email,
                new_first_name,
                new_last_name,
                row.id,
                function (err) {
                    if (err && err.code === 'SQLITE_CONSTRAINT') {
                        const msg = /accounts\.username/.test(err.message)
                            ? 'That username is already taken'
                            : /accounts\.email/.test(err.message)
                                ? 'That email is already registered'
                                : 'That username or email is already in use';
                        res.writeHead(409, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: msg }));
                    } else if (err) {
                        console.error('DB error on update:', err);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false, message: 'Internal Server Error' }));
                    }

                    // 4) Success
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({
                        success:    true,
                        username:   new_username,
                        first_name: new_first_name,
                        last_name:  new_last_name,
                        email:      new_email
                    }));
                }
            );
            stmt.finalize();
        }
    );
}

module.exports = {
    handleCreateAccount,
    handleSignIn,
    handleForgotPassword,
    handleUpdateAccount
};

