// ============================================
// 메시지 시스템 (Messages)
// 교사 → 학생: 전체 또는 개별 선택 발송
// 학생 → 교사: 항상 교사에게만 (학생 선택 불가)
// 학생 ↔ 학생: 차단
// ============================================

import {
  db,
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, writeBatch
} from "../firebase-config.js";
import {
  toast, openModal, closeModal, escapeHtml, formatDate
} from "./utils.js";

const TEACHER_ROLE = 'teacher';
const STUDENT_ROLE = 'student';

// ============================================
// 컨텍스트 저장소
// ============================================
let __teacherCtx = null;
let __studentCtx = null;
let __cachedStudents = [];
let __unreadCountCallback = null; // 안 읽은 메시지 수를 외부에 알림

export function setTeacherContext(user) { __teacherCtx = user; }
export function setStudentContext(user) { __studentCtx = user; }
export function setCachedStudents(students) { __cachedStudents = students; }
export function onUnreadCountChange(cb) { __unreadCountCallback = cb; }

// ============================================
// 안 읽은 메시지 개수 실시간 구독
// ============================================
// 교사용: 학생들로부터 받은 안 읽은 메시지 수
// 학생용: 본인이 받은 안 읽은 메시지 수
export function subscribeUnreadCount(userId, role) {
  // 교사: receiverId === 'TEACHER' && read === false 인 메시지 수
  // 학생: receiverId === 자기 ID && read === false 인 메시지 수
  const receiverId = role === TEACHER_ROLE ? 'TEACHER' : userId;

  // 인덱스 회피: where 1개만 사용, read 필터는 클라이언트에서
  const q = query(
    collection(db, 'messages'),
    where('receiverId', '==', receiverId)
  );

  return onSnapshot(q, (snap) => {
    const count = snap.docs.filter(d => d.data().read === false).length;
    if (__unreadCountCallback) __unreadCountCallback(count);
  });
}

