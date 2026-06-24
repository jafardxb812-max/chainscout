import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { Chains } from '@/types';

type BlockscoutTransaction = {
  hash: string;
  timestamp: string;
  status: 'ok' | 'error';
  block: number;
  value: string;
  gas_price: string;
  gas_used: string;
  fee: { value: string; type: string };
  from: { hash: string };
  to: { hash: string } | null;
  method: string | null;
  tx_types: string[];
  confirmations: number;
  nonce: number;
  type: number;
  result: string;
  revert_reason: string | null;
};

type BlockscoutTxResponse = {
  items: BlockscoutTransaction[];
  next_page_params: Record<string, unknown> | null;
};

// Safety cap: maximum pages to fetch to avoid runaway requests for very active wallets
const MAX_PAGES = 50;

function isValidEVMAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

async function fetchPage(
  baseApiUrl: URL,
  pageParams: Record<string, unknown> | null
): Promise<BlockscoutTxResponse> {
  const url = new URL(baseApiUrl.toString());
  if (pageParams) {
    for (const [k, v] of Object.entries(pageParams)) {
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Explorer returned ${res.status}`);
  }
  return res.json();
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const chainId = searchParams.get('chain_id');
  const address = searchParams.get('address');
  const filter = searchParams.get('filter') ?? 'all';

  if (!chainId) {
    return NextResponse.json({ error: 'Missing required parameter: chain_id' }, { status: 400 });
  }
  if (!address) {
    return NextResponse.json({ error: 'Missing required parameter: address' }, { status: 400 });
  }
  if (!isValidEVMAddress(address)) {
    return NextResponse.json({ error: 'Invalid EVM wallet address format' }, { status: 400 });
  }
  if (!['to', 'from', 'all'].includes(filter)) {
    return NextResponse.json({ error: "filter must be 'to', 'from', or 'all'" }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), 'data', 'chains.json');
  let chainsData: Chains;
  try {
    chainsData = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return NextResponse.json({ error: 'Failed to load chains data' }, { status: 500 });
  }

  const chain = chainsData[chainId];
  if (!chain) {
    return NextResponse.json({ error: `Chain with id '${chainId}' not found` }, { status: 404 });
  }

  const explorer = chain.explorers?.[0];
  if (!explorer?.url) {
    return NextResponse.json({ error: `No explorer URL found for chain '${chain.name}'` }, { status: 404 });
  }

  const baseUrl = explorer.url.replace(/\/$/, '');
  const baseApiUrl = new URL(`${baseUrl}/api/v2/addresses/${address}/transactions`);
  if (filter !== 'all') {
    baseApiUrl.searchParams.set('filter', filter);
  }

  const allTransactions: BlockscoutTransaction[] = [];
  let pageParams: Record<string, unknown> | null = null;
  let pages = 0;
  let truncated = false;

  try {
    do {
      const page: BlockscoutTxResponse = await fetchPage(baseApiUrl, pageParams);
      allTransactions.push(...page.items);
      pageParams = page.next_page_params ?? null;
      pages++;

      if (pages >= MAX_PAGES && pageParams !== null) {
        truncated = true;
        break;
      }
    } while (pageParams !== null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to fetch transactions: ${msg}` }, { status: 502 });
  }

  // Sort oldest-first so callers see the full journey from first tx to last
  allTransactions.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  return NextResponse.json({
    chain_id: chainId,
    chain_name: chain.name,
    explorer_url: explorer.url,
    address,
    filter,
    total_fetched: allTransactions.length,
    truncated,
    truncated_at_page: truncated ? MAX_PAGES : null,
    transactions: allTransactions,
  });
}
