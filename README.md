# 💰 학급 통장 (Classroom Bank) v3

학급에서 사용할 수 있는 가상 통장 시스템입니다. 학생들은 직업으로 월급을 받고, 친구·교사와 송금하고, 세금·구매로 학급 국고에 기여하며, 적금으로 이자를 받을 수 있습니다.

## ✨ 주요 기능

### 교사용 (관리 페이지)

| 탭 | 기능 |
|---|---|
| **대시보드** | 학생 수, 총 통화량, 국고, 오늘 거래 한눈에 |
| **학생 관리** | 개별·일괄(CSV형식) 추가, 정보 수정, 잔액 조정 |
| **급여/지급** | 직업별 월급 일괄 지급, 개별 보너스, 전체 일괄 지급 |
| **직업 관리** | 직업 풀 생성, 정원 설정, 학생 자유 배정 |
| **🆕 학급 가게** | 물품·특권 등록, 재고 관리, 학생 구매 내역 확인·지급 |
| **🆕 학급 목표** | 국고로 달성할 학급 목표 설정 (단합대회, 피자파티 등) |
| **게임 관리** | 학급 게임 등록 (외부 URL 연결) |
| **🆕 통계** | 월별 자금 흐름 차트, 학생 자산 순위, 거래 유형별 합계 |
| **거래 내역** | 유형/학생별 필터, CSV 내보내기 |
| **설정** | 🆕 자동 월급, 거래 한도, 국고 지출, 비밀번호 변경 |

### 학생용 페이지 (액션 7개)

- 💸 **송금** — 친구/선생님에게 (한도 적용)
- 📋 **세금 납부** — 소득세/재산세/자리세/벌금 → 국고로
- 🆕 🛒 **학급 가게** — 물품·특권 구매 (선생님이 지급)
- 🆕 🏦 **적금** — 7일/14일/30일 상품, 만기 시 +2~10% 이자
- 🆕 🎯 **학급 목표** — 국고 진행도 확인 (우리 반이 목표에 얼마나 가까운지)
- 🎮 **학급 게임** — 등록된 게임 참여
- 📊 **거래 내역** — 본인 거래 기록

## 🆕 v3 새 기능 상세

### 🛒 학급 가게
- 물품 등록 시 이모지/이름/가격/재고/설명 입력
- 재고 -1 입력 시 무제한
- 학생이 구매하면 자동으로 잔액 차감 + 재고 감소
- 교사는 "구매 내역"에서 누가 무엇을 샀는지 확인하고 "지급 완료" 표시
- 활용 예: 자리 바꾸기 권, 숙제 면제권, 간식 쿠폰, 음악 신청권

### 📈 통계
- **월별 자금 흐름**: 최근 6개월간 학급 자금 유입(파란)/회수(주황)
- **거래 유형별 합계**: 송금/세금/월급/지급/구매 등 누적 금액
- **학생 자산 순위**: 잔액 기준 1위부터 (🥇🥈🥉)

### 🏦 적금
- 3가지 상품: 7일(+2%), 14일(+5%), 30일(+10%)
- 학생이 직접 금액·기간 선택해서 예금
- 만기 도달 시 원금+이자 자동 계산해서 받기 버튼 표시
- 중도 해지 가능 (이자 없이 원금만)
- 교사는 "전체 적금 현황"에서 누가 얼마 예금했는지 확인 가능
- **복리 이자 학습 효과**: 학생들이 직접 시간과 이자의 관계를 체험

### 📅 자동 월급
- 설정 탭에서 활성화 가능
- 활성화 후 새 달에 처음 로그인할 때 자동 지급 여부를 묻는 팝업 표시
- 한 달에 한 번만 동작 (중복 지급 방지)
- 직업이 배정된 학생만 대상

### 🎯 학급 목표
- 목표 이름·금액·아이콘·설명 등록
- 국고 잔액 기준으로 진행률 자동 계산
- 학생들도 자기 화면에서 진행 상황 확인 가능
- 달성 시 "달성!" 배지와 초록 카드로 변경
- 활용 예: 단합대회 50,000원, 피자파티 20,000원, 학급문고 10,000원

## 🚀 시작하기

### 1단계: Firebase 프로젝트 설정

