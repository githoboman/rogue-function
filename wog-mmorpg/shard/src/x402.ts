/**
 * x402.ts — Fastify x402 Payment Middleware
 * Adapts x402-stacks (Express-based) for Fastify.
 * Protects selected endpoints with STX micropayments.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import {
  X402PaymentVerifier,
  X402_HEADERS,
  X402_ERROR_CODES,
  STXtoMicroSTX,
  networkToCAIP2,
} from "x402-stacks";
import type {
  NetworkV2,
  PaymentRequirementsV2,
  PaymentRequiredV2,
  PaymentPayloadV2,
  SettlementResponseV2,
} from "x402-stacks";

// ── Config ────────────────────────────────────────────────

const NETWORK_TYPE = (process.env.STACKS_NETWORK || "testnet") as "testnet" | "mainnet";
const NETWORK: NetworkV2 = networkToCAIP2(NETWORK_TYPE);
const PAY_TO = process.env.SERVER_STACKS_ADDRESS || "";
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator";

// ── Helpers ───────────────────────────────────────────────

function buildPaymentRequirements(
  amount: string,
  description: string,
  extra?: Record<string, unknown>,
): PaymentRequirementsV2 {
  return {
    scheme: "exact",
    network: NETWORK,
    amount,
    asset: "STX",
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    extra,
  };
}

function buildPaymentRequired(
  req: FastifyRequest,
  requirements: PaymentRequirementsV2,
  description: string,
): PaymentRequiredV2 {
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host || "localhost";
  return {
    x402Version: 2,
    resource: {
      url: `${protocol}://${host}${req.url}`,
      description,
    },
    accepts: [requirements],
  };
}

// ── Fastify preHandler factory ────────────────────────────

export interface X402RouteConfig {
  /** Amount in STX (e.g. "0.001" for a micropayment) */
  amountSTX: string;
  /** Human-readable description of the paid resource */
  description: string;
}

/**
 * Creates a Fastify preHandler that enforces x402 payment.
 * Usage:
 *   server.get("/premium", { preHandler: x402Pay({ amountSTX: "0.001", description: "Game state" }) }, handler)
 */
export function x402Pay(config: X402RouteConfig) {
  const amountMicro = STXtoMicroSTX(parseFloat(config.amountSTX)).toString();
  const verifier = new X402PaymentVerifier(FACILITATOR_URL);

  return async function x402Handler(req: FastifyRequest, reply: FastifyReply) {
    // 1. Check for payment-signature header
    const paymentHeader = req.headers[X402_HEADERS.PAYMENT_SIGNATURE] as string | undefined;

    if (!paymentHeader) {
      // No payment → return 402 with payment requirements
      const requirements = buildPaymentRequirements(amountMicro, config.description);
      const paymentRequired = buildPaymentRequired(req, requirements, config.description);
      const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString("base64");

      reply
        .header(X402_HEADERS.PAYMENT_REQUIRED, encoded)
        .status(402)
        .send({
          error: "payment_required",
          message: `Payment of ${config.amountSTX} STX required`,
          x402Version: 2,
        });
      return reply;
    }

    // 2. Decode payment payload
    let paymentPayload: PaymentPayloadV2;
    try {
      const decoded = Buffer.from(paymentHeader, "base64").toString("utf-8");
      paymentPayload = JSON.parse(decoded);
    } catch {
      reply.status(400).send({
        error: X402_ERROR_CODES.INVALID_PAYLOAD,
        message: "Invalid payment-signature header",
      });
      return reply;
    }

    if (paymentPayload.x402Version !== 2) {
      reply.status(400).send({
        error: X402_ERROR_CODES.INVALID_X402_VERSION,
        message: "Only x402 v2 is supported",
      });
      return reply;
    }

    // 3. Settle the payment via facilitator
    const requirements = buildPaymentRequirements(amountMicro, config.description);
    let settlement: SettlementResponseV2;
    try {
      settlement = await verifier.settle(paymentPayload, { paymentRequirements: requirements });
    } catch (e: any) {
      console.warn(`⚡ x402 settlement error: ${e.message}`);
      reply.status(502).send({
        error: "settlement_failed",
        message: "Facilitator unreachable or settlement failed",
      });
      return reply;
    }

    // 4. Check settlement result
    if (!settlement.success) {
      const paymentRequired = buildPaymentRequired(req, requirements, config.description);
      const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString("base64");
      reply
        .header(X402_HEADERS.PAYMENT_REQUIRED, encoded)
        .status(402)
        .send({
          error: settlement.errorReason || "settlement_failed",
          payer: settlement.payer,
          transaction: settlement.transaction,
        });
      return reply;
    }

    // 5. Payment verified — attach settlement info to request and proceed
    (req as any).x402 = settlement;
    const responseEncoded = Buffer.from(JSON.stringify(settlement)).toString("base64");
    reply.header(X402_HEADERS.PAYMENT_RESPONSE, responseEncoded);

    console.log(`⚡ x402 payment: ${settlement.payer} paid ${config.amountSTX} STX → ${req.method} ${req.url} (tx: ${settlement.transaction})`);
  };
}

/**
 * Get x402 settlement info from a paid request
 */
export function getPaymentInfo(req: FastifyRequest): SettlementResponseV2 | undefined {
  return (req as any).x402;
}

// Export config for reference
export { NETWORK, PAY_TO, FACILITATOR_URL };
