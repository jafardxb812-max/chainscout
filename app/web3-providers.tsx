'use client';

import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  mainnet, polygon, arbitrum,
} from '@reown/appkit/networks';
import { ReactNode, useState } from 'react';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? 'no-project-id';

const networks = [mainnet, polygon, arbitrum];
const wagmiAdapter = new WagmiAdapter({ networks, projectId });

// Only initialise AppKit (WalletConnect modal) when a real project ID is set
if (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID) {
  const { createAppKit } = require('@reown/appkit/react') as typeof import('@reown/appkit/react');
  createAppKit({
    adapters: [wagmiAdapter],
    networks: networks as unknown as Parameters<typeof createAppKit>[0]['networks'],
    projectId,
    metadata: {
      name: 'Chainscout Wallet',
      description: 'EVM Wallet Dashboard',
      url: 'http://localhost:3000',
      icons: ['/favicon-32x32.png'],
    },
    features: { analytics: false, email: false, socials: false },
  });
}

export const walletConnectEnabled = !!process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

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
