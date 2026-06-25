import { NextRequest, NextResponse } from 'next/server';
import { ETHERSCAN_API_URLS, isValidEVMAddress, resolveTokenAddress, fetchEtherscan } from '@/utils/wallet';

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

  const params: Record<string, string> = {
    module: 'account', action: 'tokentx',
    address, startblock: '0', endblock: '99999999',
    page, offset, sort,
  };
  if (tokenAddress) params.contractaddress = tokenAddress;

  let data: { status: string; message: string; result: unknown[] | string };
  try {
    data = await fetchEtherscan(baseUrl, params, { ttlMs: 30_000 }) as typeof data;
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
