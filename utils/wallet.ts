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

// Well-known USDT contract addresses per chain
export const USDT_CONTRACTS: Record<string, string> = {
  '1':     '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  '10':    '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
  '56':    '0x55d398326f99059fF775485246999027B3197955',
  '137':   '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  '42161': '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  '43114': '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
  '8453':  '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  '324':   '0x493257fD37EDB34451f62EDf8D2a0C418852bA4',
  '1101':  '0x1E4a5963aBFD975d8c9021ce480b42188849D41d',
};

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
  if (token.toLowerCase() === 'usdt') return USDT_CONTRACTS[chainId] ?? null;
  if (isValidEVMAddress(token)) return token;
  return null;
}

// Etherscan free tier: 5 req/s → wait 250ms between paginated calls to stay safe
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
