import { NextRequest, NextResponse } from 'next/server';
import { isValidEVMAddress, loadWallets, addWallet } from '@/utils/wallet';

// GET  /api/wallets          → list all tracked wallets
// POST /api/wallets          → add a wallet to track
export async function GET() {
  const wallets = await loadWallets();
  return NextResponse.json({ wallets, total: wallets.length });
}

export async function POST(req: NextRequest) {
  let body: { address?: string; label?: string; chain_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { address, label, chain_ids } = body;

  if (!address || !isValidEVMAddress(address)) {
    return NextResponse.json({ error: 'Missing or invalid: address (0x...)' }, { status: 400 });
  }
  if (!label || label.trim() === '') {
    return NextResponse.json({ error: 'Missing: label (e.g. "My Main Wallet")' }, { status: 400 });
  }
  if (!chain_ids || chain_ids.length === 0) {
    return NextResponse.json({ error: 'Missing: chain_ids (e.g. ["1","137"])' }, { status: 400 });
  }

  const wallet = await addWallet(address.trim(), label.trim(), chain_ids);
  return NextResponse.json({ wallet }, { status: 201 });
}
