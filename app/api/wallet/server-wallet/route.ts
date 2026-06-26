import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  getSenderPrivateKey,
  getWorkingProvider,
  ERC20_ABI,
  VERIFIED_TOKENS,
} from '@/utils/wallet';

// GET /api/wallet/server-wallet?chain_id=1
// Returns server wallet address + ETH and USDT balances
export async function GET(req: NextRequest) {
  const chainId = req.nextUrl.searchParams.get('chain_id') ?? '1';

  const privateKey = getSenderPrivateKey();
  if (!privateKey) {
    return NextResponse.json(
      { error: 'SENDER_WALLET_PRIVATE_KEY not set in .env.local' },
      { status: 500 }
    );
  }

  const provider = await getWorkingProvider(chainId);
  if (!provider) {
    return NextResponse.json(
      { error: `No working RPC for chain ${chainId}` },
      { status: 502 }
    );
  }

  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address;

  try {
    const ethRaw = await provider.getBalance(address);
    const ethBalance = parseFloat(ethers.formatEther(ethRaw)).toFixed(6);

    const usdtAddress = VERIFIED_TOKENS.USDT?.[chainId];
    let usdtBalance = '0.00';
    if (usdtAddress) {
      const contract = new ethers.Contract(usdtAddress, ERC20_ABI, provider);
      const usdtRaw: bigint = await contract.balanceOf(address);
      usdtBalance = parseFloat(ethers.formatUnits(usdtRaw, 6)).toFixed(2);
    }

    return NextResponse.json({
      address,
      chain_id: chainId,
      balances: {
        eth:  { amount: ethBalance,  symbol: 'ETH'  },
        usdt: { amount: usdtBalance, symbol: 'USDT', contract: usdtAddress ?? null },
      },
      funded: parseFloat(ethBalance) > 0 || parseFloat(usdtBalance) > 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `RPC error: ${msg}` }, { status: 502 });
  }
}
