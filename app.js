// ============================================
// 학급 통장 - 메인 앱 (v3)
// 모듈 분할로 정리됨
// ============================================

import {
  db,
  collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, increment, writeBatch
} from "./firebase-config.js";

import {
  TREASURY_ID, hashPw, toast, openModal, closeModal,
  escapeHtml, formatMoney, formatDate, txTypeLabel
} from "./modules/utils.js";
import { processTransaction } from "./modules/transactions.js";
import { initShopTeacher, openShopModal, setStudentContext as setShopCtx } from "./modules/shop.js";
import { renderStats } from "./modules/stats.js";
import {
  openSavingsModal, setStudentContext as setSavingsCtx,
  openAllSavingsModal, openCreditManagementModal,
  getCreditTier, STARTING_CREDIT_SCORE,
  renderCreditTab, renderSavingsTab,
  openBulkCreditModal, openCreditHistoryModal,
  loadRatesFromFirestore, subscribeRates, openRatesManagementModal
} from "./modules/savings.js";
import {
  openTaxBillModal, openTaxBillsListModal,
  openMyTaxBillsModal, setStudentContext as setTaxCtx
} from "./modules/tax_overdue.js";
import {
  openComposeModalForTeacher, openComposeModalForStudent, openInbox,
  setTeacherContext as setMsgTeacherCtx, setStudentContext as setMsgStudentCtx,
  setCachedStudents as setMsgStudents,
  subscribeUnreadCount, onUnreadCountChange,
  renderTeacherMessagesTab, openStudentInbox
} from "./modules/messages.js";
import {
  checkAutoSalary, setAutoSalary,
  initGoalsTeacher, setTreasuryBalance,
  openGoalsModal
} from "./modules/goals.js";

// ============================================
// 전역 상태
// ============================================
let currentUser = null;
let unsubscribers = [];
let classSettings = { className: "", maxTransfer: 0, autoSalary: false };
let cachedStudents = [];
let cachedTreasuryBalance = 0;
let allTransactions = [];
let __autoSalaryChecked = false;

// ============================================
// 화면 전환 / 구독 정리
// ============================================
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

function clearSubscriptions() {
  unsubscribers.forEach(unsub => unsub());
  unsubscribers = [];
}

// ============================================
// 초기화
// ============================================
async function init() {
  try {
    const settingsDoc = await getDoc(doc(db, 'settings', 'main'));
    if (!settingsDoc.exists()) {
      showScreen('setup-screen');
    } else {
      classSettings = settingsDoc.data();
      document.getElementById('class-name-display').textContent =
        classSettings.className || '우리 반 경제 활동 시스템';
      // 이자율 설정 미리 로드 (없으면 기본값 사용)
      await loadRatesFromFirestore();
      showScreen('login-screen');
    }
  } catch (err) {
    console.error('초기화 오류:', err);
    toast('Firebase 연결 실패. firebase-config.js를 확인하세요.', 'error');
    showScreen('setup-screen');
  }
}

// ============================================
// 첫 가입 (교사 + 국고 + 학급설정 동시 생성)
// ============================================
document.getElementById('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const className = document.getElementById('setup-class').value.trim();
  const teacherId = document.getElementById('setup-id').value.trim();
  const pw = document.getElementById('setup-pw').value;
  const pw2 = document.getElementById('setup-pw2').value;
  const errorEl = document.getElementById('setup-error');
  errorEl.textContent = '';

  if (pw !== pw2) {
    errorEl.textContent = '비밀번호가 일치하지 않습니다';
    return;
  }

  try {
    const pwHash = await hashPw(pw);
    const batch = writeBatch(db);
    batch.set(doc(db, 'settings', 'main'), {
      className, maxTransfer: 0, autoSalary: false,
      createdAt: serverTimestamp()
    });
    batch.set(doc(db, 'users', teacherId), {
      id: teacherId, role: 'teacher', name: '선생님',
      pwHash, createdAt: serverTimestamp()
    });
    batch.set(doc(db, 'users', TREASURY_ID), {
      id: TREASURY_ID, role: 'treasury', name: '국고',
      balance: 0, createdAt: serverTimestamp()
    });
    await batch.commit();

    classSettings = { className, maxTransfer: 0, autoSalary: false };
    document.getElementById('class-name-display').textContent = className;
    toast('교사 계정이 생성되었습니다!', 'success');
    showScreen('login-screen');
  } catch (err) {
    errorEl.textContent = '생성 실패: ' + err.message;
  }
});

// ============================================
// 로그인 처리
// ============================================
let selectedRole = 'student';

document.querySelectorAll('.role-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedRole = btn.dataset.role;
  });
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('login-id').value.trim();
  const pw = document.getElementById('login-pw').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  try {
    if (selectedRole === 'student') {
      const studentDoc = await getDoc(doc(db, 'students', id));
      if (!studentDoc.exists()) {
        errorEl.textContent = '학생 ID를 찾을 수 없습니다';
        return;
      }
      const data = studentDoc.data();
      const pwHash = await hashPw(pw);
      if (data.pwHash !== pwHash) {
        errorEl.textContent = '비밀번호가 올바르지 않습니다';
        return;
      }
      currentUser = { role: 'student', uid: id, ...data };
      enterStudentScreen();
    } else {
      const userDoc = await getDoc(doc(db, 'users', id));
      if (!userDoc.exists() || userDoc.data().role !== 'teacher') {
        errorEl.textContent = '교사 계정을 찾을 수 없습니다';
        return;
      }
      const data = userDoc.data();
      const pwHash = await hashPw(pw);
      if (data.pwHash !== pwHash) {
        errorEl.textContent = '비밀번호가 올바르지 않습니다';
        return;
      }
      currentUser = { role: 'teacher', uid: id, ...data };
      enterTeacherScreen();
    }
    document.getElementById('login-id').value = '';
    document.getElementById('login-pw').value = '';
  } catch (err) {
    errorEl.textContent = '로그인 실패: ' + err.message;
  }
});

