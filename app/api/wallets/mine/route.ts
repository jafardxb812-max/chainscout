import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  VERIFIED_TOKENS,
  ETHERSCAN_API_URLS,
  getRpcUrl,
  ERC20_ABI,
  COINGECKO_PLATFORMS,
  loadWallets,
  addWallet,
  sleep,
  getReceiverAddress,
} from '@/utils/wallet';

const COINGECKO = 'https://api.coingecko.com/api/v3';

type ChainBalance = {
  chain_id: string;
  usdt_balance: string;
  usdt_address: string;
  price_usd: number | null;
  balance_usd: string | null;
};

async function fetchUsdtPrice(chainId: string): Promise<number | null> {
  const platform = COINGECKO_PLATFORMS[chainId];
  const usdtContract = VERIFIED_TOKENS.USDT[chainId];
  if (!platform || !usdtContract) return null;
  try {
    const res = await fetch(
      `${COINGECKO}/simple/token_price/${platform}?contract_addresses=${usdtContract.toLowerCase()}&vs_currencies=usd`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data[usdtContract.toLowerCase()]?.usd ?? null;
  } catch {
    return null;
  }
}

async function getUsdtBalance(address: string, chainId: string): Promise<string | null> {
  const rpcUrl = getRpcUrl(chainId);
  const usdtContract = VERIFIED_TOKENS.USDT[chainId];
  if (!rpcUrl || !usdtContract) return null;
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contract = new ethers.Contract(usdtContract, ERC20_ABI, provider);
    const [raw, dec]: [bigint, number] = await Promise.all([
      contract.balanceOf(address),
      contract.decimals(),
    ]);
    return ethers.formatUnits(raw, dec);
  } catch {
    return null;
  }
}

// GET /api/wallets/mine
// Returns the server wallet address, USDT balance on every supported chain,
// and whether it is already in the tracked wallets list.
export async function GET() {
  const address = getReceiverAddress();
  if (!address) {
    return NextResponse.json(
      { error: 'WALLET_PRIVATE_KEY not set in .env.local' },
      { status: 500 }
    );
  }


  // Chains that have a known USDT contract
  const supportedChains = Object.keys(VERIFIED_TOKENS.USDT);

  // Fetch balances in parallel batches
  const BATCH = 4;
  const balances: ChainBalance[] = [];

  for (let i = 0; i < supportedChains.length; i += BATCH) {
    const batch = supportedChains.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (chainId) => {
        const [balanceStr, price] = await Promise.all([
          getUsdtBalance(address, chainId),
          fetchUsdtPrice(chainId),
        ]);
        if (balanceStr === null) return null;
        const balance_usd =
          price !== null ? (parseFloat(balanceStr) * price).toFixed(2) : null;
        return {
          chain_id: chainId,
          usdt_balance: balanceStr,
          usdt_address: VERIFIED_TOKENS.USDT[chainId],
          price_usd: price,
          balance_usd,
        } satisfies ChainBalance;
      })
    );
    for (const r of results) if (r !== null) balances.push(r);
    if (i + BATCH < supportedChains.length) await sleep(100);
  }

  // Total USD across all chains
  const total_usd = balances
    .reduce((sum, b) => sum + (b.balance_usd ? parseFloat(b.balance_usd) : 0), 0)
    .toFixed(2);

  // Is this wallet already tracked?
  const tracked = await loadWallets();
  const already_tracked = tracked.some(
    (w) => w.address.toLowerCase() === address.toLowerCase()
  );

  return NextResponse.json({
    address,
    already_tracked,
    total_usdt_usd: total_usd,
    balances: balances.filter((b) => parseFloat(b.usdt_balance) > 0), // non-zero only
    all_balances: balances,
  });
}

// POST /api/wallets/mine/track
// Auto-adds the server wallet into the tracked wallets list.
export async function POST() {
  const address = getReceiverAddress();
  if (!address) {
    return NextResponse.json({ error: 'RECEIVER_WALLET_ADDRESS not set' }, { status: 500 });
  }

  const chainIds = Object.keys(VERIFIED_TOKENS.USDT); // track on all USDT-supported chains

  const entry = await addWallet(address, 'My Server Wallet', chainIds);
  return NextResponse.json({ wallet: entry, message: 'Server wallet added to tracking list' });
}
