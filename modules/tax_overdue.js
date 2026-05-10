// ============================================
// 세금 부과 시스템 (Tax Bills)
// 교사가 학생들에게 세금 청구서를 부과하고,
// 기한 내 미납 시 신용도 자동 감점
// ============================================

import {
  db,
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, writeBatch
} from "../firebase-config.js";
import { processTransaction } from "./transactions.js";
import { changeCreditScore, CREDIT_DELTAS } from "./savings.js";
import {
  TREASURY_ID, toast, openModal, closeModal,
  escapeHtml, formatMoney, formatDateOnly
} from "./utils.js";

// ============================================
// 교사: 세금 청구서 발급
// ============================================
export function openTaxBillModal(students) {
  if (!students || students.length === 0) {
    toast('학생이 없습니다', 'error');
    return;
  }

  // 기본 마감일: 7일 후
  const defaultDue = new Date();
  defaultDue.setDate(defaultDue.getDate() + 7);
  const defaultDueStr = defaultDue.toISOString().slice(0, 10);

  openModal(`
    <h2>📋 세금 부과</h2>
    <p class="hint">학생들에게 세금 청구서를 발급합니다. 기한 내 미납 시 신용도가 자동 감점됩니다.</p>

    <form id="tax-bill-form" class="modal-form">
      <div class="input-group">
        <label>세금 종류</label>
        <select id="tb-type" required>
          <option value="소득세">소득세</option>
          <option value="재산세">재산세</option>
          <option value="자리세">자리세</option>
          <option value="벌금">벌금</option>
          <option value="기타">기타</option>
        </select>
      </div>

      <div class="input-group">
        <label>금액 (원)</label>
        <input type="number" id="tb-amount" required min="1" placeholder="모든 학생 동일 금액" />
      </div>

      <div class="input-group">
        <label>마감일</label>
        <input type="date" id="tb-due" required value="${defaultDueStr}" />
        <small style="font-size:12px;color:#6B7280">이 날까지 납부 안 하면 신용도 ${CREDIT_DELTAS.taxOverdue}점</small>
      </div>

      <div class="input-group">
        <label>대상 학생</label>
        <div style="background:#F9FAFB;padding:10px;border-radius:8px;border:1px solid #E5E7EB">
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer">
            <input type="checkbox" id="tb-all" checked onchange="window.toggleAllStudents(this.checked)" />
            <strong>전체 선택</strong> (${students.length}명)
          </label>
          <div style="max-height:140px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
            ${students.map(s => `
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
                <input type="checkbox" class="tb-student" value="${s.id}" checked />
                ${s.number}번 ${escapeHtml(s.name)}
              </label>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="input-group">
        <label>설명 (선택)</label>
        <input type="text" id="tb-desc" placeholder="예: 3월 자리세" />
      </div>

      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">취소</button>
        <button type="submit" class="btn-primary">부과하기</button>
      </div>
    </form>
  `);

  document.getElementById('tax-bill-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('tb-type').value;
    const amount = parseInt(document.getElementById('tb-amount').value);
    const dueDateStr = document.getElementById('tb-due').value;
    const desc = document.getElementById('tb-desc').value.trim();
    const selectedIds = Array.from(document.querySelectorAll('.tb-student:checked')).map(c => c.value);

    if (selectedIds.length === 0) {
      toast('대상 학생을 선택하세요', 'error');
      return;
    }
    if (!dueDateStr) {
      toast('마감일을 선택하세요', 'error');
      return;
    }

    const dueDate = new Date(dueDateStr + 'T23:59:59'); // 마감일은 그날 자정까지

    const batch = writeBatch(db);
    selectedIds.forEach(studentId => {
      const billRef = doc(collection(db, 'tax_bills'));
      batch.set(billRef, {
        studentId,
        type,
        amount,
        description: desc,
        dueDate,
        paid: false,
        overdue: false,
        createdAt: serverTimestamp()
      });
    });
    await batch.commit();

    closeModal();
    toast(`${selectedIds.length}명에게 ${type} 부과 완료 (${formatMoney(amount)})`, 'success');
  });
}

window.toggleAllStudents = (checked) => {
  document.querySelectorAll('.tb-student').forEach(c => c.checked = checked);
};

// ============================================
// 교사: 부과된 세금 목록 보기
// ============================================
export async function openTaxBillsListModal(students) {
  const snap = await getDocs(query(collection(db, 'tax_bills'), orderBy('createdAt', 'desc')));
  const bills = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const studentMap = Object.fromEntries(students.map(s => [s.id, s]));

  const unpaid = bills.filter(b => !b.paid);
  const overdue = bills.filter(b => !b.paid && b.dueDate?.toDate && new Date() > b.dueDate.toDate());
  const paid = bills.filter(b => b.paid);

  openModal(`
    <h2>📋 부과된 세금 현황</h2>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
      <div style="background:#FEF3C7;padding:10px;border-radius:8px;text-align:center">
        <div style="font-size:11px;color:#D97706">미납</div>
        <div style="font-size:18px;font-weight:700;color:#D97706">${unpaid.length}건</div>
      </div>
      <div style="background:#FEE2E2;padding:10px;border-radius:8px;text-align:center">
        <div style="font-size:11px;color:#DC2626">연체 중</div>
        <div style="font-size:18px;font-weight:700;color:#DC2626">${overdue.length}건</div>
      </div>
      <div style="background:#ECFDF5;padding:10px;border-radius:8px;text-align:center">
        <div style="font-size:11px;color:#059669">납부 완료</div>
        <div style="font-size:18px;font-weight:700;color:#047857">${paid.length}건</div>
      </div>
    </div>

    ${overdue.length > 0 ? `
      <div style="background:#FEE2E2;border:1px solid #FCA5A5;padding:10px;border-radius:8px;margin-bottom:12px">
        <strong style="color:#DC2626">⚠️ 연체된 ${overdue.length}건이 있습니다</strong>
        <p style="font-size:12px;color:#991B1B;margin-top:4px">
          연체 처리 시 해당 학생들의 신용도가 ${CREDIT_DELTAS.taxOverdue}점 차감됩니다.
        </p>
        <button class="btn-danger" style="margin-top:6px;font-size:13px" onclick="window.processOverdue()">연체 처리 (신용도 감점)</button>
      </div>
    ` : ''}

    <div style="max-height:50vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px">
      ${bills.length === 0 ? '<div class="empty-state">부과된 세금이 없습니다.</div>' :
        bills.map(b => {
          const student = studentMap[b.studentId];
          const studentLabel = student ? `${student.number}번 ${student.name}` : b.studentId;
          const dueDate = b.dueDate?.toDate ? b.dueDate.toDate() : null;
          const isOverdue = !b.paid && dueDate && new Date() > dueDate;
          const status = b.paid
            ? '<span style="color:#059669">✅ 납부완료</span>'
            : isOverdue
              ? `<span style="color:#DC2626">🚨 연체${b.overdue ? ' (감점완료)' : ''}</span>`
              : '<span style="color:#D97706">⏳ 미납</span>';

          return `
            <div class="transaction-item">
              <div class="transaction-info">
                <div class="transaction-title">${escapeHtml(studentLabel)} - ${escapeHtml(b.type)}</div>
                <div class="transaction-meta">
                  마감 ${formatDateOnly(dueDate)} · ${status}
                  ${b.description ? ' · ' + escapeHtml(b.description) : ''}
                </div>
              </div>
              <div style="display:flex;gap:6px;align-items:center">
                <span class="transaction-amount">${formatMoney(b.amount)}</span>
                ${!b.paid ? `<button class="btn-danger" onclick="window.deleteTaxBill('${b.id}')" style="font-size:11px;padding:4px 8px">취소</button>` : ''}
              </div>
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

// 교사가 미납 세금을 취소
window.deleteTaxBill = async (billId) => {
  if (!confirm('이 세금 청구서를 취소하시겠습니까?')) return;
  await deleteDoc(doc(db, 'tax_bills', billId));
  toast('세금이 취소되었습니다');
  closeModal();
};

// 교사가 연체 처리 일괄 실행
window.processOverdue = async () => {
  if (!confirm('연체된 세금 모두에 대해 신용도를 감점하시겠습니까?')) return;
  const snap = await getDocs(collection(db, 'tax_bills'));
  const bills = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(b => !b.paid && !b.overdue);
  const now = new Date();
  let processed = 0;

  for (const bill of bills) {
    const dueDate = bill.dueDate?.toDate ? bill.dueDate.toDate() : null;
    if (!dueDate || now <= dueDate) continue;

    // 신용도 감점
    await changeCreditScore(bill.studentId, CREDIT_DELTAS.taxOverdue, `${bill.type} 연체`);
    // 연체 표시
    await updateDoc(doc(db, 'tax_bills', bill.id), { overdue: true, overdueAt: serverTimestamp() });
    processed++;
  }

  closeModal();
  toast(`${processed}건 연체 처리 완료 (각 ${CREDIT_DELTAS.taxOverdue}점 감점)`, processed > 0 ? 'success' : '');
};

// ============================================
// 학생: 본인의 미납 세금 조회 + 납부
// ============================================
export async function openMyTaxBillsModal(currentUser) {
  // 인덱스 회피: where 1개만 사용, 나머지는 클라이언트 필터/정렬
  const snap = await getDocs(query(
    collection(db, 'tax_bills'),
    where('studentId', '==', currentUser.uid)
  ));
  const unpaidBills = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(b => !b.paid)
    .sort((a, b) => (a.dueDate?.seconds || 0) - (b.dueDate?.seconds || 0));

  // 부과된 세금이 없으면 기존 자유 세금 납부 화면으로 폴백
  if (unpaidBills.length === 0) {
    openFreeTaxModal(currentUser);
    return;
  }

  openModal(`
    <h2>📋 세금 납부</h2>
    <p class="hint">현재 잔액: ${formatMoney(currentUser.balance || 0)}</p>

    <h3 style="font-size:15px;margin-top:12px">📌 부과된 세금 (${unpaidBills.length}건)</h3>
    <div style="display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow-y:auto">
      ${unpaidBills.map(b => {
        const dueDate = b.dueDate?.toDate ? b.dueDate.toDate() : null;
        const now = new Date();
        const isOverdue = dueDate && now > dueDate;
        const daysLeft = dueDate ? Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24)) : 0;
        const canPay = (currentUser.balance || 0) >= b.amount;

        return `
          <div class="savings-card" style="border-color:${isOverdue ? '#FCA5A5' : daysLeft <= 1 ? '#FCD34D' : '#E5E7EB'}">
            <div style="display:flex;justify-content:space-between;align-items:start">
              <div>
                <div style="font-weight:600">${escapeHtml(b.type)}${b.description ? ` - ${escapeHtml(b.description)}` : ''}</div>
                <div style="font-size:12px;color:${isOverdue ? '#DC2626' : '#6B7280'}">
                  마감: ${formatDateOnly(dueDate)}
                  ${isOverdue ? ` · 🚨 연체 중!` : daysLeft <= 1 ? ` · ⚠️ 오늘 마감!` : ` · ${daysLeft}일 남음`}
                </div>
              </div>
              <div style="font-weight:700">${formatMoney(b.amount)}</div>
            </div>
            <button class="btn-primary" style="width:100%;margin-top:8px"
              ${canPay ? '' : 'disabled style="opacity:0.5;cursor:not-allowed"'}
              onclick="window.payTaxBill('${b.id}', ${b.amount}, '${escapeHtml(b.type)}')">
              ${canPay ? `${formatMoney(b.amount)} 납부` : '잔액 부족'}
            </button>
          </div>
        `;
      }).join('')}
    </div>

    <div class="modal-actions">
      <button class="btn-secondary" onclick="window.openFreeTax()">자유 납부 (선납)</button>
      <button class="btn-secondary" onclick="window.closeModal()">닫기</button>
    </div>
  `);
}

let __studentCtx = null;
export function setStudentContext(user) {
  __studentCtx = user;
}

window.payTaxBill = async (billId, amount, type) => {
  if (!__studentCtx) return;
  if ((__studentCtx.balance || 0) < amount) {
    toast('잔액이 부족합니다', 'error');
    return;
  }

  try {
    // 거래 처리 (학생 → 국고)
    await processTransaction({
      type: 'tax',
      from: __studentCtx.uid,
      to: TREASURY_ID,
      amount: amount,
      reason: type
    });

    // 세금 청구서 납부 표시
    await updateDoc(doc(db, 'tax_bills', billId), {
      paid: true,
      paidAt: serverTimestamp()
    });

    closeModal();
    toast('납부 완료! 국고에 입금되었습니다', 'success');
  } catch (err) {
    toast('실패: ' + err.message, 'error');
  }
};

window.openFreeTax = () => {
  if (!__studentCtx) return;
  openFreeTaxModal(__studentCtx);
};

// 자유 납부 (기존 방식)
function openFreeTaxModal(currentUser) {
  openModal(`
    <h2>세금 자유 납부</h2>
    <p class="hint">납부한 세금/벌금은 학급 국고로 들어갑니다</p>
    <form id="free-tax-form" class="modal-form">
      <div class="input-group">
        <label>세금 종류</label>
        <select id="ftax-type" required>
          <option value="소득세">소득세</option>
          <option value="재산세">재산세</option>
          <option value="자리세">자리세</option>
          <option value="벌금">벌금</option>
          <option value="기타">기타</option>
        </select>
      </div>
      <div class="input-group">
        <label>금액 (원)</label>
        <input type="number" id="ftax-amount" required min="1" max="${currentUser.balance || 0}" />
      </div>
      <p class="hint">현재 잔액: ${formatMoney(currentUser.balance || 0)}</p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">취소</button>
        <button type="submit" class="btn-primary">납부</button>
      </div>
    </form>
  `);

  document.getElementById('free-tax-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('ftax-type').value;
    const amount = parseInt(document.getElementById('ftax-amount').value);
    if (amount > (currentUser.balance || 0)) {
      toast('잔액이 부족합니다', 'error');
      return;
    }
    await processTransaction({
      type: 'tax', from: currentUser.uid, to: TREASURY_ID, amount, reason: type
    });
    closeModal();
    toast('납부 완료', 'success');
  });
}
