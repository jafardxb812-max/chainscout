import { NextRequest, NextResponse } from 'next/server';
import { ETHERSCAN_API_URLS, isValidEVMAddress, resolveTokenAddress } from '@/utils/wallet';

// GET /api/wallet/token-transfers?chain_id=1&address=0x...&token=usdt&page=1&offset=50
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const chainId    = searchParams.get('chain_id');
  const address    = searchParams.get('address');
  const tokenParam = searchParams.get('token'); // 'usdt' | '0x...' | null (all ERC-20)
  const page       = searchParams.get('page')   ?? '1';
  const offset     = searchParams.get('offset') ?? '50';
  const sort       = searchParams.get('sort')   ?? 'desc';

  if (!chainId) return NextResponse.json({ error: 'Missing: chain_id' }, { status: 400 });
  if (!address || !isValidEVMAddress(address)) {
    return NextResponse.json({ error: 'Missing or invalid: address' }, { status: 400 });
  }

  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ETHERSCAN_API_KEY not set. Get a free key at https://etherscan.io/apis' },
      { status: 500 }
    );
  }

  const baseUrl = ETHERSCAN_API_URLS[chainId];
  if (!baseUrl) {
    return NextResponse.json(
      { error: `Etherscan not supported for chain_id '${chainId}'` },
      { status: 404 }
    );
  }

  // Resolve token contract address if provided
  let tokenAddress: string | null = null;
  if (tokenParam) {
    tokenAddress = resolveTokenAddress(tokenParam, chainId);
    if (!tokenAddress) {
      return NextResponse.json(
        { error: `Unknown token '${tokenParam}'. Use 'usdt' or a 0x contract address` },
        { status: 400 }
      );
    }
  }

  const url = new URL(baseUrl);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'tokentx');
  url.searchParams.set('address', address);
  if (tokenAddress) url.searchParams.set('contractaddress', tokenAddress);
  url.searchParams.set('startblock', '0');
  url.searchParams.set('endblock', '99999999');
  url.searchParams.set('page', page);
  url.searchParams.set('offset', offset);
  url.searchParams.set('sort', sort);
  url.searchParams.set('apikey', apiKey);

  let data: { status: string; message: string; result: unknown[] | string };
  try {
    const res = await fetch(url.toString(), { next: { revalidate: 30 } });
    data = await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Etherscan request failed: ${msg}` }, { status: 502 });
  }

  if (data.status === '0' && data.message !== 'No transactions found') {
    return NextResponse.json({ error: `Etherscan error: ${data.message}` }, { status: 502 });
  }

  const transfers = Array.isArray(data.result) ? data.result : [];

  return NextResponse.json({
    chain_id: chainId,
    address,
    token_filter: tokenAddress
      ? { address: tokenAddress, label: tokenParam?.toLowerCase() === 'usdt' ? 'USDT' : tokenAddress }
      : null,
    page: parseInt(page),
    offset: parseInt(offset),
    sort,
    count: transfers.length,
    has_more: transfers.length === parseInt(offset),
    transfers,
  });
}
