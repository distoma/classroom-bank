// ============================================
// 적금/예금 (Savings) v2 - 신용도 시스템
// ============================================

import {
  db,
  collection, doc, getDoc, getDocs, addDoc, updateDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, increment, writeBatch
} from "../firebase-config.js";
import { processTransaction } from "./transactions.js";
import {
  toast, openModal, closeModal, escapeHtml, formatMoney, formatDateOnly
} from "./utils.js";

// ============================================
// 신용도 등급 정의
// ============================================
// 점수 기반 등급 시스템 (학생당 creditScore 보유)
// 시작: 30점 (3등급)
// 격차 큰 편 (1등급 0.2배 ~ 5등급 2.0배)
// 8주 적금 기준: 1등급 0.5% / 5등급 5%
export const CREDIT_TIERS = [
  { tier: 1, name: '신용 부족',  emoji: '⭐',         minScore: 0,  rateMultiplier: 0.2, color: '#EF4444' },
  { tier: 2, name: '주의',       emoji: '⭐⭐',       minScore: 15, rateMultiplier: 0.5, color: '#F59E0B' },
  { tier: 3, name: '기본',       emoji: '⭐⭐⭐',     minScore: 30, rateMultiplier: 1.0, color: '#6B7280' },
  { tier: 4, name: '우수',       emoji: '⭐⭐⭐⭐',   minScore: 50, rateMultiplier: 1.5, color: '#10B981' },
  { tier: 5, name: '최고',       emoji: '⭐⭐⭐⭐⭐', minScore: 80, rateMultiplier: 2.0, color: '#059669' }
];

export const STARTING_CREDIT_SCORE = 30; // 3등급 시작점

// 신용도 변동 정책 (자동)
export const CREDIT_DELTAS = {
  matured: 1,         // 적금 만기 완료 +1점
  maturedBig: 2,      // 큰 금액(1000원 이상) 만기 +2점
  withdrawn: -2,      // 중도 해지 -2점
  taxOverdue: -3,     // 세금 연체 (기한 내 미납) -3점
};

// ============================================
// 적금 기간 옵션 (2주 단위, 4단계)
// ============================================
// 기준: 8주 + 5등급 = 5% (격차 큰 편)
// 8주 baseRate 0.025 × 5등급 2.0배 = 5%
// 8주 baseRate 0.025 × 1등급 0.2배 = 0.5%
export const SAVINGS_DURATIONS = [
  { id: '2w', weeks: 2, days: 14, baseRate: 0.00625 }, // 2주: 1등급 0.125% / 5등급 1.25%
  { id: '4w', weeks: 4, days: 28, baseRate: 0.0125 },  // 4주: 1등급 0.25%  / 5등급 2.5%
  { id: '6w', weeks: 6, days: 42, baseRate: 0.01875 }, // 6주: 1등급 0.375% / 5등급 3.75%
  { id: '8w', weeks: 8, days: 56, baseRate: 0.025 }    // 8주: 1등급 0.5%   / 5등급 5%
];

// ============================================
// 헬퍼 함수
// ============================================

// 점수로 현재 등급 계산
export function getCreditTier(score = STARTING_CREDIT_SCORE) {
  // 높은 점수부터 검사 (역순)
  for (let i = CREDIT_TIERS.length - 1; i >= 0; i--) {
    if (score >= CREDIT_TIERS[i].minScore) return CREDIT_TIERS[i];
  }
  return CREDIT_TIERS[0];
}

// 다음 등급까지 필요한 점수
export function getScoreToNextTier(score) {
  const current = getCreditTier(score);
  const next = CREDIT_TIERS.find(t => t.tier === current.tier + 1);
  if (!next) return null; // 최고 등급
  return next.minScore - score;
}

// 최종 이자율 = 기간 기본이자율 × 신용도 배율
export function calculateRate(durationId, creditScore) {
  const duration = SAVINGS_DURATIONS.find(d => d.id === durationId);
  if (!duration) return 0;
  const tier = getCreditTier(creditScore);
  return duration.baseRate * tier.rateMultiplier;
}

