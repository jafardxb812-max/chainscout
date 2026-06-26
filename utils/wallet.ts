// Shared utilities for wallet API routes

// Etherscan v2 unified API — tested working chains only
// BSC (56), Optimism (10), Base (8453), Avalanche (43114) require separate API keys
const ETHERSCAN_V2 = 'https://api.etherscan.io/v2/api';
export const ETHERSCAN_API_URLS: Record<string, string> = {
  '1':     `${ETHERSCAN_V2}?chainid=1`,    // Ethereum Mainnet ✓
  '137':   `${ETHERSCAN_V2}?chainid=137`,  // Polygon ✓
  '42161': `${ETHERSCAN_V2}?chainid=42161`, // Arbitrum One ✓
};

// CoinGecko platform IDs for each chain (used to fetch token metadata + price)
export const COINGECKO_PLATFORMS: Record<string, string> = {
  '1':     'ethereum',
  '10':    'optimistic-ethereum',
  '56':    'binance-smart-chain',
  '137':   'polygon-pos',
  '42161': 'arbitrum-one',
  '43114': 'avalanche',
  '8453':  'base',
  '324':   'zksync',
  '1101':  'polygon-zkevm',
};

// CoinGecko coin IDs for native coins
export const NATIVE_COIN_IDS: Record<string, string> = {
  '1':     'ethereum',
  '10':    'ethereum',
  '56':    'binancecoin',
  '137':   'matic-network',
  '42161': 'ethereum',
  '43114': 'avalanche-2',
  '8453':  'ethereum',
  '324':   'ethereum',
  '1101':  'ethereum',
};

// Primary RPC per chain — fallbacks tried in order via getWorkingProvider()
// Ankr public endpoints removed (now require API key)
export const PUBLIC_RPC_URLS: Record<string, string[]> = {
  '1':     [
    'https://ethereum.publicnode.com',
    'https://1rpc.io/eth',
    'https://eth.llamarpc.com',
    'https://rpc.eth.gateway.fm',
  ],
  '10':    ['https://mainnet.optimism.io', 'https://optimism.publicnode.com', 'https://1rpc.io/op'],
  '56':    ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io', 'https://1rpc.io/bnb'],
  '137':   ['https://polygon-rpc.com', 'https://polygon.publicnode.com', 'https://1rpc.io/matic'],
  '42161': ['https://arb1.arbitrum.io/rpc', 'https://arbitrum.publicnode.com', 'https://1rpc.io/arb'],
  '43114': ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain.publicnode.com', 'https://1rpc.io/avax/c'],
  '8453':  ['https://mainnet.base.org', 'https://base.publicnode.com', 'https://1rpc.io/base'],
  '324':   ['https://mainnet.era.zksync.io', 'https://zksync.drpc.org'],
  '1101':  ['https://zkevm-rpc.com', 'https://polygon-zkevm.drpc.org'],
  '11155111': ['https://rpc.sepolia.org', 'https://ethereum-sepolia.publicnode.com'],
  '80002':    ['https://rpc-amoy.polygon.technology'],
};

