// ============================================
// 거래 처리 (모든 잔액 이동의 단일 진입점)
// ============================================

import {
  db,
  collection, doc, writeBatch, increment, serverTimestamp
} from "../firebase-config.js";
import { TREASURY_ID } from "./utils.js";

/**
 * 거래 처리
 * @param {Object} tx - { type, from, to, amount, reason, meta }
 * - from/to: 학생 ID | 'TEACHER' | TREASURY_ID
 * - meta: 추가 정보 (예: 구매 시 itemId)
 */
export async function processTransaction({ type, from, to, amount, reason, meta = {} }) {
  if (amount <= 0) throw new Error('금액은 0보다 커야 합니다');

  const batch = writeBatch(db);

  // 보낸 사람 차감
  if (from === 'TEACHER') {
    // 교사는 무한 (기록만)
  } else if (from === TREASURY_ID) {
    batch.update(doc(db, 'users', TREASURY_ID), { balance: increment(-amount) });
  } else {
    batch.update(doc(db, 'students', from), { balance: increment(-amount) });
  }

  // 받는 사람 증가
  if (to === 'TEACHER') {
    // 교사는 무한 (기록만)
  } else if (to === TREASURY_ID) {
    batch.update(doc(db, 'users', TREASURY_ID), { balance: increment(amount) });
  } else {
    batch.update(doc(db, 'students', to), { balance: increment(amount) });
  }

  // 거래 기록
  const participants = [from, to].filter(p => p !== 'TEACHER' && p !== TREASURY_ID);
  const txRef = doc(collection(db, 'transactions'));
  batch.set(txRef, {
    type, from, to, amount, reason, participants, meta,
    createdAt: serverTimestamp()
  });

  await batch.commit();
  return txRef.id;
}
