require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const { db, init } = require('./db');
const authRoutes = require('./routes/auth');
const quizRoutes = require('./routes/quiz');
const paymentRoutes = require('./routes/payment');

init();
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/payment', paymentRoutes);

// CSV Export
app.get('/api/export/:type', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.headers['x-user-id']);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { type } = req.params;
  let headers, rows;
  if (type === 'transactions') {
    headers = ['id', 'timestamp', 'trans_type', 'amount', 'balance_after', 'description'];
    if (user.role === 'DEV') rows = db.prepare(`SELECT ${headers.join(',')} FROM transactions ORDER BY timestamp DESC`).all();
    else rows = db.prepare(`SELECT t.${headers.join(',t.')} FROM transactions t JOIN wallets w ON t.wallet_id = w.id WHERE w.user_id = ? ORDER BY t.timestamp DESC`).all(user.id);
  } else return res.status(400).json({ error: 'Invalid export type' });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = headers.map(esc).join(',') + '\n' + rows.map(r => headers.map(h => esc(r[h])).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${type}.csv"`);
  res.status(200).send(csv);
});

// Dev Routes
app.get('/api/dev/overview', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.headers['x-user-id']);
  if (!u || u.role !== 'DEV') return res.status(403).json({ error: 'Dev only' });
  const totals = db.prepare(`SELECT SUM(CASE WHEN trans_type='DEPOSIT' THEN amount ELSE 0 END) AS deposits, SUM(CASE WHEN trans_type='DEV_FEE' THEN amount ELSE 0 END) AS devFees FROM transactions`).get();
  const schools = db.prepare('SELECT s.*, u.username AS admin_user FROM schools s LEFT JOIN users u ON s.id=u.school_id AND u.role="ADMIN"').all();
  const devWallet = db.prepare('SELECT * FROM wallets WHERE id=?').get(1);
  res.json({ totals, schools, devWallet });
});

app.post('/api/dev/schools/:id/approve', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.headers['x-user-id']);
  if (!u || u.role !== 'DEV') return res.status(403).json({ error: 'Dev only' });
  db.prepare('UPDATE schools SET approved=1 WHERE id=?').run(req.params.id);
  res.json({ message: 'Approved' });
});

app.post('/api/dev/schools/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.headers['x-user-id']);
  if (!u || u.role !== 'DEV') return res.status(403).json({ error: 'Dev only' });
  const { name, code, support_email } = req.body;
  db.prepare('UPDATE schools SET name=COALESCE(?,name), code=COALESCE(?,code), support_email=COALESCE(?,support_email) WHERE id=?').run(name, code, support_email, req.params.id);
  res.json({ message: 'Updated' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 SCHOOLAR HUB UG running on port ${PORT}`));