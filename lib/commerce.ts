export type SupportedCurrency = 'USD' | 'KES' | 'TZS';
export type InvoiceType = 'DEPOSIT' | 'BALANCE';
export type PaymentLifecycleStatus =
  | 'pending'
  | 'pending_review'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'reversed';

export type CommercialLineItemInput = {
  type: string;
  itemId?: string;
  itemName: string;
  catalogPackageId?: string;
  departureId?: string;
  quantity: number;
  pricePerUnit: number;
  subtotal: number;
  dateFrom?: string;
  dateTo?: string;
  specialRequests?: string;
};

export const DEFAULT_DEPOSIT_PERCENTAGE = 30;

export function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildPriceBreakdown(totalAmount: number, currency: SupportedCurrency) {
  const total = roundCurrency(totalAmount);

  return {
    basePrice: total,
    serviceFee: 0,
    taxes: 0,
    total,
    currency,
  };
}

export function calculateDepositBreakdownFromAmount(totalAmount: number, rawDepositAmount: number) {
  const boundedTotal = Math.max(roundCurrency(totalAmount), 0);
  const boundedDepositAmount = Math.min(Math.max(roundCurrency(rawDepositAmount), 0), boundedTotal);
  const balanceAmount = roundCurrency(boundedTotal - boundedDepositAmount);
  const depositPercentage = boundedTotal > 0 ? roundCurrency((boundedDepositAmount / boundedTotal) * 100) : 0;

  return {
    depositPercentage,
    depositAmount: boundedDepositAmount,
    balanceAmount,
  };
}

export function buildQuoteLineItems(items: CommercialLineItemInput[]) {
  return items.map((item) => ({
    label: item.itemName,
    quantity: item.quantity,
    unitAmount: roundCurrency(item.pricePerUnit),
    amount: roundCurrency(item.subtotal),
  }));
}

export function splitAmountEvenly(totalAmount: number, count: number) {
  if (count <= 0) {
    return [];
  }

  const roundedTotal = roundCurrency(Math.max(totalAmount, 0));
  const cents = Math.round(roundedTotal * 100);
  const baseShare = Math.floor(cents / count);
  const remainder = cents % count;

  return Array.from({ length: count }, (_, index) => (baseShare + (index < remainder ? 1 : 0)) / 100);
}

export function generateBookingReference() {
  return `MV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function generateQuoteNumber() {
  return `MVQ-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function generateInvoiceNumber(type: InvoiceType) {
  const prefix = type === 'BALANCE' ? 'MVB' : 'MVD';
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export function mapInvoiceToBookingStatus(
  invoiceType: InvoiceType,
  paymentStatus: PaymentLifecycleStatus
): {
  bookingStatus: string;
  bookingPaymentStatus: string;
} {
  if (paymentStatus === 'completed') {
    if (invoiceType === 'BALANCE') {
      return {
        bookingStatus: 'paid_in_full',
        bookingPaymentStatus: 'paid_in_full',
      };
    }

    return {
      bookingStatus: 'confirmed',
      bookingPaymentStatus: 'deposit_paid',
    };
  }

  if (paymentStatus === 'reversed') {
    return {
      bookingStatus: 'refunded',
      bookingPaymentStatus: 'refunded',
    };
  }

  if (paymentStatus === 'failed' || paymentStatus === 'cancelled') {
    return {
      bookingStatus: invoiceType === 'BALANCE' ? 'balance_pending' : 'deposit_pending',
      bookingPaymentStatus: 'failed',
    };
  }

  if (paymentStatus === 'pending_review') {
    return {
      bookingStatus: invoiceType === 'BALANCE' ? 'balance_pending' : 'deposit_pending',
      bookingPaymentStatus: 'pending_review',
    };
  }

  return {
    bookingStatus: invoiceType === 'BALANCE' ? 'balance_pending' : 'deposit_pending',
    bookingPaymentStatus: invoiceType === 'BALANCE' ? 'balance_due' : 'deposit_due',
  };
}
