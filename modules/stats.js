// ============================================
// 통계 (Stats)
// ============================================

import {
  db,
  collection, getDocs, query, orderBy, limit
} from "../firebase-config.js";
import { escapeHtml, formatMoney, monthKey, txTypeLabel } from "./utils.js";

export async function renderStats(students) {
  const container = document.getElementById('stats-container');
  if (!container) return;

  // 거래 내역 가져오기 (최근 6개월용)
  const snap = await getDocs(query(collection(db, 'transactions'), orderBy('createdAt', 'desc'), limit(2000)));
  const txs = snap.docs.map(d => d.data()).filter(t => t.createdAt?.toDate);

  // 월별 그룹화 (최근 6개월)
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(monthKey(d));
  }

  const monthData = {}; // { '2026-01': { income: 0, expense: 0 } }
  months.forEach(m => monthData[m] = { income: 0, expense: 0 });

  txs.forEach(t => {
    const d = t.createdAt.toDate();
    const key = monthKey(d);
    if (!monthData[key]) return;
    // 학생 입장에서 income/expense 분류
    if (t.from === 'TEACHER' || t.from === 'TREASURY') {
      monthData[key].income += t.amount; // 학생 전체에 들어온 돈
    } else if (t.to === 'TEACHER' || t.to === 'TREASURY') {
      monthData[key].expense += t.amount; // 학생 전체에서 나간 돈
    }
    // 학생 간 송금은 학급 전체 관점에서 net 0이므로 제외
  });

  // 학생별 통계 (잔액, 총 수입, 총 지출)
  const studentStats = students.map(s => {
    const myTxs = txs.filter(t => t.from === s.id || t.to === s.id);
    const income = myTxs.filter(t => t.to === s.id).reduce((sum, t) => sum + t.amount, 0);
    const expense = myTxs.filter(t => t.from === s.id).reduce((sum, t) => sum + t.amount, 0);
    return { ...s, income, expense, net: income - expense };
  }).sort((a, b) => (b.balance || 0) - (a.balance || 0));

  // 거래 유형별 통계
  const typeStats = {};
  txs.forEach(t => {
    typeStats[t.type] = (typeStats[t.type] || 0) + t.amount;
  });

  container.innerHTML = `
    <div class="card">
      <h3>📊 월별 학급 자금 흐름 (최근 6개월)</h3>
      <p class="hint">교사가 지급한 돈(파란) vs 학생이 낸 돈(주황). 학생 간 송금은 제외됩니다.</p>
      ${renderMonthlyChart(months, monthData)}
    </div>

    <div class="card">
      <h3>💰 거래 유형별 합계</h3>
      ${renderTypeStats(typeStats)}
    </div>

    <div class="card">
      <h3>🏆 학생별 자산 순위</h3>
      ${renderStudentRanking(studentStats)}
    </div>
  `;
}

function renderMonthlyChart(months, monthData) {
  const maxValue = Math.max(
    ...Object.values(monthData).flatMap(m => [m.income, m.expense]),
    1
  );

  return `
    <div class="chart-bars">
      ${months.map(m => {
        const data = monthData[m];
        const incomePct = (data.income / maxValue) * 100;
        const expensePct = (data.expense / maxValue) * 100;
        const [year, month] = m.split('-');
        return `
          <div class="chart-month">
            <div class="chart-bars-pair">
              <div class="chart-bar chart-bar-income" style="height:${incomePct}%" title="${formatMoney(data.income)}">
                <span class="chart-bar-value">${data.income > 0 ? formatMoney(data.income) : ''}</span>
              </div>
              <div class="chart-bar chart-bar-expense" style="height:${expensePct}%" title="${formatMoney(data.expense)}">
                <span class="chart-bar-value">${data.expense > 0 ? formatMoney(data.expense) : ''}</span>
              </div>
            </div>
            <div class="chart-label">${parseInt(month)}월</div>
          </div>
        `;
      }).join('')}
    </div>
    <div class="chart-legend">
      <span><span class="legend-dot legend-income"></span>학급 자금 유입(지급/월급)</span>
      <span><span class="legend-dot legend-expense"></span>학급 자금 회수(세금/구매)</span>
    </div>
  `;
}

function renderTypeStats(typeStats) {
  const entries = Object.entries(typeStats).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '<div class="empty-state">데이터가 없습니다.</div>';
  const max = entries[0][1];

  return `
    <div style="display:flex;flex-direction:column;gap:10px">
      ${entries.map(([type, amount]) => {
        const pct = (amount / max) * 100;
        return `
          <div class="type-stat-row">
            <div class="type-stat-label">${txTypeLabel(type)}</div>
            <div class="type-stat-bar-wrap">
              <div class="type-stat-bar" style="width:${pct}%"></div>
            </div>
            <div class="type-stat-amount">${formatMoney(amount)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderStudentRanking(students) {
  if (students.length === 0) return '<div class="empty-state">학생이 없습니다.</div>';
  return `
    <div class="ranking-list">
      ${students.map((s, i) => {
        const rankIcon = ['🥇', '🥈', '🥉'][i] || `${i + 1}`;
        return `
          <div class="ranking-item">
            <div class="ranking-rank">${rankIcon}</div>
            <div style="flex:1">
              <div class="ranking-name">${s.number}번 ${escapeHtml(s.name)}</div>
              <div class="ranking-meta">수입 ${formatMoney(s.income)} · 지출 ${formatMoney(s.expense)}</div>
            </div>
            <div class="ranking-balance">${formatMoney(s.balance || 0)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}
