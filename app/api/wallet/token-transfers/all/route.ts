import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { Chains } from '@/types';

const USDT_CONTRACTS: Record<string, string> = {
  '1': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  '10': '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
  '56': '0x55d398326f99059fF775485246999027B3197955',
  '137': '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  '42161': '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  '43114': '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
  '8453': '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  '324': '0x493257fD37EDB34451f62EDf8D2a0C418852bA4',
  '1101': '0x1E4a5963aBFD975d8c9021ce480b42188849D41d',
};

type TokenTransfer = {
  tx_hash: string;
  timestamp: string;
  from: { hash: string };
  to: { hash: string };
  token: {
    name: string;
    symbol: string;
    decimals: string;
    address: string;
    type: string;
  };
  total: { value: string; decimals: string };
  type: string;
};

type BlockscoutTokenTransferResponse = {
  items: TokenTransfer[];
  next_page_params: Record<string, unknown> | null;
};

const MAX_PAGES = 50;

function isValidEVMAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

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

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const chainId = searchParams.get('chain_id');
  const address = searchParams.get('address');
  const tokenParam = searchParams.get('token');

  if (!chainId) {
    return NextResponse.json({ error: 'Missing required parameter: chain_id' }, { status: 400 });
  }
  if (!address) {
    return NextResponse.json({ error: 'Missing required parameter: address' }, { status: 400 });
  }
  if (!isValidEVMAddress(address)) {
    return NextResponse.json({ error: 'Invalid EVM wallet address format' }, { status: 400 });
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

  let tokenAddress: string | null = null;
  let tokenLabel: string | null = null;
  if (tokenParam) {
    if (tokenParam.toLowerCase() === 'usdt') {
      tokenAddress = USDT_CONTRACTS[chainId] ?? null;
      tokenLabel = 'USDT';
      if (!tokenAddress) {
        return NextResponse.json(
          { error: `USDT contract not known for chain '${chain.name}'. Use ?token=0x... with the contract address.` },
          { status: 400 }
        );
      }
    } else if (isValidEVMAddress(tokenParam)) {
      tokenAddress = tokenParam;
      tokenLabel = tokenParam;
    } else {
      return NextResponse.json(
        { error: "token must be 'usdt' or a valid contract address (0x...)" },
        { status: 400 }
      );
    }
  }

  const baseUrl = explorer.url.replace(/\/$/, '');
  const buildUrl = (pageParams: Record<string, unknown> | null) => {
    const url = new URL(`${baseUrl}/api/v2/addresses/${address}/token-transfers`);
    url.searchParams.set('type', 'ERC-20');
    if (tokenAddress) url.searchParams.set('token', tokenAddress);
    if (pageParams) {
      for (const [k, v] of Object.entries(pageParams)) {
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  };

  const allTransfers: TokenTransfer[] = [];
  let pageParams: Record<string, unknown> | null = null;
  let pages = 0;
  let truncated = false;

  try {
    do {
      const res = await fetch(buildUrl(pageParams), { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Explorer returned ${res.status}`);
      const data: BlockscoutTokenTransferResponse = await res.json();
      allTransfers.push(...data.items);
      pageParams = data.next_page_params ?? null;
      pages++;
      if (pages >= MAX_PAGES && pageParams !== null) {
        truncated = true;
        break;
      }
    } while (pageParams !== null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to fetch transfers: ${msg}` }, { status: 502 });
  }

  // Sort oldest-first: complete fund journey from first to last
  allTransfers.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Enrich each transfer with a human-readable amount and direction
  const walletLower = address.toLowerCase();
  const enriched = allTransfers.map((t) => {
    const direction = t.from.hash.toLowerCase() === walletLower ? 'outgoing' : 'incoming';
    const decimals = t.token?.decimals ?? '0';
    const amountFormatted = formatTokenAmount(t.total?.value ?? '0', decimals);
    return { ...t, direction, amount_formatted: amountFormatted };
  });

  // Summary stats
  const incoming = enriched.filter((t) => t.direction === 'incoming');
  const outgoing = enriched.filter((t) => t.direction === 'outgoing');

  return NextResponse.json({
    chain_id: chainId,
    chain_name: chain.name,
    explorer_url: explorer.url,
    address,
    token_filter: tokenAddress ? { address: tokenAddress, label: tokenLabel } : null,
    summary: {
      total_transfers: enriched.length,
      incoming_count: incoming.length,
      outgoing_count: outgoing.length,
    },
    truncated,
    transfers: enriched,
  });
}
