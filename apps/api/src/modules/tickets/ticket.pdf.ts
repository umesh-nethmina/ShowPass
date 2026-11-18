import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { formatMoney, formatShowTime } from '../../lib/format.js';

export const qrPayload = (qrToken: string) => `SHOWPASS:${qrToken}`;

export interface TicketData {
  reference: string;
  qrToken: string;
  customerName: string;
  movieTitle: string;
  ageRating: string;
  cinemaName: string;
  cinemaAddress: string;
  screenName: string;
  format: string;
  startTime: Date;
  seats: string[];
  /** e.g. "2× Popcorn combo" */
  items: string[];
  totalCents: number;
  currency: string;
  status: string;
}

export async function qrPng(qrToken: string, width = 320) {
  return QRCode.toBuffer(qrPayload(qrToken), { errorCorrectionLevel: 'M', margin: 1, width });
}

/** FR-6.1 / FR-6.3: printable e-ticket with booking ID and QR code. */
export async function renderTicketPdf(t: TicketData): Promise<Buffer> {
  const qr = await qrPng(t.qrToken, 360);
  const doc = new PDFDocument({ size: 'A5', margin: 36, info: { Title: `ShowPass ticket ${t.reference}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width;
  doc.rect(0, 0, W, 70).fill('#0b0b12');
  doc.fillColor('#f5c518').fontSize(24).font('Helvetica-Bold').text('ShowPass', 36, 24);
  doc.fillColor('#ffffff').fontSize(10).font('Helvetica').text('E-TICKET', W - 120, 32, { width: 84, align: 'right' });

  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(18).text(t.movieTitle, 36, 90, { width: W - 72 });
  doc.font('Helvetica').fontSize(10).fillColor('#555555').text(`${t.ageRating} · ${t.format}`);
  doc.moveDown(0.8);

  const row = (label: string, value: string) => {
    doc.font('Helvetica').fontSize(9).fillColor('#777777').text(label.toUpperCase());
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111').text(value);
    doc.moveDown(0.4);
  };
  row('Date & time', formatShowTime(t.startTime));
  row('Cinema', `${t.cinemaName} – ${t.screenName}`);
  row('Seats', t.seats.join(', '));
  if (t.items.length) row('Food & drinks (collect at the counter)', t.items.join(', '));
  row('Booking ID', t.reference);
  row('Name', t.customerName);
  row('Total paid', formatMoney(t.totalCents, t.currency));

  const qrSize = 170;
  const y = doc.y + 6;
  doc.image(qr, (W - qrSize) / 2, y, { width: qrSize });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#777777')
    .text('Show this QR code at the entrance. Valid for one entry only.', 36, y + qrSize + 8, { width: W - 72, align: 'center' })
    .text(t.cinemaAddress, { width: W - 72, align: 'center' });
  if (t.status !== 'CONFIRMED') {
    doc.save().rotate(-30, { origin: [W / 2, 300] }).fontSize(60).fillColor('#dc2626').opacity(0.35).text(t.status, 0, 280, { width: W, align: 'center' }).restore();
  }
  doc.end();
  return done;
}
