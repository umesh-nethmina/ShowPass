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

export function reminderEmail(d: { name: string; reference: string; movie: string; cinema: string; screen: string; startsAt: string; seats: string; address: string }) {
  return {
    subject: `Reminder: ${d.movie} starts at ${d.startsAt}`,
    text: `Hi ${d.name}, a reminder that ${d.movie} starts at ${d.startsAt} at ${d.cinema} (${d.screen}). Seats: ${d.seats}. Booking ${d.reference}. Please arrive 15 minutes early with your QR ticket.`,
    html: layout(
      'Your show starts soon',
      `<p>Hi ${esc(d.name)}, <b>${esc(d.movie)}</b> starts at <b>${esc(d.startsAt)}</b>.</p>
       <p>${esc(d.cinema)} · ${esc(d.screen)}<br>${esc(d.address)}</p>
       <p>Seats: <b>${esc(d.seats)}</b> · Booking <b>${esc(d.reference)}</b></p>
       <p style="color:#a1a1aa">Please arrive 15 minutes early and have your QR ticket ready.</p>`,
    ),
  };
}

export function bookingOpenEmail(d: { name: string; movie: string; url: string }) {
  return {
    subject: `Booking is open: ${d.movie}`,
    text: `Hi ${d.name}, tickets for ${d.movie} are now on sale. Book here: ${d.url}`,
    html: layout(
      `${d.movie} – booking is open`,
      `<p>Hi ${esc(d.name)}, you asked us to let you know: tickets for <b>${esc(d.movie)}</b> are now on sale.</p>
       <p><a href="${esc(d.url)}" style="display:inline-block;background:#f5c518;color:#0b0b12;padding:10px 18px;border-radius:8px;font-weight:bold;text-decoration:none">Book tickets</a></p>`,
    ),
  };
}
