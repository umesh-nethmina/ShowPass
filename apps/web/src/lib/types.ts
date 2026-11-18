export type Role = 'CUSTOMER' | 'TICKET_CHECKER' | 'CINEMA_ADMIN' | 'SUPER_ADMIN';
export type ScreenFormat = 'TWO_D' | 'THREE_D' | 'IMAX';
export type SeatCategory = 'STANDARD' | 'PREMIUM' | 'RECLINER';
export type MovieStatus = 'COMING_SOON' | 'NOW_SHOWING' | 'ARCHIVED';
export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'EXPIRED' | 'CANCELLED' | 'REFUNDED';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  cinemaId: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  verified: boolean;
}

export interface MovieSummary {
  id: string;
  title: string;
  slug: string;
  posterUrl: string;
  backdropUrl: string | null;
  genres: string[];
  language: string;
  durationMin: number;
  ageRating: string;
  releaseDate: string;
  status: MovieStatus;
  rating: { avg: number | null; count: number } | null;
}

export interface Movie extends MovieSummary {
  synopsis: string;
  cast: string[];
  trailerUrl: string | null;
  reviews: { id: string; rating: number; comment: string | null; createdAt: string; user: { name: string } }[];
}

export interface Showtime {
  id: string;
  startTime: string;
  language: string;
  screen: { id: string; name: string; format: ScreenFormat };
  availability: 'AVAILABLE' | 'FILLING_FAST' | 'SOLD_OUT';
  seatsLeft: number;
}

export interface ShowtimesResponse {
  dates: string[];
  date: string | null;
  cinemas: { cinema: { id: string; name: string; city: string; address: string }; shows: Showtime[] }[];
}

export interface SeatMapSeat {
  id: string;
  label: string;
  row: string;
  number: number;
  gridRow: number;
  gridCol: number;
  category: SeatCategory;
  priceCents: number;
  status: 'AVAILABLE' | 'HELD' | 'BOOKED';
  mine: boolean;
}

export interface SeatMap {
  show: {
    id: string;
    startTime: string;
    language: string;
    bookingOpen: boolean;
    movie: { id: string; title: string; slug: string; posterUrl: string; ageRating: string; durationMin: number };
    screen: { id: string; name: string; format: ScreenFormat; gridRows: number; gridCols: number };
    cinema: { id: string; name: string; city: string; address: string };
  };
  categories: { category: SeatCategory; priceCents: number }[];
  seats: SeatMapSeat[];
  rules: { maxSeats: number; holdMinutes: number; currency: string; convenienceFeePerTicket: number; taxPercent: number };
}

export interface Booking {
  id: string;
  reference: string;
  status: BookingStatus;
  currency: string;
  subtotalCents: number;
  convenienceFeeCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  refundCents: number | null;
  promoCode: string | null;
  holdExpiresAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  checkedInAt: string | null;
  createdAt: string;
  qrToken: string | null;
  seats: { seatId: string; label: string; category: SeatCategory; priceCents: number }[];
  show: {
    id: string;
    startTime: string;
    language: string;
    movie: { id: string; title: string; slug: string; posterUrl: string; ageRating: string; durationMin: number };
    screen: { id: string; name: string; format: ScreenFormat };
    cinema: { id: string; name: string; city: string; address: string };
  };
  payments: { id: string; status: string; amountCents: number; method: string | null; paidAt: string | null; gateway: string }[];
  cancellation: { allowed: boolean; refundCents: number; refundPercent: number; cutoffMinutes: number };
  customer?: { id: string; name: string; email: string; phone: string };
}

export type CheckoutAction = { type: 'redirect'; url: string } | { type: 'form'; action: string; fields: Record<string, string> };
