import PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import { rankStatisticsRows, STATISTICS_MIN_MATCHES } from './shared/standings.js';

const regular = readFileSync(new URL('./fonts/noto-sans-regular.woff', import.meta.url));
const bold = readFileSync(new URL('./fonts/noto-sans-bold.woff', import.meta.url));
const forest = '#18231A', lime = '#D4F04C';
const clean = (s) => String(s ?? '').replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u2018\u2019]/g, "'");
export const statisticsFilename = (view) => `slice-player-statistics-${view.allTime ? 'all-time' : `${view.start}-to-${view.end}`}.pdf`;

// Both ranking views are included so a downloaded report is complete on its own.
export async function renderStatisticsPdf(view) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
  doc.registerFont('Regular', regular).registerFont('Bold', bold);
  doc.info.Title = 'All player statistics | Slice by STA';
  doc.info.Author = 'Slice by STA';
  const chunks = [];
  const result = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.once('end', () => resolve(Buffer.concat(chunks)));
    doc.once('error', reject);
  });
  const period = view.allTime ? `All-time${view.start ? ` / ${view.start} to ${view.end}` : ''}` : `${view.start} to ${view.end}`;
  const columns = [36, 66, 243, 286, 323, 360, 407, 454, 499];
  const widths = [26, 173, 39, 33, 33, 43, 43, 41, 60];
  const text = (s, x, y, width, opts = {}) => doc.text(clean(s), x, y, { width, lineBreak: false, ...opts });
  for (const [modeIndex, mode] of ['percentage', 'wins'].entries()) {
    const rows = rankStatisticsRows(view.standings, mode);
    let offset = 0;
    do {
      if (modeIndex || offset) doc.addPage();
      doc.rect(0, 0, 596, 116).fill(forest);
      doc.font('Bold').fontSize(11).fillColor(lime); text('SLICE BY STA / PLAYER STATISTICS', 36, 23, 523);
      doc.fontSize(23).fillColor('white'); text(mode === 'percentage' ? 'Ranked by win percentage' : 'Ranked by matches won', 36, 49, 523);
      doc.font('Regular').fontSize(9).fillColor('white'); text(period, 36, 88, 523);
      doc.fontSize(9).fillColor(forest); text(`${view.standings.length} players / ${view.completedMatches} completed matches / ${view.sessionCount} sessions`, 36, 134, 523);
      doc.fontSize(8); text(`Minimum ${STATISTICS_MIN_MATCHES} completed matches in this period to rank. Unqualified players remain listed.`, 36, 154, 523);
      text(mode === 'percentage' ? 'Order: win percentage, then matches won. Exact ties share rank.' : 'Order: matches won, then win percentage. Exact ties share rank.', 36, 170, 523);
      doc.roundedRect(36, 194, 523, 30, 6).fill(forest);
      doc.font('Bold').fontSize(7.5).fillColor('white');
      ['Rank', 'Player', 'Played', 'Won', 'Lost', 'Win %', 'Games W', 'Games L', 'Eligible'].forEach((v, i) => text(v, columns[i], 205, widths[i]));
      let y = 230;
      if (!rows.length) { doc.font('Regular').fontSize(10).fillColor(forest); text('No players recorded yet.', 44, y + 12, 500); }
      while (offset < rows.length && y + 36 <= 730) {
        const r = rows[offset];
        if (offset % 2 === 0) doc.rect(36, y, 523, 36).fill('#F4F7EE');
        const values = [r.rank ?? '-', r.name, r.matchesPlayed, r.matchWins, r.matchLosses, r.matchesPlayed ? `${(r.winPct * 100).toFixed(1)}%` : '-', r.gamesWon, r.gamesLost, r.eligible ? 'Yes' : `${r.matchesPlayed}/15`];
        doc.font('Regular').fontSize(8).fillColor(forest);
        values.forEach((v, i) => text(v, columns[i], y + (i === 1 ? 5 : 12), widths[i], i === 1 ? { lineBreak: true, height: 30 } : {}));
        y += 36; offset++;
      }
      doc.font('Regular').fontSize(7.5).fillColor('#627064');
      doc.text('Only completed results count. Doubles credit each partner. Games exclude match tiebreak points.\nEach saved set-format match represents one set; minimum eligibility is 15 completed matches.', 36, 750, { width: 523 });
    } while (offset < rows.length);
  }
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.font('Regular').fontSize(8).fillColor('#627064');
    text(`Slice by STA / Generated ${new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' })}`, 36, 809, 440);
    text(`${i + 1} / ${range.count}`, 500, 809, 59, { align: 'right' });
  }
  doc.end();
  return result;
}
