const express = require('express');
const { db } = require('../db');
const momo = require('../momoService');
const router = express.Router();
const FEE = parseFloat(process.env.PLATFORM_FEE_RATE || '0.05');
const DEV_WID = parseInt(process.env.DEV_WALLET_ID || '1');

function auth(req, res, next) {
  const id = req.headers['x-user-id'];
  req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

router.post('/deposit', auth, async (req, res) => {
  const { phone, amount, student_id } = req.body;
  const tId = student_id || req.user.id;
  const w = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(tId);
  if (!w) return res.status(404).json({ error: 'Wallet not found' });
  const ref = momo.genRef();
  try {
    await momo.deposit(phone, amount, ref);
    db.prepare(`INSERT INTO pending_deposits (reference_id, wallet_id, phone, amount) VALUES (?, ?, ?, ?)`).run(ref, w.id, phone, amount);
    res.json({ ref, status: 'PENDING' });
  } catch (e) { res.status(502).json({ error: 'MoMo Error' }); }
});

router.get('/status/:ref', auth, async (req, res) => {
  const p = db.prepare('SELECT * FROM pending_deposits WHERE reference_id=?').get(req.params.ref);
  try {
    const r = await momo.status(req.params.ref);
    if (r.status === 'SUCCESSFUL' && p.status === 'PENDING') {
      db.transaction(() => {
        const amt = parseFloat(p.amount), f = amt*FEE, net = amt-f;
        const w = db.prepare('SELECT * FROM wallets WHERE id=?').get(p.wallet_id);
        const dW = db.prepare('SELECT * FROM wallets WHERE id=?').get(DEV_WID);
        const nP = w.play_balance + net;
        db.prepare('UPDATE wallets SET play_balance=? WHERE id=?').run(nP, w.id);
        db.prepare(`INSERT INTO transactions (wallet_id, trans_type, amount, balance_after, description) VALUES (?, 'DEPOSIT', ?, ?, ?)`).run(w.id, net, nP, 'Deposit');
        const nD = dW.play_balance + f;
        db.prepare('UPDATE wallets SET play_balance=? WHERE id=?').run(nD, dW.id);
        db.prepare(`INSERT INTO transactions (wallet_id, trans_type, amount, balance_after, description) VALUES (?, 'DEV_FEE', ?, ?, ?)`).run(dW.id, f, nD, 'Fee');
        db.prepare('UPDATE pending_deposits SET status="COMPLETED" WHERE id=?').run(p.id);
      })();
    }
    res.json({ status: r.status });
  } catch (e) { res.json({ status: 'PENDING' }); }
});

router.post('/withdraw', auth, async (req, res) => {
  const { amount, student_id, wallet_type } = req.body;
  const w = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(student_id || req.user.id);
  const fld = wallet_type === 'savings' ? 'savings_balance' : 'play_balance';
  if (w[fld] < amount) return res.status(400).json({ error: 'Insufficient' });
  const ref = momo.genRef(), f = amount*FEE, net = amount-f;
  try {
    await momo.withdraw(net, ref);
    db.transaction(() => {
      const nB = w[fld] - amount;
      db.prepare(`UPDATE wallets SET ${fld}=? WHERE id=?`).run(nB, w.id);
      db.prepare(`INSERT INTO transactions (wallet_id, trans_type, amount, balance_after, description) VALUES (?, 'WITHDRAWAL', ?, ?, ?)`).run(w.id, amount, nB, 'Withdraw');
      const dW = db.prepare('SELECT * FROM wallets WHERE id=?').get(DEV_WID);
      const nD = dW.play_balance + f;
      db.prepare('UPDATE wallets SET play_balance=? WHERE id=?').run(nD, dW.id);
      db.prepare(`INSERT INTO transactions (wallet_id, trans_type, amount, balance_after, description) VALUES (?, 'DEV_FEE', ?, ?, ?)`).run(dW.id, f, nD, 'Fee');
    })();
    res.json({ status: 'PENDING' });
  } catch (e) { res.status(502).json({ error: 'MoMo Error' }); }
});

module.exports = router;