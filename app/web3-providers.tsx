'use client';

import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  mainnet, polygon, bsc, arbitrum, optimism, base, avalanche,
} from '@reown/appkit/networks';
import { ReactNode, useState } from 'react';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

const networks = [mainnet, polygon, bsc, arbitrum, optimism, base, avalanche] as const;

const wagmiAdapter = new WagmiAdapter({ networks, projectId });

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata: {
    name: 'Chainscout Wallet',
    description: 'EVM Wallet Dashboard',
    url: 'http://localhost:3002',
    icons: ['/favicon-32x32.png'],
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
});

export function Web3Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
