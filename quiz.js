const express = require('express');
const bcrypt = require('bcrypt');
const { db } = require('../db');
const { startQuiz, calcScore, grade } = require('../quizEngine');
const router = express.Router();

function auth(req, res, next) {
  const id = req.headers['x-user-id'];
  if (!id) return res.status(401).json({ error: 'Unauthorized' });
  req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Admin Mgmt
router.post('/schools', auth, (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
  const { name } = req.body;
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const info = db.prepare('INSERT INTO schools (name, code, approved) VALUES (?, ?, 1)').run(name, code);
  db.prepare('UPDATE users SET school_id=? WHERE id=?').run(info.lastInsertRowid, req.user.id);
  res.json({ id: info.lastInsertRowid, code });
});
router.post('/classes', auth, (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
  const info = db.prepare('INSERT INTO classes (school_id, name) VALUES (?, ?)').run(req.user.school_id, req.body.name);
  res.json({ id: info.lastInsertRowid });
});
router.post('/teachers', auth, (req, res) => {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
  const { username, password, name, subject_name } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  const uInfo = db.prepare(`INSERT INTO users (username, password_hash, role, name, school_id) VALUES (?, ?, 'TEACHER', ?, ?)`).run(username, hash, name, req.user.school_id);
  db.prepare('INSERT INTO wallets (user_id, play_balance, savings_balance) VALUES (?, 0, 0)').run(uInfo.lastInsertRowid);
  const sInfo = db.prepare('INSERT INTO subjects (name, school_id, teacher_id) VALUES (?, ?, ?)').run(subject_name, req.user.school_id, uInfo.lastInsertRowid);
  res.json({ teacher_id: uInfo.lastInsertRowid, subject_id: sInfo.lastInsertRowid });
});

// Parent Mgmt
router.post('/students', auth, (req, res) => {
  if (req.user.role !== 'PARENT') return res.status(403).json({ error: 'Parents only' });
  const { username, password, name, email, phone_number, class_id } = req.body;
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return res.status(409).json({ error: 'Username taken' });
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(`INSERT INTO users (username, password_hash, role, name, email, phone_number, school_id, class_id) VALUES (?, ?, 'STUDENT', ?, ?, ?, ?, ?)`).run(username, hash, name, email, phone_number, req.user.school_id, class_id);
  db.prepare('INSERT INTO wallets (user_id, play_balance, savings_balance) VALUES (?, 0, 0)').run(info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid });
});
router.put('/students/:id/class', auth, (req, res) => {
  if (req.user.role !== 'PARENT') return res.status(403).json({ error: 'Parents only' });
  db.prepare('UPDATE users SET class_id=? WHERE id=? AND school_id=?').run(req.body.class_id, req.params.id, req.user.school_id);
  res.json({ message: 'Class updated' });
});

// Teacher Mgmt
router.post('/quizzes', auth, (req, res) => {
  if (req.user.role !== 'TEACHER') return res.status(403).json({ error: 'Teachers only' });
  const { title, subject_id, class_id, topic, scheduled_day, scheduled_time, time_per_question } = req.body;
  const info = db.prepare(`INSERT INTO quizzes (title, subject_id, class_id, topic, scheduled_day, scheduled_time, time_per_question) VALUES (?,?,?,?,?,?,?)`).run(title, subject_id, class_id, topic, scheduled_day, scheduled_time, time_per_question || 30);
  res.json({ id: info.lastInsertRowid });
});
router.post('/quizzes/:id/questions', auth, (req, res) => {
  if (req.user.role !== 'TEACHER') return res.status(403).json({ error: 'Teachers only' });
  const { text, option_a, option_b, option_c, option_d, correct_option } = req.body;
  db.prepare(`INSERT INTO questions (quiz_id, text, option_a, option_b, option_c, option_d, correct_option) VALUES (?,?,?,?,?,?,?)`).run(req.params.id, text, option_a, option_b, option_c, option_d, correct_option.toUpperCase());
  res.json({ message: 'Added' });
});

