import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  isValidEVMAddress,
  getWorkingProvider,
  resolveTokenAddress,
  ERC20_ABI,
  COINGECKO_PLATFORMS,
  NATIVE_COIN_IDS,
} from '@/utils/wallet';

const COINGECKO = 'https://api.coingecko.com/api/v3';

async function fetchUsdPrice(
  isNative: boolean,
  chainId: string,
  tokenAddress?: string
): Promise<number | null> {
  try {
    if (isNative) {
      const coinId = NATIVE_COIN_IDS[chainId];
      if (!coinId) return null;
      const res = await fetch(
        `${COINGECKO}/simple/price?ids=${coinId}&vs_currencies=usd`,
        { next: { revalidate: 60 } }
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data[coinId]?.usd ?? null;
    }

    const platform = COINGECKO_PLATFORMS[chainId];
    if (!platform || !tokenAddress) return null;
    const res = await fetch(
      `${COINGECKO}/simple/token_price/${platform}?contract_addresses=${tokenAddress.toLowerCase()}&vs_currencies=usd`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data[tokenAddress.toLowerCase()]?.usd ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const chainId = searchParams.get('chain_id');
  const address = searchParams.get('address');
  const token = searchParams.get('token') ?? 'eth';

  if (!chainId) {
    return NextResponse.json({ error: 'Missing required parameter: chain_id' }, { status: 400 });
  }
  if (!address || !isValidEVMAddress(address)) {
    return NextResponse.json({ error: 'Missing or invalid address' }, { status: 400 });
  }

  const provider = await getWorkingProvider(chainId);
  if (!provider) {
    return NextResponse.json({ error: `No working RPC for chain_id '${chainId}'` }, { status: 502 });
  }

  try {
    if (token.toLowerCase() === 'eth') {
      const [rawBalance, network, usdPrice] = await Promise.all([
        provider.getBalance(address),
        provider.getNetwork(),
        fetchUsdPrice(true, chainId),
      ]);
      const balance = ethers.formatEther(rawBalance);
      const balance_usd = usdPrice ? (parseFloat(balance) * usdPrice).toFixed(2) : null;

      return NextResponse.json({
        chain_id: chainId,
        network_name: network.name,
        address,
        token: { symbol: 'ETH', name: 'Ethereum', address: null, decimals: 18 },
        balance,
        balance_raw: rawBalance.toString(),
        price_usd: usdPrice,
        balance_usd,
      });
    }

    // ERC-20 token
    const tokenAddress = resolveTokenAddress(token, chainId);
    if (!tokenAddress) {
      return NextResponse.json(
        { error: `Unknown token '${token}'. Use 'eth', 'usdt', or a 0x contract address` },
        { status: 400 }
      );
    }

    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const [[rawBalance, rawDecimals, symbol, name], usdPrice] = await Promise.all([
      Promise.all([
        contract.balanceOf(address) as Promise<bigint>,
        contract.decimals() as Promise<bigint | number>,
        contract.symbol() as Promise<string>,
        contract.name() as Promise<string>,
      ]),
      fetchUsdPrice(false, chainId, tokenAddress),
    ]);

    const decimals = Number(rawDecimals);
    const balance = ethers.formatUnits(rawBalance, decimals);
    const balance_usd = usdPrice ? (parseFloat(balance) * usdPrice).toFixed(2) : null;

    return NextResponse.json({
      chain_id: chainId,
      address,
      token: { symbol, name, address: tokenAddress, decimals },
      balance,
      balance_raw: rawBalance.toString(),
      price_usd: usdPrice,
      balance_usd,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `RPC call failed: ${msg}` }, { status: 502 });
  }
}
