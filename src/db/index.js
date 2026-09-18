import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from './schema.js';

const CURRENT_VERSION = 2;

/** Añade una columna solo si todavía no existe, para poder reejecutar sin miedo. */
function addColumn(db, table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Migraciones: añade funciones a este array. Cada una recibe la conexión y se
 * ejecuta una sola vez, en orden, según schema_version.
 */
const MIGRATIONS = [
  // v1: esquema inicial (lo crea SCHEMA)
  () => {},
  // v2: nombre, apellidos y teléfono separados en los usuarios
  (db) => {
    addColumn(db, 'users', 'first_name', 'TEXT');
    addColumn(db, 'users', 'last_name', 'TEXT');
    addColumn(db, 'users', 'phone', 'TEXT');
    db.exec("UPDATE users SET first_name = name WHERE first_name IS NULL OR first_name = ''");
  },
];

/** Convierte valores JS a tipos aceptados por SQLite (booleanos -> 0/1, undefined -> null). */
function bind(params) {
  return params.map((p) => {
    if (p === undefined) return null;
    if (p === true) return 1;
    if (p === false) return 0;
    if (p instanceof Date) return p.toISOString().slice(0, 19).replace('T', ' ');
    return p;
  });
}

/**
 * Pequeña capa sobre node:sqlite con una API parecida a better-sqlite3:
 *   db.prepare(sql).run/get/all(...params), db.exec(sql), db.pragma(...),
 *   db.transaction(fn)()
 */
export class Db {
  constructor(file = ':memory:') {
    this.file = file;
    this.raw = new DatabaseSync(file);
    this.cache = new Map();
    this.txDepth = 0;
  }

  exec(sql) {
    this.raw.exec(sql);
  }

  pragma(text) {
    return this.raw.prepare(`PRAGMA ${text}`).all();
  }

  prepare(sql) {
    let stmt = this.cache.get(sql);
    if (!stmt) {
      const inner = this.raw.prepare(sql);
      stmt = {
        run: (...params) => inner.run(...bind(params)),
        get: (...params) => inner.get(...bind(params)),
        all: (...params) => inner.all(...bind(params)),
      };
      this.cache.set(sql, stmt);
    }
    return stmt;
  }

  /** Devuelve una función que ejecuta fn dentro de una transacción (con savepoints si se anida). */
  transaction(fn) {
    return (...args) => {
      const name = `sp${this.txDepth}`;
      const outer = this.txDepth === 0;
      this.raw.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
      this.txDepth += 1;
      try {
        const result = fn(...args);
        this.txDepth -= 1;
        this.raw.exec(outer ? 'COMMIT' : `RELEASE ${name}`);
        return result;
      } catch (err) {
        this.txDepth -= 1;
        this.raw.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
        throw err;
      }
    };
  }

  close() {
    this.cache.clear();
    this.raw.close();
  }
}

export function openDatabase(file = ':memory:') {
  const db = new Db(file);
  if (file !== ':memory:') {
    // WAL permite leer mientras se escribe: varias visitas a la vez no se estorban.
    db.exec('PRAGMA journal_mode = WAL');
    // NORMAL es la pareja recomendada de WAL. Sigue siendo seguro ante una caída
    // del programa; solo un corte de corriente podría costar los últimos segundos.
    db.exec('PRAGMA synchronous = NORMAL');
    // Deja que el sistema operativo lea la base por memoria: menos llamadas a disco.
    db.exec('PRAGMA mmap_size = 268435456');
    // Reordena el fichero WAL cuando crece, para que no se dispare de tamaño.
    db.exec('PRAGMA wal_autocheckpoint = 1000');
  }
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA cache_size = -16000');
  db.exec('PRAGMA temp_store = MEMORY');
  db.exec(SCHEMA);
  migrate(db);
  if (file !== ':memory:') db.exec('PRAGMA optimize');
  return db;
}

function migrate(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get();
  let version = row ? Number(row.value) : 0;
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  while (version < CURRENT_VERSION) {
    const step = MIGRATIONS[version];
    db.transaction(() => {
      if (step) step(db);
      version += 1;
      upsert.run(String(version));
    })();
  }
}
