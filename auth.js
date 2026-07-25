const express = require('express');
const bcrypt = require('bcrypt');
const { db } = require('../db');
const router = express.Router();

router.post('/register', (req, res) => {
  const { username, password, role, name, email, phone_number, school_code, class_id } = req.body;
  if (!username || !password || !role || !school_code) return res.status(400).json({ error: 'Missing fields' });
  const school = db.prepare('SELECT id, approved FROM schools WHERE code = ?').get(school_code);
  if (!school || !school.approved) return res.status(404).json({ error: 'Invalid or unapproved school code' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return res.status(409).json({ error: 'Username taken' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`INSERT INTO users (username, password_hash, role, name, email, phone_number, school_id, class_id) VALUES (?,?,?,?,?,?,?,?)`)
    .run(username, hash, role, name || username, email, phone_number, school.id, class_id || null);
  db.prepare('INSERT INTO wallets (user_id, play_balance, savings_balance) VALUES (?, 0, 0)').run(info.lastInsertRowid);
  res.json({ message: 'Registered', user: { id: info.lastInsertRowid, role } });
});

router.post('/login', (req, res) => {
  const { username, password, school_code } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  
  // Strict Password Check for everyone
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials. Access denied.' });
  }

  // Dev bypasses school code, everyone else needs it
  if (user.role !== 'DEV') {
    if (!school_code) return res.status(400).json({ error: 'School code required' });
    const school = db.prepare('SELECT id FROM schools WHERE code = ?').get(school_code);
    if (!school || school.id !== user.school_id) return res.status(403).json({ error: 'Invalid school code for this user' });
  }

  res.json({ user: { id: user.id, username: user.username, role: user.role, name: user.name, school_id: user.school_id, class_id: user.class_id } });
});
module.exports = router;