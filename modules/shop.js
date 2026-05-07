// ============================================
// 학급 가게 (Shop)
// ============================================

import {
  db,
  collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp, increment, writeBatch
} from "../firebase-config.js";
import { processTransaction } from "./transactions.js";
import {
  TREASURY_ID, toast, openModal, closeModal, escapeHtml, formatMoney, formatDate
} from "./utils.js";

let cachedItems = [];

// ============================================
// 교사: 가게 관리
// ============================================
export function initShopTeacher(getStudents) {
  // 물품 실시간 구독
  const unsub = onSnapshot(
    query(collection(db, 'shop_items'), orderBy('createdAt', 'desc')),
    (snap) => {
      cachedItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderShopTeacher(cachedItems);
    }
  );

  // 물품 추가 버튼
  document.getElementById('add-item-btn').addEventListener('click', () => openItemModal());

  // 구매 내역 버튼
  document.getElementById('view-purchases-btn').addEventListener('click', () => openPurchasesModal(getStudents()));

  return unsub;
}

function renderShopTeacher(items) {
  const container = document.getElementById('shop-items-list');
  if (!container) return;
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">등록된 물품이 없습니다. "+ 물품 추가" 버튼을 눌러 시작하세요.</div>';
    return;
  }
  container.innerHTML = items.map(it => `
    <div class="shop-item-card">
      <div class="shop-item-emoji">${escapeHtml(it.emoji || '🎁')}</div>
      <div class="shop-item-name">${escapeHtml(it.name)}</div>
      <div class="shop-item-price">${formatMoney(it.price)}</div>
      <div class="shop-item-stock">재고: ${it.stock === -1 ? '무제한' : (it.stock + '개')}</div>
      <div class="shop-item-desc">${escapeHtml(it.description || '')}</div>
      <div class="student-actions">
        <button class="btn-secondary" onclick="window.editItem('${it.id}')">수정</button>
        <button class="btn-danger" onclick="window.deleteItem('${it.id}')">삭제</button>
      </div>
    </div>
  `).join('');
}

function openItemModal(item = null) {
  const isEdit = !!item;
  openModal(`
    <h2>${isEdit ? '물품 수정' : '물품 추가'}</h2>
    <form id="item-form" class="modal-form">
      <div class="input-group">
        <label>이모지 (선택)</label>
        <input type="text" id="i-emoji" maxlength="2" value="${item?.emoji || ''}" placeholder="🎁" />
      </div>
      <div class="input-group">
        <label>물품명</label>
        <input type="text" id="i-name" required value="${item ? escapeHtml(item.name) : ''}" placeholder="예: 자리 바꾸기 권" />
      </div>
      <div class="input-group">
        <label>가격 (원)</label>
        <input type="number" id="i-price" required min="1" value="${item?.price || ''}" />
      </div>
      <div class="input-group">
        <label>재고 (-1: 무제한)</label>
        <input type="number" id="i-stock" required value="${item?.stock ?? -1}" />
      </div>
      <div class="input-group">
        <label>설명</label>
        <input type="text" id="i-desc" value="${item ? escapeHtml(item.description || '') : ''}" placeholder="물품 설명" />
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onclick="window.closeModal()">취소</button>
        <button type="submit" class="btn-primary">${isEdit ? '저장' : '추가'}</button>
      </div>
    </form>
  `);

  document.getElementById('item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      emoji: document.getElementById('i-emoji').value.trim() || '🎁',
      name: document.getElementById('i-name').value.trim(),
      price: parseInt(document.getElementById('i-price').value),
      stock: parseInt(document.getElementById('i-stock').value),
      description: document.getElementById('i-desc').value.trim()
    };
    if (isEdit) {
      await updateDoc(doc(db, 'shop_items', item.id), data);
      toast('수정되었습니다', 'success');
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, 'shop_items'), data);
      toast('물품이 추가되었습니다', 'success');
    }
    closeModal();
  });
}

window.editItem = async (id) => {
  const snap = await getDoc(doc(db, 'shop_items', id));
  if (snap.exists()) openItemModal({ id, ...snap.data() });
};

window.deleteItem = async (id) => {
  if (!confirm('이 물품을 삭제하시겠습니까?')) return;
  await deleteDoc(doc(db, 'shop_items', id));
  toast('삭제되었습니다');
};

