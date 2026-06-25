import { NextRequest, NextResponse } from 'next/server';
import { CHANGENOW_CURRENCIES } from '@/utils/tron';
import { isValidEVMAddress } from '@/utils/wallet';
import { isValidTronAddress } from '@/utils/tron';

// ChangeNow API v2 — https://changenow.io/api-docs
// Requires CHANGENOW_API_KEY in .env.local (free at changenow.io)
const CHANGENOW = 'https://api.changenow.io/v2';

// GET /api/wallet/bridge/quote
//   ?from=usdt-erc20   source network+token
//   ?to=usdt-trc20     destination network+token
//   ?amount=100        amount to convert
//
// Supported from/to values: usdt-erc20, usdt-trc20, usdt-bep20,
//   usdt-polygon, usdt-arbitrum, usdt-avax, eth, bnb, trx
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from   = searchParams.get('from');
  const to     = searchParams.get('to');
  const amount = searchParams.get('amount');

  if (!from || !to || !amount) {
    return NextResponse.json(
      { error: 'Required: from, to, amount  (e.g. from=usdt-erc20&to=usdt-trc20&amount=100)' },
      { status: 400 }
    );
  }

  const apiKey = process.env.CHANGENOW_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'CHANGENOW_API_KEY not set. Get a free key at https://changenow.io/api-docs' },
      { status: 500 }
    );
  }

  const fromCurrency = CHANGENOW_CURRENCIES[from.toLowerCase()];
  const toCurrency   = CHANGENOW_CURRENCIES[to.toLowerCase()];

  if (!fromCurrency) {
    return NextResponse.json(
      { error: `Unknown 'from' token: ${from}. Supported: ${Object.keys(CHANGENOW_CURRENCIES).join(', ')}` },
      { status: 400 }
    );
  }
  if (!toCurrency) {
    return NextResponse.json(
      { error: `Unknown 'to' token: ${to}. Supported: ${Object.keys(CHANGENOW_CURRENCIES).join(', ')}` },
      { status: 400 }
    );
  }

  // 1. Get minimum amount required
  const minUrl = new URL(`${CHANGENOW}/exchange/min-amount`);
  minUrl.searchParams.set('fromCurrency', fromCurrency);
  minUrl.searchParams.set('toCurrency',   toCurrency);
  minUrl.searchParams.set('flow',         'standard');

  // 2. Get estimated output
  const estUrl = new URL(`${CHANGENOW}/exchange/estimated-amount`);
  estUrl.searchParams.set('fromCurrency', fromCurrency);
  estUrl.searchParams.set('toCurrency',   toCurrency);
  estUrl.searchParams.set('fromAmount',   amount);
  estUrl.searchParams.set('flow',         'standard');
  estUrl.searchParams.set('type',         'direct');

  const headers = { 'x-changenow-api-key': apiKey, Accept: 'application/json' };

  const [minRes, estRes] = await Promise.all([
    fetch(minUrl.toString(), { headers, next: { revalidate: 60 } }),
    fetch(estUrl.toString(), { headers, next: { revalidate: 30 } }),
  ]);

  let minData: { minAmount?: number } = {};
  let estData: { toAmount?: number; validUntil?: string; warningMessage?: string } = {};

  if (minRes.ok) minData = await minRes.json();
  if (estRes.ok) estData = await estRes.json();

  if (!estData.toAmount) {
    const errText = !estRes.ok ? await estRes.text() : JSON.stringify(estData);
    return NextResponse.json(
      { error: `ChangeNow quote failed: ${errText}` },
      { status: 502 }
    );
  }

  const fromAmt = parseFloat(amount);
  const toAmt   = estData.toAmount;
  const rate    = toAmt / fromAmt;

  return NextResponse.json({
    from: {
      token:    from,
      currency: fromCurrency,
      amount:   fromAmt,
    },
    to: {
      token:    to,
      currency: toCurrency,
      estimated_amount: toAmt,
    },
    rate,
    minimum_amount: minData.minAmount ?? null,
    valid_until:    estData.validUntil ?? null,
    warning:        estData.warningMessage ?? null,
    note: `To execute: POST /api/wallet/bridge/exchange with the same params + recipient_address`,
  });
}
