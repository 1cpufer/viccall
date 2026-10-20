/*
 * Community Garage database: SQLite through Node's built-in node:sqlite
 * (Node 22.13+), so there is no database server to run or pay for.
 *
 * The file lives in DATA_DIR. In production that directory must be on a
 * persistent disk, otherwise accounts and photos vanish on every deploy; the
 * Garage stays switched off (GARAGE_ENABLED) until that's in place.
 *
 * Migrations run in order and are recorded in schema_migrations.
 */
const path = require('path');
const fs = require('fs');

// node:sqlite prints an "experimental" warning once; keep logs clean.
const origEmit = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const text = typeof warning === 'string' ? warning : warning && warning.message;
  if (/SQLite is an experimental feature/.test(text || '')) return;
  return origEmit.call(process, warning, ...rest);
};
const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS = [
  // 1: accounts
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     email TEXT COLLATE NOCASE UNIQUE,
     email_verified INTEGER NOT NULL DEFAULT 0,
     password_hash TEXT,
     display_name TEXT COLLATE NOCASE UNIQUE,
     adult INTEGER NOT NULL DEFAULT 0,          -- 18 or over; the birth date itself is never stored
     age_checked_at INTEGER,
     profile_complete INTEGER NOT NULL DEFAULT 0,
     role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','moderator','admin')),
     status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
     credit_anonymous INTEGER NOT NULL DEFAULT 0,
     bio TEXT, links TEXT,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE TABLE identities (
     provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
     email TEXT, created_at INTEGER NOT NULL,
     PRIMARY KEY (provider, subject)
   );
   CREATE INDEX identities_user ON identities(user_id);
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, user_agent TEXT
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE email_tokens (
     token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
     kind TEXT NOT NULL CHECK (kind IN ('verify','reset')),
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
   );
   CREATE TABLE oauth_states (
     state TEXT PRIMARY KEY, provider TEXT NOT NULL, verifier TEXT NOT NULL, return_to TEXT,
     created_at INTEGER NOT NULL
   );`,

  // 2: Community Garage content, licensing and moderation
  `CREATE TABLE licence_acceptances (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), version TEXT NOT NULL,
     accepted_at INTEGER NOT NULL
   );
   -- Vehicles added by moderators for photos of cars not in the built-in list.
   CREATE TABLE vehicles (
     key TEXT PRIMARY KEY, make TEXT NOT NULL, model TEXT NOT NULL, variant TEXT, generation TEXT,
     model_aliases TEXT, year_from INTEGER, year_to INTEGER, region TEXT, supercar INTEGER NOT NULL DEFAULT 0,
     created_by TEXT, created_at INTEGER NOT NULL
   );
   -- Every playable photo has a provenance and licence record.
   CREATE TABLE images (
     id TEXT PRIMARY KEY,
     source TEXT NOT NULL CHECK (source IN ('commons','community','manufacturer','licensed','commissioned')),
     source_ref TEXT,                 -- original URL, or 'upload:<id>' for community photos
     photographer TEXT,               -- copyright holder as credited
     contributor_id TEXT REFERENCES users(id),
     licence TEXT,                    -- e.g. 'vicall-contributor-v0.1', 'CC BY-SA 4.0', 'unverified'
     licence_evidence TEXT,           -- where the proof is kept
     permission_at INTEGER,
     commercial_ok INTEGER,           -- 1 yes, 0 no, NULL unknown
     attribution TEXT,
     expires_at INTEGER,
     restrictions TEXT,
     moderation TEXT NOT NULL DEFAULT 'pending' CHECK (moderation IN ('pending','approved','rejected','removed')),
     eligibility TEXT NOT NULL DEFAULT 'pending' CHECK (eligibility IN ('pending','casual','competitive','restricted','removed')),
     takedown TEXT NOT NULL DEFAULT 'none' CHECK (takedown IN ('none','disputed','removed')),
     flagged INTEGER NOT NULL DEFAULT 0, -- suspected manipulation or open report: out of competitive play
     sha256 TEXT, dhash TEXT, dhash_center TEXT,
     width INTEGER, height INTEGER,
     vehicle_key TEXT, year INTEGER, difficulty INTEGER,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE INDEX images_sha ON images(sha256);
   CREATE INDEX images_state ON images(moderation, eligibility);
   -- Everyone with a claim on a photo: the uploader, and anyone who uploaded a copy.
   CREATE TABLE image_contributors (
     image_id TEXT NOT NULL REFERENCES images(id), user_id TEXT NOT NULL REFERENCES users(id),
     relation TEXT NOT NULL CHECK (relation IN ('uploader','duplicate')),
     created_at INTEGER NOT NULL,
     PRIMARY KEY (image_id, user_id)
   );
   CREATE INDEX image_contributors_user ON image_contributors(user_id);
   CREATE TABLE submissions (
     id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), image_id TEXT REFERENCES images(id),
     status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','needs_correction','approved','rejected','removed')),
     make TEXT, model TEXT, trim TEXT, generation TEXT, year INTEGER,
     modified INTEGER NOT NULL DEFAULT 0, kit TEXT, mods TEXT,
     location_text TEXT, show_location INTEGER NOT NULL DEFAULT 0, event TEXT, notes TEXT,
     promo_opt_in INTEGER NOT NULL DEFAULT 0,
     licence_version TEXT, declarations TEXT,
     flags TEXT,                      -- automated checks: JSON list of warnings for moderators
     duplicate_of TEXT,               -- image id this upload matched
     reason TEXT,                     -- why it was rejected or needs correction
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE INDEX submissions_user ON submissions(user_id);
   CREATE INDEX submissions_status ON submissions(status);
   CREATE TABLE reports (
     id TEXT PRIMARY KEY, image_id TEXT, car_id TEXT, reporter_id TEXT,
     kind TEXT NOT NULL CHECK (kind IN ('wrong_id','copyright','privacy','quality','other')),
     message TEXT, contact TEXT,
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
     resolution TEXT, resolved_by TEXT, created_at INTEGER NOT NULL, resolved_at INTEGER
   );
   CREATE TABLE audit_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor_id TEXT,
     action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, detail TEXT
   );
   CREATE INDEX audit_entity ON audit_log(entity, entity_id);`,

  // 3: perceptual fingerprints of the whole frame and likely crops (JSON), for duplicate checks
  `ALTER TABLE images ADD COLUMN fingerprints TEXT;`,
];

function openDb(dataDir, file = 'garage.db') {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, file));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
  MIGRATIONS.forEach((sql, i) => {
    const version = i + 1;
    if (done.has(version)) return;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, Date.now());
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  });
  // Small helpers so callers read like the SQL they run.
  const helpers = {
    raw: db,
    get: (sql, ...a) => db.prepare(sql).get(...a),
    all: (sql, ...a) => db.prepare(sql).all(...a),
    run: (sql, ...a) => db.prepare(sql).run(...a),
    tx(fn) {
      db.exec('BEGIN');
      try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    audit(actorId, action, entity, entityId, detail) {
      db.prepare('INSERT INTO audit_log (at, actor_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)')
        .run(Date.now(), actorId || null, action, entity, entityId || null, detail == null ? null : JSON.stringify(detail));
    },
    close: () => db.close(),
  };
  return helpers;
}

module.exports = { openDb, MIGRATIONS };
