import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  isValidEVMAddress,
  getRpcUrl,
  ETHERSCAN_API_URLS,
  COINGECKO_PLATFORMS,
  NATIVE_COIN_IDS,
  ERC20_ABI,
  getVerifiedSymbol,
  sleep,
} from '@/utils/wallet';

const COINGECKO = 'https://api.coingecko.com/api/v3';

type TokenHolding = {
  contract_address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  balance_usd: string | null;
  price_usd: number | null;
  verified: boolean;  // is this an official known token?
};

// Fetch all ERC-20 tokens a wallet has interacted with via Etherscan token tx list
async function fetchTokenList(
  address: string,
  chainId: string,
  apiKey: string
): Promise<{ contract: string; symbol: string; name: string; decimal: string }[]> {
  const baseUrl = ETHERSCAN_API_URLS[chainId];
  if (!baseUrl) return [];

  const url = new URL(baseUrl);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'tokentx');
  url.searchParams.set('address', address);
  url.searchParams.set('startblock', '0');
  url.searchParams.set('endblock', '99999999');
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('offset', '200');
  url.searchParams.set('page', '1');
  url.searchParams.set('apikey', apiKey);

  try {
    const res = await fetch(url.toString(), { next: { revalidate: 120 } });
    const data = await res.json();
    if (!Array.isArray(data.result)) return [];

    // Deduplicate by contract address
    const seen = new Set<string>();
    return data.result
      .filter((tx: { contractAddress: string }) => {
        const addr = tx.contractAddress.toLowerCase();
        if (seen.has(addr)) return false;
        seen.add(addr);
        return true;
      })
      .map((tx: { contractAddress: string; tokenSymbol: string; tokenName: string; tokenDecimal: string }) => ({
        contract: tx.contractAddress,
        symbol:   tx.tokenSymbol,
        name:     tx.tokenName,
        decimal:  tx.tokenDecimal,
      }));
  } catch {
    return [];
  }
}

// Fetch USD prices for multiple ERC-20 tokens in one CoinGecko call
async function fetchTokenPrices(
  contracts: string[],
  platform: string
): Promise<Record<string, number>> {
  if (contracts.length === 0 || !platform) return {};
  try {
    const addrs = contracts.map((c) => c.toLowerCase()).join(',');
    const res = await fetch(
      `${COINGECKO}/simple/token_price/${platform}?contract_addresses=${addrs}&vs_currencies=usd`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

async function fetchNativeUsdPrice(chainId: string): Promise<number | null> {
  const coinId = NATIVE_COIN_IDS[chainId];
  if (!coinId) return null;
  try {
    const res = await fetch(
      `${COINGECKO}/simple/price?ids=${coinId}&vs_currencies=usd`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data[coinId]?.usd ?? null;
  } catch {
    return null;
  }
}

// GET /api/wallet/storage?chain_id=1&address=0x...
// Returns all tokens held in the wallet + native balance + USD totals.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const chainId = searchParams.get('chain_id');
  const address = searchParams.get('address');

  if (!chainId) return NextResponse.json({ error: 'Missing: chain_id' }, { status: 400 });
  if (!address || !isValidEVMAddress(address)) {
    return NextResponse.json({ error: 'Missing or invalid: address' }, { status: 400 });
  }

  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ETHERSCAN_API_KEY not set' }, { status: 500 });
  }

  const rpcUrl  = getRpcUrl(chainId);
  const platform = COINGECKO_PLATFORMS[chainId];

  // ── 1. Fetch native balance + token list + native price in parallel ────────
  const [nativeRaw, tokenList, nativeUsd] = await Promise.all([
    (async () => {
      if (!rpcUrl) return null;
      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        return provider.getBalance(address);
      } catch { return null; }
    })(),
    fetchTokenList(address, chainId, apiKey),
    fetchNativeUsdPrice(chainId),
  ]);

  // ── 2. Fetch all ERC-20 balances from RPC ─────────────────────────────────
  const holdings: TokenHolding[] = [];

  if (rpcUrl && tokenList.length > 0) {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const BATCH = 5;

    for (let i = 0; i < tokenList.length; i += BATCH) {
      const batch = tokenList.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(async (t) => {
          const contract = new ethers.Contract(t.contract, ERC20_ABI, provider);
          const [rawBal, decimals]: [bigint, number] = await Promise.all([
            contract.balanceOf(address),
            contract.decimals().catch(() => parseInt(t.decimal, 10) || 18),
          ]);
          return { ...t, rawBal, decimals };
        })
      );

      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const { contract, symbol, name, rawBal, decimals } = result.value;
        if (rawBal === 0n) continue; // skip zero balances
        holdings.push({
          contract_address: contract,
          symbol,
          name,
          decimals,
          balance: ethers.formatUnits(rawBal, decimals),
          balance_usd: null, // filled below
          price_usd: null,
          verified: getVerifiedSymbol(contract, chainId) !== null,
        });
      }

      if (i + BATCH < tokenList.length) await sleep(100);
    }
  }

  // ── 3. Fetch USD prices for all held tokens in one CoinGecko batch call ───
  if (holdings.length > 0 && platform) {
    const contracts = holdings.map((h) => h.contract_address);
    const prices = await fetchTokenPrices(contracts, platform);

    for (const h of holdings) {
      const priceEntry = prices[h.contract_address.toLowerCase()];
      const price = (priceEntry && typeof priceEntry === 'object' && 'usd' in priceEntry)
        ? (priceEntry as { usd: number }).usd
        : null;
      h.price_usd  = price;
      h.balance_usd = price !== null
        ? (parseFloat(h.balance) * price).toFixed(2)
        : null;
    }
  }

  // ── 4. Sort: verified tokens first, then by USD value descending ──────────
  holdings.sort((a, b) => {
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    const aUsd = a.balance_usd ? parseFloat(a.balance_usd) : 0;
    const bUsd = b.balance_usd ? parseFloat(b.balance_usd) : 0;
    return bUsd - aUsd;
  });

  // ── 5. Native coin entry ───────────────────────────────────────────────────
  const nativeBalance = nativeRaw ? ethers.formatEther(nativeRaw) : '0';
  const nativeBalanceUsd =
    nativeUsd !== null ? (parseFloat(nativeBalance) * nativeUsd).toFixed(2) : null;

  // ── 6. Portfolio total ─────────────────────────────────────────────────────
  const totalUsd = (
    (nativeBalanceUsd ? parseFloat(nativeBalanceUsd) : 0) +
    holdings.reduce((s, h) => s + (h.balance_usd ? parseFloat(h.balance_usd) : 0), 0)
  ).toFixed(2);

  return NextResponse.json({
    chain_id: chainId,
    address,
    portfolio_total_usd: totalUsd,
    native: {
      symbol:      chainId === '56' ? 'BNB' : chainId === '137' ? 'MATIC' : 'ETH',
      balance:     nativeBalance,
      price_usd:   nativeUsd,
      balance_usd: nativeBalanceUsd,
    },
    tokens: holdings,
    token_count: holdings.length,
    updated_at: new Date().toISOString(),
  });
}
