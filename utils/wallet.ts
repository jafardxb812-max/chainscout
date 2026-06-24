// Shared utilities for wallet API routes

// Etherscan-family API base URLs per chain ID
// All accept the same ETHERSCAN_API_KEY from etherscan.io (free registration)
export const ETHERSCAN_API_URLS: Record<string, string> = {
  '1':        'https://api.etherscan.io/api',
  '10':       'https://api-optimistic.etherscan.io/api',
  '56':       'https://api.bscscan.com/api',
  '137':      'https://api.polygonscan.com/api',
  '42161':    'https://api.arbiscan.io/api',
  '43114':    'https://api.snowscan.xyz/api',
  '8453':     'https://api.basescan.org/api',
  '324':      'https://block-explorer-api.mainnet.zksync.io/api',
  '1101':     'https://api-zkevm.polygonscan.com/api',
  '59144':    'https://api.lineascan.build/api',
  '534352':   'https://api.scrollscan.com/api',
  '11155111': 'https://api-sepolia.etherscan.io/api',
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

export const PUBLIC_RPC_URLS: Record<string, string> = {
  '1':     'https://eth.llamarpc.com',
  '10':    'https://mainnet.optimism.io',
  '56':    'https://bsc-dataseed.binance.org/',
  '137':   'https://polygon-rpc.com',
  '42161': 'https://arb1.arbitrum.io/rpc',
  '43114': 'https://api.avax.network/ext/bc/C/rpc',
  '8453':  'https://mainnet.base.org',
  '324':   'https://mainnet.era.zksync.io',
  '1101':  'https://zkevm-rpc.com',
  '11155111': 'https://rpc.sepolia.org',   // Sepolia testnet
  '80002':    'https://rpc-amoy.polygon.technology', // Polygon Amoy testnet
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
  // Allow override via environment variable: RPC_URL_<chainId>
  return process.env[`RPC_URL_${chainId}`] ?? PUBLIC_RPC_URLS[chainId] ?? null;
}

export function resolveTokenAddress(token: string, chainId: string): string | null {
  const upper = token.toUpperCase();
  if (VERIFIED_TOKENS[upper]) return VERIFIED_TOKENS[upper][chainId] ?? null;
  if (isValidEVMAddress(token)) return token;
  return null;
}

// Etherscan free tier: 5 req/s → wait 250ms between paginated calls to stay safe
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
