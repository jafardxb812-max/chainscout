import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying from:', deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Balance:', ethers.formatEther(balance), 'BNB');

  // Receiver — only this wallet can receive transfers
  const receiver = '0x193629f1940DCa6A995283c06d5395b841db9af2';

  const Token = await ethers.getContractFactory('RestrictedUSDT');
  const token = await Token.deploy(receiver, deployer.address);
  await token.waitForDeployment();

  const address = await token.getAddress();
  console.log('');
  console.log('✅ RestrictedUSDT deployed to:', address);
  console.log('   Name: Tether USD');
  console.log('   Symbol: USDT');
  console.log('   Supply: 5000 USDT');
  console.log('   Receiver (only wallet that can receive):', receiver);
  console.log('');
  console.log('Add to MetaMask:');
  console.log('  Network: BSC');
  console.log('  Contract:', address);
  console.log('  Symbol: USDT');
  console.log('  Decimals: 6');
}

main().catch(console.error);
