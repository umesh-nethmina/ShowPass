/* Development seed: wipes and recreates demo data. Never run against production. */
import 'dotenv/config';
import { PrismaClient, type SeatCategory, type ScreenFormat } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { resolvePrice, type RuleLike } from '../src/modules/pricing/pricing.js';

process.env.TZ = process.env.APP_TIMEZONE || 'Asia/Colombo';
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');

const prisma = new PrismaClient();
const TRAILER = 'https://www.youtube.com/embed/aqz-KE-bpKQ'; // placeholder trailer (Big Buck Bunny, CC-BY)
const poster = (slug: string) => `https://picsum.photos/seed/${slug}/400/600`;
const backdrop = (slug: string) => `https://picsum.photos/seed/${slug}-bg/1280/540`;

const MOVIES = [
  { title: 'The Last Monsoon', genres: ['Drama', 'Romance'], language: 'Sinhala', durationMin: 138, ageRating: 'PG-13', status: 'NOW_SHOWING', cast: ['Nadeesha Perera', 'Kasun Silva', 'Ruwani Fernando'], synopsis: 'Two estranged siblings return to their family tea estate in the hills as the season\'s heaviest rains threaten to wash away everything they once shared.' },
  { title: 'Neon Harbour', genres: ['Action', 'Thriller'], language: 'English', durationMin: 124, ageRating: 'R', status: 'NOW_SHOWING', cast: ['Maya Collins', 'Dev Rao', 'Tom Hale'], synopsis: 'A disgraced port inspector uncovers a smuggling ring hiding in plain sight beneath the glowing cranes of a city that never sleeps.' },
  { title: 'Orbit of Ash', genres: ['Sci-Fi', 'Adventure'], language: 'English', durationMin: 151, ageRating: 'PG-13', status: 'NOW_SHOWING', cast: ['Lena Ortiz', 'Samuel Okafor', 'Yuki Tanaka'], synopsis: 'When a mining station loses contact with Earth, its youngest engineer must pilot a crippled shuttle through a storm of debris to bring everyone home.' },
  { title: 'Paper Kites', genres: ['Family', 'Comedy'], language: 'Tamil', durationMin: 106, ageRating: 'G', status: 'NOW_SHOWING', cast: ['Arun Kumar', 'Priya Raj', 'Selvi Nathan'], synopsis: 'A grandmother and her three mischievous grandchildren enter the town\'s legendary kite festival with a homemade kite and a lot of ambition.' },
  { title: 'Kandy Express', genres: ['Mystery', 'Thriller'], language: 'Sinhala', durationMin: 117, ageRating: 'PG-13', status: 'NOW_SHOWING', cast: ['Chamara Jayasinghe', 'Ishara De Silva'], synopsis: 'A priceless relic vanishes on the overnight train to Kandy, and a retired detective has until sunrise to find which passenger took it.' },
  { title: 'The Quiet Cartographer', genres: ['Drama'], language: 'English', durationMin: 129, ageRating: 'PG', status: 'NOW_SHOWING', cast: ['Eleanor Grey', 'Ravi Menon'], synopsis: 'An elderly mapmaker sets out on one last journey to chart the coastline of the island where she was born.' },
  { title: 'Lion Rock Rising', genres: ['Action', 'History'], language: 'Sinhala', durationMin: 162, ageRating: 'PG-13', status: 'COMING_SOON', cast: ['Dinesh Gunawardena', 'Hiruni Wickramasinghe'], synopsis: 'An epic tale of the engineers and artists who built a fortress in the sky.' },
  { title: 'Starlight Diner', genres: ['Comedy', 'Romance'], language: 'English', durationMin: 98, ageRating: 'PG', status: 'COMING_SOON', cast: ['Jamie Fox-Lee', 'Ana Ruiz'], synopsis: 'A late-night diner, a broken jukebox, and two strangers who keep ordering the same dessert.' },
] as const;

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Builds a seat grid: aisles between blocks, premium middle rows, recliners at the back. */
function layout(rows: number, perRow: number, aisles: number[], recliners = 2, premium = 3) {
  const seats: { gridRow: number; gridCol: number; rowLabel: string; seatNumber: number; category: SeatCategory }[] = [];
  const gridCols = perRow + aisles.length;
  for (let r = 0; r < rows; r++) {
    const rowLabel = String.fromCharCode(65 + r);
    const category: SeatCategory = r >= rows - recliners ? 'RECLINER' : r >= rows - recliners - premium ? 'PREMIUM' : 'STANDARD';
    let n = 0;
    for (let c = 0; c < gridCols; c++) {
      if (aisles.includes(c)) continue;
      // recliners are wider: use every other position
      if (category === 'RECLINER' && c % 2 === 1) continue;
      seats.push({ gridRow: r, gridCol: c, rowLabel, seatNumber: ++n, category });
    }
  }
  return { gridRows: rows, gridCols, seats };
}

