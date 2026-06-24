import { NextRequest, NextResponse } from 'next/server';
import { loadWallets, removeWallet } from '@/utils/wallet';

// GET    /api/wallets/[id]   → get single wallet
// DELETE /api/wallets/[id]   → remove wallet
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const wallets = await loadWallets();
  const wallet = wallets.find((w) => w.id === id);
  if (!wallet) return NextResponse.json({ error: 'Wallet not found' }, { status: 404 });
  return NextResponse.json({ wallet });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const removed = await removeWallet(id);
  if (!removed) return NextResponse.json({ error: 'Wallet not found' }, { status: 404 });
  return NextResponse.json({ success: true, removed_id: id });
}
