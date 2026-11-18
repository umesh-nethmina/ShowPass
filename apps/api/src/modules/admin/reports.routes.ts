import { Router } from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { h } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { badRequest } from '../../lib/errors.js';
import { toCents } from '../../lib/money.js';
import { dayRange, localDateKey } from '../../lib/format.js';
import { getQuery, validate } from '../../middleware/validate.js';
import { getSettings } from '../settings/settings.service.js';
import { scopedCinemaId } from './scope.js';

/** FR-9.7: sales, bookings and occupancy by movie, show, cinema or date, exportable to CSV/PDF. */
export const reportsRouter = Router();

const query = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  groupBy: z.enum(['movie', 'show', 'cinema', 'date']).default('movie'),
  cinemaId: z.string().optional(),
  format: z.enum(['json', 'csv', 'pdf']).default('json'),
});

export interface ReportRow {
  key: string;
  label: string;
  shows: number;
  bookings: number;
  tickets: number;
  capacity: number;
  occupancyPct: number;
  grossCents: number;
  refundsCents: number;
  netCents: number;
}

export async function buildReport(q: { from: string; to: string; groupBy: 'movie' | 'show' | 'cinema' | 'date'; cinemaId?: string }) {
  const start = dayRange(q.from).start;
  const end = dayRange(q.to).end;
  if (end <= start) throw badRequest('INVALID_RANGE', 'The end date must be on or after the start date');
  if (end.getTime() - start.getTime() > 366 * 86_400_000) throw badRequest('INVALID_RANGE', 'Choose a range of at most one year');

  const shows = await prisma.show.findMany({
    where: { startTime: { gte: start, lt: end }, ...(q.cinemaId ? { screen: { cinemaId: q.cinemaId } } : {}) },
    include: {
      movie: { select: { id: true, title: true } },
      screen: { select: { name: true, cinema: { select: { id: true, name: true } } } },
      _count: { select: { showSeats: true } },
      bookings: {
        where: { status: { in: ['CONFIRMED', 'CANCELLED', 'REFUNDED'] } },
        select: { status: true, total: true, refundAmount: true, _count: { select: { seats: true } } },
      },
    },
    orderBy: { startTime: 'asc' },
  });

  const rows = new Map<string, ReportRow>();
  for (const s of shows) {
    const [key, label] =
      q.groupBy === 'movie'
        ? [s.movie.id, s.movie.title]
        : q.groupBy === 'cinema'
          ? [s.screen.cinema.id, s.screen.cinema.name]
          : q.groupBy === 'date'
            ? [localDateKey(s.startTime), localDateKey(s.startTime)]
            : [s.id, `${s.movie.title} · ${s.screen.cinema.name} ${s.screen.name} · ${s.startTime.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`];
    const r = rows.get(key) ?? { key, label, shows: 0, bookings: 0, tickets: 0, capacity: 0, occupancyPct: 0, grossCents: 0, refundsCents: 0, netCents: 0 };
    r.shows += 1;
    if (s.status === 'SCHEDULED') r.capacity += s._count.showSeats;
    for (const b of s.bookings) {
      r.grossCents += toCents(b.total);
      if (b.status === 'CONFIRMED') {
        r.bookings += 1;
        r.tickets += b._count.seats;
      } else {
        r.refundsCents += b.refundAmount ? toCents(b.refundAmount) : 0;
      }
    }
    rows.set(key, r);
  }
  const list = [...rows.values()].map((r) => ({
    ...r,
    netCents: r.grossCents - r.refundsCents,
    occupancyPct: r.capacity ? Math.round((r.tickets / r.capacity) * 1000) / 10 : 0,
  }));
  const totals = list.reduce(
    (t, r) => ({
      shows: t.shows + r.shows,
      bookings: t.bookings + r.bookings,
      tickets: t.tickets + r.tickets,
      capacity: t.capacity + r.capacity,
      grossCents: t.grossCents + r.grossCents,
      refundsCents: t.refundsCents + r.refundsCents,
      netCents: t.netCents + r.netCents,
    }),
    { shows: 0, bookings: 0, tickets: 0, capacity: 0, grossCents: 0, refundsCents: 0, netCents: 0 },
  );
  return { rows: list, totals: { ...totals, occupancyPct: totals.capacity ? Math.round((totals.tickets / totals.capacity) * 1000) / 10 : 0 } };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const HEADERS = ['Group', 'Shows', 'Bookings', 'Tickets', 'Capacity', 'Occupancy %', 'Gross', 'Refunds', 'Net'];
const money = (c: number) => (c / 100).toFixed(2);

reportsRouter.get(
  '/reports',
  validate(query, 'query'),
  h(async (req, res) => {
    const q = getQuery(req, query);
    const cinemaId = scopedCinemaId(req.user!, q.cinemaId);
    const report = await buildReport({ ...q, cinemaId });
    const { currency } = await getSettings();
    const filename = `showpass-report-${q.groupBy}-${q.from}-to-${q.to}`;

    if (q.format === 'csv') {
      const lines = [HEADERS.map(csvCell).join(',')];
      for (const r of report.rows) {
        lines.push([r.label, r.shows, r.bookings, r.tickets, r.capacity, r.occupancyPct, money(r.grossCents), money(r.refundsCents), money(r.netCents)].map(csvCell).join(','));
      }
      const t = report.totals;
      lines.push(['TOTAL', t.shows, t.bookings, t.tickets, t.capacity, t.occupancyPct, money(t.grossCents), money(t.refundsCents), money(t.netCents)].map(csvCell).join(','));
      res.type('text/csv').set('Content-Disposition', `attachment; filename="${filename}.csv"`).send(lines.join('\n'));
      return;
    }

    if (q.format === 'pdf') {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
      res.type('application/pdf').set('Content-Disposition', `attachment; filename="${filename}.pdf"`);
      doc.pipe(res);
      doc.font('Helvetica-Bold').fontSize(16).text('ShowPass – Sales & occupancy report');
      doc.font('Helvetica').fontSize(10).fillColor('#555').text(`${q.from} to ${q.to} · grouped by ${q.groupBy} · amounts in ${currency}`).moveDown();
      const widths = [260, 50, 60, 55, 60, 70, 70, 60, 70];
      const drawRow = (cells: (string | number)[], bold = false) => {
        const y = doc.y;
        let x = 36;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#111');
        cells.forEach((c, i) => {
          doc.text(String(c), x, y, { width: widths[i] - 6, align: i === 0 ? 'left' : 'right', lineBreak: i === 0 });
          x += widths[i];
        });
        doc.y = Math.max(doc.y, y + 14);
        if (doc.y > doc.page.height - 50) doc.addPage();
      };
      drawRow(HEADERS, true);
      for (const r of report.rows) drawRow([r.label, r.shows, r.bookings, r.tickets, r.capacity, r.occupancyPct, money(r.grossCents), money(r.refundsCents), money(r.netCents)]);
      const t = report.totals;
      drawRow(['TOTAL', t.shows, t.bookings, t.tickets, t.capacity, t.occupancyPct, money(t.grossCents), money(t.refundsCents), money(t.netCents)], true);
      doc.end();
      return;
    }

    res.json({ ...report, currency });
  }),
);
