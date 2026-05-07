// ============================================
// 적금/예금 (Savings)
// ============================================

import {
  db,
  collection, doc, getDoc, getDocs, addDoc, updateDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, writeBatch
} from "../firebase-config.js";
import { processTransaction } from "./transactions.js";
import {
  toast, openModal, closeModal, escapeHtml, formatMoney, formatDateOnly
} from "./utils.js";

// 적금 상품 (교사가 설정 가능하지만 우선 고정)
export const SAVINGS_PRODUCTS = [
  { id: '7d',  name: '7일 적금',  days: 7,  rate: 0.02 }, // 2%
  { id: '14d', name: '14일 적금', days: 14, rate: 0.05 }, // 5%
  { id: '30d', name: '30일 적금', days: 30, rate: 0.10 }  // 10%
];

let __studentCtx = null;

export function setStudentContext(user) {
  __studentCtx = user;
}

// ============================================
// 학생: 적금 모달
// ============================================
export async function openSavingsModal(currentUser) {
  __studentCtx = currentUser;

  // 본인 적금 목록
  const snap = await getDocs(query(
    collection(db, 'savings'),
    where('studentId', '==', currentUser.uid),
    orderBy('createdAt', 'desc')
  ));
  const mySavings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const active = mySavings.filter(s => !s.withdrawn);

  openModal(`
    <h2>🏦 적금</h2>
    <p class="hint">현재 잔액: ${formatMoney(currentUser.balance || 0)}</p>

    <h3 style="margin-top:16px;font-size:15px">📌 적금 상품</h3>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
      ${SAVINGS_PRODUCTS.map(p => `
        <div class="savings-product">
          <div>
            <div style="font-weight:600">${p.name}</div>
            <div style="font-size:12px;color:#6B7280">만기 시 +${(p.rate * 100).toFixed(0)}% 이자</div>
          </div>
          <button class="btn-primary" onclick="window.openDepositForm('${p.id}')">예금하기</button>
        </div>
      `).join('')}
    </div>

    <h3 style="margin-top:16px;font-size:15px">💼 내 적금 (${active.length}건)</h3>
    ${active.length === 0 ? '<p class="hint">진행 중인 적금이 없습니다.</p>' :
      `<div style="display:flex;flex-direction:column;gap:8px;max-height:30vh;overflow-y:auto">
        ${active.map(s => renderSavingsCard(s)).join('')}
      </div>`
    }

    <div class="modal-actions">
      <button class="btn-secondary" onclick="window.closeModal()">닫기</button>
    </div>
  `);
}

function renderSavingsCard(s) {
  const matureDate = s.matureAt?.toDate ? s.matureAt.toDate() : null;
  const now = new Date();
  const isMatured = matureDate && now >= matureDate;
  const interest = Math.floor(s.amount * s.rate);
  const total = s.amount + interest;
  const daysLeft = matureDate ? Math.max(0, Math.ceil((matureDate - now) / (1000 * 60 * 60 * 24))) : 0;

  return `
    <div class="savings-card">
      <div style="display:flex;justify-content:space-between;align-items:start">
        <div>
          <div style="font-weight:600">${escapeHtml(s.productName)}</div>
          <div style="font-size:12px;color:#6B7280">만기일: ${formatDateOnly(matureDate)}</div>
          <div style="font-size:12px;color:#6B7280">${isMatured ? '✅ 만기 도달!' : `D-${daysLeft}`}</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:600">${formatMoney(s.amount)}</div>
          <div style="font-size:12px;color:#10B981">+${formatMoney(interest)} 이자</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px">
        ${isMatured
          ? `<button class="btn-primary" style="flex:1" onclick="window.withdrawSavings('${s.id}', true)">${formatMoney(total)} 받기</button>`
          : `<button class="btn-secondary" style="flex:1" onclick="window.withdrawSavings('${s.id}', false)">중도 해지 (이자 없음)</button>`
        }
      </div>
    </div>
  `;
}