1. [Firebase Console](https://console.firebase.google.com)에 접속하여 새 프로젝트 생성
2. 프로젝트가 만들어지면 **웹 앱 추가** (`</>` 아이콘 클릭)
3. 앱 닉네임 입력 후 등록 → `firebaseConfig` 객체 복사
4. **Firestore Database** 메뉴 → **데이터베이스 만들기** → **테스트 모드로 시작** 선택
   - 위치: `asia-northeast3` (서울) 추천
5. ⚠️ Firebase Authentication을 사용하지 않습니다. 모든 인증은 Firestore에서 자체 처리합니다.

### 2단계: Firebase 정보 입력

`firebase-config.js` 파일을 열어 `firebaseConfig` 객체를 본인 것으로 교체:

```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

### 3단계: Firestore 보안 규칙

Firebase Console → **Firestore Database** → **규칙** 탭에서 아래 규칙 사용:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

> ⚠️ **주의**: 학급 내부 사용 전제의 단순 설정입니다. URL이 외부에 노출되면 누구나 데이터를 수정할 수 있으니 학생들에게만 공유하세요.

### 4단계: GitHub Pages 배포

1. GitHub에 새 저장소 생성 (예: `classroom-bank`)
2. 프로젝트 파일을 푸시:
   ```bash
   git init
   git add .
   git commit -m "학급 통장 v3"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/classroom-bank.git
   git push -u origin main
   ```
3. GitHub 저장소 → **Settings** → **Pages**
4. **Source**: `Deploy from a branch` → **Branch**: `main` / `(root)` → 저장
5. 1-2분 후 `https://YOUR_USERNAME.github.io/classroom-bank/` 로 접속

## 📖 사용 흐름

### 처음 사용 (교사)

1. 배포된 URL 첫 접속 → "교사 계정 만들기" 자동 표시
2. 학급 이름 / 교사 ID / 비밀번호 입력
3. 로그인 후 순서대로:
   - **학생 관리** → 학생 일괄 추가
   - **직업 관리** → 직업 추가하고 학생들에게 배정
   - **학급 가게** → 물품·특권 등록
   - **학급 목표** → 학기 목표 설정
   - **설정** → 자동 월급 활성화, 거래 한도 설정

### 학생 사용

1. 같은 URL 접속 → **학생** 역할 선택
2. 교사가 만든 ID와 비밀번호로 로그인
3. 7가지 액션으로 경제활동 체험

## 🗂️ 데이터 구조 (Firestore)

```
settings/main
  - className, maxTransfer, autoSalary, lastSalaryMonth

users/{userId}
  - role: "teacher" | "treasury"
  - balance (treasury만)

students/{studentId}
  - number, name, id, pwHash
  - balance, jobId, jobName, salary

jobs/{jobId}        - name, salary, maxCount, description
games/{gameId}      - title, description, url
shop_items/{id}     - emoji, name, price, stock, description
purchases/{id}      - studentId, itemId, itemName, totalPrice, delivered
goals/{id}          - icon, title, targetAmount, description
savings/{id}        - studentId, productId, amount, rate, days, matureAt, withdrawn

transactions/{txId}
  - type: transfer/tax/salary/payment/adjustment
        | treasury_spend/purchase/refund
        | deposit/withdrawal/interest
  - from, to, amount, reason, participants[], meta{}, createdAt
```

## 🔧 파일 구조

```
classroom-bank/
├── index.html              # 화면 구조
├── styles.css              # 디자인
├── firebase-config.js      # Firebase 연결
├── app.js                  # 메인 로직 (로그인, 학생/교사 화면, 직업, 게임)
├── modules/
│   ├── utils.js            # 공통 유틸 (해시, 토스트, 모달, 포맷)
│   ├── transactions.js     # 거래 처리 (모든 잔액 이동)
│   ├── shop.js             # 학급 가게
│   ├── stats.js            # 통계 (차트, 순위)
│   ├── savings.js          # 적금/예금
│   └── goals.js            # 학급 목표 + 자동 월급
└── README.md
```

## 💡 다음 업데이트 아이디어

- 학생 출석 체크 + 출석 보너스
- 학부모 조회용 별도 페이지 (읽기 전용)
- 알림 기능 (받은 송금 표시)
- Firebase Auth 도입 옵션 (보안 강화)
- 학년 종료 시 자동 통계 리포트
- 학급 가게 카테고리 분류
- 적금 상품을 교사가 자유롭게 추가/수정

## 📝 라이선스

자유롭게 수정·배포 가능
