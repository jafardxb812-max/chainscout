import { ethers } from 'ethers';

export const CHAIN_ID = 56;

// Reliable public BSC RPC endpoints (tried in order)
const BSC_RPCS = [
  'https://rpc.ankr.com/bsc',
  'https://bsc-rpc.publicnode.com',
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-dataseed.binance.org',
];

// Known-good pair addresses (fallback if factory lookup fails)
export const KNOWN_PAIRS: Record<string, string> = {
  // USDT/WBNB PancakeSwap V2
  'USDT/WBNB': '0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE',
};

// Contract addresses on BSC
export const ADDRESSES = {
  router:  '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap V2 Router
  factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73', // PancakeSwap V2 Factory
  USDT:    '0x55d398326f99059fF775485246999027B3197955', // USDT BEP-20 (BSC Pegged)
  WBNB:    '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // Wrapped BNB
};

export const ROUTER_ABI = [
  'function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)',
  'function removeLiquidityETH(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountToken, uint256 amountETH)',
];

export const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) view returns (address pair)',
];

export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

export const PAIR_ABI = [
  ...ERC20_ABI,
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
];

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

export interface LPRedemptionQuote {
  lpTokenAddress: string;
  lpBalance: string;
  lpBalanceRaw: string;
  token0: TokenInfo;
  token1: TokenInfo;
  amount0Out: string;
  amount1Out: string;
  sharePercent: string;
}

function makeProvider(rpc: string): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(
    rpc,
    { chainId: CHAIN_ID, name: 'bnb' },
    { staticNetwork: true },
  );
}

/**
 * Try each RPC in order; return the first provider that responds to eth_chainId.
 */
export async function getBSCProvider(): Promise<ethers.JsonRpcProvider> {
  for (const rpc of BSC_RPCS) {
    try {
      const p = makeProvider(rpc);
      // lightweight liveness check
      await p.send('eth_chainId', []);
      return p;
    } catch {
      // try next
    }
  }
  throw new Error('BSC RPC-ലേക്ക് connect ചെയ്യാൻ കഴിഞ്ഞില്ല. Internet connection check ചെയ്യുക.');
}

/**
 * Get the PancakeSwap V2 pair address for two tokens.
 * Falls back to KNOWN_PAIRS if the factory call fails.
 */
export async function getPairAddress(
  tokenA: string,
  tokenB: string,
  provider: ethers.JsonRpcProvider,
): Promise<string> {
  // Check known pairs first (case-insensitive)
  const usdtLower = ADDRESSES.USDT.toLowerCase();
  const wbnbLower = ADDRESSES.WBNB.toLowerCase();
  const aLow = tokenA.toLowerCase();
  const bLow = tokenB.toLowerCase();
  if (
    (aLow === usdtLower && bLow === wbnbLower) ||
    (aLow === wbnbLower && bLow === usdtLower)
  ) {
    return KNOWN_PAIRS['USDT/WBNB'];
  }

  try {
    const factory = new ethers.Contract(ADDRESSES.factory, FACTORY_ABI, provider);
    const pair: string = await factory.getPair(tokenA, tokenB);
    if (pair === ethers.ZeroAddress) throw new Error('Pair does not exist on PancakeSwap V2');
    return pair;
  } catch (e) {
    throw new Error(
      'Pair address lookup failed: ' +
      (e instanceof Error ? e.message : String(e)),
    );
  }
}

/**
 * Build a full redemption quote for a wallet's LP position.
 */
export async function getLPRedemptionQuote(
  walletAddress: string,
  lpTokenAddress: string,
  provider: ethers.JsonRpcProvider,
): Promise<LPRedemptionQuote> {
  const pair = new ethers.Contract(lpTokenAddress, PAIR_ABI, provider);

  const [
    token0Address,
    token1Address,
    reserves,
    totalSupply,
    lpBalance,
  ] = await Promise.all([
    pair.token0(),
    pair.token1(),
    pair.getReserves(),
    pair.totalSupply(),
    pair.balanceOf(walletAddress),
  ]);

  const [reserve0, reserve1] = reserves;

  const token0Contract = new ethers.Contract(token0Address, ERC20_ABI, provider);
  const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);

  const [t0Symbol, t0Name, t0Dec, t1Symbol, t1Name, t1Dec] = await Promise.all([
    token0Contract.symbol(),
    token0Contract.name(),
    token0Contract.decimals(),
    token1Contract.symbol(),
    token1Contract.name(),
    token1Contract.decimals(),
  ]);

  const amount0Out = totalSupply > 0n ? (lpBalance * reserve0) / totalSupply : 0n;
  const amount1Out = totalSupply > 0n ? (lpBalance * reserve1) / totalSupply : 0n;
  const sharePercent = totalSupply > 0n
    ? ((lpBalance * 10000n) / totalSupply).toString()
    : '0';

  return {
    lpTokenAddress,
    lpBalance: ethers.formatUnits(lpBalance, 18),
    lpBalanceRaw: lpBalance.toString(),
    token0: { address: token0Address, symbol: t0Symbol, name: t0Name, decimals: Number(t0Dec) },
    token1: { address: token1Address, symbol: t1Symbol, name: t1Name, decimals: Number(t1Dec) },
    amount0Out: ethers.formatUnits(amount0Out, Number(t0Dec)),
    amount1Out: ethers.formatUnits(amount1Out, Number(t1Dec)),
    sharePercent: (Number(sharePercent) / 100).toFixed(4),
  };
}

/**
 * Approve router then remove all liquidity.
 */
export async function redeemLPTokens(params: {
  lpTokenAddress: string;
  lpAmountRaw: string;
  token0Address: string;
  token1Address: string;
  amount0Min: string;
  amount1Min: string;
  walletAddress: string;
  signer: ethers.Signer;
}): Promise<{ approveTx: string; redeemTx: string }> {
  const {
    lpTokenAddress, lpAmountRaw,
    token0Address, token1Address,
    amount0Min, amount1Min,
    walletAddress, signer,
  } = params;

  const lpToken = new ethers.Contract(lpTokenAddress, ERC20_ABI, signer);
  const router  = new ethers.Contract(ADDRESSES.router, ROUTER_ABI, signer);

  const approveTx = await lpToken.approve(ADDRESSES.router, lpAmountRaw);
  await approveTx.wait();

  const deadline = Math.floor(Date.now() / 1000) + 1200;
  const redeemTx = await router.removeLiquidity(
    token0Address,
    token1Address,
    lpAmountRaw,
    amount0Min,
    amount1Min,
    walletAddress,
    deadline,
  );
  await redeemTx.wait();

  return { approveTx: approveTx.hash, redeemTx: redeemTx.hash };
}

/**
 * Apply slippage tolerance to an amount (BigInt string in).
 * e.g. applySlippage("1000000000000000000", 50) → 0.5% slippage
 */
export function applySlippage(amountWei: string, slippageBps: number): string {
  const amount = BigInt(amountWei);
  return ((amount * BigInt(10000 - slippageBps)) / 10000n).toString();
}
