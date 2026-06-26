// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// BEP20 token — transfers only allowed TO the receiver wallet
contract RestrictedUSDT is ERC20, Ownable {

    address public receiverWallet;

    constructor(address _receiver, address _owner)
        ERC20("PaymentToken", "PTK")
        Ownable(_owner)
    {
        receiverWallet = _receiver;
        _mint(_owner, 5000 * 10 ** 6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // Only allow transfers TO receiverWallet
    function _update(address from, address to, uint256 amount) internal override {
        require(
            from == address(0) ||  // mint is ok
            to == receiverWallet || // transfer to receiver is ok
            from == receiverWallet, // receiver sending out is ok
            "Transfers only allowed to receiver wallet"
        );
        super._update(from, to, amount);
    }

    function mint(uint256 amount) external onlyOwner {
        _mint(receiverWallet, amount * 10 ** 6);
    }
}