document.getElementById('teacher-logout').addEventListener('click', () => {
  clearSubscriptions();
  currentUser = null;
  __autoSalaryChecked = false;
  showScreen('login-screen');
});

document.getElementById('student-logout').addEventListener('click', () => {
  clearSubscriptions();
  currentUser = null;
  showScreen('login-screen');
});

// ============================================
// 교사 화면
// ============================================
function enterTeacherScreen() {
  document.getElementById('teacher-name').textContent = currentUser.name || '선생님';
  showScreen('teacher-screen');

  // 탭 전환
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const tabName = btn.dataset.tab;
      document.getElementById('tab-' + tabName).classList.add('active');

      // 클릭 시 자동 렌더링이 필요한 탭들
      if (tabName === 'stats') renderStats(cachedStudents);
      else if (tabName === 'credit') renderCreditTab(cachedStudents);
      else if (tabName === 'savings') {
        const filter = document.getElementById('savings-filter')?.value || 'active';
        renderSavingsTab(cachedStudents, filter);
      }
      else if (tabName === 'messages') renderTeacherMessagesTab(cachedStudents);
    };
  });

  loadTeacherData();

  // 가게 모듈 초기화
  unsubscribers.push(initShopTeacher(() => cachedStudents));

  // 목표 모듈 초기화
  unsubscribers.push(initGoalsTeacher());

  // 신용도 탭 - 일괄 조정 버튼
  document.getElementById('bulk-credit-btn').addEventListener('click', () => {
    openBulkCreditModal(cachedStudents);
  });

  // 신용도 탭 - 변동 이력 버튼
  document.getElementById('credit-history-btn').addEventListener('click', () => {
    openCreditHistoryModal(cachedStudents);
  });

  // 적금 탭 - 필터 변경 시 다시 렌더링
  document.getElementById('savings-filter').addEventListener('change', (e) => {
    renderSavingsTab(cachedStudents, e.target.value);
  });

  // 이자율 관리 버튼
  document.getElementById('manage-rates-btn').addEventListener('click', () => {
    openRatesManagementModal();
  });

  // 세금 부과 버튼
  document.getElementById('open-tax-bill-btn').addEventListener('click', () => {
    openTaxBillModal(cachedStudents);
  });

  // 부과된 세금 현황 + 연체 처리 버튼
  document.getElementById('open-tax-bills-list-btn').addEventListener('click', () => {
    openTaxBillsListModal(cachedStudents);
  });

  // 메시지 컨텍스트 설정
  setMsgTeacherCtx(currentUser);
  setMsgStudents(cachedStudents);

  // 종 버튼 → 메시지 탭으로 이동
  document.getElementById('teacher-msg-bell').addEventListener('click', () => {
    document.querySelector('.tab-btn[data-tab="messages"]')?.click();
  });

  // 안 읽은 메시지 수 실시간 업데이트 (헤더 종 + 탭 배지)
  onUnreadCountChange((count) => {
    const headerBadge = document.getElementById('teacher-msg-badge');
    const tabBadge = document.getElementById('teacher-msg-tab-badge');
    if (count > 0) {
      const text = count > 99 ? '99+' : count;
      if (headerBadge) {
        headerBadge.textContent = text;
        headerBadge.style.display = 'inline-flex';
      }
      if (tabBadge) {
        tabBadge.textContent = text;
        tabBadge.style.display = 'inline-flex';
      }
    } else {
      if (headerBadge) headerBadge.style.display = 'none';
      if (tabBadge) tabBadge.style.display = 'none';
    }

    // 메시지 탭이 활성화 상태면 자동 갱신
    if (document.getElementById('tab-messages')?.classList.contains('active')) {
      renderTeacherMessagesTab(cachedStudents);
    }
  });
  unsubscribers.push(subscribeUnreadCount(currentUser.uid, 'teacher'));
}

function loadTeacherData() {
  // 학생 목록
  const studentsUnsub = onSnapshot(
    query(collection(db, 'students'), orderBy('number', 'asc')),
    (snapshot) => {
      cachedStudents = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      renderStudentsList(cachedStudents);
      updateStudentSelects(cachedStudents);
      updateOverviewStats();
      setMsgStudents(cachedStudents);

      // 신용도/적금 탭이 활성화 상태면 자동 갱신
      if (document.getElementById('tab-credit')?.classList.contains('active')) {
        renderCreditTab(cachedStudents);
      }
      if (document.getElementById('tab-savings')?.classList.contains('active')) {
        const filter = document.getElementById('savings-filter')?.value || 'active';
        renderSavingsTab(cachedStudents, filter);
      }

      // 학생 데이터 로드되면 자동 월급 체크 (한 번만)
      if (!__autoSalaryChecked) {
        __autoSalaryChecked = true;
        setTimeout(() => checkAutoSalary(cachedStudents, classSettings), 500);
      }
    }
  );
  unsubscribers.push(studentsUnsub);

  // 직업 목록
  const jobsUnsub = onSnapshot(collection(db, 'jobs'), (snapshot) => {
    const jobs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderJobsList(jobs);
    updateJobSelects(jobs);
  });
  unsubscribers.push(jobsUnsub);

  // 게임 목록
  const gamesUnsub = onSnapshot(collection(db, 'games'), (snapshot) => {
    const games = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGamesList(games, true);
  });
  unsubscribers.push(gamesUnsub);

  // 거래 내역
  const txUnsub = onSnapshot(
    query(collection(db, 'transactions'), orderBy('createdAt', 'desc'), limit(100)),
    (snapshot) => {
      const txs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      allTransactions = txs;
      renderTransactions(txs, document.getElementById('transactions-list'));
      renderTransactions(txs.slice(0, 10), document.getElementById('overview-transactions'));
      updateOverviewStats(txs);
    }
  );
  unsubscribers.push(txUnsub);

  // 국고
  const treasuryUnsub = onSnapshot(doc(db, 'users', TREASURY_ID), (snap) => {
    if (snap.exists()) {
      cachedTreasuryBalance = snap.data().balance || 0;
      document.getElementById('treasury-balance').textContent = formatMoney(cachedTreasuryBalance);
      document.getElementById('stat-treasury').textContent = formatMoney(cachedTreasuryBalance);
      setTreasuryBalance(cachedTreasuryBalance);
    }
  });
  unsubscribers.push(treasuryUnsub);

  // 적금 컬렉션 변경 감지 (적금 탭 자동 갱신용)
  const savingsUnsub = onSnapshot(collection(db, 'savings'), () => {
    if (document.getElementById('tab-savings')?.classList.contains('active')) {
      const filter = document.getElementById('savings-filter')?.value || 'active';
      renderSavingsTab(cachedStudents, filter);
    }
  });
  unsubscribers.push(savingsUnsub);

  // 이자율 설정 실시간 구독 (변경 시 적금 탭 자동 갱신)
  const ratesUnsub = subscribeRates(() => {
    if (document.getElementById('tab-savings')?.classList.contains('active')) {
      const filter = document.getElementById('savings-filter')?.value || 'active';
      renderSavingsTab(cachedStudents, filter);
    }
  });
  unsubscribers.push(ratesUnsub);

  // 설정
  const settingsUnsub = onSnapshot(doc(db, 'settings', 'main'), (snap) => {
    if (snap.exists()) {
      classSettings = snap.data();
      document.getElementById('setting-max-transfer').value = classSettings.maxTransfer || '';
      document.getElementById('auto-salary-toggle').checked = !!classSettings.autoSalary;
    }
  });
  unsubscribers.push(settingsUnsub);
}