// Official verified token contracts — keyed by symbol → chainId → address
// These are the ONLY addresses treated as "verified" for each token.
// Source: Tether (USDT), Circle (USDC), official bridge deployments.
export const VERIFIED_TOKENS: Record<string, Record<string, string>> = {
  USDT: {
    '1':     '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    '10':    '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    '56':    '0x55d398326f99059fF775485246999027B3197955',
    '137':   '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    '42161': '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    '43114': '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
    '8453':  '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    '324':   '0x493257fD37EDB34451f62EDf8D2a0C418852bA4',
    '1101':  '0x1E4a5963aBFD975d8c9021ce480b42188849D41d',
  },
  USDC: {
    '1':     '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    '10':    '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    '56':    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    '137':   '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    '42161': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    '43114': '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6',
    '8453':  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  WETH: {
    '1':     '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    '10':    '0x4200000000000000000000000000000000000006',
    '42161': '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    '8453':  '0x4200000000000000000000000000000000000006',
  },
};

// Flat USDT map kept for backward compat
export const USDT_CONTRACTS: Record<string, string> = VERIFIED_TOKENS.USDT;

export type TokenVerification = {
  verified: boolean;
  symbol_match: boolean;     // on-chain symbol matches expected
  address_is_official: boolean; // address is in our VERIFIED_TOKENS list
  coingecko_match: boolean;  // CoinGecko contract address matches
  warning: string | null;
};

// CoinGecko coin IDs for well-known tokens (used for about/metadata fetch)
export const TOKEN_COINGECKO_IDS: Record<string, string> = {
  USDT: 'tether',
  USDC: 'usd-coin',
  WETH: 'weth',
  ETH:  'ethereum',
  BNB:  'binancecoin',
  MATIC: 'matic-network',
  AVAX: 'avalanche-2',
};

export type CoinAbout = {
  id: string;
  symbol: string;
  name: string;
  description: string;
  logo: { thumb: string; small: string; large: string };
  links: {
    website: string | null;
    whitepaper: string | null;
    twitter: string | null;
    telegram: string | null;
    github: string | null;
  };
  genesis_date: string | null;
  market_data: {
    price_usd: number;
    price_change_24h_pct: number;
    market_cap_usd: number;
    total_volume_24h_usd: number;
    total_supply: number | null;
    circulating_supply: number;
    max_supply: number | null;
    ath_usd: number;
    ath_date: string;
  };
};

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

export async function fetchCoinAbout(
  coinIdOrSymbol: string,
  chainId?: string,
  contractAddress?: string
): Promise<CoinAbout | null> {
  let coinId = TOKEN_COINGECKO_IDS[coinIdOrSymbol.toUpperCase()] ?? coinIdOrSymbol.toLowerCase();

  // If a contract address is given, look up by contract on the chain's platform
  if (contractAddress && chainId && COINGECKO_PLATFORMS[chainId]) {
    try {
      const platform = COINGECKO_PLATFORMS[chainId];
      const res = await fetch(
        `${COINGECKO_BASE}/coins/${platform}/contract/${contractAddress.toLowerCase()}`,
        { headers: { Accept: 'application/json' }, next: { revalidate: 300 } }
      );
      if (res.ok) {
        const d = await res.json();
        coinId = d.id;
      }
    } catch { /* fall through to coinId lookup */ }
  }

  try {
    const res = await fetch(
      `${COINGECKO_BASE}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`,
      { headers: { Accept: 'application/json' }, next: { revalidate: 300 } }
    );
    if (!res.ok) return null;
    const d = await res.json();

    return {
      id:          d.id,
      symbol:      d.symbol?.toUpperCase(),
      name:        d.name,
      description: d.description?.en?.replace(/<[^>]+>/g, '').slice(0, 500) ?? '', // strip HTML, cap length
      logo: {
        thumb: d.image?.thumb ?? null,
        small: d.image?.small ?? null,
        large: d.image?.large ?? null,
      },
      links: {
        website:    d.links?.homepage?.[0]                      ?? null,
        whitepaper: d.links?.whitepaper                         ?? null,
        twitter:    d.links?.twitter_screen_name
          ? `https://twitter.com/${d.links.twitter_screen_name}` : null,
        telegram:   d.links?.telegram_channel_identifier
          ? `https://t.me/${d.links.telegram_channel_identifier}` : null,
        github:     d.links?.repos_url?.github?.[0]             ?? null,
      },
      genesis_date: d.genesis_date ?? null,
      market_data: {
        price_usd:            d.market_data?.current_price?.usd           ?? 0,
        price_change_24h_pct: d.market_data?.price_change_percentage_24h  ?? 0,
        market_cap_usd:       d.market_data?.market_cap?.usd              ?? 0,
        total_volume_24h_usd: d.market_data?.total_volume?.usd            ?? 0,
        total_supply:         d.market_data?.total_supply                  ?? null,
        circulating_supply:   d.market_data?.circulating_supply            ?? 0,
        max_supply:           d.market_data?.max_supply                    ?? null,
        ath_usd:              d.market_data?.ath?.usd                      ?? 0,
        ath_date:             d.market_data?.ath_date?.usd                 ?? null,
      },
    };
  } catch {
    return null;
  }
}

// Check whether a contract address is in our verified list
export function getVerifiedSymbol(address: string, chainId: string): string | null {
  const norm = address.toLowerCase();
  for (const [symbol, chains] of Object.entries(VERIFIED_TOKENS)) {
    const official = chains[chainId];
    if (official && official.toLowerCase() === norm) return symbol;
  }
  return null;
}

// Minimal ERC-20 ABI — only what we need
export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

export function isValidEVMAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

export function getRpcUrl(chainId: string): string | null {
  const override = process.env[`RPC_URL_${chainId}`];
  if (override) return override;
  const urls = PUBLIC_RPC_URLS[chainId];
  return urls?.[0] ?? null;
}

// Try each RPC in order until one succeeds — 5s timeout per attempt
export async function getWorkingProvider(chainId: string): Promise<import('ethers').JsonRpcProvider | null> {
  const { ethers } = await import('ethers');
  const override = process.env[`RPC_URL_${chainId}`];
  const urls = override ? [override] : (PUBLIC_RPC_URLS[chainId] ?? []);
  for (const url of urls) {
    try {
      const provider = new ethers.JsonRpcProvider(url);
      await Promise.race([
        provider.getBlockNumber(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]);
      return provider;
    } catch { continue; }
  }
  return null;
}

export function resolveTokenAddress(token: string, chainId: string): string | null {
  const upper = token.toUpperCase();
  if (VERIFIED_TOKENS[upper]) return VERIFIED_TOKENS[upper][chainId] ?? null;
  if (isValidEVMAddress(token)) return token;
  return null;
}

// ── Wallet role helpers ───────────────────────────────────────────────────────

// Sender wallet private key — for outgoing txs (send, swap, bridge)
// Uses SENDER_WALLET_PRIVATE_KEY first, falls back to legacy WALLET_PRIVATE_KEY
export function getSenderPrivateKey(): string | null {
  return process.env.SENDER_WALLET_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || null;
}

// Receiver wallet address — the address customers send funds to
// Uses RECEIVER_WALLET_ADDRESS if set; otherwise derives from sender key
export function getReceiverAddress(): string | null {
  if (process.env.RECEIVER_WALLET_ADDRESS) {
    return process.env.RECEIVER_WALLET_ADDRESS;
  }
  // Fallback: derive from sender key (legacy single-wallet mode)
  const key = getSenderPrivateKey();
  if (!key) return null;
  try {
    const { ethers } = require('ethers');
    return new ethers.Wallet(key).address;
  } catch {
    return null;
  }
}

// Etherscan free tier: 5 req/s → wait 250ms between paginated calls to stay safe
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Etherscan API key rotation ────────────────────────────────────────────────
// Supports up to 3 keys: ETHERSCAN_API_KEY, ETHERSCAN_API_KEY_2, ETHERSCAN_API_KEY_3
// Rotates round-robin across available keys to spread load
let _keyIndex = 0;
function getEtherscanKey(): string {
  const keys = [
    process.env.ETHERSCAN_API_KEY,
    process.env.ETHERSCAN_API_KEY_2,
    process.env.ETHERSCAN_API_KEY_3,
  ].filter(Boolean) as string[];
  if (keys.length === 0) return '';
  const key = keys[_keyIndex % keys.length];
  _keyIndex = (_keyIndex + 1) % keys.length;
  return key;
}

// ── In-memory response cache ──────────────────────────────────────────────────
type CacheEntry = { data: unknown; expires: number };
const _cache = new Map<string, CacheEntry>();

function cacheGet(key: string): unknown | null {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { _cache.delete(key); return null; }
  return entry.data;
}

function cacheSet(key: string, data: unknown, ttlMs: number): void {
  _cache.set(key, { data, expires: Date.now() + ttlMs });
  // Evict old entries when cache grows large
  if (_cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of _cache) if (now > v.expires) _cache.delete(k);
  }
}

// ── Etherscan fetch with auto-retry + cache ───────────────────────────────────
// ttlMs: how long to cache a successful response (default 30s)
// retries: how many times to retry on rate-limit / server error
export async function fetchEtherscan(
  baseUrl: string,
  params: Record<string, string>,
  options: { ttlMs?: number; retries?: number; apiKey?: string } = {}
): Promise<unknown> {
  const { ttlMs = 30_000, retries = 3 } = options;
  const key = options.apiKey ?? getEtherscanKey();

  const url = new URL(baseUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('apikey', key);

  const cacheKey = url.toString().replace(/apikey=[^&]+/, 'apikey=__');
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1)); // 500ms, 1s, 2s backoff

    try {
      const res = await fetch(url.toString(), { next: { revalidate: 0 } });
      if (!res.ok) {
        if (res.status === 429 || res.status === 503) {
          lastErr = new Error(`HTTP ${res.status}`);
          continue; // retry
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      // Etherscan rate-limit response: status "0", result contains "rate limit"
      if (
        data?.status === '0' &&
        typeof data?.result === 'string' &&
        data.result.toLowerCase().includes('rate limit')
      ) {
        lastErr = new Error('Rate limit');
        continue; // retry with next key on next attempt
      }

      cacheSet(cacheKey, data, ttlMs);
      return data;
    } catch (e) {
      lastErr = e as Error;
      if (attempt < retries) continue;
    }
  }

  throw lastErr ?? new Error('Etherscan fetch failed');
}

// ── Multi-wallet storage helpers ──────────────────────────────────────────────
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

export type StoredWallet = {
  id: string;
  address: string;
  label: string;
  chain_ids: string[]; // chains to monitor for this wallet
  added_at: string;
};

type WalletsFile = { wallets: StoredWallet[] };

const WALLETS_PATH = path.join(process.cwd(), 'data', 'wallets.json');

export async function loadWallets(): Promise<StoredWallet[]> {
  try {
    const raw = await fs.readFile(WALLETS_PATH, 'utf8');
    return (JSON.parse(raw) as WalletsFile).wallets ?? [];
  } catch {
    return [];
  }
}

async function saveWallets(wallets: StoredWallet[]): Promise<void> {
  await fs.writeFile(WALLETS_PATH, JSON.stringify({ wallets }, null, 2), 'utf8');
}

export async function addWallet(
  address: string,
  label: string,
  chain_ids: string[]
): Promise<StoredWallet> {
  const wallets = await loadWallets();
  const existing = wallets.find((w) => w.address.toLowerCase() === address.toLowerCase());
  if (existing) return existing;
  const entry: StoredWallet = { id: randomUUID(), address, label, chain_ids, added_at: new Date().toISOString() };
  wallets.push(entry);
  await saveWallets(wallets);
  return entry;
}

export async function removeWallet(id: string): Promise<boolean> {
  const wallets = await loadWallets();
  const next = wallets.filter((w) => w.id !== id);
  if (next.length === wallets.length) return false;
  await saveWallets(next);
  return true;
}
