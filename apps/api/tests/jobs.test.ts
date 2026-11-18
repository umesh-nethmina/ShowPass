import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { sentEmails } from '../src/modules/notifications/email.js';
import { sentSms } from '../src/modules/notifications/sms.js';
import { notifyWatchlists, sendShowReminders } from '../src/jobs/notifications.js';
import { bookAndPay, createFixture, loginAs, resetDb } from './helpers.js';

beforeEach(async () => {
  await resetDb();
  sentEmails.length = 0;
  sentSms.length = 0;
});

describe('show reminders (FR-6.4)', () => {
  it('sends one reminder about 2 hours before the show', async () => {
    const soon = await createFixture({ startsInMinutes: 118 });
    const later = await createFixture({ startsInMinutes: 6 * 60 });
    const a = await loginAs();
    const b1 = await bookAndPay(a.agent, soon.show.id, [soon.seats[0].id]);
    await bookAndPay(a.agent, later.show.id, [later.seats[0].id]);
    sentEmails.length = 0;
    sentSms.length = 0;

    expect(await sendShowReminders()).toBe(1);
    expect(sentEmails.find((m) => m.subject.startsWith('Reminder:'))).toBeTruthy();
    expect(sentSms.some((s) => s.text.includes('reminder'))).toBe(true);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b1.id } })).reminderSentAt).not.toBeNull();

    // Not sent twice
    expect(await sendShowReminders()).toBe(0);
  });

  it('skips cancelled bookings', async () => {
    const f = await createFixture({ startsInMinutes: 118 });
    const a = await loginAs();
    const b = await bookAndPay(a.agent, f.show.id, [f.seats[0].id]);
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED' } });
    expect(await sendShowReminders()).toBe(0);
  });
});

describe('watchlist notifications (FR-2.5)', () => {
  it('notifies once when an upcoming movie gets bookable shows', async () => {
    const f = await createFixture();
    await prisma.show.update({ where: { id: f.show.id }, data: { status: 'CANCELLED' } });
    await prisma.movie.update({ where: { id: f.movie.id }, data: { status: 'COMING_SOON' } });
    const a = await loginAs();
    expect((await a.agent.post(`/api/movies/${f.movie.id}/watchlist`)).status).toBe(204);

    expect(await notifyWatchlists()).toBe(0); // no bookable shows yet

    await prisma.show.update({ where: { id: f.show.id }, data: { status: 'SCHEDULED' } });
    expect(await notifyWatchlists()).toBe(1);
    const mail = sentEmails.find((m) => m.to === a.user.email);
    expect(mail?.subject).toContain('Booking is open');
    expect(mail?.text).toContain(`/movies/${f.movie.slug}`);
    expect(await notifyWatchlists()).toBe(0);
  });
});
