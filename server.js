const express = require('express');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const dbPath = path.join(__dirname, 'shelf.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to connect to database:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database.');
});

function hashPassword(password) {
  return crypto.pbkdf2Sync(password, 'shelf-it-salt', 100000, 64, 'sha512').toString('hex');
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function normalizeItem(row) {
  return {
    id: row.id,
    title: row.title,
    creator: row.creator,
    type: row.type,
    year: row.year || '—',
    color: row.color || 'plum',
    favorite: Boolean(row.favorite),
    added: row.added,
  };
}

function normalizeUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
  };
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  db.get('SELECT * FROM user_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) {
      return res.status(401).json({ error: 'Invalid or expired session.' });
    }

    db.get('SELECT id, name, email, created_at FROM users WHERE id = ?', [session.user_id], (userErr, user) => {
      if (userErr || !user) {
        return res.status(401).json({ error: 'User not found.' });
      }

      req.user = normalizeUser(user);
      next();
    });
  });
}

function initDb() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='media_items'", (err, tableRow) => {
      if (err) {
        console.error('Failed to inspect media_items table:', err.message);
        return;
      }

      if (!tableRow) {
        db.run(`
          CREATE TABLE media_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL DEFAULT 1,
            title TEXT NOT NULL,
            creator TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('book', 'movie', 'music')),
            year TEXT DEFAULT '—',
            color TEXT DEFAULT 'plum',
            favorite INTEGER DEFAULT 0,
            added TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
          )
        `);
      }

      db.all('PRAGMA table_info(media_items)', (pragmaErr, columns) => {
        if (pragmaErr) {
          console.error('PRAGMA table_info(media_items) failed:', pragmaErr.message);
          return;
        }

        const hasUserId = Array.isArray(columns) && columns.some((column) => column.name === 'user_id');

        if (!hasUserId) {
          db.run('ALTER TABLE media_items RENAME TO media_items_legacy', (renameErr) => {
            if (renameErr) {
              console.error('Failed to migrate legacy media_items table:', renameErr.message);
              return;
            }

            db.run(`
              CREATE TABLE media_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL DEFAULT 1,
                title TEXT NOT NULL,
                creator TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('book', 'movie', 'music')),
                year TEXT DEFAULT '—',
                color TEXT DEFAULT 'plum',
                favorite INTEGER DEFAULT 0,
                added TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
              )
            `, (createErr) => {
              if (createErr) {
                console.error('Failed to create upgraded media_items table:', createErr.message);
                return;
              }

              db.run(`
                INSERT INTO media_items (id, user_id, title, creator, type, year, color, favorite, added)
                SELECT id, 1, title, creator, type, year, color, favorite, added
                FROM media_items_legacy
              `, (migrateErr) => {
                if (migrateErr) {
                  console.error('Failed to migrate legacy items:', migrateErr.message);
                  return;
                }

                db.run('DROP TABLE media_items_legacy', (dropErr) => {
                  if (dropErr) {
                    console.error('Failed to drop legacy table:', dropErr.message);
                  }
                });
              });
            });
          });
        }
      });
    });

    db.run(`
      DELETE FROM media_items
      WHERE title IN (
        'The Left Hand of Darkness',
        'In the Mood for Love',
        'Promises',
        'The Shape of Water'
      )
      AND creator IN (
        'Ursula K. Le Guin',
        'Wong Kar-wai',
        'Floating Points',
        'Guillermo del Toro'
      )
    `, (cleanupErr) => {
      if (cleanupErr) {
        console.error('Failed to remove demo items:', cleanupErr.message);
      }
    });
  });
}