// 신용도 점수 변경 (학생 문서 직접 업데이트)
export async function changeCreditScore(studentId, delta, reason = '') {
  if (!studentId || delta === 0) return;
  await updateDoc(doc(db, 'students', studentId), {
    creditScore: increment(delta)
  });
  // 신용도 변동 로그 (선택)
  await addDoc(collection(db, 'credit_history'), {
    studentId,
    delta,
    reason,
    createdAt: serverTimestamp()
  });
}

// ============================================
// 학생용: 적금 모달
// ============================================
let __studentCtx = null;

export function setStudentContext(user) {
  __studentCtx = user;
}

export async function openSavingsModal(currentUser) {
  __studentCtx = currentUser;
  const score = currentUser.creditScore ?? STARTING_CREDIT_SCORE;
  const tier = getCreditTier(score);
  const toNext = getScoreToNextTier(score);

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

    <!-- 신용도 카드 -->
    <div class="credit-card" style="background:linear-gradient(135deg, ${tier.color}22 0%, ${tier.color}11 100%); border:1.5px solid ${tier.color}66; border-radius:12px; padding:14px; margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="font-weight:600;font-size:15px">내 신용 등급</div>
        <div style="font-size:18px">${tier.emoji}</div>
      </div>
      <div style="font-size:13px;color:#374151">
        <strong>${tier.tier}등급 (${tier.name})</strong> · 점수 ${score}점 · 이자율 배율 ${tier.rateMultiplier}배
      </div>
      ${toNext !== null
        ? `<div style="font-size:12px;color:#6B7280;margin-top:4px">다음 등급까지 ${toNext}점 더 필요해요!</div>`
        : `<div style="font-size:12px;color:${tier.color};margin-top:4px;font-weight:600">🎉 최고 등급입니다!</div>`
      }
    </div>

    <p class="hint">현재 잔액: ${formatMoney(currentUser.balance || 0)}</p>

    <h3 style="margin-top:16px;font-size:15px">📌 적금 가입</h3>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
      ${SAVINGS_DURATIONS.map(d => {
        const myRate = (d.baseRate * tier.rateMultiplier * 100).toFixed(2);
        return `
          <div class="savings-product">
            <div>
              <div style="font-weight:600">${d.weeks}주 적금</div>
              <div style="font-size:12px;color:#6B7280">기본 ${(d.baseRate * 100).toFixed(0)}% × ${tier.rateMultiplier}배 = <strong style="color:${tier.color}">+${myRate}%</strong></div>
            </div>
            <button class="btn-primary" onclick="window.openDepositForm('${d.id}')">가입</button>
          </div>
        `;
      }).join('')}
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
          <div style="font-weight:600">${s.weeks}주 적금 (가입 시 ${s.tierName} 등급)</div>
          <div style="font-size:12px;color:#6B7280">이자율 ${(s.rate * 100).toFixed(2)}% · 만기일: ${formatDateOnly(matureDate)}</div>
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
          : `<button class="btn-secondary" style="flex:1" onclick="window.withdrawSavings('${s.id}', false)">중도 해지 (이자 없음, 신용도 -2)</button>`
        }
      </div>
    </div>
  `;
}

// ============================================
// 예금 폼
// ============================================
window.openDepositForm = async (durationId) => {
  const duration = SAVINGS_DURATIONS.find(d => d.id === durationId);
  if (!duration || !__studentCtx) return;

  const score = __studentCtx.creditScore ?? STARTING_CREDIT_SCORE;
  const tier = getCreditTier(score);
  const finalRate = duration.baseRate * tier.rateMultiplier;
  const maxAmount = Math.floor((__studentCtx.balance || 0) / 100) * 100;

  openModal(`
    <h2>${duration.weeks}주 적금 가입</h2>
    <p class="hint">
      이자율: <strong style="color:${tier.color}">+${(finalRate * 100).toFixed(2)}%</strong>
      (기간 ${(duration.baseRate * 100).toFixed(0)}% × ${tier.tier}등급 ${tier.rateMultiplier}배)
    </p>
    <form id="deposit-form" class="modal-form">
      <div class="input-group">
        <label>예금할 금액 (100원 단위)</label>
        <input type="number" id="dep-amount" required min="100" max="${maxAmount}" step="100" placeholder="예: 1000" />
      </div>
      <p class="hint">현재 잔액: ${formatMoney(__studentCtx.balance || 0)} · 가능 최대: ${formatMoney(maxAmount)}</p>

      <div id="dep-preview" style="background:#F9FAFB;border-radius:8px;padding:12px;font-size:13px;color:#6B7280">
        금액을 입력하면 만기 예상액이 표시됩니다
      </div>

      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">취소</button>
        <button type="submit" class="btn-primary">가입하기</button>
      </div>
    </form>
  `);

  // 실시간 만기 예상액 미리보기
  document.getElementById('dep-amount').addEventListener('input', (e) => {
    const amount = parseInt(e.target.value) || 0;
    const preview = document.getElementById('dep-preview');
    if (amount < 100) {
      preview.innerHTML = '최소 100원 이상 입력하세요';
      return;
    }
    if (amount % 100 !== 0) {
      preview.innerHTML = '⚠️ 100원 단위로 입력해주세요';
      preview.style.color = '#EF4444';
      return;
    }
    const interest = Math.floor(amount * finalRate);
    const total = amount + interest;
    const matureDate = new Date();
    matureDate.setDate(matureDate.getDate() + duration.days);

    preview.style.color = '#1F2937';
    preview.innerHTML = `
      <div style="font-size:14px;font-weight:600;margin-bottom:6px">📊 만기 예상</div>
      <div>원금: ${formatMoney(amount)}</div>
      <div>이자: <span style="color:#10B981;font-weight:600">+${formatMoney(interest)}</span></div>
      <div style="border-top:1px dashed #E5E7EB;margin:6px 0;padding-top:6px">
        만기 수령액: <strong>${formatMoney(total)}</strong>
      </div>
      <div style="font-size:12px;color:#6B7280;margin-top:4px">
        만기일: ${formatDateOnly(matureDate)} · 만기 시 신용도 +${amount >= 1000 ? 2 : 1}점
      </div>
    `;
  });

  document.getElementById('deposit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseInt(document.getElementById('dep-amount').value);

    // 검증
    if (!amount || amount < 100) {
      toast('최소 100원 이상 입력하세요', 'error');
      return;
    }
    if (amount % 100 !== 0) {
      toast('100원 단위로만 입력 가능합니다', 'error');
      return;
    }
    if (amount > (__studentCtx.balance || 0)) {
      toast('잔액이 부족합니다', 'error');
      return;
    }

    try {
      // 1) 학생 잔액 → 국고 (적금은 학교에 보관)
      await processTransaction({
        type: 'deposit',
        from: __studentCtx.uid,
        to: 'TREASURY',
        amount: amount,
        reason: `${duration.weeks}주 적금 가입`
      });

      // 2) 적금 레코드
      const matureAt = new Date();
      matureAt.setDate(matureAt.getDate() + duration.days);

      await addDoc(collection(db, 'savings'), {
        studentId: __studentCtx.uid,
        durationId: duration.id,
        weeks: duration.weeks,
        days: duration.days,
        amount: amount,
        baseRate: duration.baseRate,
        rate: finalRate,                  // 가입 시점의 최종 이자율 고정
        tierAtDeposit: tier.tier,
        tierName: tier.name,
        rateMultiplier: tier.rateMultiplier,
        matureAt: matureAt,
        withdrawn: false,
        createdAt: serverTimestamp()
      });

      closeModal();
      toast(`${duration.weeks}주 적금에 ${formatMoney(amount)} 가입 완료!`, 'success');
    } catch (err) {
      toast('실패: ' + err.message, 'error');
    }
  });
};

// ============================================
// 적금 해지 (만기 또는 중도)
// ============================================
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

  let msg, creditDelta, creditReason;
  if (isMatured) {
    creditDelta = s.amount >= 1000 ? CREDIT_DELTAS.maturedBig : CREDIT_DELTAS.matured;
    creditReason = `${s.weeks}주 적금 만기 완료`;
    msg = `만기 적금을 해지합니다.\n원금 ${formatMoney(s.amount)} + 이자 ${formatMoney(interest)} = 총 ${formatMoney(total)}\n\n신용도 +${creditDelta}점!`;
  } else {
    creditDelta = CREDIT_DELTAS.withdrawn;
    creditReason = `${s.weeks}주 적금 중도 해지`;
    msg = `⚠️ 중도 해지 시:\n• 이자 없이 원금만 ${formatMoney(s.amount)} 환급\n• 신용도 ${creditDelta}점 (감점)\n\n진행할까요?`;
  }
  if (!confirm(msg)) return;

  try {
    // 1) 원금 + 이자 환급 (TREASURY → 학생)
    await processTransaction({
      type: isMatured ? 'interest' : 'withdrawal',
      from: 'TREASURY',
      to: s.studentId,
      amount: total,
      reason: isMatured
        ? `${s.weeks}주 적금 만기 (원금+이자, ${(s.rate*100).toFixed(2)}%)`
        : `${s.weeks}주 적금 중도해지`
    });

    // 2) 적금 레코드 업데이트
    await updateDoc(doc(db, 'savings', savingsId), {
      withdrawn: true,
      withdrawnAt: serverTimestamp(),
      withdrawnAmount: total,
      withdrawnInterest: interest,
      withdrawnEarly: !isMatured
    });

    // 3) 신용도 변경
    await changeCreditScore(s.studentId, creditDelta, creditReason);

    closeModal();
    const creditMsg = creditDelta > 0 ? ` (신용도 +${creditDelta})` : ` (신용도 ${creditDelta})`;
    toast(`${formatMoney(total)} 입금 완료!${creditMsg}`, isMatured ? 'success' : '');
  } catch (err) {
    toast('실패: ' + err.message, 'error');
  }
};

// ============================================
// 교사: 전체 적금 현황 + 신용도 관리
// ============================================
export async function openAllSavingsModal(students) {
  const snap = await getDocs(query(collection(db, 'savings'), orderBy('createdAt', 'desc')));
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const studentMap = Object.fromEntries(students.map(s => [s.id, s]));

  const active = all.filter(s => !s.withdrawn);
  const totalActive = active.reduce((sum, s) => sum + s.amount, 0);
  const matured = active.filter(s => s.matureAt?.toDate && new Date() >= s.matureAt.toDate()).length;

  openModal(`
    <h2>🏦 전체 적금 현황</h2>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
      <div style="background:#EEF2FF;padding:12px;border-radius:8px;text-align:center">
        <div style="font-size:11px;color:#6366F1">진행중</div>
        <div style="font-size:18px;font-weight:700;color:#4F46E5">${active.length}건</div>
      </div>
      <div style="background:#FEF3C7;padding:12px;border-radius:8px;text-align:center">
        <div style="font-size:11px;color:#D97706">만기 도달</div>
        <div style="font-size:18px;font-weight:700;color:#D97706">${matured}건</div>
      </div>
      <div style="background:#ECFDF5;padding:12px;border-radius:8px;text-align:center">
        <div style="font-size:11px;color:#059669">총 예금액</div>
        <div style="font-size:14px;font-weight:700;color:#047857">${formatMoney(totalActive)}</div>
      </div>
    </div>

    <div style="max-height:55vh;overflow-y:auto;display:flex;flex-direction:column;gap:8px">
      ${all.length === 0 ? '<div class="empty-state">적금 데이터가 없습니다.</div>' :
        all.map(s => {
          const student = studentMap[s.studentId];
          const studentLabel = student ? `${student.number}번 ${student.name}` : s.studentId;
          const matureDate = s.matureAt?.toDate ? s.matureAt.toDate() : null;
          const status = s.withdrawn
            ? (s.withdrawnEarly ? `🚫 중도해지 (${formatMoney(s.amount)})` : `✅ 만기수령 (${formatMoney(s.withdrawnAmount || s.amount)})`)
            : (new Date() >= matureDate ? '⏰ 만기' : 'D-' + Math.ceil((matureDate - new Date()) / (1000*60*60*24)));
          return `
            <div class="transaction-item">
              <div class="transaction-info">
                <div class="transaction-title">${escapeHtml(studentLabel)} - ${s.weeks}주 적금</div>
                <div class="transaction-meta">
                  ${s.tierName || '?'}등급 가입 · 이자율 ${(s.rate * 100).toFixed(2)}% ·
                  만기: ${formatDateOnly(matureDate)} · ${status}
                </div>
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

// ============================================
// 교사: 신용도 관리 모달
// ============================================
export async function openCreditManagementModal(students) {
  // 등급별로 그룹화
  const tierGroups = {};
  CREDIT_TIERS.forEach(t => tierGroups[t.tier] = []);
  students.forEach(s => {
    const score = s.creditScore ?? STARTING_CREDIT_SCORE;
    const tier = getCreditTier(score);
    tierGroups[tier.tier].push({ ...s, score, tier });
  });

  openModal(`
    <h2>⭐ 신용도 관리</h2>
    <p class="hint">학생들의 신용 등급을 한눈에 확인하고 직접 조정할 수 있습니다.</p>

    <!-- 등급 분포 요약 -->
    <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
      ${CREDIT_TIERS.map(t => `
        <div style="flex:1;min-width:80px;background:${t.color}22;padding:8px;border-radius:8px;text-align:center;border:1px solid ${t.color}66">
          <div style="font-size:14px">${t.emoji}</div>
          <div style="font-size:11px;color:#374151;margin-top:2px">${t.tier}등급</div>
          <div style="font-size:14px;font-weight:700;color:${t.color}">${tierGroups[t.tier].length}명</div>
        </div>
      `).join('')}
    </div>

    <!-- 학생 목록 -->
    <div style="max-height:50vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px">
      ${students.length === 0 ? '<div class="empty-state">학생이 없습니다.</div>' :
        students
          .map(s => ({ ...s, score: s.creditScore ?? STARTING_CREDIT_SCORE }))
          .sort((a, b) => b.score - a.score)
          .map(s => {
            const tier = getCreditTier(s.score);
            return `
              <div class="credit-row" style="display:flex;align-items:center;gap:10px;padding:10px;background:#F9FAFB;border-radius:8px">
                <div style="font-size:16px;min-width:80px">${tier.emoji}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-weight:600;font-size:14px">${s.number}번 ${escapeHtml(s.name)}</div>
                  <div style="font-size:11px;color:#6B7280">${tier.tier}등급 · ${s.score}점 · 이자배율 ${tier.rateMultiplier}배</div>
                </div>
                <button class="btn-secondary" onclick="window.adjustCredit('${s.id}', 5)" style="font-size:12px;padding:4px 8px;color:#10B981">+5</button>
                <button class="btn-secondary" onclick="window.adjustCredit('${s.id}', 1)" style="font-size:12px;padding:4px 8px;color:#10B981">+1</button>
                <button class="btn-secondary" onclick="window.adjustCredit('${s.id}', -1)" style="font-size:12px;padding:4px 8px;color:#EF4444">-1</button>
                <button class="btn-secondary" onclick="window.adjustCredit('${s.id}', -5)" style="font-size:12px;padding:4px 8px;color:#EF4444">-5</button>
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

// 교사가 신용도 직접 조정
window.adjustCredit = async (studentId, delta) => {
  const reason = prompt(`신용도 ${delta > 0 ? '+' : ''}${delta}점 사유를 입력하세요:`, '교사 조정');
  if (reason === null) return; // 취소
  await changeCreditScore(studentId, delta, reason || '교사 조정');
  toast(`신용도 ${delta > 0 ? '+' : ''}${delta}점 적용`, 'success');
  // 모달 새로고침을 위해 다시 열기 (cachedStudents가 곧 업데이트되므로 약간 대기)
  setTimeout(async () => {
    const snap = await getDocs(query(collection(db, 'students'), orderBy('number')));
    const students = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    openCreditManagementModal(students);
  }, 300);
};