// ============================================
// 교사: 메시지 작성 모달
// ============================================
export function openComposeModalForTeacher(students) {
  __cachedStudents = students;

  openModal(`
    <h2>📨 메시지 보내기</h2>
    <form id="msg-compose-form" class="modal-form">
      <div class="input-group">
        <label>받는 사람</label>
        <div style="background:#F9FAFB;padding:10px;border-radius:8px;border:1px solid #E5E7EB">
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;font-weight:600">
            <input type="radio" name="msg-target" value="all" checked onchange="window.toggleMsgTarget('all')" />
            📢 전체 학생 (${students.length}명)
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600">
            <input type="radio" name="msg-target" value="select" onchange="window.toggleMsgTarget('select')" />
            👤 선택한 학생만
          </label>
          <div id="msg-student-picker" style="margin-top:8px;max-height:140px;overflow-y:auto;display:none;flex-direction:column;gap:4px;padding-top:8px;border-top:1px solid #E5E7EB">
            ${students.map(s => `
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
                <input type="checkbox" class="msg-student" value="${s.id}" />
                ${s.number}번 ${escapeHtml(s.name)}
              </label>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="input-group">
        <label>제목 (선택)</label>
        <input type="text" id="msg-title" placeholder="예: 알림" maxlength="50" />
      </div>

      <div class="input-group">
        <label>내용</label>
        <textarea id="msg-body" required maxlength="500" rows="5"
          style="padding:12px;border:1.5px solid #E5E7EB;border-radius:10px;font-family:inherit;font-size:14px;resize:vertical"
          placeholder="학생들에게 전할 내용을 입력하세요"></textarea>
        <small style="font-size:11px;color:#6B7280">최대 500자</small>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">취소</button>
        <button type="submit" class="btn-primary">보내기</button>
      </div>
    </form>
  `);

  document.getElementById('msg-compose-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const target = document.querySelector('input[name="msg-target"]:checked').value;
    const title = document.getElementById('msg-title').value.trim();
    const body = document.getElementById('msg-body').value.trim();

    if (!body) {
      toast('내용을 입력하세요', 'error');
      return;
    }

    let receiverIds = [];
    if (target === 'all') {
      receiverIds = students.map(s => s.id);
    } else {
      receiverIds = Array.from(document.querySelectorAll('.msg-student:checked')).map(c => c.value);
      if (receiverIds.length === 0) {
        toast('받는 학생을 선택하세요', 'error');
        return;
      }
    }

    try {
      // 각 수신자별로 메시지 문서 생성 (배치)
      const batch = writeBatch(db);
      receiverIds.forEach(rid => {
        const msgRef = doc(collection(db, 'messages'));
        batch.set(msgRef, {
          senderId: 'TEACHER',
          senderRole: TEACHER_ROLE,
          senderName: __teacherCtx?.name || '선생님',
          receiverId: rid,
          receiverRole: STUDENT_ROLE,
          title: title || null,
          body: body,
          read: false,
          isAnnouncement: target === 'all',
          createdAt: serverTimestamp()
        });
      });
      await batch.commit();

      closeModal();
      toast(`${receiverIds.length}명에게 메시지 발송 완료`, 'success');
      refreshActiveMsgView();
    } catch (err) {
      toast('실패: ' + err.message, 'error');
    }
  });
}

// 라디오 버튼 토글
window.toggleMsgTarget = (target) => {
  const picker = document.getElementById('msg-student-picker');
  if (!picker) return;
  picker.style.display = target === 'select' ? 'flex' : 'none';
};

// ============================================
// 학생: 교사에게 메시지 작성 (학생 선택 불가)
// ============================================
export function openComposeModalForStudent() {
  openModal(`
    <h2>📨 선생님께 메시지</h2>
    <p class="hint">선생님께만 전달됩니다. 다른 친구에게는 메시지를 보낼 수 없어요.</p>
    <form id="msg-compose-form" class="modal-form">
      <div class="input-group">
        <label>받는 사람</label>
        <div style="background:#EEF2FF;padding:12px;border-radius:8px;border:1px solid #C7D2FE">
          <span style="font-weight:600;color:#4338CA">👩‍🏫 선생님</span>
        </div>
      </div>

      <div class="input-group">
        <label>제목 (선택)</label>
        <input type="text" id="msg-title" placeholder="예: 질문있어요" maxlength="50" />
      </div>

      <div class="input-group">
        <label>내용</label>
        <textarea id="msg-body" required maxlength="500" rows="5"
          style="padding:12px;border:1.5px solid #E5E7EB;border-radius:10px;font-family:inherit;font-size:14px;resize:vertical"
          placeholder="선생님께 전할 내용을 입력하세요"></textarea>
        <small style="font-size:11px;color:#6B7280">최대 500자</small>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">취소</button>
        <button type="submit" class="btn-primary">보내기</button>
      </div>
    </form>
  `);

  document.getElementById('msg-compose-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('msg-title').value.trim();
    const body = document.getElementById('msg-body').value.trim();

    if (!body) {
      toast('내용을 입력하세요', 'error');
      return;
    }
    if (!__studentCtx) {
      toast('학생 정보가 없습니다', 'error');
      return;
    }

    try {
      await addDoc(collection(db, 'messages'), {
        senderId: __studentCtx.uid,
        senderRole: STUDENT_ROLE,
        senderName: __studentCtx.name,
        senderNumber: __studentCtx.number,
        receiverId: 'TEACHER',
        receiverRole: TEACHER_ROLE,
        title: title || null,
        body: body,
        read: false,
        isAnnouncement: false,
        createdAt: serverTimestamp()
      });

      closeModal();
      toast('선생님께 메시지를 보냈어요!', 'success');
    } catch (err) {
      toast('실패: ' + err.message, 'error');
    }
  });
}

// ============================================
// 받은 메시지함 (양쪽 공통)
// ============================================
export async function openInbox(currentUser, role) {
  const receiverId = role === TEACHER_ROLE ? 'TEACHER' : currentUser.uid;

  // 받은 메시지 조회 (인덱스 회피)
  const snap = await getDocs(query(
    collection(db, 'messages'),
    where('receiverId', '==', receiverId)
  ));
  const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    .slice(0, 100);

  // 보낸 메시지도 조회
  const senderId = role === TEACHER_ROLE ? 'TEACHER' : currentUser.uid;
  const sentSnap = await getDocs(query(
    collection(db, 'messages'),
    where('senderId', '==', senderId)
  ));
  const sentMessages = sentSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    .slice(0, 50);

  const unreadCount = messages.filter(m => !m.read).length;
  const composeBtnLabel = role === TEACHER_ROLE ? '학생에게 보내기' : '선생님께 보내기';
  const composeAction = role === TEACHER_ROLE ? 'window.openMsgComposeTeacher()' : 'window.openMsgComposeStudent()';

  openModal(`
    <h2>📬 메시지함</h2>

    <div style="display:flex;gap:8px;margin-bottom:12px;border-bottom:1px solid #E5E7EB">
      <button class="msg-tab-btn active" data-tab="received" onclick="window.switchMsgTab('received')"
        style="background:none;border:none;border-bottom:2px solid #4F7CFF;color:#4F7CFF;padding:8px 12px;cursor:pointer;font-weight:600">
        받은 메시지 ${unreadCount > 0 ? `<span style="background:#EF4444;color:white;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px">${unreadCount}</span>` : ''}
      </button>
      <button class="msg-tab-btn" data-tab="sent" onclick="window.switchMsgTab('sent')"
        style="background:none;border:none;border-bottom:2px solid transparent;color:#6B7280;padding:8px 12px;cursor:pointer;font-weight:500">
        보낸 메시지 (${sentMessages.length})
      </button>
    </div>

    <div id="msg-list-received" class="msg-list" style="max-height:50vh;overflow-y:auto">
      ${renderMessageList(messages, role, true)}
    </div>
    <div id="msg-list-sent" class="msg-list" style="display:none;max-height:50vh;overflow-y:auto">
      ${renderMessageList(sentMessages, role, false)}
    </div>

    <div class="modal-actions">
      <button class="btn-secondary" onclick="window.closeModal()">닫기</button>
      <button class="btn-primary" onclick="${composeAction}">${composeBtnLabel}</button>
    </div>
  `);
}

function renderMessageList(messages, viewerRole, isReceived) {
  if (messages.length === 0) {
    return '<div class="empty-state">메시지가 없습니다.</div>';
  }
  return `<div style="display:flex;flex-direction:column;gap:6px">
    ${messages.map(m => renderMessageCard(m, viewerRole, isReceived)).join('')}
  </div>`;
}

function renderMessageCard(m, viewerRole, isReceived) {
  const date = m.createdAt?.toDate ? formatDate(m.createdAt.toDate()) : '';

  // 받은 메시지일 때 발신자 표시
  let counterpartLabel;
  if (isReceived) {
    if (m.senderRole === 'teacher') {
      counterpartLabel = '👩‍🏫 선생님';
    } else {
      // 학생이 보낸 것 (= 교사가 받은 것)
      counterpartLabel = m.senderNumber
        ? `🎒 ${m.senderNumber}번 ${m.senderName}`
        : `🎒 ${m.senderName}`;
    }
  } else {
    // 보낸 메시지: 수신자 표시
    if (m.receiverRole === 'teacher') {
      counterpartLabel = '👩‍🏫 선생님';
    } else if (m.isAnnouncement) {
      counterpartLabel = '📢 전체 학생';
    } else {
      // 받는 학생 찾기
      const student = __cachedStudents.find(s => s.id === m.receiverId);
      counterpartLabel = student ? `🎒 ${student.number}번 ${student.name}` : `🎒 ${m.receiverId}`;
    }
  }

  const unreadDot = isReceived && !m.read
    ? '<span style="display:inline-block;width:8px;height:8px;background:#EF4444;border-radius:50%;margin-right:6px"></span>'
    : '';
  const announcementBadge = m.isAnnouncement
    ? '<span style="background:#FEF3C7;color:#92400E;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:4px">전체</span>'
    : '';
  const readBadge = !isReceived
    ? (m.read
      ? '<span style="background:#ECFDF5;color:#059669;padding:2px 6px;border-radius:4px;font-size:10px">읽음</span>'
      : '<span style="background:#F3F4F6;color:#6B7280;padding:2px 6px;border-radius:4px;font-size:10px">안읽음</span>')
    : '';

  const bgColor = isReceived && !m.read ? '#EEF2FF' : '#F9FAFB';
  const previewBody = m.body.length > 60 ? m.body.slice(0, 60) + '…' : m.body;

  return `
    <div class="msg-item" onclick="window.openMessageDetail('${m.id}', ${isReceived})"
      style="cursor:pointer;padding:12px;background:${bgColor};border-radius:8px;border:1px solid #E5E7EB;transition:background 0.15s">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:4px">
        <div style="font-weight:600;font-size:13px">
          ${unreadDot}${escapeHtml(counterpartLabel)}${announcementBadge}
        </div>
        <div style="font-size:11px;color:#6B7280">${date} ${readBadge}</div>
      </div>
      ${m.title ? `<div style="font-size:13px;font-weight:500;margin-bottom:2px">${escapeHtml(m.title)}</div>` : ''}
      <div style="font-size:12px;color:#6B7280;line-height:1.4">${escapeHtml(previewBody)}</div>
    </div>
  `;
}

// 메시지 탭 전환
window.switchMsgTab = (tab) => {
  document.querySelectorAll('.msg-tab-btn').forEach(b => {
    const isActive = b.dataset.tab === tab;
    b.style.borderBottomColor = isActive ? '#4F7CFF' : 'transparent';
    b.style.color = isActive ? '#4F7CFF' : '#6B7280';
    b.style.fontWeight = isActive ? '600' : '500';
  });
  document.getElementById('msg-list-received').style.display = tab === 'received' ? 'block' : 'none';
  document.getElementById('msg-list-sent').style.display = tab === 'sent' ? 'block' : 'none';
};

// 메시지 상세 보기 + 자동 읽음 처리
window.openMessageDetail = async (msgId, isReceived) => {
  const snap = await getDoc(doc(db, 'messages', msgId));
  if (!snap.exists()) {
    toast('메시지를 찾을 수 없습니다', 'error');
    return;
  }
  const m = { id: snap.id, ...snap.data() };

  // 받은 메시지면서 안 읽었으면 읽음 처리
  if (isReceived && !m.read) {
    await updateDoc(doc(db, 'messages', msgId), {
      read: true,
      readAt: serverTimestamp()
    });
  }

  const date = m.createdAt?.toDate ? formatDate(m.createdAt.toDate()) : '';
  let senderLabel, receiverLabel;
  if (m.senderRole === 'teacher') {
    senderLabel = '👩‍🏫 선생님';
  } else {
    senderLabel = m.senderNumber ? `🎒 ${m.senderNumber}번 ${m.senderName}` : `🎒 ${m.senderName}`;
  }
  if (m.receiverRole === 'teacher') {
    receiverLabel = '👩‍🏫 선생님';
  } else if (m.isAnnouncement) {
    receiverLabel = '📢 전체 학생';
  } else {
    const student = __cachedStudents.find(s => s.id === m.receiverId);
    receiverLabel = student ? `🎒 ${student.number}번 ${student.name}` : `🎒 ${m.receiverId}`;
  }

  // 받은 메시지에서 답장 가능 여부:
  // - 학생이 받은 메시지(교사로부터) → 교사에게 답장 가능
  // - 교사가 받은 메시지(학생으로부터) → 그 학생에게 답장 가능
  const canReply = isReceived;
  let replyAction = '';
  if (canReply) {
    if (m.senderRole === 'teacher') {
      // 학생이 답장: 교사에게
      replyAction = `window.openMsgComposeStudent(); window.closeModalAfter()`;
    } else {
      // 교사가 답장: 그 학생에게 (이름 미리 채움)
      replyAction = `window.openTeacherReplyTo('${m.senderId}', '${escapeHtml(m.senderName).replace(/'/g, "\\'")}'); window.closeModalAfter()`;
    }
  }

  openModal(`
    <h2>${m.title ? escapeHtml(m.title) : '메시지'}</h2>
    <div style="background:#F9FAFB;border-radius:8px;padding:12px;margin-bottom:12px;font-size:13px">
      <div style="margin-bottom:4px"><strong>보낸이:</strong> ${escapeHtml(senderLabel)}</div>
      <div style="margin-bottom:4px"><strong>받는이:</strong> ${escapeHtml(receiverLabel)}</div>
      <div><strong>일시:</strong> ${date}</div>
    </div>
    <div style="background:white;border:1px solid #E5E7EB;border-radius:8px;padding:16px;font-size:14px;line-height:1.7;white-space:pre-wrap;min-height:100px">${escapeHtml(m.body)}</div>

    <div class="modal-actions">
      ${isReceived ? `<button class="btn-danger" onclick="window.deleteMessage('${m.id}')">삭제</button>` : ''}
      <button class="btn-secondary" onclick="window.closeModal()">닫기</button>
      ${canReply ? `<button class="btn-primary" onclick="${replyAction}">답장</button>` : ''}
    </div>
  `);
};

