// ============================================
// 자동 월급 + 학급 목표
// ============================================

import {
  db,
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp
} from "../firebase-config.js";
import { processTransaction } from "./transactions.js";
import {
  TREASURY_ID, toast, openModal, closeModal,
  escapeHtml, formatMoney, monthKey
} from "./utils.js";

// ============================================
// 자동 월급 - 교사 로그인 시 체크
// ============================================
export async function checkAutoSalary(students, settings) {
  if (!settings.autoSalary) return; // 자동 월급 비활성화

  const currentMonth = monthKey();
  if (settings.lastSalaryMonth === currentMonth) return; // 이번 달 이미 지급함

  const eligible = students.filter(s => s.salary > 0);
  if (eligible.length === 0) return;

  const totalCost = eligible.reduce((sum, s) => sum + s.salary, 0);
  const proceed = confirm(
    `📅 ${currentMonth} 자동 월급 지급\n\n` +
    `이번 달 아직 월급을 지급하지 않았습니다.\n` +
    `대상: ${eligible.length}명\n` +
    `총 지급액: ${formatMoney(totalCost)}\n\n` +
    `지금 지급하시겠습니까?\n(취소하면 나중에 직접 지급 가능)`
  );
  if (!proceed) return;

  for (const s of eligible) {
    await processTransaction({
      type: 'salary',
      from: 'TEACHER',
      to: s.id,
      amount: s.salary,
      reason: `${s.jobName} 월급 (${currentMonth})`
    });
  }

  // 마지막 지급 월 기록
  await updateDoc(doc(db, 'settings', 'main'), {
    lastSalaryMonth: currentMonth,
    lastSalaryAt: serverTimestamp()
  });

  toast(`${eligible.length}명에게 자동 월급 지급 완료`, 'success');
}

// 자동 월급 토글
export async function setAutoSalary(enabled) {
  await updateDoc(doc(db, 'settings', 'main'), { autoSalary: enabled });
}

// ============================================
// 학급 목표
// ============================================
export function initGoalsTeacher() {
  const unsub = onSnapshot(
    query(collection(db, 'goals'), orderBy('createdAt', 'desc')),
    (snap) => {
      const goals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderGoalsList(goals);
    }
  );

  document.getElementById('add-goal-btn').addEventListener('click', () => openGoalModal());
  return unsub;
}

let __cachedTreasury = 0;
export function setTreasuryBalance(b) { __cachedTreasury = b; renderProgressBars(); }

let __cachedGoals = [];
function renderGoalsList(goals) {
  __cachedGoals = goals;
  const container = document.getElementById('goals-list');
  if (!container) return;
  if (goals.length === 0) {
    container.innerHTML = '<div class="empty-state">설정된 학급 목표가 없습니다.<br>"+ 목표 추가"로 학급 행사를 위한 목표 금액을 정하세요.</div>';
    return;
  }
  container.innerHTML = goals.map(g => renderGoalCard(g)).join('');
}

function renderGoalCard(g) {
  const progress = Math.min(100, (__cachedTreasury / g.targetAmount) * 100);
  const isAchieved = __cachedTreasury >= g.targetAmount;
  return `
    <div class="goal-card ${isAchieved ? 'achieved' : ''}">
      <div class="goal-header">
        <div>
          <div class="goal-title">${escapeHtml(g.icon || '🎯')} ${escapeHtml(g.title)}</div>
          <div class="goal-desc">${escapeHtml(g.description || '')}</div>
        </div>
        ${isAchieved ? '<span class="goal-badge">달성!</span>' : ''}
      </div>
      <div class="goal-progress-row">
        <span>${formatMoney(__cachedTreasury)}</span>
        <span style="color:#6B7280">/ ${formatMoney(g.targetAmount)}</span>
      </div>
      <div class="goal-progress-bar">
        <div class="goal-progress-fill" style="width:${progress}%"></div>
      </div>
      <div style="font-size:12px;color:#6B7280;margin-top:6px">${progress.toFixed(1)}%</div>
      <div class="student-actions">
        <button class="btn-secondary" onclick="window.editGoal('${g.id}')">수정</button>
        <button class="btn-danger" onclick="window.deleteGoal('${g.id}')">삭제</button>
      </div>
    </div>
  `;
}

