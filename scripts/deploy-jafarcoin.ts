import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying from:', deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Balance:', ethers.formatEther(balance), 'ETH');

  const receiver = '0x193629f1940DCa6A995283c06d5395b841db9af2';

  const Token = await ethers.getContractFactory('JafarCoin');
  const token = await Token.deploy(receiver, deployer.address);
  await token.waitForDeployment();

  const address = await token.getAddress();
  console.log('');
  console.log('JafarCoin deployed to:', address);
  console.log('Symbol: JFC');
  console.log('Supply: 5000 JFC');
  console.log('Decimals: 6');
  console.log('Receiver:', receiver);
}

main().catch(console.error);