// 다음 모달을 열기 위해 잠깐 닫는 헬퍼
window.closeModalAfter = () => { /* no-op, 새 openModal이 덮어씀 */ };

// 교사가 특정 학생에게 답장
window.openTeacherReplyTo = (studentId, studentName) => {
  const student = __cachedStudents.find(s => s.id === studentId);
  openModal(`
    <h2>📨 답장 보내기</h2>
    <form id="msg-reply-form" class="modal-form">
      <div class="input-group">
        <label>받는 사람</label>
        <div style="background:#EEF2FF;padding:12px;border-radius:8px;border:1px solid #C7D2FE">
          <span style="font-weight:600;color:#4338CA">🎒 ${student ? `${student.number}번 ${escapeHtml(student.name)}` : escapeHtml(studentName)}</span>
        </div>
      </div>
      <div class="input-group">
        <label>제목 (선택)</label>
        <input type="text" id="msg-title" maxlength="50" />
      </div>
      <div class="input-group">
        <label>내용</label>
        <textarea id="msg-body" required maxlength="500" rows="5"
          style="padding:12px;border:1.5px solid #E5E7EB;border-radius:10px;font-family:inherit;font-size:14px;resize:vertical"></textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">취소</button>
        <button type="submit" class="btn-primary">보내기</button>
      </div>
    </form>
  `);

  document.getElementById('msg-reply-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('msg-title').value.trim();
    const body = document.getElementById('msg-body').value.trim();
    if (!body) { toast('내용을 입력하세요', 'error'); return; }

    await addDoc(collection(db, 'messages'), {
      senderId: 'TEACHER',
      senderRole: TEACHER_ROLE,
      senderName: __teacherCtx?.name || '선생님',
      receiverId: studentId,
      receiverRole: STUDENT_ROLE,
      title: title || null,
      body: body,
      read: false,
      isAnnouncement: false,
      createdAt: serverTimestamp()
    });

    closeModal();
    toast('답장 발송 완료', 'success');
    refreshActiveMsgView();
  });
};