function renderProgressBars() {
  if (__cachedGoals.length > 0) renderGoalsList(__cachedGoals);
}

function openGoalModal(goal = null) {
  const isEdit = !!goal;
  openModal(`
    <h2>${isEdit ? '목표 수정' : '학급 목표 추가'}</h2>
    <form id="goal-form" class="modal-form">
      <div class="input-group">
        <label>아이콘 (선택)</label>
        <input type="text" id="g-icon" maxlength="2" value="${goal?.icon || ''}" placeholder="🎯" />
      </div>
      <div class="input-group">
        <label>목표 이름</label>
        <input type="text" id="g-title" required value="${goal ? escapeHtml(goal.title) : ''}" placeholder="예: 학급 단합대회" />
      </div>
      <div class="input-group">
        <label>목표 금액 (원)</label>
        <input type="number" id="g-amount" required min="1" value="${goal?.targetAmount || ''}" />
      </div>
      <div class="input-group">
        <label>설명</label>
        <input type="text" id="g-desc" value="${goal ? escapeHtml(goal.description || '') : ''}" placeholder="달성 시 어떤 일이 일어나나요?" />
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">취소</button>
        <button type="submit" class="btn-primary">${isEdit ? '저장' : '추가'}</button>
      </div>
    </form>
  `);

  document.getElementById('goal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      icon: document.getElementById('g-icon').value.trim() || '🎯',
      title: document.getElementById('g-title').value.trim(),
      targetAmount: parseInt(document.getElementById('g-amount').value),
      description: document.getElementById('g-desc').value.trim()
    };
    if (isEdit) {
      await updateDoc(doc(db, 'goals', goal.id), data);
      toast('수정되었습니다', 'success');
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, 'goals'), data);
      toast('목표가 추가되었습니다', 'success');
    }
    closeModal();
  });
}

window.editGoal = async (id) => {
  const snap = await getDoc(doc(db, 'goals', id));
  if (snap.exists()) openGoalModal({ id, ...snap.data() });
};

window.deleteGoal = async (id) => {
  if (!confirm('이 목표를 삭제하시겠습니까?')) return;
  await deleteDoc(doc(db, 'goals', id));
  toast('목표가 삭제되었습니다');
};

// ============================================
// 학생용: 학급 목표 보기
// ============================================
export async function openGoalsModal(treasuryBalance) {
  const snap = await getDocs(query(collection(db, 'goals'), orderBy('createdAt', 'desc')));
  const goals = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  openModal(`
    <h2>🎯 우리 반 목표</h2>
    <p class="hint">국고 잔액: <strong>${formatMoney(treasuryBalance)}</strong></p>
    ${goals.length === 0
      ? '<div class="empty-state">설정된 목표가 없습니다.</div>'
      : `<div style="display:flex;flex-direction:column;gap:10px;max-height:60vh;overflow-y:auto">
          ${goals.map(g => {
            const progress = Math.min(100, (treasuryBalance / g.targetAmount) * 100);
            const isAchieved = treasuryBalance >= g.targetAmount;
            return `
              <div class="goal-card ${isAchieved ? 'achieved' : ''}">
                <div class="goal-header">
                  <div>
                    <div class="goal-title">${escapeHtml(g.icon || '🎯')} ${escapeHtml(g.title)}</div>
                    <div class="goal-desc">${escapeHtml(g.description || '')}</div>
                  </div>
                  ${isAchieved ? '<span class="goal-badge">달성!</span>' : ''}
                </div>
                <div class="goal-progress-row">
                  <span>${formatMoney(treasuryBalance)}</span>
                  <span style="color:#6B7280">/ ${formatMoney(g.targetAmount)}</span>
                </div>
                <div class="goal-progress-bar">
                  <div class="goal-progress-fill" style="width:${progress}%"></div>
                </div>
                <div style="font-size:12px;color:#6B7280;margin-top:6px">${progress.toFixed(1)}%</div>
              </div>
            `;
          }).join('')}
        </div>`
    }
    <div class="modal-actions">
      <button class="btn-secondary" onclick="window.closeModal()">닫기</button>
    </div>
  `);
}
