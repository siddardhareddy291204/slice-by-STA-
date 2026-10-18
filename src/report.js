import { readFileSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import { formatScore, replay, scoreFromState } from './shared/scoring.js';

const FONT = readFileSync(new URL('./fonts/noto-sans-regular.woff', import.meta.url));
const BOLD = readFileSync(new URL('./fonts/noto-sans-bold.woff', import.meta.url));
const C = { forest: '#18231A', forest2: '#293A2D', lime: '#D4F04C', ink: '#172018', gray: '#627064', line: '#DFE7DB', pale: '#F4F7EE', white: '#FFFFFF', gold: '#EFF8BD' };
const W = 595.28;
const H = 841.89;
const M = 36;
const INNER = W - M * 2;
const inTimeZone = { timeZone: 'Asia/Kolkata' };

const safe = (value) => String(value ?? '').replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u2212]/g, '-');
const dateLabel = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const timeLabel = (time) => time ? new Date(`2000-01-01T${time}:00Z`).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : null;
const stampTime = (stamp) => stamp ? new Date(stamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', ...inTimeZone }) : '';
const countLabel = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
const scoreLabel = (m, format) => {
  if (m.score) return safe(formatScore(m.score));
  if (m.points) return safe(formatScore(scoreFromState(replay(format, m.points))));
  return '-';
};
const metric = (doc, value, label, x, y, width) => {
  doc.roundedRect(x, y, width, 64, 13).fill(C.pale);
  doc.font('Bold').fontSize(19).fillColor(C.ink).text(String(value), x + 13, y + 10, { width: width - 26, lineBreak: false });
  doc.font('Regular').fontSize(8).fillColor(C.gray).text(label.toUpperCase(), x + 13, y + 40, { width: width - 26, lineBreak: false, characterSpacing: 0.7 });
};
const smallLabel = (doc, label, x, y, color = C.gray) => doc.font('Bold').fontSize(8).fillColor(color).text(label.toUpperCase(), x, y, { characterSpacing: 1.1, lineBreak: false });
const sectionTitle = (doc, title, aside, y) => {
  doc.font('Bold').fontSize(15).fillColor(C.ink).text(title, M, y, { lineBreak: false });
  if (aside) doc.font('Regular').fontSize(8).fillColor(C.gray).text(aside, W - M - 190, y + 6, { width: 190, align: 'right', lineBreak: false });
};
const ellipsis = (doc, value, width, size = 9) => {
  const str = safe(value);
  doc.fontSize(size);
  if (doc.widthOfString(str) <= width) return str;
  let s = str;
  while (s.length && doc.widthOfString(`${s}...`) > width) s = s.slice(0, -1);
  return `${s}...`;
};

function ball(doc, x, y, r = 12) {
  doc.circle(x, y, r).fill(C.lime);
  doc.lineWidth(1.1).strokeColor(C.forest).opacity(0.6);
  doc.path(`M ${x - r * 0.58} ${y - r * 0.78} C ${x - r * 0.07} ${y - r * 0.1}, ${x - r * 0.07} ${y + r * 0.1}, ${x - r * 0.58} ${y + r * 0.78}`).stroke();
  doc.path(`M ${x + r * 0.58} ${y - r * 0.78} C ${x + r * 0.07} ${y - r * 0.1}, ${x + r * 0.07} ${y + r * 0.1}, ${x + r * 0.58} ${y + r * 0.78}`).stroke();
  doc.opacity(1);
}

function coverHeader(doc, view) {
  const { day } = view;
  doc.rect(0, 0, W, 184).fill(C.forest);
  doc.save().opacity(0.08).circle(W + 30, 10, 170).fill(C.lime).circle(W - 10, 25, 102).fill(C.lime).restore();
  ball(doc, M + 12, 32, 11);
  doc.font('Bold').fontSize(13).fillColor(C.white).text('Slice', M + 32, 21, { lineBreak: false });
  smallLabel(doc, 'BY STA', M + 33, 37, C.lime);
  doc.font('Bold').fontSize(8).fillColor(C.lime).text('DAILY SESSION REPORT', W - M - 185, 28, { width: 185, align: 'right', characterSpacing: 1.2 });
  doc.font('Bold').fontSize(23).fillColor(C.white).text(safe(day.title), M, 75, { width: INNER - 110, height: 64, ellipsis: true });
  const pill = day.finishedAt ? 'SESSION COMPLETE' : 'IN PROGRESS';
  doc.roundedRect(W - M - 100, 83, 100, 23, 11).fill(day.finishedAt ? C.lime : C.forest2);
  doc.font('Bold').fontSize(7).fillColor(day.finishedAt ? C.forest : C.white).text(pill, W - M - 100, 91, { width: 100, align: 'center', lineBreak: false });
  doc.font('Regular').fontSize(10).fillColor('#E8EFDE').text(dateLabel(day.date), M, 145, { lineBreak: false });
  const times = [timeLabel(day.startTime), timeLabel(day.endTime)].filter(Boolean).join(' - ');
  doc.font('Regular').fontSize(8.5).fillColor('#BFCBB9').text([times, `${day.courts} court${day.courts === 1 ? '' : 's'}`, day.formatInfo.name].filter(Boolean).join('   /   '), M, 165, { width: INNER, lineBreak: false });
}

function awardCard(doc, x, y, width, title, winners, detail) {
  doc.roundedRect(x, y, width, 91, 13).fill(C.forest);
  doc.circle(x + 25, y + 24, 11).fill(C.lime);
  doc.lineWidth(1.2).strokeColor(C.forest).roundedRect(x + 21, y + 19, 8, 7, 2).stroke();
  doc.moveTo(x + 19, y + 20).lineTo(x + 17, y + 20).lineTo(x + 17, y + 23).lineTo(x + 21, y + 25).stroke();
  doc.moveTo(x + 31, y + 20).lineTo(x + 33, y + 20).lineTo(x + 33, y + 23).lineTo(x + 29, y + 25).stroke();
  doc.moveTo(x + 25, y + 26).lineTo(x + 25, y + 29).moveTo(x + 22, y + 29).lineTo(x + 28, y + 29).stroke();
  smallLabel(doc, title, x + 44, y + 18, C.lime);
  doc.font('Bold').fontSize(11).fillColor(C.white).text(ellipsis(doc, winners, width - 30, 11), x + 14, y + 43, { width: width - 28, lineBreak: false });
  doc.font('Regular').fontSize(7.5).fillColor('#C6D3BF').text(detail, x + 14, y + 70, { width: width - 28, lineBreak: false });
}

function standingsHeader(doc, y) {
  doc.roundedRect(M, y, INNER, 27, 8).fill(C.forest);
  const cols = [['#', M + 12, 24], ['PLAYER', M + 44, 155], ['P', M + 204, 24], ['W-L', M + 233, 48], ['WIN %', M + 292, 43], ['GW', M + 343, 42], ['+/-', M + 393, 48], ['AVG +/-', M + 451, 58]];
  for (const [label, x, width] of cols) doc.font('Bold').fontSize(7.2).fillColor(C.white).text(label, x, y + 9, { width, lineBreak: false, align: label === 'PLAYER' ? 'left' : 'right' });
}

function standingRow(doc, row, index, y) {
  if (index % 2 === 0) doc.roundedRect(M, y, INNER, 25, 6).fill(C.pale);
  if (row.rank === 1) doc.circle(M + 22, y + 12.5, 9).fill(C.lime);
  doc.font('Bold').fontSize(8.5).fillColor(C.ink).text(row.rank ?? '-', M + 10, y + 7, { width: 24, align: 'center', lineBreak: false });
  doc.font('Regular').fontSize(8.6).fillColor(C.ink).text(ellipsis(doc, row.name, 153, 8.6), M + 44, y + 7, { width: 153, lineBreak: false });
  const values = [row.played, `${row.wins}-${row.losses}`, `${Math.round(row.winPct * 100)}%`, row.gamesWon, row.diff > 0 ? `+${row.diff}` : row.diff, row.played ? `${row.avgDiff > 0 ? '+' : ''}${row.avgDiff.toFixed(1)}` : '-'];
  const cols = [[M + 204, 24], [M + 233, 48], [M + 292, 43], [M + 343, 42], [M + 393, 48], [M + 451, 58]];
  values.forEach((value, i) => doc.font(i === 2 ? 'Bold' : 'Regular').fontSize(8.5).fillColor(C.ink).text(String(value), cols[i][0], y + 7, { width: cols[i][1], align: 'right', lineBreak: false }));
}

function drawStandings(doc, view) {
  const rows = view.standings;
  sectionTitle(doc, 'Daily standings', `${rows.length} players / completed results only`, 413);
  standingsHeader(doc, 443);
  let index = 0;
  let y = 474;
  while (index < rows.length && y <= 758) { standingRow(doc, rows[index], index, y); index++; y += 25; }
  if (!rows.length) doc.font('Regular').fontSize(10).fillColor(C.gray).text('No players recorded for this session.', M + 12, 487);
  if (index === rows.length && y < 668) {
    const counts = ['live', 'scheduled', 'incomplete'].map((status) => view.matches.filter((m) => m.status === status).length);
    doc.roundedRect(M, y + 18, INNER, 78, 11).fill(C.pale);
    smallLabel(doc, 'REPORT NOTES', M + 14, y + 30);
    doc.font('Regular').fontSize(8.5).fillColor(C.ink).text(`Not counted in standings: ${counts[0]} live, ${counts[1]} scheduled, ${counts[2]} stopped.`, M + 14, y + 48, { width: INNER - 28 });
    doc.font('Regular').fontSize(8).fillColor(C.gray).text('Player award: minimum 2 completed matches. Pair award: completed doubles only.', M + 14, y + 66, { width: INNER - 28 });
  }
  while (index < rows.length) {
    doc.addPage();
    pageHeading(doc, 'Daily standings', 'Continued from the session overview');
    standingsHeader(doc, 115);
    y = 146;
    while (index < rows.length && y <= 746) { standingRow(doc, rows[index], index, y); index++; y += 25; }
  }
}

function pageHeading(doc, title, sub) {
  doc.rect(0, 0, W, 92).fill(C.forest);
  ball(doc, M + 10, 31, 9);
  doc.font('Bold').fontSize(13).fillColor(C.white).text('Slice', M + 26, 22, { lineBreak: false });
  smallLabel(doc, 'BY STA', M + 27, 38, C.lime);
  doc.font('Bold').fontSize(20).fillColor(C.white).text(title, M, 57, { lineBreak: false });
  doc.font('Regular').fontSize(8).fillColor(C.gray).text(sub, M, 101, { width: INNER, lineBreak: false });
}

function drawMatch(doc, view, match, index, y) {
  const names = (ids) => ids.map((id) => view.people[id] ?? 'Unknown player').join(' & ');
  const tone = match.status === 'completed' ? C.pale : '#F7F7F5';
  doc.roundedRect(M, y, INNER, 66, 11).fill(tone);
  smallLabel(doc, `MATCH ${String(index + 1).padStart(2, '0')}  /  COURT ${match.court}  /  ${match.kind}`, M + 13, y + 9);
  const status = { completed: 'FINAL', live: 'LIVE', scheduled: 'SCHEDULED', incomplete: 'STOPPED' }[match.status] ?? match.status.toUpperCase();
  const when = match.completedAt ? ` / ${stampTime(match.completedAt)}` : match.startedAt ? ` / STARTED ${stampTime(match.startedAt)}` : '';
  doc.font('Bold').fontSize(7.4).fillColor(match.status === 'completed' ? C.forest2 : C.gray).text(`${status}${when}`, W - M - 156, y + 9, { width: 143, align: 'right', lineBreak: false });
  doc.font(match.winner === 'A' ? 'Bold' : 'Regular').fontSize(9).fillColor(C.ink).text(ellipsis(doc, names(match.teamA), 196, 9), M + 13, y + 36, { width: 196, lineBreak: false });
  doc.font('Bold').fontSize(10).fillColor(C.ink).text(scoreLabel(match, view.day.format), M + 209, y + 34, { width: 105, align: 'center', lineBreak: false });
  doc.font(match.winner === 'B' ? 'Bold' : 'Regular').fontSize(9).fillColor(C.ink).text(ellipsis(doc, names(match.teamB), 196, 9), M + 314, y + 36, { width: 196, align: 'right', lineBreak: false });
}

function drawMatches(doc, view) {
  const matches = view.matches;
  doc.addPage();
  pageHeading(doc, 'Match by match', `${dateLabel(view.day.date)} / ${countLabel(matches.length, 'match')} recorded`);
  if (!matches.length) {
    doc.roundedRect(M, 142, INNER, 110, 12).fill(C.pale);
    doc.font('Bold').fontSize(13).fillColor(C.ink).text('No matches yet', M + 16, 172);
    doc.font('Regular').fontSize(9).fillColor(C.gray).text('This report will fill in as the session is scored.', M + 16, 198);
    return;
  }
  let y = 138;
  for (const [index, match] of matches.entries()) {
    if (y + 66 > H - 65) { doc.addPage(); pageHeading(doc, 'Match by match', 'Continued'); y = 138; }
    drawMatch(doc, view, match, index, y);
    y += 74;
  }
  if (y + 48 < 775) {
    doc.font('Regular').fontSize(8).fillColor(C.gray).text('Only final scores count toward the standings and daily awards.', M, y + 12, { width: INNER });
  }
}

function addFooters(doc, view) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.moveTo(M, H - 46).lineTo(W - M, H - 46).lineWidth(0.7).strokeColor(C.line).stroke();
    doc.font('Regular').fontSize(7.5).fillColor(C.gray).text(`SLICE BY STA  /  ${safe(view.day.title).toUpperCase()}`, M, H - 36, { width: 350, lineBreak: false });
    doc.font('Regular').fontSize(7.5).fillColor(C.gray).text(`${i + 1} / ${range.count}`, W - M - 60, H - 36, { width: 60, align: 'right', lineBreak: false });
  }
}

