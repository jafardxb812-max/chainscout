import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { Chains } from '@/types';

// Well-known USDT contract addresses per chain ID
const USDT_CONTRACTS: Record<string, string> = {
  '1': '0xdAC17F958D2ee523a2206206994597C13D831ec7',     // Ethereum
  '10': '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',    // Optimism
  '56': '0x55d398326f99059fF775485246999027B3197955',     // BNB Chain
  '137': '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',   // Polygon
  '42161': '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // Arbitrum One
  '43114': '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', // Avalanche
  '8453': '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',   // Base
  '324': '0x493257fD37EDB34451f62EDf8D2a0C418852bA4',     // zkSync Era
  '1101': '0x1E4a5963aBFD975d8c9021ce480b42188849D41d',   // Polygon zkEVM
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

function isValidEVMAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const chainId = searchParams.get('chain_id');
  const address = searchParams.get('address');
  // Optional: filter by specific token contract (e.g. USDT address)
  // Pass 'usdt' as a shorthand to auto-resolve the USDT contract for the chain
  const tokenParam = searchParams.get('token');
  const pageToken = searchParams.get('page_token');

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

  // Resolve token contract address
  let tokenAddress: string | null = null;
  if (tokenParam) {
    if (tokenParam.toLowerCase() === 'usdt') {
      tokenAddress = USDT_CONTRACTS[chainId] ?? null;
      if (!tokenAddress) {
        return NextResponse.json(
          { error: `USDT contract address not known for chain '${chain.name}' (chain_id: ${chainId}). Pass the token contract address directly via ?token=0x...` },
          { status: 400 }
        );
      }
    } else if (isValidEVMAddress(tokenParam)) {
      tokenAddress = tokenParam;
    } else {
      return NextResponse.json(
        { error: "token must be 'usdt' or a valid EVM contract address (0x...)" },
        { status: 400 }
      );
    }
  }

  const baseUrl = explorer.url.replace(/\/$/, '');
  const apiUrl = new URL(`${baseUrl}/api/v2/addresses/${address}/token-transfers`);
  // Filter to ERC-20 only (covers USDT and all fungible tokens)
  apiUrl.searchParams.set('type', 'ERC-20');
  if (tokenAddress) {
    apiUrl.searchParams.set('token', tokenAddress);
  }

  if (pageToken) {
    try {
      const decoded: Record<string, string> = JSON.parse(
        Buffer.from(pageToken, 'base64url').toString('utf8')
      );
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

  const data: BlockscoutTokenTransferResponse = await upstreamRes.json();

  const nextPageToken = data.next_page_params
    ? Buffer.from(JSON.stringify(data.next_page_params), 'utf8').toString('base64url')
    : null;

  return NextResponse.json({
    chain_id: chainId,
    chain_name: chain.name,
    explorer_url: explorer.url,
    address,
    token_filter: tokenAddress
      ? { address: tokenAddress, label: tokenParam?.toLowerCase() === 'usdt' ? 'USDT' : tokenAddress }
      : null,
    transfers: data.items,
    next_page_token: nextPageToken,
    has_more: nextPageToken !== null,
  });
}