async function main() {
  console.log('Clearing existing data…');
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.bookingSeat.deleteMany(),
    prisma.bookingItem.deleteMany(),
    prisma.showSeat.deleteMany(),
    prisma.booking.deleteMany(),
    prisma.show.deleteMany(),
    prisma.priceRule.deleteMany(),
    prisma.seat.deleteMany(),
    prisma.screen.deleteMany(),
    prisma.review.deleteMany(),
    prisma.watchlistItem.deleteMany(),
    prisma.verificationCode.deleteMany(),
    prisma.user.deleteMany(),
    prisma.cinema.deleteMany(),
    prisma.movie.deleteMany(),
    prisma.promoCode.deleteMany(),
    prisma.concession.deleteMany(),
    prisma.setting.deleteMany(),
  ]);

  const cinemas = await Promise.all([
    prisma.cinema.create({ data: { name: 'ShowPass Colombo City', address: '45 Galle Road, Colombo 03', city: 'Colombo', contact: '+94 11 234 5678' } }),
    prisma.cinema.create({ data: { name: 'ShowPass Kandy Lakeside', address: '12 Dalada Veediya, Kandy', city: 'Kandy', contact: '+94 81 222 3344' } }),
  ]);

  const screenDefs: { cinema: number; name: string; format: ScreenFormat; l: ReturnType<typeof layout> }[] = [
    { cinema: 0, name: 'Screen 1', format: 'TWO_D', l: layout(10, 16, [4, 13]) },
    { cinema: 0, name: 'Screen 2', format: 'THREE_D', l: layout(8, 12, [3, 10]) },
    { cinema: 0, name: 'IMAX', format: 'IMAX', l: layout(12, 20, [5, 16], 2, 4) },
    { cinema: 1, name: 'Hall A', format: 'TWO_D', l: layout(9, 14, [3, 12]) },
    { cinema: 1, name: 'Hall B', format: 'THREE_D', l: layout(7, 10, [5]) },
  ];
  const screens = [];
  for (const d of screenDefs) {
    screens.push(
      await prisma.screen.create({
        data: { cinemaId: cinemas[d.cinema].id, name: d.name, format: d.format, gridRows: d.l.gridRows, gridCols: d.l.gridCols, seats: { create: d.l.seats } },
        include: { seats: true },
      }),
    );
  }

  // Base prices + a weekend/evening uplift (FR-9.4)
  for (const c of cinemas) {
    await prisma.priceRule.createMany({
      data: [
        { cinemaId: c.id, category: 'STANDARD', price: 1200, daysOfWeek: [] },
        { cinemaId: c.id, category: 'PREMIUM', price: 1800, daysOfWeek: [] },
        { cinemaId: c.id, category: 'RECLINER', price: 3000, daysOfWeek: [] },
        { cinemaId: c.id, category: 'STANDARD', price: 1500, daysOfWeek: [0, 6], startMinute: 17 * 60, priority: 1 },
        { cinemaId: c.id, category: 'PREMIUM', price: 2200, daysOfWeek: [0, 6], startMinute: 17 * 60, priority: 1 },
        { cinemaId: c.id, category: 'RECLINER', price: 3500, daysOfWeek: [0, 6], startMinute: 17 * 60, priority: 1 },
      ],
    });
  }

  const movies = [];
  for (const [i, m] of MOVIES.entries()) {
    const slug = slugify(m.title);
    const release = new Date();
    release.setDate(release.getDate() + (m.status === 'COMING_SOON' ? 21 + i : -7 - i * 3));
    movies.push(
      await prisma.movie.create({
        data: { ...m, genres: [...m.genres], cast: [...m.cast], slug, releaseDate: release, posterUrl: poster(slug), backdropUrl: backdrop(slug), trailerUrl: TRAILER },
      }),
    );
  }
  const nowShowing = movies.filter((m) => m.status === 'NOW_SHOWING');

  // Shows for the next 7 days: 4 slots per screen per day, rotating movies.
  const SLOTS = [[10, 0], [13, 30], [17, 0], [20, 30]];
  const allRules = await prisma.priceRule.findMany();
  let showCount = 0;
  for (let day = 0; day < 7; day++) {
    for (const [si, screen] of screens.entries()) {
      const rules: RuleLike[] = allRules.filter((r) => r.cinemaId === screen.cinemaId).map((r) => ({ ...r, priceCents: Math.round(Number(r.price) * 100) }));
      for (const [k, [hh, mm]] of SLOTS.entries()) {
        const start = new Date();
        start.setDate(start.getDate() + day);
        start.setHours(hh, mm, 0, 0);
        if (start < new Date()) continue;
        const movie = nowShowing[(si + k + day) % nowShowing.length];
        const show = await prisma.show.create({
          data: {
            movieId: movie.id,
            screenId: screen.id,
            startTime: start,
            endTime: new Date(start.getTime() + (movie.durationMin + 15) * 60_000),
            language: movie.language,
          },
        });
        await prisma.showSeat.createMany({
          data: screen.seats.map((seat) => ({ showId: show.id, seatId: seat.id, price: (resolvePrice(rules, seat.category, start)! / 100).toFixed(2) })),
        });
        showCount++;
      }
    }
  }

  const hash = (pw: string) => bcrypt.hashSync(pw, 12);
  const verified = new Date();
  await prisma.user.createMany({
    data: [
      { name: 'Super Admin', email: 'admin@showpass.local', phone: '+94770000001', passwordHash: hash('Admin@1234'), role: 'SUPER_ADMIN', emailVerifiedAt: verified },
      { name: 'Colombo Manager', email: 'manager@showpass.local', phone: '+94770000002', passwordHash: hash('Manager@1234'), role: 'CINEMA_ADMIN', cinemaId: cinemas[0].id, emailVerifiedAt: verified },
      { name: 'Gate Checker', email: 'checker@showpass.local', phone: '+94770000003', passwordHash: hash('Checker@1234'), role: 'TICKET_CHECKER', cinemaId: cinemas[0].id, emailVerifiedAt: verified },
      { name: 'Demo Customer', email: 'customer@showpass.local', phone: '+94770000004', passwordHash: hash('Customer@1234'), role: 'CUSTOMER', emailVerifiedAt: verified },
    ],
  });

  const now = new Date();
  const inThreeMonths = new Date(now.getTime() + 90 * 86_400_000);
  await prisma.promoCode.createMany({
    data: [
      { code: 'WELCOME10', description: '10% off, up to LKR 500', type: 'PERCENT', value: 10, maxDiscount: 500, validFrom: now, validTo: inThreeMonths, usageLimit: 1000 },
      { code: 'FLAT300', description: 'LKR 300 off bookings over LKR 2,000', type: 'FIXED', value: 300, minAmount: 2000, validFrom: now, validTo: inThreeMonths },
    ],
  });

  await prisma.concession.createMany({
    data: [
      { name: 'Classic popcorn combo', description: 'Large salted popcorn + 2 soft drinks', price: 1450, sortOrder: 1 },
      { name: 'Caramel popcorn (regular)', description: 'Sweet caramel popcorn', price: 750, sortOrder: 2 },
      { name: 'Nachos with cheese', description: 'Tortilla chips with warm cheese dip', price: 950, sortOrder: 3 },
      { name: 'Iced coffee', description: '500 ml', price: 650, sortOrder: 4 },
      { name: 'Kandy kottu box', description: 'Chicken kottu, served in the lobby', price: 1250, sortOrder: 5, cinemaId: cinemas[1].id },
    ],
  });

  console.log(`Seeded ${cinemas.length} cinemas, ${screens.length} screens, ${movies.length} movies, ${showCount} shows.`);
  console.log('Logins: admin@showpass.local / Admin@1234 · manager@showpass.local / Manager@1234 · checker@showpass.local / Checker@1234 · customer@showpass.local / Customer@1234');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
