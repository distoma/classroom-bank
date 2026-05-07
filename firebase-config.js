// ============================================
// Firebase 설정 (Firestore 전용 - Auth 미사용)
// ============================================
// 사용 방법:
// 1. https://console.firebase.google.com 에서 프로젝트 생성
// 2. 웹 앱 등록 후 아래 firebaseConfig 값을 본인 것으로 교체
// 3. Firestore Database 활성화 (테스트 모드로 시작)
//    ※ 이 버전은 Firebase Authentication을 사용하지 않습니다
//    ※ 교사/학생 모두 Firestore의 users 컬렉션으로 로그인 처리됩니다
// ============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  increment,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ⚠️ 여기를 본인의 Firebase 프로젝트 정보로 교체하세요
const firebaseConfig = {
  apiKey: "AIzaSyBiowL-UZaPL7d-rg6izBJtx9e403C6D3Y",
  authDomain: "classroom-bank-62ba8.firebaseapp.com",
  projectId: "classroom-bank-62ba8",
  storageBucket: "classroom-bank-62ba8.firebasestorage.app",
  messagingSenderId: "983881467304",
  appId: "1:983881467304:web:dd24ff93cfa81c93e5c99d"
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export {
  db,
  collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot,
  serverTimestamp, increment, writeBatch
};
