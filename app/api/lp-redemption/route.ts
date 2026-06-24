import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  getBSCProvider,
  getPairAddress,
  getLPRedemptionQuote,
  ADDRESSES,
} from '@/utils/pancakeswap-lp';

/**
 * GET /api/lp-redemption
 *
 * Query params:
 *   wallet        – wallet address to check LP balance for
 *   lpToken       – (optional) LP pair contract address; if omitted, resolves USDT/WBNB pair
 *   tokenA        – (optional) override tokenA for pair lookup
 *   tokenB        – (optional) override tokenB for pair lookup
 *
 * Returns a full redemption quote including expected token amounts.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const wallet = searchParams.get('wallet');
  let lpToken = searchParams.get('lpToken');
  const tokenA = searchParams.get('tokenA') ?? ADDRESSES.USDT;
  const tokenB = searchParams.get('tokenB') ?? ADDRESSES.WBNB;

  if (!wallet || !ethers.isAddress(wallet)) {
    return NextResponse.json({ error: 'Invalid or missing wallet address' }, { status: 400 });
  }

  try {
    const provider = await getBSCProvider();

    if (!lpToken) {
      lpToken = await getPairAddress(tokenA, tokenB, provider);
    } else if (!ethers.isAddress(lpToken)) {
      return NextResponse.json({ error: 'Invalid lpToken address' }, { status: 400 });
    }

    const quote = await getLPRedemptionQuote(wallet, lpToken, provider);
    return NextResponse.json({ success: true, quote });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
