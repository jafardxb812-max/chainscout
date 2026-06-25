import { NextRequest, NextResponse } from 'next/server';
import { ETHERSCAN_API_URLS, isValidEVMAddress } from '@/utils/wallet';

// GET /api/wallet/transactions?chain_id=1&address=0x...&page=1&offset=50&sort=desc
// sort: 'asc' (oldest first) | 'desc' (newest first, default)
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const chainId  = searchParams.get('chain_id');
  const address  = searchParams.get('address');
  const page     = searchParams.get('page')   ?? '1';
  const offset   = searchParams.get('offset') ?? '50';   // records per page
  const sort     = searchParams.get('sort')   ?? 'desc'; // asc | desc

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

  const url = new URL(baseUrl);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'txlist');
  url.searchParams.set('address', address);
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

  const transactions = Array.isArray(data.result) ? data.result : [];

  return NextResponse.json({
    chain_id: chainId,
    address,
    page: parseInt(page),
    offset: parseInt(offset),
    sort,
    count: transactions.length,
    has_more: transactions.length === parseInt(offset),
    transactions,
  });
}