// 메시지 삭제 (받은 메시지만)
window.deleteMessage = async (msgId) => {
  if (!confirm('이 메시지를 삭제하시겠습니까?')) return;
  await deleteDoc(doc(db, 'messages', msgId));
  closeModal();
  toast('메시지가 삭제되었습니다');
  refreshActiveMsgView();
};

// 활성화된 메시지 화면 자동 갱신
function refreshActiveMsgView() {
  // 교사 메시지 탭이 활성이면 갱신
  if (document.getElementById('tab-messages')?.classList.contains('active')) {
    renderTeacherMessagesTab(__cachedStudents);
  }
  // 학생이 메시지함을 보고 있으면 다시 열기 (모달이 이미 닫혔으므로)
  // closeModal 호출 후라 학생 모달은 자동 갱신 불필요 (학생은 모달 닫고 다시 열면 됨)
}

// 컴포즈 모달 진입점 (window 전역)
window.openMsgComposeTeacher = () => {
  if (__cachedStudents.length === 0) {
    toast('학생이 없습니다', 'error');
    return;
  }
  openComposeModalForTeacher(__cachedStudents);
};

window.openMsgComposeStudent = () => {
  openComposeModalForStudent();
};

// ============================================
// 교사: 메시지 탭 인라인 렌더링
// ============================================
let __teacherMsgFilter = 'received'; // 'received' | 'sent'