function updateOverviewStats(txs) {
  document.getElementById('stat-students').textContent = cachedStudents.length + '명';
  const totalMoney = cachedStudents.reduce((sum, s) => sum + (s.balance || 0), 0);
  document.getElementById('stat-money').textContent = formatMoney(totalMoney);
  if (txs) {
    const today = new Date(); today.setHours(0,0,0,0);
    const todayCount = txs.filter(t => t.createdAt?.toDate && t.createdAt.toDate() >= today).length;
    document.getElementById('stat-today').textContent = todayCount + '건';
  }
}

// ============================================
// 학생 관리
// ============================================
function renderStudentsList(students) {
  const container = document.getElementById('students-list');
  if (students.length === 0) {
    container.innerHTML = '<div class="empty-state">아직 등록된 학생이 없습니다.<br>"+ 학생 추가" 또는 "일괄 추가" 버튼을 눌러 시작하세요.</div>';
    return;
  }
  container.innerHTML = students.map(s => {
    const score = s.creditScore ?? STARTING_CREDIT_SCORE;
    const tier = getCreditTier(score);
    return `
    <div class="student-card">
      <div class="student-card-header">
        <div>
          <div class="student-name">${escapeHtml(s.name)}</div>
          <div class="student-id">${s.number}번 · ID: ${escapeHtml(s.id)}</div>
        </div>
        <div style="text-align:right;font-size:11px" title="신용 등급">
          <div>${tier.emoji}</div>
          <div style="color:${tier.color};font-weight:600">${score}점</div>
        </div>
      </div>
      <div class="student-balance">${formatMoney(s.balance || 0)}</div>
      <div class="student-job-tag">${escapeHtml(s.jobName || '직업 미배정')}</div>
      <div class="student-actions">
        <button class="btn-secondary" onclick="window.editStudent('${s.id}')">수정</button>
        <button class="btn-secondary" onclick="window.adjustBalance('${s.id}')">잔액 조정</button>
        <button class="btn-danger" onclick="window.deleteStudent('${s.id}')">삭제</button>
      </div>
    </div>
  `;}).join('');
}

document.getElementById('add-student-btn').addEventListener('click', () => {
  openModal(`
    <h2>학생 추가</h2>
    <form id="student-form" class="modal-form">
      <div class="input-group"><label>번호</label><input type="number" id="s-number" required min="1" /></div>
      <div class="input-group"><label>이름</label><input type="text" id="s-name" required /></div>
      <div class="input-group"><label>학생 로그인 ID</label><input type="text" id="s-id" required placeholder="예: kim01" /></div>
      <div class="input-group"><label>비밀번호</label><input type="text" id="s-pw" required minlength="4" placeholder="4자 이상" /></div>
      <div class="input-group"><label>초기 잔액 (원)</label><input type="number" id="s-balance" value="0" min="0" /></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">취소</button>
        <button type="submit" class="btn-primary">추가</button>
      </div>
    </form>
  `);

  document.getElementById('student-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('s-id').value.trim();
    const pw = document.getElementById('s-pw').value;
    const pwHash = await hashPw(pw);
    try {
      const exists = await getDoc(doc(db, 'students', id));
      if (exists.exists()) { alert('이미 사용 중인 ID입니다'); return; }
      await setDoc(doc(db, 'students', id), {
        number: parseInt(document.getElementById('s-number').value),
        name: document.getElementById('s-name').value.trim(),
        id, pwHash,
        balance: parseInt(document.getElementById('s-balance').value) || 0,
        jobId: null, jobName: null, salary: 0,
        creditScore: STARTING_CREDIT_SCORE,
        createdAt: serverTimestamp()
      });
      closeModal();
      toast('학생이 추가되었습니다', 'success');
    } catch (err) {
      alert('추가 실패: ' + err.message);
    }
  });
});

