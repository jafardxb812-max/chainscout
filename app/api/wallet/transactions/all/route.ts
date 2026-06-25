import { NextRequest, NextResponse } from 'next/server';
import { ETHERSCAN_API_URLS, isValidEVMAddress, sleep } from '@/utils/wallet';

type EtherscanTx = {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;         // in wei
  gas: string;
  gasPrice: string;
  gasUsed: string;
  isError: string;       // '0' = success, '1' = failed
  txreceipt_status: string;
  methodId: string;
  functionName: string;
  confirmations: string;
  nonce: string;
  input: string;
};

const PAGE_SIZE = 10000; // Etherscan max per call
const MAX_PAGES = 10;    // 100k transactions cap

function weiToEther(wei: string): string {
  const val = BigInt(wei);
  const eth = val / BigInt(1e15);
  const frac = eth % 1000n;
  const whole = eth / 1000n;
  return frac === 0n ? `${whole}` : `${whole}.${frac.toString().padStart(3, '0').replace(/0+$/, '')}`;
}

// GET /api/wallet/transactions/all?chain_id=1&address=0x...&sort=asc
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const chainId = searchParams.get('chain_id');
  const address = searchParams.get('address');
  const sort    = searchParams.get('sort') ?? 'asc'; // oldest-first by default

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

  const allTxs: EtherscanTx[] = [];
  let page = 1;
  let truncated = false;

  try {
    while (true) {
      const url = new URL(baseUrl);
      url.searchParams.set('module', 'account');
      url.searchParams.set('action', 'txlist');
      url.searchParams.set('address', address);
      url.searchParams.set('startblock', '0');
      url.searchParams.set('endblock', '99999999');
      url.searchParams.set('page', String(page));
      url.searchParams.set('offset', String(PAGE_SIZE));
      url.searchParams.set('sort', 'asc');
      url.searchParams.set('apikey', apiKey);

      const res = await fetch(url.toString());
      const data: { status: string; message: string; result: EtherscanTx[] | string } =
        await res.json();

      if (data.status === '0' && data.message !== 'No transactions found') {
        return NextResponse.json({ error: `Etherscan error: ${data.message}` }, { status: 502 });
      }

      const batch = Array.isArray(data.result) ? data.result : [];
      allTxs.push(...batch);

      if (batch.length < PAGE_SIZE) break; // last page
      if (page >= MAX_PAGES) { truncated = true; break; }
      page++;
      await sleep(250); // stay under Etherscan free-tier 5 req/s limit
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Etherscan request failed: ${msg}` }, { status: 502 });
  }

  // Apply requested sort (default: asc = oldest first = fund journey start→end)
  if (sort === 'desc') allTxs.reverse();

  const walletLower = address.toLowerCase();

  // Enrich each tx with direction + human-readable ETH value
  const enriched = allTxs.map((tx) => ({
    ...tx,
    direction:     tx.from.toLowerCase() === walletLower ? 'outgoing' : 'incoming',
    value_eth:     weiToEther(tx.value),
    status:        tx.isError === '0' ? 'success' : 'failed',
  }));

  const incoming = enriched.filter((t) => t.direction === 'incoming' && t.status === 'success');
  const outgoing = enriched.filter((t) => t.direction === 'outgoing' && t.status === 'success');

  return NextResponse.json({
    chain_id: chainId,
    address,
    sort,
    summary: {
      total: enriched.length,
      incoming: incoming.length,
      outgoing: outgoing.length,
      failed: enriched.filter((t) => t.status === 'failed').length,
    },
    truncated,
    transactions: enriched,
  });
}