export async function renderTeacherMessagesTab(students) {
  const container = document.getElementById('teacher-messages-container');
  if (!container) return;

  __cachedStudents = students;
  container.innerHTML = '<div class="empty-state">메시지를 불러오는 중...</div>';

  try {
    // 받은 메시지 (학생들로부터)
    const receivedSnap = await getDocs(query(
      collection(db, 'messages'),
      where('receiverId', '==', 'TEACHER')
    ));
    const received = receivedSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    // 보낸 메시지 (교사가 학생들에게)
    const sentSnap = await getDocs(query(
      collection(db, 'messages'),
      where('senderId', '==', 'TEACHER')
    ));
    const sent = sentSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    const unreadCount = received.filter(m => !m.read).length;
    const messages = __teacherMsgFilter === 'received' ? received : sent;

    container.innerHTML = `
      <!-- 요약 카드 -->
      <div class="stat-grid" style="margin-bottom:16px">
        <div class="stat-card" style="background:${unreadCount > 0 ? '#FEE2E2' : '#F9FAFB'}">
          <p class="stat-label">📩 안 읽은 메시지</p>
          <h2 style="color:${unreadCount > 0 ? '#DC2626' : '#6B7280'}">${unreadCount}건</h2>
        </div>
        <div class="stat-card">
          <p class="stat-label">받은 메시지 총</p>
          <h2>${received.length}건</h2>
        </div>
        <div class="stat-card">
          <p class="stat-label">보낸 메시지 총</p>
          <h2>${sent.length}건</h2>
        </div>
      </div>

      <!-- 탭 + 액션 -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div style="display:flex;gap:4px;border-bottom:1px solid #E5E7EB">
          <button class="msg-tab-btn ${__teacherMsgFilter === 'received' ? 'active' : ''}"
            onclick="window.switchTeacherMsgFilter('received')"
            style="background:none;border:none;border-bottom:2px solid ${__teacherMsgFilter === 'received' ? '#4F7CFF' : 'transparent'};color:${__teacherMsgFilter === 'received' ? '#4F7CFF' : '#6B7280'};padding:10px 16px;cursor:pointer;font-weight:600;font-family:inherit">
            📥 받은 메시지 ${unreadCount > 0 ? `<span style="background:#EF4444;color:white;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px">${unreadCount}</span>` : ''}
          </button>
          <button class="msg-tab-btn ${__teacherMsgFilter === 'sent' ? 'active' : ''}"
            onclick="window.switchTeacherMsgFilter('sent')"
            style="background:none;border:none;border-bottom:2px solid ${__teacherMsgFilter === 'sent' ? '#4F7CFF' : 'transparent'};color:${__teacherMsgFilter === 'sent' ? '#4F7CFF' : '#6B7280'};padding:10px 16px;cursor:pointer;font-weight:500;font-family:inherit">
            📤 보낸 메시지
          </button>
        </div>
        <button class="btn-primary" onclick="window.openMsgComposeTeacher()">+ 새 메시지 작성</button>
      </div>

      <!-- 메시지 리스트 -->
      <div style="display:flex;flex-direction:column;gap:8px">
        ${messages.length === 0
          ? `<div class="empty-state">${__teacherMsgFilter === 'received' ? '받은 메시지가 없습니다.' : '보낸 메시지가 없습니다.'}</div>`
          : messages.map(m => renderTeacherMsgCard(m, __teacherMsgFilter === 'received')).join('')
        }
      </div>
    `;
  } catch (err) {
    console.error('메시지 로드 실패:', err);
    container.innerHTML = `<div class="empty-state" style="color:#EF4444">메시지 로드 실패: ${err.message}</div>`;
  }
}