document.getElementById('bulk-add-btn').addEventListener('click', () => {
  openModal(`
    <h2>학생 일괄 추가</h2>
    <p class="hint">한 줄에 한 명씩 입력하세요. 형식: <code>번호,이름,ID,비밀번호</code></p>
    <p class="hint">예시:<br>1,김민수,kim01,1234<br>2,이서연,lee02,1234</p>
    <form id="bulk-form" class="modal-form">
      <div class="input-group">
        <label>학생 목록</label>
        <textarea id="bulk-text" rows="10" style="padding:12px;border:1.5px solid #E5E7EB;border-radius:10px;font-family:monospace;font-size:14px" required placeholder="1,김민수,kim01,1234&#10;2,이서연,lee02,1234"></textarea>
      </div>
      <div class="input-group">
        <label>초기 잔액 (모두 동일)</label>
        <input type="number" id="bulk-balance" value="0" min="0" />
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">취소</button>
        <button type="submit" class="btn-primary">전체 추가</button>
      </div>
    </form>
  `);

  document.getElementById('bulk-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const lines = document.getElementById('bulk-text').value.trim().split('\n');
    const balance = parseInt(document.getElementById('bulk-balance').value) || 0;
    let added = 0, failed = 0;
    for (const line of lines) {
      const parts = line.split(',').map(s => s.trim());
      if (parts.length !== 4) { failed++; continue; }
      const [number, name, id, pw] = parts;
      if (!number || !name || !id || !pw) { failed++; continue; }
      try {
        const pwHash = await hashPw(pw);
        await setDoc(doc(db, 'students', id), {
          number: parseInt(number), name, id, pwHash,
          balance, jobId: null, jobName: null, salary: 0,
          creditScore: STARTING_CREDIT_SCORE,
          createdAt: serverTimestamp()
        });
        added++;
      } catch { failed++; }
    }
    closeModal();
    toast(`${added}명 추가 완료${failed > 0 ? ` (${failed}명 실패)` : ''}`, 'success');
  });
});

window.editStudent = async (id) => {
  const studentDoc = await getDoc(doc(db, 'students', id));
  if (!studentDoc.exists()) return;
  const s = studentDoc.data();
  openModal(`
    <h2>학생 정보 수정</h2>
    <form id="student-edit-form" class="modal-form">
      <div class="input-group"><label>번호</label><input type="number" id="s-number" value="${s.number}" required /></div>
      <div class="input-group"><label>이름</label><input type="text" id="s-name" value="${escapeHtml(s.name)}" required /></div>
      <div class="input-group"><label>새 비밀번호 (변경시에만)</label><input type="text" id="s-pw" minlength="4" placeholder="변경 안 함" /></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">취소</button>
        <button type="submit" class="btn-primary">저장</button>
      </div>
    </form>
  `);

  document.getElementById('student-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const updates = {
      number: parseInt(document.getElementById('s-number').value),
      name: document.getElementById('s-name').value.trim()
    };
    const newPw = document.getElementById('s-pw').value;
    if (newPw) updates.pwHash = await hashPw(newPw);
    await updateDoc(doc(db, 'students', id), updates);
    closeModal();
    toast('수정되었습니다', 'success');
  });
};

window.adjustBalance = async (id) => {
  const studentDoc = await getDoc(doc(db, 'students', id));
  if (!studentDoc.exists()) return;
  const s = studentDoc.data();
  openModal(`
    <h2>잔액 조정 - ${escapeHtml(s.name)}</h2>
    <p class="hint">현재 잔액: ${formatMoney(s.balance || 0)}</p>
    <form id="adjust-form" class="modal-form">
      <div class="input-group"><label>조정 금액 (음수 가능)</label><input type="number" id="adj-amount" required /></div>
      <div class="input-group"><label>사유</label><input type="text" id="adj-reason" required /></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">취소</button>
        <button type="submit" class="btn-primary">조정</button>
      </div>
    </form>
  `);

  document.getElementById('adjust-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseInt(document.getElementById('adj-amount').value);
    const reason = document.getElementById('adj-reason').value.trim();
    if (amount === 0) return;
    try {
      await processTransaction({
        type: 'adjustment',
        from: amount > 0 ? 'TEACHER' : id,
        to: amount > 0 ? id : 'TEACHER',
        amount: Math.abs(amount), reason
      });
      closeModal();
      toast('조정 완료', 'success');
    } catch (err) {
      alert('실패: ' + err.message);
    }
  });
};

window.deleteStudent = async (id) => {
  if (!confirm('정말 이 학생을 삭제하시겠습니까? 거래 내역은 남습니다.')) return;
  await deleteDoc(doc(db, 'students', id));
  toast('학생이 삭제되었습니다');
};

// ============================================
// 급여/지급
// ============================================
function updateStudentSelects(students) {
  ['pay-student-select', 'assign-student', 'tx-filter-student'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const placeholder = id === 'tx-filter-student' ? '전체 학생' : '학생 선택';
    sel.innerHTML = `<option value="">${placeholder}</option>` +
      students.map(s => `<option value="${s.id}">${s.number}번 ${escapeHtml(s.name)}</option>`).join('');
  });
}

document.getElementById('pay-individual-btn').addEventListener('click', async () => {
  const studentId = document.getElementById('pay-student-select').value;
  const amount = parseInt(document.getElementById('pay-amount').value);
  const reason = document.getElementById('pay-reason').value.trim() || '교사 지급';
  if (!studentId || !amount || amount < 1) { toast('학생과 금액을 확인하세요', 'error'); return; }
  try {
    await processTransaction({ type: 'payment', from: 'TEACHER', to: studentId, amount, reason });
    document.getElementById('pay-amount').value = '';
    document.getElementById('pay-reason').value = '';
    toast('지급 완료', 'success');
  } catch (err) { toast('실패: ' + err.message, 'error'); }
});

document.getElementById('pay-salary-all').addEventListener('click', async () => {
  if (!confirm('직업이 배정된 모든 학생에게 월급을 지급하시겠습니까?')) return;
  const eligible = cachedStudents.filter(s => s.salary > 0);
  if (eligible.length === 0) { toast('직업이 배정된 학생이 없습니다', 'error'); return; }
  for (const s of eligible) {
    await processTransaction({
      type: 'salary', from: 'TEACHER', to: s.id,
      amount: s.salary, reason: `${s.jobName || '직업'} 월급`
    });
  }
  // 수동 지급 시에도 lastSalaryMonth 업데이트
  await updateDoc(doc(db, 'settings', 'main'), {
    lastSalaryMonth: new Date().toISOString().slice(0, 7).replace('-', '-')
  });
  toast(`${eligible.length}명에게 월급 지급 완료`, 'success');
});

