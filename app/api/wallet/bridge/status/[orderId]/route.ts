import { NextRequest, NextResponse } from 'next/server';

const CHANGENOW = 'https://api.changenow.io/v2';

// GET /api/wallet/bridge/status/[orderId]
// Track a ChangeNow exchange order by its ID
// orderId comes from /api/wallet/bridge/exchange response (bridge_order.id)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;

  const apiKey = process.env.CHANGENOW_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'CHANGENOW_API_KEY not set' }, { status: 500 });
  }

  if (!orderId || orderId.length < 5) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }

  const res = await fetch(`${CHANGENOW}/exchange/by-id?id=${encodeURIComponent(orderId)}`, {
    headers: {
      'x-changenow-api-key': apiKey,
      Accept: 'application/json',
    },
    next: { revalidate: 0 }, // always fresh
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json(
      { error: `ChangeNow status fetch failed: ${err}` },
      { status: res.status === 404 ? 404 : 502 }
    );
  }

  const order: {
    id: string;
    status: string;
    fromCurrency: string;
    toCurrency: string;
    fromNetwork: string;
    toNetwork: string;
    payinAddress: string;
    payoutAddress: string;
    fromAmount: number;
    toAmount: number;
    amountSend: number;
    amountReceive: number;
    payinHash?: string;
    payoutHash?: string;
    createdAt: string;
    validUntil?: string;
    updatedAt?: string;
  } = await res.json();

  // Map ChangeNow statuses to human-readable descriptions
  const STATUS_DESC: Record<string, string> = {
    waiting:    'Waiting for deposit — send funds to the deposit address',
    confirming: 'Deposit received — waiting for blockchain confirmations',
    exchanging: 'Funds confirmed — exchange in progress',
    sending:    'Exchange complete — sending to destination address',
    finished:   'Complete — funds delivered to destination',
    failed:     'Exchange failed — contact ChangeNow support',
    refunded:   'Refunded — funds returned to refund address',
    expired:    'Expired — deposit window has passed',
    overdue:    'Overdue — deposit received late, may still process',
    hold:       'On hold — additional verification required by ChangeNow',
  };

  const isComplete = order.status === 'finished';
  const isFailed   = ['failed', 'refunded', 'expired'].includes(order.status);

  return NextResponse.json({
    order_id: order.id,
    status:   order.status,
    status_description: STATUS_DESC[order.status] ?? order.status,
    is_complete: isComplete,
    is_failed:   isFailed,

    exchange: {
      from: {
        currency: order.fromCurrency,
        network:  order.fromNetwork,
        amount:   order.amountSend ?? order.fromAmount,
        deposit_address: order.payinAddress,
        tx_hash: order.payinHash ?? null,
      },
      to: {
        currency: order.toCurrency,
        network:  order.toNetwork,
        amount:   order.amountReceive ?? order.toAmount,
        recipient_address: order.payoutAddress,
        tx_hash: order.payoutHash ?? null,
      },
    },

    timestamps: {
      created_at:  order.createdAt,
      updated_at:  order.updatedAt ?? null,
      valid_until: order.validUntil ?? null,
    },

    track_url: `https://changenow.io/exchange/txs/${order.id}`,

    ...(order.payoutHash && {
      tron_tx_url: order.toCurrency?.toLowerCase().includes('trc20')
        ? `https://tronscan.org/#/transaction/${order.payoutHash}`
        : null,
    }),
  });
}
