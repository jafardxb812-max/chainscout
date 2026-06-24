import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  isValidEVMAddress,
  getRpcUrl,
  resolveTokenAddress,
  ERC20_ABI,
  COINGECKO_PLATFORMS,
  NATIVE_COIN_IDS,
} from '@/utils/wallet';

// CoinGecko free API — no key needed for basic calls (rate limit: 30 req/min)
const COINGECKO = 'https://api.coingecko.com/api/v3';

// Native token sentinel used to mean ETH/native coin
const NATIVE_SENTINEL = 'eth';

type CoinGeckoTokenData = {
  id: string;
  name: string;
  symbol: string;
  image: { thumb: string; small: string; large: string };
  market_data: {
    current_price: { usd: number };
    price_change_percentage_24h: number;
    market_cap: { usd: number };
    total_volume: { usd: number };
    circulating_supply: number;
    total_supply: number | null;
  };
  contract_address: string;
};

async function fetchCoinGeckoByContract(
  platform: string,
  contractAddress: string
): Promise<CoinGeckoTokenData | null> {
  try {
    const url = `${COINGECKO}/coins/${platform}/contract/${contractAddress.toLowerCase()}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 60 }, // cache 60s
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchCoinGeckoById(coinId: string): Promise<CoinGeckoTokenData | null> {
  try {
    const url = `${COINGECKO}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// GET /api/wallet/token-info?chain_id=1&token=usdt
// GET /api/wallet/token-info?chain_id=1&token=eth
// GET /api/wallet/token-info?chain_id=1&token=0xdAC17F...
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const chainId = searchParams.get('chain_id');
  const tokenParam = searchParams.get('token') ?? 'eth';

  if (!chainId) {
    return NextResponse.json({ error: 'Missing required parameter: chain_id' }, { status: 400 });
  }

  const isNative = tokenParam.toLowerCase() === NATIVE_SENTINEL;

  // ── On-chain data (name, symbol, decimals from contract) ──────────────────
  let onChainName: string | null = null;
  let onChainSymbol: string | null = null;
  let onChainDecimals: number | null = null;
  let tokenAddress: string | null = null;

  if (!isNative) {
    tokenAddress = resolveTokenAddress(tokenParam, chainId);
    if (!tokenAddress) {
      return NextResponse.json(
        { error: `Unknown token '${tokenParam}'. Use 'eth', 'usdt', or a 0x contract address` },
        { status: 400 }
      );
    }

    const rpcUrl = getRpcUrl(chainId);
    if (rpcUrl) {
      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        [onChainName, onChainSymbol, onChainDecimals] = await Promise.all([
          contract.name() as Promise<string>,
          contract.symbol() as Promise<string>,
          contract.decimals() as Promise<number>,
        ]);
      } catch {
        // RPC failed — we'll rely on CoinGecko data
      }
    }
  }

  // ── CoinGecko: logo + live price + market data ─────────────────────────────
  const platform = COINGECKO_PLATFORMS[chainId];
  let cgData: CoinGeckoTokenData | null = null;

  if (isNative) {
    const coinId = NATIVE_COIN_IDS[chainId];
    if (coinId) cgData = await fetchCoinGeckoById(coinId);
  } else if (platform && tokenAddress) {
    cgData = await fetchCoinGeckoByContract(platform, tokenAddress);
  }

  // ── Merge: on-chain is source of truth for name/symbol/decimals ───────────
  const name    = onChainName   ?? cgData?.name   ?? null;
  const symbol  = onChainSymbol ?? cgData?.symbol?.toUpperCase() ?? null;
  const decimals = onChainDecimals ?? (isNative ? 18 : null);

  const price_usd            = cgData?.market_data?.current_price?.usd ?? null;
  const price_change_24h_pct = cgData?.market_data?.price_change_percentage_24h ?? null;
  const market_cap_usd       = cgData?.market_data?.market_cap?.usd ?? null;
  const volume_24h_usd       = cgData?.market_data?.total_volume?.usd ?? null;
  const circulating_supply   = cgData?.market_data?.circulating_supply ?? null;
  const total_supply         = cgData?.market_data?.total_supply ?? null;

  const logo = {
    thumb: cgData?.image?.thumb ?? null,
    small: cgData?.image?.small ?? null,
    large: cgData?.image?.large ?? null,
  };

  if (!name && !price_usd) {
    return NextResponse.json(
      { error: `Could not fetch data for token '${tokenParam}' on chain ${chainId}. Check chain_id and token address.` },
      { status: 404 }
    );
  }

  return NextResponse.json({
    chain_id: chainId,
    token: {
      name,
      symbol,
      decimals,
      address: isNative ? null : tokenAddress,
      is_native: isNative,
      coingecko_id: cgData?.id ?? null,
      logo,
    },
    price: {
      usd: price_usd,
      change_24h_pct: price_change_24h_pct,
    },
    market: {
      market_cap_usd,
      volume_24h_usd,
      circulating_supply,
      total_supply,
    },
    source: {
      on_chain: onChainName !== null,
      coingecko: cgData !== null,
    },
  });
}
