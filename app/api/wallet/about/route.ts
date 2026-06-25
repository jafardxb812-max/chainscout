import { NextRequest, NextResponse } from 'next/server';
import { isValidEVMAddress, fetchCoinAbout, resolveTokenAddress } from '@/utils/wallet';

// GET /api/wallet/about?token=usdt
// GET /api/wallet/about?token=0xdAC17F...&chain_id=1
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const token   = searchParams.get('token');
  const chainId = searchParams.get('chain_id') ?? undefined;

  if (!token) {
    return NextResponse.json({ error: 'Missing: token (e.g. usdt, eth, or 0x contract address)' }, { status: 400 });
  }

  let contractAddress: string | undefined;
  if (isValidEVMAddress(token) && chainId) {
    contractAddress = token;
  } else if (chainId) {
    const resolved = resolveTokenAddress(token, chainId);
    contractAddress = resolved ?? undefined;
  }

  const about = await fetchCoinAbout(token, chainId, contractAddress);

  if (!about) {
    return NextResponse.json(
      { error: `Could not find coin data for '${token}'. Try the CoinGecko coin ID (e.g. 'tether', 'usd-coin', 'ethereum').` },
      { status: 404 }
    );
  }

  return NextResponse.json({ about });
}
