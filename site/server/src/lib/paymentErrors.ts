// Payment-domain error types shared by provider/state machine/refund code.

export class PaymentStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentStateError";
  }
}

export class PaymentRefundError extends Error {
  constructor(
    message: string,
    public readonly status: number = 409,
    public readonly code: string = "refund_error"
  ) {
    super(message);
    this.name = "PaymentRefundError";
  }
}