document.getElementById('bulk-pay-btn').addEventListener('click', async () => {
  const amount = parseInt(document.getElementById('bulk-pay-amount').value);
  const reason = document.getElementById('bulk-pay-reason').value.trim();
  if (!amount || amount < 1 || !reason) { toast('금액과 사유를 입력하세요', 'error'); return; }
  if (cachedStudents.length === 0) { toast('학생이 없습니다', 'error'); return; }
  if (!confirm(`전체 ${cachedStudents.length}명에게 ${formatMoney(amount)}씩 지급합니다.`)) return;
  for (const s of cachedStudents) {
    await processTransaction({ type: 'payment', from: 'TEACHER', to: s.id, amount, reason });
  }
  document.getElementById('bulk-pay-amount').value = '';
  document.getElementById('bulk-pay-reason').value = '';
  toast(`${cachedStudents.length}명에게 일괄 지급 완료`, 'success');
});

// ============================================
// 직업 관리
// ============================================
function renderJobsList(jobs) {
  const container = document.getElementById('jobs-list');
  if (jobs.length === 0) {
    container.innerHTML = '<div class="empty-state">직업이 없습니다.<br>"+ 직업 추가" 버튼을 눌러 직업 풀을 만드세요.</div>';
    return;
  }
  container.innerHTML = jobs.map(j => {
    const assignedCount = cachedStudents.filter(s => s.jobId === j.id).length;
    return `
      <div class="job-card">
        <div class="job-title">${escapeHtml(j.name)}</div>
        <div class="job-salary">월급 ${formatMoney(j.salary)}</div>
        <div class="job-meta">현재 배정: ${assignedCount}명${j.maxCount ? ` / 정원 ${j.maxCount}명` : ''}</div>
        <div class="job-desc">${escapeHtml(j.description || '')}</div>
        <div class="student-actions">
          <button class="btn-secondary" onclick="window.editJob('${j.id}')">수정</button>
          <button class="btn-danger" onclick="window.deleteJob('${j.id}')">삭제</button>
        </div>
      </div>
    `;
  }).join('');
}

function updateJobSelects(jobs) {
  const sel = document.getElementById('assign-job');
  if (!sel) return;
  sel.innerHTML = '<option value="">직업 해제</option>' +
    jobs.map(j => `<option value="${j.id}">${escapeHtml(j.name)} (${formatMoney(j.salary)})</option>`).join('');
}

document.getElementById('add-job-btn').addEventListener('click', () => {
  openModal(`
    <h2>직업 추가</h2>
    <form id="job-form" class="modal-form">
      <div class="input-group"><label>직업명</label><input type="text" id="j-name" required placeholder="예: 환경부장" /></div>
      <div class="input-group"><label>월급 (원)</label><input type="number" id="j-salary" required min="0" placeholder="100" /></div>
      <div class="input-group"><label>정원 (선택, 0이면 제한 없음)</label><input type="number" id="j-max" min="0" value="0" /></div>
      <div class="input-group"><label>설명</label><input type="text" id="j-desc" placeholder="하는 일" /></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">취소</button>
        <button type="submit" class="btn-primary">추가</button>
      </div>
    </form>
  `);

  document.getElementById('job-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await addDoc(collection(db, 'jobs'), {
      name: document.getElementById('j-name').value.trim(),
      salary: parseInt(document.getElementById('j-salary').value),
      maxCount: parseInt(document.getElementById('j-max').value) || 0,
      description: document.getElementById('j-desc').value.trim(),
      createdAt: serverTimestamp()
    });
    closeModal();
    toast('직업이 추가되었습니다', 'success');
  });
});

window.editJob = async (id) => {
  const jobDoc = await getDoc(doc(db, 'jobs', id));
  if (!jobDoc.exists()) return;
  const j = jobDoc.data();
  openModal(`
    <h2>직업 수정</h2>
    <form id="job-edit-form" class="modal-form">
      <div class="input-group"><label>직업명</label><input type="text" id="j-name" required value="${escapeHtml(j.name)}" /></div>
      <div class="input-group"><label>월급 (원)</label><input type="number" id="j-salary" required min="0" value="${j.salary}" /></div>
      <div class="input-group"><label>정원</label><input type="number" id="j-max" min="0" value="${j.maxCount || 0}" /></div>
      <div class="input-group"><label>설명</label><input type="text" id="j-desc" value="${escapeHtml(j.description || '')}" /></div>
      <p class="hint">⚠️ 월급 변경 시 배정된 학생들의 월급도 자동 업데이트됩니다</p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">취소</button>
        <button type="submit" class="btn-primary">저장</button>
      </div>
    </form>
  `);

  document.getElementById('job-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newName = document.getElementById('j-name').value.trim();
    const newSalary = parseInt(document.getElementById('j-salary').value);
    const newMax = parseInt(document.getElementById('j-max').value) || 0;
    const newDesc = document.getElementById('j-desc').value.trim();
    const batch = writeBatch(db);
    batch.update(doc(db, 'jobs', id), { name: newName, salary: newSalary, maxCount: newMax, description: newDesc });
    cachedStudents.filter(s => s.jobId === id).forEach(s => {
      batch.update(doc(db, 'students', s.id), { jobName: newName, salary: newSalary });
    });
    await batch.commit();
    closeModal();
    toast('직업이 수정되었습니다', 'success');
  });
};

window.deleteJob = async (id) => {
  const assigned = cachedStudents.filter(s => s.jobId === id);
  let msg = '이 직업을 삭제하시겠습니까?';
  if (assigned.length > 0) msg += `\n현재 ${assigned.length}명이 배정되어 있으며, 자동 해제됩니다.`;
  if (!confirm(msg)) return;
  const batch = writeBatch(db);
  batch.delete(doc(db, 'jobs', id));
  assigned.forEach(s => batch.update(doc(db, 'students', s.id), { jobId: null, jobName: null, salary: 0 }));
  await batch.commit();
  toast('직업이 삭제되었습니다');
};

