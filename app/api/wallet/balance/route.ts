import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  isValidEVMAddress,
  getRpcUrl,
  resolveTokenAddress,
  ERC20_ABI,
} from '@/utils/wallet';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const chainId = searchParams.get('chain_id');
  const address = searchParams.get('address');
  // Optional: pass 'usdt', 'eth', or a contract address
  const token = searchParams.get('token') ?? 'eth';

  if (!chainId) {
    return NextResponse.json({ error: 'Missing required parameter: chain_id' }, { status: 400 });
  }
  if (!address || !isValidEVMAddress(address)) {
    return NextResponse.json({ error: 'Missing or invalid address' }, { status: 400 });
  }

  const rpcUrl = getRpcUrl(chainId);
  if (!rpcUrl) {
    return NextResponse.json({ error: `No RPC URL configured for chain_id '${chainId}'` }, { status: 404 });
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  try {
    if (token.toLowerCase() === 'eth') {
      const [rawBalance, network] = await Promise.all([
        provider.getBalance(address),
        provider.getNetwork(),
      ]);
      const formatted = ethers.formatEther(rawBalance);
      return NextResponse.json({
        chain_id: chainId,
        network_name: network.name,
        address,
        token: 'ETH',
        balance_raw: rawBalance.toString(),
        balance: formatted,
      });
    }

    // ERC-20 token balance
    const tokenAddress = resolveTokenAddress(token, chainId);
    if (!tokenAddress) {
      return NextResponse.json(
        { error: `Unknown token '${token}'. Use 'eth', 'usdt', or a contract address (0x...)` },
        { status: 400 }
      );
    }

    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const [rawBalance, decimals, symbol, name] = await Promise.all([
      contract.balanceOf(address) as Promise<bigint>,
      contract.decimals() as Promise<number>,
      contract.symbol() as Promise<string>,
      contract.name() as Promise<string>,
    ]);

    const formatted = ethers.formatUnits(rawBalance, decimals);
    return NextResponse.json({
      chain_id: chainId,
      address,
      token: symbol,
      token_name: name,
      token_address: tokenAddress,
      balance_raw: rawBalance.toString(),
      balance: formatted,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `RPC call failed: ${msg}` }, { status: 502 });
  }
}
