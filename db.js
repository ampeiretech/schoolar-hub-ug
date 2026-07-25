const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');
const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schools (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
      approved INTEGER DEFAULT 0, support_email TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL, name TEXT NOT NULL,
      FOREIGN KEY(school_id) REFERENCES schools(id)
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('DEV','ADMIN','TEACHER','PARENT','STUDENT')),
      name TEXT, email TEXT, phone_number TEXT, school_id INTEGER, class_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(school_id) REFERENCES schools(id),
      FOREIGN KEY(class_id) REFERENCES classes(id)
    );
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL UNIQUE,
      play_balance REAL DEFAULT 0, savings_balance REAL DEFAULT 0,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, school_id INTEGER NOT NULL,
      teacher_id INTEGER NOT NULL,
      FOREIGN KEY(school_id) REFERENCES schools(id),
      FOREIGN KEY(teacher_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, subject_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL, topic TEXT, scheduled_day TEXT, scheduled_time TEXT,
      time_per_question INTEGER DEFAULT 30, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(subject_id) REFERENCES subjects(id),
      FOREIGN KEY(class_id) REFERENCES classes(id)
    );
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id INTEGER NOT NULL, text TEXT NOT NULL,
      option_a TEXT, option_b TEXT, option_c TEXT, option_d TEXT, correct_option TEXT,
      FOREIGN KEY(quiz_id) REFERENCES quizzes(id)
    );
    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, quiz_id INTEGER NOT NULL,
      stake_amount REAL NOT NULL, score_percentage REAL, status TEXT DEFAULT 'PENDING',
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(student_id) REFERENCES users(id),
      FOREIGN KEY(quiz_id) REFERENCES quizzes(id)
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, wallet_id INTEGER NOT NULL,
      trans_type TEXT NOT NULL, amount REAL NOT NULL, balance_after REAL,
      description TEXT, reference_id TEXT, timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(wallet_id) REFERENCES wallets(id)
    );
    CREATE TABLE IF NOT EXISTS pending_deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reference_id TEXT UNIQUE NOT NULL,
      wallet_id INTEGER NOT NULL, phone TEXT, amount REAL NOT NULL, status TEXT DEFAULT 'PENDING',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(wallet_id) REFERENCES wallets(id)
    );
  `);

  // Seed Dev Account (Strict Credentials)
  const dev = db.prepare('SELECT id FROM users WHERE id = 1').get();
  if (!dev) {
    const hash = bcrypt.hashSync('ampeiretech@16', 10);
    db.prepare(`INSERT INTO users (id, username, password_hash, role, name, email) VALUES (1, 'ampeiretech@gmail.com', ?, 'DEV', 'Super Dev', 'ampeiretech@gmail.com')`).run(hash);
    db.prepare('INSERT INTO wallets (user_id, play_balance, savings_balance) VALUES (1, 0, 0)').run();
  }
  console.log('[db] Schema initialized. Dev login: ampeiretech@gmail.com / ampeiretech@16');
}
module.exports = { db, init };