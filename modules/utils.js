// ============================================
// 공통 유틸리티
// ============================================

export const TREASURY_ID = "TREASURY";

// SHA-256 해시
export async function hashPw(pw) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pw + "classroom-bank-salt-2026");
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// 토스트 알림
export function toast(message, type = '') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast show ' + type;
  setTimeout(() => el.classList.remove('show'), 2500);
}

// 모달 열고/닫기
export function openModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('active');
}

export function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}

// window에도 노출 (HTML onclick에서 호출용)
window.closeModal = closeModal;

// 포맷팅
export function formatMoney(n) {
  return Number(n || 0).toLocaleString('ko-KR') + '원';
}

export function formatDate(d) {
  if (!d) return '';
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('ko-KR', {
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

export function formatDateOnly(d) {
  if (!d) return '';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 거래 유형 라벨
export function txTypeLabel(type) {
  return ({
    transfer: '송금',
    tax: '세금',
    salary: '월급',
    payment: '지급',
    adjustment: '조정',
    treasury_spend: '국고지출',
    purchase: '구매',
    refund: '환불',
    deposit: '예금',
    withdrawal: '예금해지',
    interest: '이자'
  })[type] || type;
}

// 두 날짜가 같은 월인지 확인 (자동 월급용)
export function isSameMonth(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
         d1.getMonth() === d2.getMonth();
}

// 한국식 'YYYY-MM' 키
export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