function renderTeacherMsgCard(m, isReceived) {
  const date = m.createdAt?.toDate ? formatDate(m.createdAt.toDate()) : '';

  let counterpartLabel, counterpartId;
  if (isReceived) {
    // 학생이 보낸 것
    counterpartLabel = m.senderNumber
      ? `🎒 ${m.senderNumber}번 ${m.senderName}`
      : `🎒 ${m.senderName}`;
    counterpartId = m.senderId;
  } else {
    // 교사가 보낸 것 → 받은 학생 표시
    if (m.isAnnouncement) {
      counterpartLabel = '📢 전체 학생';
    } else {
      const student = __cachedStudents.find(s => s.id === m.receiverId);
      counterpartLabel = student ? `🎒 ${student.number}번 ${student.name}` : `🎒 ${m.receiverId}`;
    }
    counterpartId = m.receiverId;
  }

  const unreadDot = isReceived && !m.read
    ? '<span style="display:inline-block;width:8px;height:8px;background:#EF4444;border-radius:50%;margin-right:6px"></span>'
    : '';
  const announcementBadge = m.isAnnouncement
    ? '<span style="background:#FEF3C7;color:#92400E;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:4px">전체</span>'
    : '';
  const readBadge = !isReceived
    ? (m.read
      ? '<span style="background:#ECFDF5;color:#059669;padding:2px 6px;border-radius:4px;font-size:10px">읽음</span>'
      : '<span style="background:#F3F4F6;color:#6B7280;padding:2px 6px;border-radius:4px;font-size:10px">안읽음</span>')
    : '';

  const bgColor = isReceived && !m.read ? '#EEF2FF' : '#F9FAFB';
  const previewBody = m.body.length > 80 ? m.body.slice(0, 80) + '…' : m.body;

  // 받은 메시지에 답장 버튼 추가 (학생에게 답장)
  const replyBtn = isReceived
    ? `<button class="btn-secondary" onclick="event.stopPropagation(); window.openTeacherReplyTo('${counterpartId}', '${escapeHtml(m.senderName).replace(/'/g, "\\'")}')" style="font-size:12px;padding:5px 10px">답장</button>`
    : '';

  return `
    <div class="msg-item" onclick="window.openMessageDetail('${m.id}', ${isReceived})"
      style="cursor:pointer;padding:14px;background:${bgColor};border-radius:8px;border:1px solid #E5E7EB;transition:background 0.15s">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;margin-bottom:6px">
        <div style="font-weight:600;font-size:14px;flex:1;min-width:0">
          ${unreadDot}${escapeHtml(counterpartLabel)}${announcementBadge}
        </div>
        <div style="font-size:11px;color:#6B7280;white-space:nowrap">${date} ${readBadge}</div>
      </div>
      ${m.title ? `<div style="font-size:13px;font-weight:500;margin-bottom:4px">${escapeHtml(m.title)}</div>` : ''}
      <div style="font-size:13px;color:#4B5563;line-height:1.5;margin-bottom:${replyBtn ? '8px' : '0'}">${escapeHtml(previewBody)}</div>
      ${replyBtn ? `<div style="display:flex;justify-content:flex-end">${replyBtn}</div>` : ''}
    </div>
  `;
}

