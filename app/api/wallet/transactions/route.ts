import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { Chains } from '@/types';

// Blockscout v2 API response types
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
  confirmation_duration: number[];
  confirmations: number;
  nonce: number;
  type: number;
  result: string;
  revert_reason: string | null;
};

type BlockscoutTxResponse = {
  items: BlockscoutTransaction[];
  next_page_params: { block_number: number; index: number; items_count: number } | null;
};

function isValidEVMAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

function getExplorerBaseUrl(url: string): string {
  // Strip trailing slash
  return url.replace(/\/$/, '');
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const chainId = searchParams.get('chain_id');
  const address = searchParams.get('address');
  const filter = searchParams.get('filter') ?? 'all'; // 'to' | 'from' | 'all'
  const pageToken = searchParams.get('page_token'); // opaque token from previous response

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

  // Load chain data
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

  const baseUrl = getExplorerBaseUrl(explorer.url);

  // Build Blockscout v2 API URL
  const apiUrl = new URL(`${baseUrl}/api/v2/addresses/${address}/transactions`);
  if (filter !== 'all') {
    apiUrl.searchParams.set('filter', filter);
  }

  // Decode page_token (it's a JSON object passed back from the previous response)
  if (pageToken) {
    try {
      const decoded: Record<string, string> = JSON.parse(Buffer.from(pageToken, 'base64url').toString('utf8'));
      for (const [k, v] of Object.entries(decoded)) {
        apiUrl.searchParams.set(k, String(v));
      }
    } catch {
      return NextResponse.json({ error: 'Invalid page_token' }, { status: 400 });
    }
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(apiUrl.toString(), {
      headers: { Accept: 'application/json' },
      next: { revalidate: 30 },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to reach explorer: ${msg}` }, { status: 502 });
  }

  if (!upstreamRes.ok) {
    return NextResponse.json(
      { error: `Explorer returned ${upstreamRes.status}: ${upstreamRes.statusText}` },
      { status: upstreamRes.status >= 500 ? 502 : upstreamRes.status }
    );
  }

  const data: BlockscoutTxResponse = await upstreamRes.json();

  // Encode next_page_params into an opaque base64url token
  const nextPageToken = data.next_page_params
    ? Buffer.from(JSON.stringify(data.next_page_params), 'utf8').toString('base64url')
    : null;

  return NextResponse.json({
    chain_id: chainId,
    chain_name: chain.name,
    explorer_url: explorer.url,
    address,
    filter,
    transactions: data.items,
    next_page_token: nextPageToken,
    has_more: nextPageToken !== null,
  });
}