export function reportFilename(day) {
  const slug = day.title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'session';
  return `slice-by-sta-${day.date}-${slug}.pdf`;
}

export async function renderSessionPdf(view) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, autoFirstPage: true, compress: true });
  doc.registerFont('Regular', FONT);
  doc.registerFont('Bold', BOLD);
  doc.info.Title = `${view.day.title} | Slice by STA`;
  doc.info.Author = 'Slice by STA';
  doc.info.Subject = `Tennis session report for ${view.day.date}`;
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const completed = view.matches.filter((m) => m.status === 'completed');
  const singles = completed.filter((m) => m.kind === 'singles').length;
  const doubles = completed.filter((m) => m.kind === 'doubles').length;
  const tally = completed.reduce((n, m) => n + m.score.a + m.score.b, 0);
  const margins = completed.map((m) => Math.abs(m.score.a - m.score.b));
  const avgMargin = margins.length ? (margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(1) : '-';
  coverHeader(doc, view);
  const mw = (INNER - 27) / 4;
  metric(doc, view.present.length, 'Players', M, 202, mw);
  metric(doc, `${completed.length}/${view.matches.length}`, 'Final matches', M + mw + 9, 202, mw);
  metric(doc, `${singles} / ${doubles}`, 'Singles / doubles', M + (mw + 9) * 2, 202, mw);
  metric(doc, tally, `${view.day.formatInfo.unit} recorded`, M + (mw + 9) * 3, 202, mw);
  sectionTitle(doc, 'The day in numbers', `${avgMargin} avg winning margin / Scorer: ${view.day.scorer ?? 'Not listed'}`, 280);
  const awardY = 307;
  const awardW = (INNER - 10) / 2;
  const playerNames = view.potd.winners.map((w) => w.name).join(', ') || 'Not awarded';
  const pairNames = view.pair.winners.map((w) => w.names.join(' & ')).join(', ') || 'Not awarded';
  awardCard(doc, M, awardY, awardW, 'PLAYER OF THE DAY', playerNames, view.potd.status === 'awarded' ? `${view.potd.winners[0].wins} wins / ${Math.round(view.potd.winners[0].winPct * 100)}% win rate` : 'Needs two completed matches');
  awardCard(doc, M + awardW + 10, awardY, awardW, 'PAIR OF THE DAY', pairNames, view.pair.status === 'awarded' ? `${countLabel(view.pair.winners[0].wins, 'win')} together / ${view.pair.winners[0].played} played` : 'Needs a completed doubles match');
  drawStandings(doc, view);
  drawMatches(doc, view);
  addFooters(doc, view);
  return await new Promise((resolve, reject) => {
    doc.once('error', reject);
    doc.once('end', () => resolve(Buffer.concat(chunks)));
    doc.end();
  });
}
