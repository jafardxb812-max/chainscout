import { NextRequest, NextResponse } from 'next/server';
import {
  isValidTronAddress,
  getTrc20Balance,
  getTrc20Transactions,
  TRON_USDT_CONTRACT,
} from '@/utils/tron';

// GET /api/wallet/tron?address=TYour...
// Returns TRC20 USDT balance + recent transfers for a TRON address
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');

  if (!address || !isValidTronAddress(address)) {
    return NextResponse.json(
      { error: 'Missing or invalid TRON address (must start with T, 34 chars)' },
      { status: 400 }
    );
  }

  const [balance, transactions] = await Promise.all([
    getTrc20Balance(address),
    getTrc20Transactions(address, 20),
  ]);

  const enriched = (transactions as Array<{
    transaction_id: string;
    block_timestamp: number;
    from: string;
    to: string;
    value: string;
    token_info: { decimals: number; symbol: string; name: string };
  }>).map((tx) => {
    const dec = tx.token_info?.decimals ?? 6;
    const raw = BigInt(tx.value ?? '0');
    const div = BigInt(10 ** dec);
    const whole = raw / div;
    const frac  = (raw % div).toString().padStart(dec, '0').replace(/0+$/, '');
    const amount = frac ? `${whole}.${frac}` : `${whole}`;

    return {
      tx_id:     tx.transaction_id,
      date:      new Date(tx.block_timestamp).toISOString(),
      from:      tx.from,
      to:        tx.to,
      direction: tx.to === address ? 'incoming' : 'outgoing',
      amount,
      symbol:    tx.token_info?.symbol ?? 'USDT',
      tronscan_url: `https://tronscan.org/#/transaction/${tx.transaction_id}`,
    };
  });

  return NextResponse.json({
    network:          'TRON (TRC20)',
    address,
    usdt_contract:    TRON_USDT_CONTRACT,
    tronscan_url:     `https://tronscan.org/#/address/${address}`,
    usdt_balance:     balance ?? '0',
    recent_transfers: enriched,
  });
}
