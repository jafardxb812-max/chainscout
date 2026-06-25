import { NextRequest, NextResponse } from 'next/server';
import { ETHERSCAN_API_URLS, isValidEVMAddress, fetchEtherscan } from '@/utils/wallet';

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

  const baseUrl = ETHERSCAN_API_URLS[chainId];
  if (!baseUrl) {
    return NextResponse.json(
      { error: `Etherscan not supported for chain_id '${chainId}'` },
      { status: 404 }
    );
  }

  let data: { status: string; message: string; result: unknown[] | string };
  try {
    data = await fetchEtherscan(baseUrl, {
      module: 'account', action: 'txlist',
      address, startblock: '0', endblock: '99999999',
      page, offset, sort,
    }, { ttlMs: 30_000 }) as typeof data;
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
