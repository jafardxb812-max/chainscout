import { NextRequest, NextResponse } from 'next/server';
import { ETHERSCAN_API_URLS, isValidEVMAddress, resolveTokenAddress, sleep } from '@/utils/wallet';

type EtherscanTokenTransfer = {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
  contractAddress: string;
  gas: string;
  gasPrice: string;
  gasUsed: string;
  confirmations: string;
};

const PAGE_SIZE = 10000;
const MAX_PAGES = 10;

function formatTokenAmount(value: string, decimals: string): string {
  const dec = parseInt(decimals, 10);
  if (isNaN(dec) || dec === 0) return value;
  const bigVal = BigInt(value);
  const divisor = BigInt(10 ** dec);
  const whole = bigVal / divisor;
  const remainder = bigVal % divisor;
  const fracStr = remainder.toString().padStart(dec, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

// GET /api/wallet/token-transfers/all?chain_id=1&address=0x...&token=usdt
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const chainId    = searchParams.get('chain_id');
  const address    = searchParams.get('address');
  const tokenParam = searchParams.get('token');
  const sort       = searchParams.get('sort') ?? 'asc';

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

  const allTransfers: EtherscanTokenTransfer[] = [];
  let page = 1;
  let truncated = false;

  try {
    while (true) {
      const url = new URL(baseUrl);
      url.searchParams.set('module', 'account');
      url.searchParams.set('action', 'tokentx');
      url.searchParams.set('address', address);
      if (tokenAddress) url.searchParams.set('contractaddress', tokenAddress);
      url.searchParams.set('startblock', '0');
      url.searchParams.set('endblock', '99999999');
      url.searchParams.set('page', String(page));
      url.searchParams.set('offset', String(PAGE_SIZE));
      url.searchParams.set('sort', 'asc');
      url.searchParams.set('apikey', apiKey);

      const res = await fetch(url.toString());
      const data: { status: string; message: string; result: EtherscanTokenTransfer[] | string } =
        await res.json();

      if (data.status === '0' && data.message !== 'No transactions found') {
        return NextResponse.json({ error: `Etherscan error: ${data.message}` }, { status: 502 });
      }

      const batch = Array.isArray(data.result) ? data.result : [];
      allTransfers.push(...batch);

      if (batch.length < PAGE_SIZE) break;
      if (page >= MAX_PAGES) { truncated = true; break; }
      page++;
      await sleep(250); // stay under Etherscan free-tier 5 req/s limit
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Etherscan request failed: ${msg}` }, { status: 502 });
  }

  if (sort === 'desc') allTransfers.reverse();

  const walletLower = address.toLowerCase();

  const enriched = allTransfers.map((t) => ({
    ...t,
    direction:        t.from.toLowerCase() === walletLower ? 'outgoing' : 'incoming',
    amount_formatted: formatTokenAmount(t.value, t.tokenDecimal),
  }));

  const incoming = enriched.filter((t) => t.direction === 'incoming');
  const outgoing = enriched.filter((t) => t.direction === 'outgoing');

  return NextResponse.json({
    chain_id: chainId,
    address,
    token_filter: tokenAddress
      ? { address: tokenAddress, label: tokenParam?.toLowerCase() === 'usdt' ? 'USDT' : tokenAddress }
      : null,
    sort,
    summary: {
      total_transfers: enriched.length,
      incoming_count:  incoming.length,
      outgoing_count:  outgoing.length,
    },
    truncated,
    transfers: enriched,
  });
}
