import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as fs from 'fs';

// Read private key from .env.local
function getKey(): string {
  try {
    const env = fs.readFileSync('.env.local', 'utf8');
    const match = env.match(/^SENDER_WALLET_PRIVATE_KEY=(.+)$/m);
    return match ? match[1].trim() : '';
  } catch { return ''; }
}

const config: HardhatUserConfig = {
  solidity: '0.8.20',
  networks: {
    polygon: {
      url: 'https://polygon.publicnode.com',
      accounts: [getKey()].filter(Boolean),
    },
    ethereum: {
      url: 'https://ethereum.publicnode.com',
      accounts: [getKey()].filter(Boolean),
    },
  },
};

export default config;