// ============================================
// 교사: 구매 내역 보기
// ============================================
async function openPurchasesModal(students) {
  const snap = await getDocs(query(
    collection(db, 'purchases'),
    orderBy('createdAt', 'desc')
  ));
  const purchases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const studentMap = Object.fromEntries(students.map(s => [s.id, s]));

  openModal(`
    <h2>구매 내역</h2>
    <div class="transaction-list" style="max-height:60vh;overflow-y:auto">
      ${purchases.length === 0 ? '<div class="empty-state">구매 내역이 없습니다.</div>' :
        purchases.map(p => {
          const student = studentMap[p.studentId];
          const studentLabel = student ? `${student.number}번 ${student.name}` : p.studentId;
          const status = p.delivered ? '✅ 지급완료' : '⏳ 대기중';
          return `
            <div class="transaction-item">
              <div class="transaction-info">
                <div class="transaction-title">${escapeHtml(p.itemEmoji || '🎁')} ${escapeHtml(p.itemName)} × ${p.quantity}</div>
                <div class="transaction-meta">${escapeHtml(studentLabel)} · ${formatDate(p.createdAt?.toDate())} · ${status}</div>
              </div>
              <div style="display:flex;gap:6px;align-items:center">
                <span class="transaction-amount">${formatMoney(p.totalPrice)}</span>
                ${!p.delivered ? `<button class="btn-secondary" onclick="window.markDelivered('${p.id}')">지급</button>` : ''}
              </div>
            </div>
          `;
        }).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="window.closeModal()">닫기</button>
    </div>
  `);
}

window.markDelivered = async (id) => {
  await updateDoc(doc(db, 'purchases', id), { delivered: true, deliveredAt: serverTimestamp() });
  toast('지급 완료로 표시했습니다', 'success');
  closeModal();
};

// ============================================
// 학생: 가게 보기 + 구매
// ============================================
export async function openShopModal(currentUser) {
  const snap = await getDocs(query(collection(db, 'shop_items'), orderBy('createdAt', 'desc')));
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  openModal(`
    <h2>🛒 학급 가게</h2>
    <p class="hint">현재 잔액: ${formatMoney(currentUser.balance || 0)}</p>
    ${items.length === 0 ? '<div class="empty-state">판매 중인 물품이 없습니다.</div>' :
      `<div class="card-grid" style="grid-template-columns:1fr;gap:10px">
        ${items.map(it => {
          const canBuy = (currentUser.balance || 0) >= it.price && (it.stock === -1 || it.stock > 0);
          const stockText = it.stock === -1 ? '무제한' : `${it.stock}개 남음`;
          return `
            <div class="shop-item-row">
              <div style="font-size:32px">${escapeHtml(it.emoji || '🎁')}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600">${escapeHtml(it.name)}</div>
                <div style="font-size:12px;color:#6B7280">${escapeHtml(it.description || '')}</div>
                <div style="font-size:12px;color:#6B7280">재고: ${stockText}</div>
              </div>
              <div style="text-align:right">
                <div style="font-weight:700;color:#4F7CFF;margin-bottom:6px">${formatMoney(it.price)}</div>
                <button class="btn-primary" ${canBuy ? '' : 'disabled style="opacity:0.5;cursor:not-allowed"'} onclick="window.buyItem('${it.id}')">구매</button>
              </div>
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

// 학생이 구매 (window에 노출)
let __studentCtx = null; // 현재 학생 컨텍스트 (구매 처리용)

export function setStudentContext(user) {
  __studentCtx = user;
}

window.buyItem = async (itemId) => {
  if (!__studentCtx) return;
  const itemSnap = await getDoc(doc(db, 'shop_items', itemId));
  if (!itemSnap.exists()) { toast('물품을 찾을 수 없습니다', 'error'); return; }
  const item = itemSnap.data();

  if ((__studentCtx.balance || 0) < item.price) {
    toast('잔액이 부족합니다', 'error');
    return;
  }
  if (item.stock !== -1 && item.stock <= 0) {
    toast('재고가 없습니다', 'error');
    return;
  }
  if (!confirm(`${item.name}을(를) ${formatMoney(item.price)}에 구매합니다. 진행할까요?`)) return;

  try {
    // 1) 거래 처리 (학생 → 국고)
    await processTransaction({
      type: 'purchase',
      from: __studentCtx.uid,
      to: TREASURY_ID,
      amount: item.price,
      reason: `${item.emoji || '🎁'} ${item.name} 구매`,
      meta: { itemId }
    });

    // 2) 구매 내역 기록
    await addDoc(collection(db, 'purchases'), {
      studentId: __studentCtx.uid,
      itemId: itemId,
      itemName: item.name,
      itemEmoji: item.emoji || '🎁',
      quantity: 1,
      totalPrice: item.price,
      delivered: false,
      createdAt: serverTimestamp()
    });

    // 3) 재고 감소
    if (item.stock !== -1) {
      await updateDoc(doc(db, 'shop_items', itemId), { stock: increment(-1) });
    }

    closeModal();
    toast(`${item.name} 구매 완료! 선생님께 받으세요.`, 'success');
  } catch (err) {
    toast('구매 실패: ' + err.message, 'error');
  }
};