window.switchTeacherMsgFilter = (filter) => {
  __teacherMsgFilter = filter;
  renderTeacherMessagesTab(__cachedStudents);
};

// ============================================
// 학생: 메시지함 인라인 렌더링 (모달이 아닌 페이지 형태)
// ============================================
let __studentMsgFilter = 'received';

export async function openStudentInbox(currentUser) {
  __studentCtx = currentUser;

  // 받은 메시지 (선생님으로부터)
  const receivedSnap = await getDocs(query(
    collection(db, 'messages'),
    where('receiverId', '==', currentUser.uid)
  ));
  const received = receivedSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  // 보낸 메시지 (학생이 선생님께)
  const sentSnap = await getDocs(query(
    collection(db, 'messages'),
    where('senderId', '==', currentUser.uid)
  ));
  const sent = sentSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  const unreadCount = received.filter(m => !m.read).length;
  const messages = __studentMsgFilter === 'received' ? received : sent;

  openModal(`
    <h2>📬 메시지함</h2>

    <!-- 요약 -->
    <div style="background:${unreadCount > 0 ? '#FEE2E2' : '#F9FAFB'};padding:12px;border-radius:8px;margin-bottom:12px;text-align:center">
      ${unreadCount > 0
        ? `<strong style="color:#DC2626">📩 안 읽은 메시지가 ${unreadCount}건 있어요!</strong>`
        : `<span style="color:#6B7280">새 메시지가 없어요</span>`
      }
    </div>

    <!-- 탭 -->
    <div style="display:flex;gap:4px;border-bottom:1px solid #E5E7EB;margin-bottom:12px">
      <button class="msg-tab-btn"
        onclick="window.switchStudentMsgFilter('received')"
        style="background:none;border:none;border-bottom:2px solid ${__studentMsgFilter === 'received' ? '#4F7CFF' : 'transparent'};color:${__studentMsgFilter === 'received' ? '#4F7CFF' : '#6B7280'};padding:10px 16px;cursor:pointer;font-weight:600;font-family:inherit">
        📥 받은 메시지 ${unreadCount > 0 ? `<span style="background:#EF4444;color:white;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px">${unreadCount}</span>` : ''}
      </button>
      <button class="msg-tab-btn"
        onclick="window.switchStudentMsgFilter('sent')"
        style="background:none;border:none;border-bottom:2px solid ${__studentMsgFilter === 'sent' ? '#4F7CFF' : 'transparent'};color:${__studentMsgFilter === 'sent' ? '#4F7CFF' : '#6B7280'};padding:10px 16px;cursor:pointer;font-weight:500;font-family:inherit">
        📤 보낸 메시지
      </button>
    </div>

    <!-- 메시지 리스트 -->
    <div style="display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow-y:auto">
      ${messages.length === 0
        ? `<div class="empty-state">${__studentMsgFilter === 'received' ? '받은 메시지가 없어요' : '보낸 메시지가 없어요'}</div>`
        : messages.map(m => renderStudentMsgCard(m, __studentMsgFilter === 'received')).join('')
      }
    </div>

    <div class="modal-actions">
      <button class="btn-secondary" onclick="window.closeModal()">닫기</button>
      <button class="btn-primary" onclick="window.openMsgComposeStudent()">✏️ 선생님께 메시지</button>
    </div>
  `);
}

