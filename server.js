const express = require('express');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const dbPath = path.join(__dirname, 'shelf.db');
let dbReady = Promise.resolve();

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

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Catalog request failed with ${response.status}`);
  return response.json();
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

async function searchCatalog(query) {
  const encodedQuery = encodeURIComponent(query);
  const [booksResult, showsResult, moviesResult, musicResult] = await Promise.allSettled([
    searchBooks(query),
    fetchJson(`https://api.tvmaze.com/search/shows?q=${encodedQuery}`),
    searchMovies(query),
    searchAlbums(query),
  ]);

  const books = booksResult.status === 'fulfilled' ? booksResult.value : [];

  const shows = showsResult.status === 'fulfilled' ? (showsResult.value || []).slice(0, 10).map(({ show }) => ({
    externalId: String(show.id),
    source: 'tvmaze',
    type: 'tv',
    title: show.name,
    creator: show.genres?.length ? show.genres.join(', ') : (show.network?.name || show.webChannel?.name || 'TV'),
    year: show.premiered ? show.premiered.slice(0, 4) : '—',
    description: stripHtml(show.summary),
    posterUrl: show.image?.original || show.image?.medium || '',
  })) : [];

  const movies = moviesResult.status === 'fulfilled' ? moviesResult.value : [];

  const music = musicResult.status === 'fulfilled' ? musicResult.value : [];

  return { books, movies, tv: shows, music };
}