app.use(express.json());
app.use(express.static(__dirname));

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/signup', (req, res) => {
  const { name, email, password } = req.body || {};
  const safeName = String(name || '').trim();
  const safeEmail = String(email || '').trim().toLowerCase();
  const safePassword = String(password || '');

  if (!safeName || !safeEmail || !safePassword) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }

  if (safePassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  const passwordHash = hashPassword(safePassword);

  db.run(
    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
    [safeName, safeEmail, passwordHash],
    function onInsert(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(409).json({ error: 'An account with that email already exists.' });
        }
        return res.status(500).json({ error: 'Unable to create account.' });
      }

      const token = createToken();
      db.run('INSERT INTO user_sessions (user_id, token) VALUES (?, ?)', [this.lastID, token], (sessionErr) => {
        if (sessionErr) {
          return res.status(500).json({ error: 'Unable to create session.' });
        }

        res.status(201).json({
          token,
          user: { id: this.lastID, name: safeName, email: safeEmail },
        });
      });
    }
  );
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const safeEmail = String(email || '').trim().toLowerCase();
  const safePassword = String(password || '');

  if (!safeEmail || !safePassword) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [safeEmail], (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const hashedInput = hashPassword(safePassword);
    if (hashedInput !== user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = createToken();
    db.run('INSERT INTO user_sessions (user_id, token) VALUES (?, ?)', [user.id, token], (sessionErr) => {
      if (sessionErr) {
        return res.status(500).json({ error: 'Unable to create session.' });
      }

      res.json({
        token,
        user: normalizeUser(user),
      });
    });
  });
});

function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    req.user = null;
    return next();
  }

  db.get('SELECT * FROM user_sessions WHERE token = ?', [token], (err, session) => {
    if (err || !session) {
      req.user = null;
      return next();
    }

    db.get('SELECT id, name, email, created_at FROM users WHERE id = ?', [session.user_id], (userErr, user) => {
      if (userErr || !user) {
        req.user = null;
        return next();
      }

      req.user = normalizeUser(user);
      next();
    });
  });
}

app.get('/api/items', optionalAuthMiddleware, (req, res) => {
  const query = req.user ? 'SELECT * FROM media_items WHERE user_id = ? ORDER BY id DESC' : 'SELECT * FROM media_items ORDER BY id DESC';
  const params = req.user ? [req.user.id] : [];

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('ITEMS_QUERY_ERROR', err);
      return res.status(500).json({ error: 'Unable to load shelf items.' });
    }

    res.json(rows.map(normalizeItem));
  });
});

app.post('/api/items', authMiddleware, (req, res) => {
  const { title, creator, type, year, color } = req.body || {};
  const safeTitle = String(title || '').trim();
  const safeCreator = String(creator || '').trim();
  const safeType = String(type || '').trim();
  const safeYear = String(year || '').trim() || '—';
  const safeColor = String(color || '').trim() || 'plum';

  if (!safeTitle || !safeCreator || !safeType) {
    return res.status(400).json({ error: 'Title, creator, and type are required.' });
  }

  if (!['book', 'movie', 'music'].includes(safeType)) {
    return res.status(400).json({ error: 'Type must be book, movie, or music.' });
  }

  const added = new Date().toISOString().slice(0, 10);

  db.run(
    'INSERT INTO media_items (user_id, title, creator, type, year, color, favorite, added) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [req.user.id, safeTitle, safeCreator, safeType, safeYear, safeColor, 0, added],
    function onInsert(err) {
      if (err) {
        return res.status(500).json({ error: 'Unable to save item.' });
      }

      db.get('SELECT * FROM media_items WHERE id = ?', [this.lastID], (rowErr, row) => {
        if (rowErr || !row) {
          return res.status(500).json({ error: 'Item was saved but could not be loaded.' });
        }

        res.status(201).json(normalizeItem(row));
      });
    }
  );
});

app.patch('/api/items/:id/favorite', authMiddleware, (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM media_items WHERE id = ? AND user_id = ?', [id, req.user.id], (err, row) => {
    if (err || !row) {
      return res.status(404).json({ error: 'Item not found.' });
    }

    const nextFavorite = row.favorite ? 0 : 1;

    db.run('UPDATE media_items SET favorite = ? WHERE id = ? AND user_id = ?', [nextFavorite, id, req.user.id], (updateErr) => {
      if (updateErr) {
        return res.status(500).json({ error: 'Unable to update favorite status.' });
      }

      db.get('SELECT * FROM media_items WHERE id = ?', [id], (fetchErr, updatedRow) => {
        if (fetchErr || !updatedRow) {
          return res.status(500).json({ error: 'Updated item could not be loaded.' });
        }

        res.json(normalizeItem(updatedRow));
      });
    });
  });
});

app.delete('/api/items/:id', authMiddleware, (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM media_items WHERE id = ? AND user_id = ?', [id, req.user.id], function onDelete(err) {
    if (err) {
      return res.status(500).json({ error: 'Unable to delete item.' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Item not found.' });
    }

    res.status(204).send();
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

initDb();

app.listen(PORT, () => {
  console.log(`Shelf It API running at http://localhost:${PORT}`);
});
