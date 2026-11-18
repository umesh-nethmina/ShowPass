import express, { Router } from 'express';
import { z } from 'zod';
import { h } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { AppError, forbidden, notFound } from '../../lib/errors.js';
import { toCents } from '../../lib/money.js';
import { logger } from '../../lib/logger.js';
import { isProd } from '../../config/env.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { gatewayByName } from './index.js';
import { handleGatewayEvent } from './payment.service.js';
import { MockGateway, mockSignature } from './mock.gateway.js';

export const paymentRouter = Router();

/** Gateway server-to-server callbacks (FR-5.3). Signature verified by each adapter. */
paymentRouter.post(
  '/webhook/:gateway',
  express.urlencoded({ extended: false }),
  h(async (req, res) => {
    const gw = gatewayByName(req.params.gateway);
    if (!gw) throw notFound('Gateway');
    const ev = await gw.parseWebhook(req);
    logger.info({ gateway: gw.name, paymentId: ev.paymentId, outcome: ev.outcome }, 'payment webhook');
    await handleGatewayEvent(ev);
    res.status(200).send('OK');
  }),
);

/** Payment status, polled by the result page after returning from the gateway. */
paymentRouter.get(
  '/:id',
  requireAuth,
  h(async (req, res) => {
    const p = await prisma.payment.findUnique({
      where: { id: req.params.id },
      include: { booking: { select: { id: true, userId: true, status: true, reference: true } } },
    });
    if (!p) throw notFound('Payment');
    if (p.booking.userId !== req.user!.id) throw forbidden();
    res.json({
      payment: { id: p.id, status: p.status, amountCents: toCents(p.amount), currency: p.currency, failReason: p.failReason, gateway: p.gateway },
      booking: { id: p.booking.id, status: p.booking.status, reference: p.booking.reference },
    });
  }),
);

/**
 * Development only: the mock gateway page calls this, and the API delivers a signed webhook to itself,
 * exercising exactly the same code path as a real gateway callback.
 */
paymentRouter.post(
  '/mock/:id/complete',
  requireAuth,
  validate(z.object({ outcome: z.enum(['SUCCESS', 'FAILED']), method: z.string().max(20).optional() })),
  h(async (req, res) => {
    if (isProd) throw new AppError(404, 'NOT_FOUND', 'Route not found');
    const p = await prisma.payment.findUnique({ where: { id: req.params.id }, include: { booking: true } });
    if (!p || p.gateway !== 'mock') throw notFound('Payment');
    if (p.booking.userId !== req.user!.id) throw forbidden();
    const amountCents = toCents(p.amount);
    const body = { paymentId: p.id, outcome: req.body.outcome, amountCents, method: req.body.method ?? 'CARD', signature: mockSignature(p.id, req.body.outcome, amountCents) };
    const ev = await new MockGateway().parseWebhook({ body } as express.Request);
    res.json(await handleGatewayEvent(ev));
  }),
);