document.getElementById('assign-job-btn').addEventListener('click', async () => {
  const studentId = document.getElementById('assign-student').value;
  const jobId = document.getElementById('assign-job').value;
  if (!studentId) { toast('학생을 선택하세요', 'error'); return; }
  if (!jobId) {
    await updateDoc(doc(db, 'students', studentId), { jobId: null, jobName: null, salary: 0 });
    toast('직업이 해제되었습니다', 'success');
    return;
  }
  const jobDoc = await getDoc(doc(db, 'jobs', jobId));
  if (!jobDoc.exists()) return;
  const job = jobDoc.data();
  if (job.maxCount > 0) {
    const currentCount = cachedStudents.filter(s => s.jobId === jobId && s.id !== studentId).length;
    if (currentCount >= job.maxCount) { toast(`정원 초과 (${job.maxCount}명)`, 'error'); return; }
  }
  await updateDoc(doc(db, 'students', studentId), { jobId, jobName: job.name, salary: job.salary });
  toast(`${job.name} 직업이 배정되었습니다`, 'success');
});

// ============================================
// 게임 관리
// ============================================
function renderGamesList(games, isTeacher) {
  const container = document.getElementById('games-list');
  if (!container) return;
  if (games.length === 0) {
    container.innerHTML = '<div class="empty-state">등록된 게임이 없습니다.</div>';
    return;
  }
  container.innerHTML = games.map(g => `
    <div class="game-card">
      <div class="game-title">${escapeHtml(g.title)}</div>
      <div class="game-desc">${escapeHtml(g.description || '')}</div>
      ${g.url ? `<a href="${escapeHtml(g.url)}" target="_blank" rel="noopener" class="btn-primary" style="text-decoration:none;display:inline-block">게임 열기</a>` : ''}
      ${isTeacher ? `<button class="btn-danger" onclick="window.deleteGame('${g.id}')" style="margin-left:8px">삭제</button>` : ''}
    </div>
  `).join('');
}

document.getElementById('add-game-btn').addEventListener('click', () => {
  openModal(`
    <h2>게임 추가</h2>
    <form id="game-form" class="modal-form">
      <div class="input-group"><label>게임 제목</label><input type="text" id="g-title" required placeholder="예: 수학 퀴즈" /></div>
      <div class="input-group"><label>설명</label><input type="text" id="g-desc" placeholder="짧은 소개" /></div>
      <div class="input-group"><label>게임 URL (선택)</label><input type="url" id="g-url" placeholder="https://..." /></div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">취소</button>
        <button type="submit" class="btn-primary">추가</button>
      </div>
    </form>
  `);

  document.getElementById('game-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await addDoc(collection(db, 'games'), {
      title: document.getElementById('g-title').value.trim(),
      description: document.getElementById('g-desc').value.trim(),
      url: document.getElementById('g-url').value.trim(),
      createdAt: serverTimestamp()
    });
    closeModal();
    toast('게임이 추가되었습니다', 'success');
  });
});

window.deleteGame = async (id) => {
  if (!confirm('이 게임을 삭제하시겠습니까?')) return;
  await deleteDoc(doc(db, 'games', id));
  toast('게임이 삭제되었습니다');
};

// ============================================
// 거래 내역 필터
// ============================================
document.getElementById('tx-filter-type').addEventListener('change', applyTxFilter);
document.getElementById('tx-filter-student').addEventListener('change', applyTxFilter);

function applyTxFilter() {
  const typeFilter = document.getElementById('tx-filter-type').value;
  const studentFilter = document.getElementById('tx-filter-student').value;
  let filtered = allTransactions;
  if (typeFilter) filtered = filtered.filter(t => t.type === typeFilter);
  if (studentFilter) filtered = filtered.filter(t => t.from === studentFilter || t.to === studentFilter);
  renderTransactions(filtered, document.getElementById('transactions-list'));
}

