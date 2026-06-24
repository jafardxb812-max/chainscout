import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  loadWallets,
  ETHERSCAN_API_URLS,
  VERIFIED_TOKENS,
  StoredWallet,
  sleep,
} from '@/utils/wallet';

type EtherscanTransfer = {
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
  gasUsed: string;
  gasPrice: string;
  confirmations: string;
};

type Activity = EtherscanTransfer & {
  wallet_id: string;
  wallet_label: string;
  wallet_address: string;
  chain_id: string;
  direction: 'incoming' | 'outgoing';
  amount_formatted: string;
  timestamp_iso: string;
  token_verified: boolean;
};

function formatAmount(value: string, decimals: string): string {
  const dec = parseInt(decimals, 10);
  if (isNaN(dec) || dec === 0) return value;
  const big = BigInt(value);
  const div = BigInt(10 ** dec);
  const whole = big / div;
  const frac = (big % div).toString().padStart(dec, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function isVerifiedUsdt(contractAddress: string, chainId: string): boolean {
  const official = VERIFIED_TOKENS.USDT[chainId];
  return !!official && official.toLowerCase() === contractAddress.toLowerCase();
}

async function fetchUsdtTransfers(
  wallet: StoredWallet,
  chainId: string,
  apiKey: string
): Promise<Activity[]> {
  const baseUrl = ETHERSCAN_API_URLS[chainId];
  if (!baseUrl) return [];

  const usdtContract = VERIFIED_TOKENS.USDT[chainId];
  if (!usdtContract) return [];

  const url = new URL(baseUrl);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'tokentx');
  url.searchParams.set('address', wallet.address);
  url.searchParams.set('contractaddress', usdtContract);
  url.searchParams.set('startblock', '0');
  url.searchParams.set('endblock', '99999999');
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('offset', '200');
  url.searchParams.set('page', '1');
  url.searchParams.set('apikey', apiKey);

  try {
    const res = await fetch(url.toString(), { next: { revalidate: 60 } });
    const data: { status: string; message: string; result: EtherscanTransfer[] | string } =
      await res.json();

    if (data.status === '0' || !Array.isArray(data.result)) return [];

    return data.result.map((tx) => ({
      ...tx,
      wallet_id: wallet.id,
      wallet_label: wallet.label,
      wallet_address: wallet.address,
      chain_id: chainId,
      direction: tx.from.toLowerCase() === wallet.address.toLowerCase() ? 'outgoing' : 'incoming',
      amount_formatted: formatAmount(tx.value, tx.tokenDecimal),
      timestamp_iso: new Date(parseInt(tx.timeStamp, 10) * 1000).toISOString(),
      token_verified: isVerifiedUsdt(tx.contractAddress, chainId),
    }));
  } catch {
    return [];
  }
}

// GET /api/wallets/activities?wallet_id=<id>&chain_id=1&sort=desc&limit=100&include_mine=true
// Omit wallet_id to get activities for ALL tracked wallets.
// include_mine=true also fetches from the WALLET_PRIVATE_KEY server wallet.
export async function GET(req: NextRequest) {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ETHERSCAN_API_KEY not set' },
      { status: 500 }
    );
  }

  const { searchParams } = req.nextUrl;
  const filterWalletId = searchParams.get('wallet_id');
  const filterChainId  = searchParams.get('chain_id');
  const sort           = searchParams.get('sort') ?? 'desc';
  const limit          = Math.min(parseInt(searchParams.get('limit') ?? '200', 10), 1000);
  const includeMine    = searchParams.get('include_mine') === 'true';

  let allWallets = await loadWallets();

  // Optionally inject the server wallet (WALLET_PRIVATE_KEY) without persisting it
  if (includeMine) {
    const pk = process.env.WALLET_PRIVATE_KEY;
    if (pk) {
      const serverAddress = new ethers.Wallet(pk).address;
      const alreadyIn = allWallets.some(
        (w) => w.address.toLowerCase() === serverAddress.toLowerCase()
      );
      if (!alreadyIn) {
        allWallets = [
          ...allWallets,
          {
            id: '__mine__',
            address: serverAddress,
            label: 'My Server Wallet',
            chain_ids: Object.keys(VERIFIED_TOKENS.USDT),
            added_at: new Date().toISOString(),
          },
        ];
      }
    }
  }
  if (allWallets.length === 0) {
    return NextResponse.json({ activities: [], total: 0, wallets_checked: 0 });
  }

  const wallets = filterWalletId
    ? allWallets.filter((w) => w.id === filterWalletId)
    : allWallets;

  if (wallets.length === 0) {
    return NextResponse.json({ error: 'Wallet not found' }, { status: 404 });
  }

  // Build list of (wallet, chainId) pairs to fetch
  const tasks: Array<{ wallet: StoredWallet; chainId: string }> = [];
  for (const wallet of wallets) {
    const chains = filterChainId ? [filterChainId] : wallet.chain_ids;
    for (const chainId of chains) {
      tasks.push({ wallet, chainId });
    }
  }

  // Fetch in small parallel batches — Etherscan allows 5 req/s
  const BATCH = 4;
  const allActivities: Activity[] = [];

  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(({ wallet, chainId }) => fetchUsdtTransfers(wallet, chainId, apiKey))
    );
    for (const r of results) allActivities.push(...r);
    if (i + BATCH < tasks.length) await sleep(250);
  }

  // Sort combined timeline
  allActivities.sort((a, b) => {
    const ta = parseInt(a.timeStamp, 10);
    const tb = parseInt(b.timeStamp, 10);
    return sort === 'asc' ? ta - tb : tb - ta;
  });

  const trimmed = allActivities.slice(0, limit);

  // Per-wallet summary
  const summaryMap: Record<string, { label: string; address: string; incoming: number; outgoing: number; chains: string[] }> = {};
  for (const act of trimmed) {
    if (!summaryMap[act.wallet_id]) {
      summaryMap[act.wallet_id] = {
        label: act.wallet_label,
        address: act.wallet_address,
        incoming: 0,
        outgoing: 0,
        chains: [],
      };
    }
    summaryMap[act.wallet_id][act.direction]++;
    if (!summaryMap[act.wallet_id].chains.includes(act.chain_id)) {
      summaryMap[act.wallet_id].chains.push(act.chain_id);
    }
  }

  return NextResponse.json({
    wallets_checked: wallets.length,
    chains_checked: [...new Set(tasks.map((t) => t.chainId))],
    sort,
    total: trimmed.length,
    summary_by_wallet: summaryMap,
    activities: trimmed,
  });
}