// 예금 폼
window.openDepositForm = async (productId) => {
  const product = SAVINGS_PRODUCTS.find(p => p.id === productId);
  if (!product) return;

  openModal(`
    <h2>${product.name} 예금</h2>
    <p class="hint">만기 시 원금 + ${(product.rate * 100).toFixed(0)}% 이자를 받습니다.</p>
    <form id="deposit-form" class="modal-form">
      <div class="input-group">
        <label>예금할 금액</label>
        <input type="number" id="dep-amount" required min="100" max="${__studentCtx.balance || 0}" placeholder="최소 100원" />
      </div>
      <p class="hint">현재 잔액: ${formatMoney(__studentCtx.balance || 0)}</p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">취소</button>
        <button type="submit" class="btn-primary">예금하기</button>
      </div>
    </form>
  `);

  document.getElementById('deposit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseInt(document.getElementById('dep-amount').value);
    if (amount > (__studentCtx.balance || 0)) {
      toast('잔액이 부족합니다', 'error');
      return;
    }

    try {
      // 1) 학생 잔액에서 차감 (TREASURY로 이동 - 적금은 학교에 맡긴 셈)
      await processTransaction({
        type: 'deposit',
        from: __studentCtx.uid,
        to: 'TREASURY',
        amount: amount,
        reason: `${product.name} 예금`
      });

      // 2) 적금 레코드 생성
      const matureAt = new Date();
      matureAt.setDate(matureAt.getDate() + product.days);

      await addDoc(collection(db, 'savings'), {
        studentId: __studentCtx.uid,
        productId: product.id,
        productName: product.name,
        amount: amount,
        rate: product.rate,
        days: product.days,
        matureAt: matureAt,
        withdrawn: false,
        createdAt: serverTimestamp()
      });

      closeModal();
      toast(`${product.name}에 ${formatMoney(amount)} 예금 완료!`, 'success');
    } catch (err) {
      toast('실패: ' + err.message, 'error');
    }
  });
};

// 적금 해지 (만기 또는 중도)
window.withdrawSavings = async (savingsId, isMatured) => {
  const snap = await getDoc(doc(db, 'savings', savingsId));
  if (!snap.exists()) return;
  const s = snap.data();

  if (s.withdrawn) {
    toast('이미 해지된 적금입니다', 'error');
    return;
  }

  const interest = isMatured ? Math.floor(s.amount * s.rate) : 0;
  const total = s.amount + interest;
  const msg = isMatured
    ? `만기 적금을 해지합니다.\n원금 ${formatMoney(s.amount)} + 이자 ${formatMoney(interest)} = 총 ${formatMoney(total)}`
    : `⚠️ 중도 해지 시 이자 없이 원금만 돌려받습니다.\n${formatMoney(s.amount)}을 받으시겠습니까?`;
  if (!confirm(msg)) return;

  try {
    // 원금 + 이자 환급 (TREASURY → 학생)
    await processTransaction({
      type: isMatured ? 'interest' : 'withdrawal',
      from: 'TREASURY',
      to: s.studentId,
      amount: total,
      reason: isMatured ? `${s.productName} 만기 (원금+이자)` : `${s.productName} 중도해지`
    });

    await updateDoc(doc(db, 'savings', savingsId), {
      withdrawn: true,
      withdrawnAt: serverTimestamp(),
      withdrawnAmount: total,
      withdrawnInterest: interest
    });

    closeModal();
    toast(`${formatMoney(total)} 입금 완료!`, 'success');
  } catch (err) {
    toast('실패: ' + err.message, 'error');
  }
};

// ============================================
// 교사: 전체 적금 현황 보기 (선택)
// ============================================
export async function openAllSavingsModal(students) {
  const snap = await getDocs(query(collection(db, 'savings'), orderBy('createdAt', 'desc')));
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const studentMap = Object.fromEntries(students.map(s => [s.id, s]));

  const active = all.filter(s => !s.withdrawn);
  const totalActive = active.reduce((sum, s) => sum + s.amount, 0);

  openModal(`
    <h2>🏦 전체 적금 현황</h2>
    <p class="hint">진행 중인 적금: ${active.length}건 / 총 ${formatMoney(totalActive)}</p>
    <div style="max-height:60vh;overflow-y:auto;display:flex;flex-direction:column;gap:8px">
      ${all.length === 0 ? '<div class="empty-state">적금 데이터가 없습니다.</div>' :
        all.map(s => {
          const student = studentMap[s.studentId];
          const studentLabel = student ? `${student.number}번 ${student.name}` : s.studentId;
          const matureDate = s.matureAt?.toDate ? s.matureAt.toDate() : null;
          const status = s.withdrawn
            ? `해지 (${formatMoney(s.withdrawnAmount || s.amount)})`
            : (new Date() >= matureDate ? '만기' : 'D-' + Math.ceil((matureDate - new Date()) / (1000*60*60*24)));
          return `
            <div class="transaction-item">
              <div class="transaction-info">
                <div class="transaction-title">${escapeHtml(studentLabel)} - ${escapeHtml(s.productName)}</div>
                <div class="transaction-meta">만기: ${formatDateOnly(matureDate)} · 상태: ${status}</div>
              </div>
              <div class="transaction-amount">${formatMoney(s.amount)}</div>
            </div>
          `;
        }).join('')
      }
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="window.closeModal()">닫기</button>
    </div>
  `);
}