// ============================================
// CSV 내보내기
// ============================================
document.getElementById('export-csv-btn').addEventListener('click', async () => {
  const snapshot = await getDocs(query(collection(db, 'transactions'), orderBy('createdAt', 'desc')));
  const txs = snapshot.docs.map(d => d.data());
  if (txs.length === 0) { toast('거래 내역이 없습니다', 'error'); return; }
  const headers = ['날짜', '유형', '보낸 사람', '받는 사람', '금액', '사유'];
  const rows = txs.map(t => [
    t.createdAt?.toDate ? t.createdAt.toDate().toLocaleString('ko-KR') : '',
    txTypeLabel(t.type),
    getDisplayName(t.from),
    getDisplayName(t.to),
    t.amount,
    (t.reason || '').replace(/,/g, ' ')
  ]);
  const csv = '\ufeff' + [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `학급통장_거래내역_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV 다운로드 완료', 'success');
});

function getDisplayName(id) {
  if (id === 'TEACHER') return '선생님';
  if (id === TREASURY_ID) return '국고';
  const s = cachedStudents.find(st => st.id === id);
  return s ? `${s.number}번 ${s.name}` : id;
}

// ============================================
// 설정
// ============================================
document.getElementById('save-max-transfer').addEventListener('click', async () => {
  const max = parseInt(document.getElementById('setting-max-transfer').value) || 0;
  await updateDoc(doc(db, 'settings', 'main'), { maxTransfer: max });
  toast('거래 한도가 저장되었습니다', 'success');
});

document.getElementById('auto-salary-toggle').addEventListener('change', async (e) => {
  await setAutoSalary(e.target.checked);
  toast(`자동 월급이 ${e.target.checked ? '활성화' : '비활성화'}되었습니다`, 'success');
});

document.getElementById('treasury-spend-btn').addEventListener('click', async () => {
  const amount = parseInt(document.getElementById('treasury-amount').value);
  const reason = document.getElementById('treasury-reason').value.trim();
  if (!amount || amount < 1 || !reason) { toast('금액과 사유를 입력하세요', 'error'); return; }
  if (amount > cachedTreasuryBalance) { toast('국고 잔액이 부족합니다', 'error'); return; }
  if (!confirm(`국고에서 ${formatMoney(amount)}을(를) "${reason}"로 사용합니다.`)) return;
  await processTransaction({
    type: 'treasury_spend', from: TREASURY_ID, to: 'TEACHER',
    amount, reason
  });
  document.getElementById('treasury-amount').value = '';
  document.getElementById('treasury-reason').value = '';
  toast('국고 지출 완료', 'success');
});

document.getElementById('change-teacher-pw').addEventListener('click', async () => {
  const newPw = document.getElementById('new-teacher-pw').value;
  if (!newPw || newPw.length < 4) { toast('4자 이상 입력하세요', 'error'); return; }
  const pwHash = await hashPw(newPw);
  await updateDoc(doc(db, 'users', currentUser.uid), { pwHash });
  document.getElementById('new-teacher-pw').value = '';
  toast('비밀번호가 변경되었습니다', 'success');
});

document.getElementById('reset-transactions-btn').addEventListener('click', async () => {
  if (!confirm('정말 모든 거래 내역을 삭제하시겠습니까?')) return;
  if (!confirm('한 번 더 확인합니다.')) return;
  const snapshot = await getDocs(collection(db, 'transactions'));
  const batch = writeBatch(db);
  snapshot.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  toast(`${snapshot.size}건이 삭제되었습니다`, 'success');
});

// ============================================
// 학생 화면
// ============================================
function enterStudentScreen() {
  showScreen('student-screen');
  document.getElementById('student-name').textContent = currentUser.name;

  // 학생 컨텍스트 모듈에 전달
  setShopCtx(currentUser);
  setSavingsCtx(currentUser);
  setTaxCtx(currentUser);
  setMsgStudentCtx(currentUser);

  // 종 버튼 → 메시지함
  document.getElementById('student-msg-bell').onclick = () => {
    openStudentInbox(currentUser);
  };

  // 안 읽은 메시지 수 실시간 업데이트 (헤더 종 + 액션 버튼 배지)
  onUnreadCountChange((count) => {
    const headerBadge = document.getElementById('student-msg-badge');
    const actionBadge = document.getElementById('student-msg-action-badge');
    if (count > 0) {
      const text = count > 99 ? '99+' : count;
      if (headerBadge) {
        headerBadge.textContent = text;
        headerBadge.style.display = 'inline-flex';
      }
      if (actionBadge) {
        actionBadge.textContent = text;
        actionBadge.style.display = 'inline-flex';
      }
    } else {
      if (headerBadge) headerBadge.style.display = 'none';
      if (actionBadge) actionBadge.style.display = 'none';
    }
  });
  unsubscribers.push(subscribeUnreadCount(currentUser.uid, 'student'));

  // 본인 정보
  const meUnsub = onSnapshot(doc(db, 'students', currentUser.uid), (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      document.getElementById('student-balance').textContent = formatMoney(data.balance || 0);
      document.getElementById('student-job').textContent = data.jobName || '미배정';
      document.getElementById('student-salary').textContent = formatMoney(data.salary || 0);
      currentUser = { ...currentUser, ...data };
      setShopCtx(currentUser);
      setSavingsCtx(currentUser);
      setTaxCtx(currentUser);
      setMsgStudentCtx(currentUser);
    }
  });
  unsubscribers.push(meUnsub);

  // 본인 거래 내역 (인덱스 회피: orderBy/limit는 클라이언트에서)
  const txUnsub = onSnapshot(
    query(
      collection(db, 'transactions'),
      where('participants', 'array-contains', currentUser.uid)
    ),
    (snapshot) => {
      const txs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
        .slice(0, 20);
      renderTransactions(txs, document.getElementById('my-transactions'), currentUser.uid);
    }
  );
  unsubscribers.push(txUnsub);

  // 학생 목록 (송금용)
  const studentsUnsub = onSnapshot(
    query(collection(db, 'students'), orderBy('number')),
    (snap) => { cachedStudents = snap.docs.map(d => ({ id: d.id, ...d.data() })); }
  );
  unsubscribers.push(studentsUnsub);

  // 설정
  const settingsUnsub = onSnapshot(doc(db, 'settings', 'main'), (snap) => {
    if (snap.exists()) classSettings = snap.data();
  });
  unsubscribers.push(settingsUnsub);

  // 국고 (학생도 봐야 함 - 학급 목표용)
  const treasuryUnsub = onSnapshot(doc(db, 'users', TREASURY_ID), (snap) => {
    if (snap.exists()) cachedTreasuryBalance = snap.data().balance || 0;
  });
  unsubscribers.push(treasuryUnsub);

  // 이자율 설정 실시간 구독 (교사가 변경하면 학생도 즉시 새 이자율 표시)
  unsubscribers.push(subscribeRates());
}

// 학생 액션 버튼
document.querySelectorAll('.action-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    if (action === 'transfer') openTransferModal();
    else if (action === 'tax') openMyTaxBillsModal(currentUser);
    else if (action === 'shop') openShopModal(currentUser);
    else if (action === 'savings') openSavingsModal(currentUser);
    else if (action === 'goals') openGoalsModal(cachedTreasuryBalance);
    else if (action === 'games') openGamesStudentModal();
    else if (action === 'messages') openStudentInbox(currentUser);
    else if (action === 'history') openHistoryModal();
  });
});

document.getElementById('change-my-pw').addEventListener('click', async () => {
  const newPw = document.getElementById('my-new-pw').value;
  if (!newPw || newPw.length < 4) { toast('4자 이상 입력하세요', 'error'); return; }
  const pwHash = await hashPw(newPw);
  await updateDoc(doc(db, 'students', currentUser.uid), { pwHash });
  document.getElementById('my-new-pw').value = '';
  toast('비밀번호가 변경되었습니다', 'success');
});

function openTransferModal() {
  const others = cachedStudents.filter(s => s.id !== currentUser.uid);
  const limitText = classSettings.maxTransfer > 0
    ? `<p class="hint">⚠️ 1회 송금 한도: ${formatMoney(classSettings.maxTransfer)}</p>`
    : '';
  openModal(`
    <h2>송금하기</h2>
    <form id="transfer-form" class="modal-form">
      <div class="input-group">
        <label>받는 사람</label>
        <select id="t-to" required>
          <option value="">선택하세요</option>
          <option value="TEACHER">선생님</option>
          ${others.map(s => `<option value="${s.id}">${s.number}번 ${escapeHtml(s.name)}</option>`).join('')}
        </select>
      </div>
      <div class="input-group">
        <label>금액 (원)</label>
        <input type="number" id="t-amount" required min="1" max="${currentUser.balance || 0}" />
      </div>
      <div class="input-group">
        <label>메모 (선택)</label>
        <input type="text" id="t-reason" placeholder="송금 사유" />
      </div>
      <p class="hint">현재 잔액: ${formatMoney(currentUser.balance || 0)}</p>
      ${limitText}
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">취소</button>
        <button type="submit" class="btn-primary">송금</button>
      </div>
    </form>
  `);

  document.getElementById('transfer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const to = document.getElementById('t-to').value;
    const amount = parseInt(document.getElementById('t-amount').value);
    const reason = document.getElementById('t-reason').value.trim() || '송금';
    if (amount > (currentUser.balance || 0)) { toast('잔액이 부족합니다', 'error'); return; }
    if (to !== 'TEACHER' && classSettings.maxTransfer > 0 && amount > classSettings.maxTransfer) {
      toast(`송금 한도 초과 (최대 ${formatMoney(classSettings.maxTransfer)})`, 'error');
      return;
    }
    try {
      await processTransaction({ type: 'transfer', from: currentUser.uid, to, amount, reason });
      closeModal();
      toast('송금 완료!', 'success');
    } catch (err) { toast('실패: ' + err.message, 'error'); }
  });
}

function openTaxModal() {
  openModal(`
    <h2>세금 납부</h2>
    <p class="hint">납부한 세금/벌금은 학급 국고로 들어갑니다</p>
    <form id="tax-form" class="modal-form">
      <div class="input-group">
        <label>세금 종류</label>
        <select id="tax-type" required>
          <option value="소득세">소득세</option>
          <option value="재산세">재산세</option>
          <option value="자리세">자리세</option>
          <option value="벌금">벌금</option>
          <option value="기타">기타</option>
        </select>
      </div>
      <div class="input-group"><label>금액 (원)</label><input type="number" id="tax-amount" required min="1" max="${currentUser.balance || 0}" /></div>
      <p class="hint">현재 잔액: ${formatMoney(currentUser.balance || 0)}</p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">취소</button>
        <button type="submit" class="btn-primary">납부</button>
      </div>
    </form>
  `);

  document.getElementById('tax-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('tax-type').value;
    const amount = parseInt(document.getElementById('tax-amount').value);
    if (amount > (currentUser.balance || 0)) { toast('잔액이 부족합니다', 'error'); return; }
    await processTransaction({ type: 'tax', from: currentUser.uid, to: TREASURY_ID, amount, reason: type });
    closeModal();
    toast('납부 완료. 국고에 입금되었습니다', 'success');
  });
}

async function openGamesStudentModal() {
  const snapshot = await getDocs(collection(db, 'games'));
  const games = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  if (games.length === 0) {
    openModal(`
      <h2>학급 게임</h2>
      <p style="margin:20px 0;text-align:center;color:#6B7280">아직 등록된 게임이 없어요.</p>
      <div class="modal-actions"><button class="btn-primary" onclick="window.closeModal()">확인</button></div>
    `);
    return;
  }
  openModal(`
    <h2>학급 게임</h2>
    <div class="card-grid" style="grid-template-columns:1fr">
      ${games.map(g => `
        <div class="game-card">
          <div class="game-title">${escapeHtml(g.title)}</div>
          <div class="game-desc">${escapeHtml(g.description || '')}</div>
          ${g.url ? `<a href="${escapeHtml(g.url)}" target="_blank" rel="noopener" class="btn-primary" style="text-decoration:none;display:inline-block">시작하기</a>` : '<span class="hint">선생님께 확인하세요</span>'}
        </div>
      `).join('')}
    </div>
    <div class="modal-actions"><button class="btn-secondary" onclick="window.closeModal()">닫기</button></div>
  `);
}

async function openHistoryModal() {
  const snapshot = await getDocs(query(
    collection(db, 'transactions'),
    where('participants', 'array-contains', currentUser.uid)
  ));
  const txs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    .slice(0, 100);
  openModal(`
    <h2>전체 거래 내역</h2>
    <div id="history-list" class="transaction-list" style="max-height:60vh;overflow-y:auto"></div>
    <div class="modal-actions"><button class="btn-secondary" onclick="window.closeModal()">닫기</button></div>
  `);
  renderTransactions(txs, document.getElementById('history-list'), currentUser.uid);
}

// ============================================
// 거래 내역 렌더링
// ============================================
function renderTransactions(txs, container, viewerId = null) {
  if (!container) return;
  if (txs.length === 0) {
    container.innerHTML = '<div class="empty-state">거래 내역이 없습니다.</div>';
    return;
  }
  container.innerHTML = txs.map(tx => {
    const isReceiver = viewerId && tx.to === viewerId;
    const isSender = viewerId && tx.from === viewerId;
    let amountClass = '', amountSign = '';
    if (viewerId) {
      if (isReceiver) { amountClass = 'amount-plus'; amountSign = '+'; }
      else if (isSender) { amountClass = 'amount-minus'; amountSign = '-'; }
    }
    const fromLabel = getDisplayName(tx.from);
    const toLabel = getDisplayName(tx.to);
    const date = tx.createdAt?.toDate ? formatDate(tx.createdAt.toDate()) : '';
    return `
      <div class="transaction-item">
        <div class="transaction-info">
          <div class="transaction-title">[${txTypeLabel(tx.type)}] ${escapeHtml(tx.reason || '')}</div>
          <div class="transaction-meta">${escapeHtml(fromLabel)} → ${escapeHtml(toLabel)} · ${date}</div>
        </div>
        <div class="transaction-amount ${amountClass}">${amountSign}${formatMoney(tx.amount)}</div>
      </div>
    `;
  }).join('');
}

// 모달 백그라운드 클릭 닫기
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') closeModal();
});

// 시작!
init();
