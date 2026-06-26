import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying from:', deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Balance:', ethers.formatEther(balance), 'MATIC/ETH');

  const Token = await ethers.getContractFactory('MyToken');
  const token = await Token.deploy(
    'My USDT',   // name
    'MUSDT',     // symbol
    6,           // decimals (same as real USDT)
    deployer.address  // owner (can mint)
  );

  await token.waitForDeployment();
  const address = await token.getAddress();
  console.log('Token deployed to:', address);
  console.log('Owner (can mint):', deployer.address);

  // Mint 1,000,000 tokens to deployer
  const mintAmount = ethers.parseUnits('1000000', 6);
  const tx = await token.mint(deployer.address, mintAmount);
  await tx.wait();
  console.log('Minted 1,000,000 MUSDT to:', deployer.address);
  console.log('Mint TX:', tx.hash);
}

main().catch(console.error);
