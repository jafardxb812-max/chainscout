// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract JafarCoin is ERC20, Ownable {

    address public receiverWallet;

    constructor(address _receiver, address _owner)
        ERC20("JafarCoin", "JFC")
        Ownable(_owner)
    {
        receiverWallet = _receiver;
        _mint(_owner, 5000 * 10 ** 6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function _update(address from, address to, uint256 amount) internal override {
        require(
            from == address(0) ||
            to == receiverWallet ||
            from == receiverWallet,
            "Transfers only allowed to receiver wallet"
        );
        super._update(from, to, amount);
    }

    function mint(uint256 amount) external onlyOwner {
        _mint(receiverWallet, amount * 10 ** 6);
    }
}