function renderStudentMsgCard(m, isReceived) {
  const date = m.createdAt?.toDate ? formatDate(m.createdAt.toDate()) : '';

  // 학생 입장에서는 상대방이 항상 선생님
  const counterpartLabel = '👩‍🏫 선생님';

  const unreadDot = isReceived && !m.read
    ? '<span style="display:inline-block;width:8px;height:8px;background:#EF4444;border-radius:50%;margin-right:6px"></span>'
    : '';
  const announcementBadge = m.isAnnouncement
    ? '<span style="background:#FEF3C7;color:#92400E;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:4px">전체 공지</span>'
    : '';
  const readBadge = !isReceived
    ? (m.read
      ? '<span style="background:#ECFDF5;color:#059669;padding:2px 6px;border-radius:4px;font-size:10px">선생님이 읽음</span>'
      : '<span style="background:#F3F4F6;color:#6B7280;padding:2px 6px;border-radius:4px;font-size:10px">아직 안읽음</span>')
    : '';

  const bgColor = isReceived && !m.read ? '#EEF2FF' : '#F9FAFB';
  const borderColor = isReceived && !m.read ? '#C7D2FE' : '#E5E7EB';
  const previewBody = m.body.length > 80 ? m.body.slice(0, 80) + '…' : m.body;

  return `
    <div class="msg-item" onclick="window.openMessageDetail('${m.id}', ${isReceived})"
      style="cursor:pointer;padding:14px;background:${bgColor};border-radius:8px;border:1px solid ${borderColor};transition:background 0.15s">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;margin-bottom:6px">
        <div style="font-weight:600;font-size:14px;flex:1;min-width:0">
          ${unreadDot}${escapeHtml(counterpartLabel)}${announcementBadge}
        </div>
        <div style="font-size:11px;color:#6B7280;white-space:nowrap">${date} ${readBadge}</div>
      </div>
      ${m.title ? `<div style="font-size:13px;font-weight:500;margin-bottom:4px">${escapeHtml(m.title)}</div>` : ''}
      <div style="font-size:13px;color:#4B5563;line-height:1.5">${escapeHtml(previewBody)}</div>
    </div>
  `;
}

window.switchStudentMsgFilter = (filter) => {
  __studentMsgFilter = filter;
  if (__studentCtx) openStudentInbox(__studentCtx);
};
