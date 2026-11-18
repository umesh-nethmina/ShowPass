const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const layout = (title: string, body: string) => `<!doctype html><html><body style="margin:0;background:#0b0b12;font-family:Arial,sans-serif;color:#f4f4f5">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="font-size:22px;font-weight:bold;color:#f5c518;margin-bottom:16px">ShowPass</div>
<div style="background:#16161f;border-radius:12px;padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>${body}</div>
<p style="color:#a1a1aa;font-size:12px;margin-top:16px">You received this email because you have a ShowPass account.</p>
</div></body></html>`;

export function otpEmail(name: string, code: string, purpose: 'verify' | 'reset') {
  const what = purpose === 'verify' ? 'verify your account' : 'reset your password';
  return {
    subject: purpose === 'verify' ? 'Your ShowPass verification code' : 'Reset your ShowPass password',
    text: `Hi ${name}, use code ${code} to ${what}. It expires in 10 minutes.`,
    html: layout(
      purpose === 'verify' ? 'Verify your account' : 'Reset your password',
      `<p>Hi ${esc(name)},</p><p>Use this code to ${what}:</p>
       <p style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#f5c518">${code}</p>
       <p style="color:#a1a1aa">It expires in 10 minutes. If you did not ask for this, you can ignore this email.</p>`,
    ),
  };
}

export interface TicketEmailData {
  name: string;
  reference: string;
  movie: string;
  cinema: string;
  screen: string;
  startsAt: string;
  seats: string;
  total: string;
}

export function ticketEmail(d: TicketEmailData) {
  const rows = [
    ['Booking ID', d.reference],
    ['Movie', d.movie],
    ['Cinema', `${d.cinema} · ${d.screen}`],
    ['Date & time', d.startsAt],
    ['Seats', d.seats],
    ['Total paid', d.total],
  ]
    .map(([k, v]) => `<tr><td style="color:#a1a1aa;padding:4px 12px 4px 0">${k}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`)
    .join('');
  return {
    subject: `Your tickets for ${d.movie} – ${d.reference}`,
    text: `Hi ${d.name}, your booking ${d.reference} for ${d.movie} at ${d.cinema} on ${d.startsAt} is confirmed. Seats: ${d.seats}. Total: ${d.total}. Your e-ticket is attached.`,
    html: layout(
      'Your booking is confirmed',
      `<p>Hi ${esc(d.name)}, enjoy the show! Your e-ticket with QR code is attached as a PDF. Show it at the entrance.</p>
       <table style="font-size:14px">${rows}</table>`,
    ),
  };
}

export function cancellationEmail(name: string, reference: string, movie: string, refund: string) {
  return {
    subject: `Booking ${reference} cancelled`,
    text: `Hi ${name}, booking ${reference} for ${movie} has been cancelled. Refund: ${refund}.`,
    html: layout('Booking cancelled', `<p>Hi ${esc(name)}, your booking <b>${esc(reference)}</b> for <b>${esc(movie)}</b> has been cancelled.</p><p>Refund: <b>${esc(refund)}</b>. It can take 5–7 working days to reach your account.</p>`),
  };
}
