const { db } = require('./db');
const DEV_WID = parseInt(process.env.DEV_WALLET_ID || '1');
const FEE = parseFloat(process.env.PLATFORM_FEE_RATE || '0.05');

function startQuiz(studentId, quizId, stakeAmount) {
  const w = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(studentId);
  if (!w || w.play_balance < stakeAmount) throw new Error('Insufficient play balance');
  if (db.prepare('SELECT id FROM quiz_attempts WHERE student_id=? AND quiz_id=? AND status="GRADED"').get(studentId, quizId)) throw new Error('Quiz already attempted');
  
  return db.transaction(() => {
    const nB = w.play_balance - stakeAmount;
    db.prepare('UPDATE wallets SET play_balance=? WHERE id=?').run(nB, w.id);
    db.prepare(`INSERT INTO transactions (wallet_id, trans_type, amount, balance_after, description) VALUES (?, 'STAKE', ?, ?, ?)`).run(w.id, stakeAmount, nB, `Stake for quiz`);
    return db.prepare(`INSERT INTO quiz_attempts (student_id, quiz_id, stake_amount, status) VALUES (?, ?, ?, 'PENDING')`).run(studentId, quizId, stakeAmount).lastInsertRowid;
  })();
}

function calcScore(ans, qs) { let c=0; qs.forEach((q,i)=>{ if((ans[i]||'').toUpperCase()===(q.correct_option||'').toUpperCase()) c++; }); return (c/qs.length)*100; }

function grade(attemptId, score) {
  const a = db.prepare('SELECT * FROM quiz_attempts WHERE id=?').get(attemptId);
  if (!a || a.status==='GRADED') throw new Error('Invalid attempt');
  const sW = db.prepare('SELECT * FROM wallets WHERE user_id=?').get(a.student_id);
  const dW = db.prepare('SELECT * FROM wallets WHERE id=?').get(DEV_WID);
  const sk = a.stake_amount;

  db.transaction(() => {
    const log = (wId, t, am, bal, d) => db.prepare(`INSERT INTO transactions (wallet_id, trans_type, amount, balance_after, description) VALUES (?, ?, ?, ?, ?)`).run(wId, t, am, bal, d);
    if (score < 30) { const f=sk*FEE, s=sk-f; const nS=sW.savings_balance+s; db.prepare('UPDATE wallets SET savings_balance=? WHERE id=?').run(nS, sW.id); log(sW.id,'SAVINGS_REDIRECT',s,nS,'Saved'); const nD=dW.play_balance+f; db.prepare('UPDATE wallets SET play_balance=? WHERE id=?').run(nD, dW.id); log(dW.id,'DEV_FEE',f,nD,'Fee'); }
    else if (score < 40) { const nP=sW.play_balance+sk; db.prepare('UPDATE wallets SET play_balance=? WHERE id=?').run(nP, sW.id); log(sW.id,'WIN',sk,nP,'1x'); }
    else if (score < 60) { const p=sk, f=p*FEE, r=sk+p-f; const nP=sW.play_balance+r; db.prepare('UPDATE wallets SET play_balance=? WHERE id=?').run(nP, sW.id); log(sW.id,'WIN',r,nP,'2x'); const nD=dW.play_balance+f; db.prepare('UPDATE wallets SET play_balance=? WHERE id=?').run(nD, dW.id); log(dW.id,'DEV_FEE',f,nD,'Fee'); }
    else if (score < 80) { const p=2*sk, f=p*FEE, r=sk+p-f; const nP=sW.play_balance+r; db.prepare('UPDATE wallets SET play_balance=? WHERE id=?').run(nP, sW.id); log(sW.id,'WIN',r,nP,'3x'); const nD=dW.play_balance+f; db.prepare('UPDATE wallets SET play_balance=? WHERE id=?').run(nD, dW.id); log(dW.id,'DEV_FEE',f,nD,'Fee'); }
    else { const p=3*sk, f=p*FEE, r=sk+p-f; const nP=sW.play_balance+r; db.prepare('UPDATE wallets SET play_balance=? WHERE id=?').run(nP, sW.id); log(sW.id,'WIN',r,nP,'4x'); const nD=dW.play_balance+f; db.prepare('UPDATE wallets SET play_balance=? WHERE id=?').run(nD, dW.id); log(dW.id,'DEV_FEE',f,nD,'Fee'); }
    db.prepare('UPDATE quiz_attempts SET score_percentage=?, status="GRADED" WHERE id=?').run(score, attemptId);
  })();

  const u = db.prepare('SELECT * FROM wallets WHERE id=?').get(sW.id);
  return { attemptId, score: Number(score.toFixed(2)), playBalance: u.play_balance, savingsBalance: u.savings_balance };
}
module.exports = { startQuiz, calcScore, grade };