async function searchAlbums(query) {
  const result = await fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=album&attribute=albumTerm&limit=50`);
  const albums = new Map();

  (result.results || []).forEach((album) => {
    const id = album.collectionId || album.collectionName;
    if (!id || albums.has(id) || !album.collectionName) return;

    albums.set(id, {
      externalId: String(album.collectionId || album.collectionName),
      source: 'itunes',
      type: 'music',
      title: album.collectionName,
      creator: album.artistName || 'Unknown artist',
      year: album.releaseDate ? album.releaseDate.slice(0, 4) : '—',
      description: `${album.collectionName} by ${album.artistName || 'Unknown artist'}.`,
      posterUrl: (album.artworkUrl100 || '').replace('100x100', '600x600'),
    });
  });

  return [...albums.values()].slice(0, 20);
}

async function searchBooks(query) {
  try {
    const google = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10&printType=books`);
    if (google.items?.length) {
      return google.items.map(({ id, volumeInfo }) => ({
        externalId: id,
        source: 'google-books',
        type: 'book',
        title: volumeInfo.title || 'Untitled',
        creator: (volumeInfo.authors || ['Unknown author']).join(', '),
        year: String(volumeInfo.publishedDate || '—').slice(0, 4),
        description: stripHtml(volumeInfo.description),
        posterUrl: volumeInfo.imageLinks?.thumbnail?.replace('http://', 'https://') || '',
      }));
    }
  } catch (error) {
    console.warn('Google Books unavailable:', error.message);
  }

  const openLibrary = await fetchJson(`https://openlibrary.org/search.json?title=${encodeURIComponent(query)}&limit=20&fields=key,title,author_name,first_publish_year,cover_i,first_sentence`);
  return (openLibrary.docs || []).filter((book) => book.cover_i).slice(0, 10).map((book) => ({
    externalId: book.key,
    source: 'open-library',
    type: 'book',
    title: book.title || 'Untitled',
    creator: (book.author_name || ['Unknown author']).join(', '),
    year: String(book.first_publish_year || '—'),
    description: Array.isArray(book.first_sentence) ? book.first_sentence[0] : (book.first_sentence || ''),
    posterUrl: book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg` : '',
  }));
}

async function searchMovies(query) {
  if (process.env.TMDB_API_KEY) {
    const tmdb = await fetchJson(`https://api.themoviedb.org/3/search/multi?api_key=${encodeURIComponent(process.env.TMDB_API_KEY)}&query=${encodeURIComponent(query)}&include_adult=false`);
    return (tmdb.results || []).filter((item) => item.media_type === 'movie').slice(0, 10).map((movie) => ({
      externalId: String(movie.id),
      source: 'tmdb',
      type: 'movie',
      title: movie.title,
      creator: 'Film',
      year: movie.release_date ? movie.release_date.slice(0, 4) : '—',
      description: movie.overview || '',
      posterUrl: movie.poster_path ? `https://image.tmdb.org/t/p/w780${movie.poster_path}` : '',
    }));
  }

  try {
    const imdb = await fetchJson(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query)}.json`);
    const filmResults = (imdb.d || []).filter((movie) => ['feature', 'tvMovie'].includes(movie.q) && movie.id && movie.i?.imageUrl).slice(0, 10);
    if (filmResults.length) {
      return filmResults.map((movie) => ({
        externalId: movie.id,
        source: 'imdb',
        type: 'movie',
        title: movie.l,
        creator: movie.s || 'Film',
        year: String(movie.y || '—'),
        description: `${movie.l}${movie.y ? ` (${movie.y})` : ''}. Film listing from IMDb.`,
        posterUrl: movie.i.imageUrl,
      }));
    }
  } catch (error) {
    console.warn('IMDb movie search unavailable:', error.message);
  }

  try {
    const itunes = await fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=movie&entity=movie&limit=10`);
    if (itunes.results?.length) {
      return itunes.results.map((movie) => ({
        externalId: String(movie.trackId),
        source: 'itunes',
        type: 'movie',
        title: movie.trackName,
        creator: movie.artistName || 'Film',
        year: movie.releaseDate ? movie.releaseDate.slice(0, 4) : '—',
        description: movie.longDescription || movie.shortDescription || '',
        posterUrl: (movie.artworkUrl100 || '').replace('100x100', '600x600'),
      }));
    }
  } catch (error) {
    console.warn('iTunes movies unavailable:', error.message);
  }

  const wikipedia = await fetchJson(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`intitle:${query} film`)}&gsrnamespace=0&gsrlimit=20&prop=extracts|pageimages&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=600&format=json&origin=*`);
  const matchingPages = Object.values(wikipedia.query?.pages || {}).filter((page) => {
    const isFilmPage = /\((19|20)\d{2} film\)/i.test(page.title) || page.title.toLowerCase().trim() === query.toLowerCase().trim();
    return isFilmPage && /\b(film|movie|cinema)\b/i.test(page.extract || '') && page.thumbnail?.source;
  }).slice(0, 10);
  if (matchingPages.length) return matchingPages.map((page) => ({
    externalId: String(page.pageid),
    source: 'wikipedia',
    type: 'movie',
    title: page.title.replace(/ \(film\)$/i, ''),
    creator: 'Film',
    year: (page.extract || '').match(/\b(19|20)\d{2}\b/)?.[0] || '—',
    description: page.extract || '',
    posterUrl: page.thumbnail?.source || '',
  }));

  const exactPage = await fetchJson(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(query)}&prop=extracts|pageimages&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=600&format=json&origin=*`);
  const exactResults = Object.values(exactPage.query?.pages || {}).filter((page) => page.thumbnail?.source && /\b(film|movie|cinema)\b/i.test(page.extract || '')).map((page) => ({
    externalId: String(page.pageid),
    source: 'wikipedia',
    type: 'movie',
    title: page.title,
    creator: 'Film',
    year: (page.extract || '').match(/\b(19|20)\d{2}\b/)?.[0] || '—',
    description: page.extract || '',
    posterUrl: page.thumbnail.source,
  }));
  if (exactResults.length) return exactResults;

  const commons = await fetchJson(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`${query} film poster`)}&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url&iiurlwidth=600&format=json&origin=*`);
  return Object.values(commons.query?.pages || {}).filter((page) => page.imageinfo?.[0]?.thumburl).slice(0, 5).map((page) => ({
    externalId: String(page.pageid),
    source: 'wikimedia-commons',
    type: 'movie',
    title: query,
    creator: 'Film',
    year: '—',
    description: `Poster artwork for ${query}.`,
    posterUrl: page.imageinfo[0].thumburl,
  }));
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
    description: row.description || '',
    posterUrl: row.poster_url || '',
    externalId: row.external_id || '',
    source: row.source || '',
    format: row.format || '',
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

function normalizePublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  };
}

function normalizeReview(row) {
  return {
    id: row.id,
    rating: row.rating,
    body: row.body,
    createdAt: row.created_at,
    user: { id: row.user_id, name: row.user_name },
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

const mediaTableSql = `
  CREATE TABLE media_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    creator TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('book', 'movie', 'tv', 'music')),
    year TEXT DEFAULT '—',
    color TEXT DEFAULT 'plum',
    favorite INTEGER DEFAULT 0,
    added TEXT NOT NULL,
    description TEXT DEFAULT '',
    poster_url TEXT DEFAULT '',
    external_id TEXT DEFAULT '',
    source TEXT DEFAULT '',
    format TEXT DEFAULT '',
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`;

function ensureMediaTable(done) {
  db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='media_items'", (err, table) => {
    if (err) return done(err);
    if (!table) return db.run(mediaTableSql, done);

    db.all('PRAGMA table_info(media_items)', (pragmaErr, columns) => {
      if (pragmaErr) return done(pragmaErr);
      db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='media_items'", (sqlErr, schema) => {
        if (sqlErr) return done(sqlErr);

        const names = new Set(columns.map((column) => column.name));
        const supportsCurrentSchema = names.has('user_id') && names.has('description') && names.has('poster_url') && names.has('external_id') && names.has('source') && names.has('format') && schema.sql.includes("'tv'");
        if (supportsCurrentSchema) return done();

        db.run('ALTER TABLE media_items RENAME TO media_items_legacy', (renameErr) => {
          if (renameErr) return done(renameErr);
          db.run(mediaTableSql, (createErr) => {
            if (createErr) return done(createErr);

            const userId = names.has('user_id') ? 'user_id' : '1';
            const description = names.has('description') ? 'description' : "''";
            const posterUrl = names.has('poster_url') ? 'poster_url' : "''";
            const externalId = names.has('external_id') ? 'external_id' : "''";
            const source = names.has('source') ? 'source' : "''";
            db.run(`
              INSERT INTO media_items (id, user_id, title, creator, type, year, color, favorite, added, description, poster_url, external_id, source, format)
              SELECT id, ${userId}, title, creator, type, year, color, favorite, added, ${description}, ${posterUrl}, ${externalId}, ${source}, ''
              FROM media_items_legacy
            `, (copyErr) => {
              if (copyErr) return done(copyErr);
              db.run('DROP TABLE media_items_legacy', done);
            });
          });
        });
      });
    });
  });
}

function initDb() {
  dbReady = new Promise((resolve, reject) => db.serialize(() => {
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
    ensureMediaTable((mediaErr) => {
      if (mediaErr) {
        console.error('Failed to initialize media_items:', mediaErr.message);
        reject(mediaErr);
        return;
      }
      db.run(`
        CREATE TABLE IF NOT EXISTS reviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          media_item_id INTEGER NOT NULL,
          rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
          body TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          UNIQUE(user_id, media_item_id),
          FOREIGN KEY(user_id) REFERENCES users(id),
          FOREIGN KEY(media_item_id) REFERENCES media_items(id)
        )
      `, (reviewsErr) => {
        if (reviewsErr) reject(reviewsErr);
        else resolve();
      });
    });
  }));
}

app.use(express.json());
app.use(express.static(__dirname));
app.use('/api', (req, res, next) => {
  dbReady.then(next).catch(() => res.status(503).json({ error: 'Database is still starting.' }));
});

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

app.get('/api/discover', (req, res) => {
  const query = String(req.query.q || '').trim();

  if (query.length < 2) {
    return res.json({ users: [], media: [] });
  }

  const pattern = `%${query}%`;
  db.all(`
    SELECT id, name, created_at
    FROM users
    WHERE name LIKE ?
    ORDER BY name COLLATE NOCASE
    LIMIT 8
  `, [pattern], (userErr, users) => {
    if (userErr) {
      return res.status(500).json({ error: 'Unable to search users.' });
    }

    db.all(`
      SELECT media_items.*, users.name AS owner_name
      FROM media_items
      JOIN users ON users.id = media_items.user_id
      WHERE media_items.title LIKE ? OR media_items.creator LIKE ?
      ORDER BY media_items.id DESC
      LIMIT 12
    `, [pattern, pattern], (mediaErr, media) => {
      if (mediaErr) {
        return res.status(500).json({ error: 'Unable to search media.' });
      }

      res.json({
        users: users.map(normalizePublicUser),
        media: media.map((item) => ({ ...normalizeItem(item), owner: { id: item.user_id, name: item.owner_name } })),
      });
    });
  });
});

app.get('/api/catalog/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 2) return res.json({ books: [], movies: [], tv: [], music: [] });

  try {
    res.json(await searchCatalog(query));
  } catch (error) {
    console.error('CATALOG_SEARCH_ERROR', error);
    res.status(502).json({ error: 'External catalog search is unavailable.' });
  }
});

app.get('/api/users/:id', (req, res) => {
  db.get('SELECT id, name, created_at FROM users WHERE id = ?', [req.params.id], (userErr, user) => {
    if (userErr || !user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    db.all(`
      SELECT media_items.*
      FROM media_items
      WHERE media_items.user_id = ?
      ORDER BY media_items.id DESC
    `, [req.params.id], (itemsErr, items) => {
      if (itemsErr) {
        return res.status(500).json({ error: 'Unable to load user shelf.' });
      }

      res.json({ user: normalizePublicUser(user), items: items.map(normalizeItem) });
    });
  });
});

app.get('/api/items/:id', (req, res) => {
  db.get(`
    SELECT media_items.*, users.name AS owner_name
    FROM media_items
    JOIN users ON users.id = media_items.user_id
    WHERE media_items.id = ?
  `, [req.params.id], (itemErr, item) => {
    if (itemErr || !item) {
      return res.status(404).json({ error: 'Media not found.' });
    }

    db.all(`
      SELECT reviews.*, users.name AS user_name
      FROM reviews
      JOIN users ON users.id = reviews.user_id
      WHERE reviews.media_item_id = ?
      ORDER BY reviews.created_at DESC
    `, [req.params.id], (reviewErr, reviews) => {
      if (reviewErr) {
        return res.status(500).json({ error: 'Unable to load reviews.' });
      }

      res.json({
        item: { ...normalizeItem(item), owner: { id: item.user_id, name: item.owner_name } },
        reviews: reviews.map(normalizeReview),
      });
    });
  });
});

app.post('/api/items/:id/reviews', authMiddleware, (req, res) => {
  const rating = Number(req.body?.rating);
  const body = String(req.body?.body || '').trim();

  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !body) {
    return res.status(400).json({ error: 'A rating from 1 to 5 and review text are required.' });
  }

  db.run(`
    INSERT INTO reviews (user_id, media_item_id, rating, body)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, media_item_id) DO UPDATE SET rating = excluded.rating, body = excluded.body, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `, [req.user.id, req.params.id, rating, body], function onReview(err) {
    if (err) {
      if (err.message.includes('FOREIGN KEY')) {
        return res.status(404).json({ error: 'Media not found.' });
      }
      return res.status(500).json({ error: 'Unable to save review.' });
    }

    db.get(`
      SELECT reviews.*, users.name AS user_name
      FROM reviews
      JOIN users ON users.id = reviews.user_id
      WHERE reviews.user_id = ? AND reviews.media_item_id = ?
    `, [req.user.id, req.params.id], (fetchErr, review) => {
      if (fetchErr || !review) {
        return res.status(500).json({ error: 'Review was saved but could not be loaded.' });
      }

      res.status(201).json(normalizeReview(review));
    });
  });
});

app.post('/api/items', authMiddleware, (req, res) => {
  const { title, creator, type, year, color, description, posterUrl, externalId, source, format } = req.body || {};
  const safeTitle = String(title || '').trim();
  const safeCreator = String(creator || '').trim();
  const safeType = String(type || '').trim();
  const safeYear = String(year || '').trim() || '—';
  const safeColor = String(color || '').trim() || 'plum';

  if (!safeTitle || !safeCreator || !safeType) {
    return res.status(400).json({ error: 'Title, creator, and type are required.' });
  }

  if (!['book', 'movie', 'tv', 'music'].includes(safeType)) {
    return res.status(400).json({ error: 'Type must be book, movie, tv, or music.' });
  }

  const added = new Date().toISOString().slice(0, 10);
  const safeDescription = String(description || '').trim();
  const safePosterUrl = String(posterUrl || '').trim();
  const safeExternalId = String(externalId || '').trim();
  const safeSource = String(source || '').trim();
  const safeFormat = String(format || '').trim();

  db.run(
    'INSERT INTO media_items (user_id, title, creator, type, year, color, favorite, added, description, poster_url, external_id, source, format) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [req.user.id, safeTitle, safeCreator, safeType, safeYear, safeColor, 0, added, safeDescription, safePosterUrl, safeExternalId, safeSource, safeFormat],
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
