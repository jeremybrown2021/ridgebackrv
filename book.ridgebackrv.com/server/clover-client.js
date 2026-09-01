const REQUEST_TIMEOUT_MS = 20_000;

export class CloverGatewayError extends Error {
  constructor(message, { status = 502, retryable = false, code = "clover_error" } = {}) {
    super(message);
    this.name = "CloverGatewayError";
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

function gatewayMessage(status, body) {
  const declineMessage = body?.message || body?.error?.message || body?.error?.decline_code;
  if (status === 402 || body?.paid === false) {
    return typeof declineMessage === "string" && declineMessage.length <= 180
      ? declineMessage
      : "The card was declined. Try another payment method or contact your card issuer.";
  }
  if (status === 400 || status === 422) {
    return "Clover could not process these payment details. Review the card information and try again.";
  }
  return "Clover is temporarily unavailable. No new payment attempt should be started until this one is retried.";
}

export class CloverClient {
  constructor(config, fetchImplementation = globalThis.fetch) {
    this.config = config;
    this.fetch = fetchImplementation;
  }

  async createCharge({ quote, source, guest, idempotencyKey, clientIp }) {
    const reference = `RB${quote.quoteId.slice(0, 10).toUpperCase()}`;
    const response = await this.fetch(`${this.config.apiBaseUrl}/v1/charges`, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.config.privateToken}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        "user-agent": "ridgeback-booking/1.0",
        "x-forwarded-for": clientIp,
      },
      body: JSON.stringify({
        amount: quote.pricing.totalCents,
        currency: quote.pricing.currency,
        source,
        capture: true,
        ecomind: "ecom",
        description: `${quote.pricing.siteLabel} reservation`,
        external_reference_id: reference,
        external_customer_reference: quote.quoteId,
        receipt_email: guest.email,
        tax_amount: quote.pricing.taxCents,
        metadata: {
          quote_id: quote.quoteId,
          arrival: quote.booking.arrival,
          nights: String(quote.booking.nights),
          sites: String(quote.booking.sites),
          site_type: quote.booking.siteType,
        },
      }),
    }).catch((error) => {
      throw new CloverGatewayError(
        error.name === "TimeoutError"
          ? "Clover did not confirm the payment before the request timed out. Retry this same payment attempt."
          : "The connection to Clover was interrupted. Retry this same payment attempt.",
        { retryable: true, code: "clover_connection_unknown" },
      );
    });

    let body = {};
    try {
      body = await response.json();
    } catch {
      if (response.ok) {
        throw new CloverGatewayError("Clover returned an unreadable payment response.", {
          retryable: true,
          code: "clover_response_unknown",
        });
      }
    }

    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
      throw new CloverGatewayError(gatewayMessage(response.status, body), {
        status: response.status === 402 ? 402 : retryable ? 502 : 400,
        retryable,
        code: response.status === 402 ? "card_declined" : retryable ? "clover_unavailable" : "payment_invalid",
      });
    }

    if (body.paid !== true || body.captured !== true || !body.id) {
      throw new CloverGatewayError("Clover did not return a captured payment confirmation.", {
        retryable: true,
        code: "payment_confirmation_unknown",
      });
    }

    return {
      ok: true,
      paymentId: body.id,
      reference,
      amountCents: body.amount,
      currency: body.currency,
      paid: true,
      captured: true,
      card: body.source
        ? { brand: body.source.brand, last4: body.source.last4 }
        : undefined,
    };
  }
}
