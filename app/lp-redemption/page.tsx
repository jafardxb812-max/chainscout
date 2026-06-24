import LPRedemption from '@/components/LPRedemption';

export const metadata = {
  title: 'PancakeSwap LP Token Redemption | Chainscout',
  description: 'Redeem your PancakeSwap V2 LP tokens back to USDT BEP-20 and WBNB on BSC.',
};

export default function LPRedemptionPage() {
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 py-12 px-4">
      <LPRedemption />
    </main>
  );
}
