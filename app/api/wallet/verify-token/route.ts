import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  isValidEVMAddress,
  getRpcUrl,
  ERC20_ABI,
  COINGECKO_PLATFORMS,
  VERIFIED_TOKENS,
  getVerifiedSymbol,
  type TokenVerification,
} from '@/utils/wallet';

const COINGECKO = 'https://api.coingecko.com/api/v3';

// GET /api/wallet/verify-token?chain_id=1&address=0xdAC17F...
// Returns a verification report: is this the real USDT/USDC/etc. or a fake?
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const chainId = searchParams.get('chain_id');
  const address = searchParams.get('address');

  if (!chainId) return NextResponse.json({ error: 'Missing: chain_id' }, { status: 400 });
  if (!address || !isValidEVMAddress(address)) {
    return NextResponse.json({ error: 'Missing or invalid: address (must be 0x...)' }, { status: 400 });
  }

  // ── 1. Check our internal verified list ──────────────────────────────────
  const verifiedSymbol = getVerifiedSymbol(address, chainId);
  const address_is_official = verifiedSymbol !== null;

  // ── 2. Read on-chain name/symbol/decimals ─────────────────────────────────
  let onChainSymbol: string | null = null;
  let onChainName: string | null = null;
  let onChainDecimals: number | null = null;

  const rpcUrl = getRpcUrl(chainId);
  if (rpcUrl) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const contract = new ethers.Contract(address, ERC20_ABI, provider);
      [onChainSymbol, onChainName, onChainDecimals] = await Promise.all([
        contract.symbol() as Promise<string>,
        contract.name()   as Promise<string>,
        contract.decimals() as Promise<number>,
      ]);
    } catch {
      // RPC unavailable — proceed with other checks
    }
  }

  // ── 3. Cross-check with CoinGecko ─────────────────────────────────────────
  let coingecko_match = false;
  let cgName: string | null = null;
  let cgSymbol: string | null = null;
  let cgLogoThumb: string | null = null;
  let cgId: string | null = null;

  const platform = COINGECKO_PLATFORMS[chainId];
  if (platform) {
    try {
      const res = await fetch(
        `${COINGECKO}/coins/${platform}/contract/${address.toLowerCase()}`,
        { headers: { Accept: 'application/json' }, next: { revalidate: 300 } }
      );
      if (res.ok) {
        const cg = await res.json();
        cgId     = cg.id ?? null;
        cgName   = cg.name ?? null;
        cgSymbol = cg.symbol?.toUpperCase() ?? null;
        cgLogoThumb = cg.image?.small ?? null;

        // CoinGecko stores the official contract — compare case-insensitively
        const cgContract: string | undefined = cg.detail_platforms?.[platform]?.contract_address;
        coingecko_match =
          typeof cgContract === 'string' &&
          cgContract.toLowerCase() === address.toLowerCase();
      }
    } catch {
      // CoinGecko unavailable
    }
  }

  // ── 4. Symbol consistency check ───────────────────────────────────────────
  // If on-chain symbol claims to be a known token, verify the address matches
  const symbol_match =
    onChainSymbol !== null &&
    (verifiedSymbol === onChainSymbol ||
      // CoinGecko agrees with on-chain symbol
      (cgSymbol !== null && cgSymbol === onChainSymbol));

  // ── 5. Warning logic ──────────────────────────────────────────────────────
  let warning: string | null = null;

  if (onChainSymbol && VERIFIED_TOKENS[onChainSymbol] && !address_is_official) {
    // Claims to be USDT/USDC/etc. but address doesn't match our list
    const officialAddr = VERIFIED_TOKENS[onChainSymbol][chainId];
    warning = officialAddr
      ? `FAKE TOKEN: Claims to be ${onChainSymbol} but official address on chain ${chainId} is ${officialAddr}`
      : `UNVERIFIED: Claims to be ${onChainSymbol} but no official address known for chain ${chainId}`;
  } else if (!address_is_official && !coingecko_match) {
    warning = 'Token not found in verified list or CoinGecko — proceed with caution';
  }

  const verification: TokenVerification = {
    verified: address_is_official && (coingecko_match || symbol_match),
    symbol_match,
    address_is_official,
    coingecko_match,
    warning,
  };

  return NextResponse.json({
    chain_id: chainId,
    address,
    on_chain: {
      symbol:   onChainSymbol,
      name:     onChainName,
      decimals: onChainDecimals,
    },
    coingecko: {
      id:     cgId,
      name:   cgName,
      symbol: cgSymbol,
      logo:   cgLogoThumb,
      contract_matches: coingecko_match,
    },
    verification,
  });
}