// Fetch Data
router.get('/classes', auth, (req, res) => res.json(db.prepare('SELECT * FROM classes WHERE school_id=?').all(req.user.school_id)));
router.get('/subjects', auth, (req, res) => res.json(db.prepare('SELECT * FROM subjects WHERE school_id=?').all(req.user.school_id)));
router.get('/quizzes', auth, (req, res) => {
  let q = `SELECT q.*, s.name AS subject_name FROM quizzes q JOIN subjects s ON q.subject_id=s.id WHERE s.school_id=?`;
  let param = req.user.school_id;
  if (req.user.role === 'TEACHER') { q = `SELECT q.*, s.name AS subject_name FROM quizzes q JOIN subjects s ON q.subject_id=s.id WHERE s.teacher_id=?`; param = req.user.id; }
  else if (req.user.role === 'STUDENT') { q = `SELECT q.*, s.name AS subject_name FROM quizzes q JOIN subjects s ON q.subject_id=s.id WHERE q.class_id=?`; param = req.user.class_id; }
  res.json(db.prepare(q).all(param));
});

// Quiz Attempts
router.post('/quizzes/:id/start', auth, (req, res) => {
  if (req.user.role !== 'STUDENT') return res.status(403).json({ error: 'Students only' });
  try {
    const attemptId = startQuiz(req.user.id, req.params.id, parseFloat(req.body.stake));
    const qs = db.prepare('SELECT id, text, option_a, option_b, option_c, option_d FROM questions WHERE quiz_id=?').all(req.params.id);
    const quiz = db.prepare('SELECT time_per_question FROM quizzes WHERE id=?').get(req.params.id);
    res.json({ attemptId, questions: qs, timePerQ: quiz.time_per_question });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.post('/attempts/:id/submit', auth, (req, res) => {
  const a = db.prepare('SELECT * FROM quiz_attempts WHERE id=?').get(req.params.id);
  if (!a || a.student_id !== req.user.id) return res.status(403).json({ error: 'Invalid' });
  const qs = db.prepare('SELECT * FROM questions WHERE quiz_id=?').all(a.quiz_id);
  res.json(grade(a.id, calcScore(req.body.answers, qs)));
});

// Analytics
router.get('/leaderboard', auth, (req, res) => {
  if (req.user.role !== 'STUDENT') return res.status(403).json({ error: 'Students only' });
  const students = db.prepare(`SELECT u.id, u.name, (SELECT AVG(qa.score_percentage) FROM quiz_attempts qa WHERE qa.student_id = u.id AND qa.status = 'GRADED') AS avg_score FROM users u WHERE u.class_id = ? AND u.role = 'STUDENT' ORDER BY avg_score DESC`).all(req.user.class_id);
  const rank = students.findIndex(s => s.id === req.user.id) + 1;
  res.json({ rank, total_students: students.length, leaderboard: students.slice(0, 5) });
});
router.get('/reports/topics/:classId', auth, (req, res) => {
  if (req.user.role !== 'TEACHER' && req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
  const topics = db.prepare(`SELECT q.topic, AVG(qa.score_percentage) AS avg_score, COUNT(qa.id) AS attempts FROM quiz_attempts qa JOIN quizzes q ON qa.quiz_id = q.id WHERE q.class_id = ? AND qa.status = 'GRADED' GROUP BY q.topic ORDER BY avg_score ASC`).all(req.params.classId);
  res.json(topics);
});
router.get('/students/:id/progress', auth, (req, res) => {
  if (req.user.role !== 'PARENT' && req.user.role !== 'STUDENT') return res.status(403).json({ error: 'Forbidden' });
  const attempts = db.prepare(`SELECT qa.score_percentage, qa.timestamp, q.title, q.topic FROM quiz_attempts qa JOIN quizzes q ON qa.quiz_id = q.id WHERE qa.student_id = ? AND qa.status = 'GRADED' ORDER BY qa.timestamp DESC`).all(req.params.id);
  res.json(attempts);
});
router.get('/reports/class/:classId', auth, (req, res) => {
  if (req.user.role !== 'TEACHER' && req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
  const students = db.prepare(`SELECT id, name FROM users WHERE class_id=? AND role='STUDENT'`).all(req.params.classId);
  const attempts = db.prepare(`SELECT qa.*, q.topic FROM quiz_attempts qa JOIN quizzes q ON qa.quiz_id=q.id WHERE qa.student_id IN (SELECT id FROM users WHERE class_id=?)`).all(req.params.classId);
  res.json({ students, attempts });
});

module.exports = router;