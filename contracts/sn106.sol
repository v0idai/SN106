// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface INonfungiblePositionManager {
    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function positions(
        uint256 tokenId
    )
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );

    function collect(
        CollectParams calldata params
    ) external payable returns (uint256 amount0, uint256 amount1);
}

interface IUniswapV3Factory {
    function getPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external view returns (address pool);
}

contract Sn106_UniswapV3 is Ownable, ReentrancyGuard, IERC721Receiver {
    using SafeERC20 for IERC20;

    struct PoolInfo {
        address poolAddress; // UniswapV3 pool address
        bool isActive;
    }

    struct Stake {
        address nftAddress; // position manager (NFT contract) address
        uint256 tokenId;
        address owner; // who staked
        address poolAddress; // direct pool address instead of poolId
        uint256 stakeTime;
        string hotkey;
        bool active;
    }

    // Events
    event PositionStaked(
        address indexed nft_address,
        uint256 indexed token_id,
        address indexed owner,
        address pool_address,
        string hotkey
    );

    event PositionUnstaked(
        address indexed nft_address,
        uint256 indexed token_id,
        address indexed owner,
        address pool_address,
        string hotkey
    );
    
    event FeesCollected(uint256 amount0, uint256 amount1);
    
    event PoolAdded(address indexed poolAddress);
    event PoolRemoved(address indexed poolAddress);

    // Pool management
    mapping(uint256 => PoolInfo) public pools; // poolId => PoolInfo
    uint256 public poolsCount;
    mapping(address => uint256) public poolIdByAddress;
    // Stakes
    mapping(uint256 => Stake) public stakesByToken; // tokenId => Stake

    // hotkey => list of tokenIds
    mapping(string => uint256[]) private tokenIdsByHotkey;
    // tokenId => index in tokenIdsByHotkey[hotkey] (plus 1). zero means not present.
    mapping(uint256 => uint256) private tokenIndexInHotkey;

    INonfungiblePositionManager public immutable positionManager;
    IUniswapV3Factory public immutable factory;

    constructor(
        address _positionManager,
        address _factory,
        address _owner
    ) Ownable(_owner) {
        require(_positionManager != address(0) && _factory != address(0) && _owner != address(0), "zero address");
        positionManager = INonfungiblePositionManager(_positionManager);
        factory = IUniswapV3Factory(_factory);
    }

    // ADMIN: add supported pool
    function addPool(address _poolAddress) external onlyOwner {
        require(_poolAddress != address(0), "zero pool");
        // simple dedupe: ensure _poolAddress not already added
        // for (uint256 i = 1; i <= poolsCount; i++) {
        //     require(pools[i].poolAddress != _poolAddress, "pool exists");
        // }
        require(poolIdByAddress[_poolAddress] == 0, "pool exists");
        poolsCount += 1;
        pools[poolsCount] = PoolInfo({poolAddress: _poolAddress, isActive: true});
        poolIdByAddress[_poolAddress] = poolsCount;
        emit PoolAdded(_poolAddress);
    }

    // Remove a pool by setting its exists flag to false
    function removePool(address _poolAddress) external onlyOwner {
        require(_poolAddress != address(0), "zero pool");
        require(poolIdByAddress[_poolAddress] != 0, "pool not found");
        pools[poolIdByAddress[_poolAddress]].isActive = false;
        // poolIdByAddress[_poolAddress] = 0;
        emit PoolRemoved(_poolAddress);
        // bool found = false;
        // for (uint256 i = 1; i <= poolsCount; i++) {
        //     if (pools[i].poolAddress == _poolAddress && pools[i].exists) {
        //         pools[i].exists = false;
        //         found = true;
        //         emit PoolRemoved(_poolAddress);
        //         break;
        //     }
        // }
        // require(found, "pool not found");
    }

    // Check if a pool address is supported
    function isPoolSupported(address _poolAddress) public view returns (bool) {
        if (_poolAddress == address(0)) return false;
        for (uint256 i = 1; i <= poolsCount; i++) {
            if (pools[i].poolAddress == _poolAddress && pools[i].isActive) {
                return true;
            }
        }
        return false;
    }

    // Stake a Uniswap V3 position NFT. _nftAddress is generally the NonfungiblePositionManager.
    // _poolAddress is the direct Uniswap V3 pool address.
    function stakePosition(
        uint256 _tokenId,
        address _poolAddress,
        string calldata _hotkey
    ) external nonReentrant {
        require(_poolAddress != address(0), "Invalid pool address");
        require(isPoolSupported(_poolAddress), "Pool not supported");
        address nftAddr = address(positionManager);

        // Verify that the position NFT indeed belongs to the provided pool by reading token details
        (
            ,
            ,
            address token0,
            address token1,
            uint24 fee,
            ,
            ,
            ,
            ,
            ,
            ,

        ) = positionManager.positions(_tokenId);
        address expectedPool = factory.getPool(token0, token1, fee);
        require(
            expectedPool == _poolAddress,
            "NFT position not from provided pool"
        );

        // Transfer the NFT into this contract.
        IERC721(nftAddr).safeTransferFrom(msg.sender, address(this), _tokenId);

        // Record stake
        stakesByToken[_tokenId] = Stake({
            nftAddress: nftAddr,
            tokenId: _tokenId,
            owner: msg.sender,
            poolAddress: _poolAddress,
            stakeTime: block.timestamp,
            hotkey: _hotkey,
            active: true
        });

        // push token id to hotkey index
        tokenIdsByHotkey[_hotkey].push(_tokenId);
        tokenIndexInHotkey[_tokenId] = tokenIdsByHotkey[_hotkey].length; // index+1

        emit PositionStaked(
            nftAddr,
            _tokenId,
            msg.sender,
            _poolAddress,
            _hotkey
        );
    }

    // Return tokenIds and pool addresses for a hotkey
    function getStakesByHotkey(
        string calldata _hotkey
    )
        external
        view
        returns (uint256[] memory tokenIds, address[] memory poolAddrs)
    {
        uint256[] storage arr = tokenIdsByHotkey[_hotkey];
        tokenIds = new uint256[](arr.length);
        poolAddrs = new address[](arr.length);
        for (uint256 i = 0; i < arr.length; i++) {
            uint256 t = arr[i];
            tokenIds[i] = t;
            poolAddrs[i] = stakesByToken[t].poolAddress;
        }
        return (tokenIds, poolAddrs);
    }

    // Compatible function for multicall integration - returns just tokenIds like reference contract
    function getStakedTokens(
        string calldata _hotkey
    ) external view returns (uint256[] memory) {
        return tokenIdsByHotkey[_hotkey];
    }

    // Optimized batch function: Get stakes for multiple hotkeys at once
    // Returns parallel arrays of tokenIds and poolAddrs for each hotkey
    // Designed to handle up to 256 hotkeys in a single call
    function getStakesByMultipleHotkeys(string[] calldata _hotkeys)
        external
        view
        returns (
            uint256[][] memory allTokenIds,
            address[][] memory allPoolAddrs
        )
    {
        allTokenIds = new uint256[][](_hotkeys.length);
        allPoolAddrs = new address[][](_hotkeys.length);
        
        for (uint256 i = 0; i < _hotkeys.length; i++) {
            uint256[] storage arr = tokenIdsByHotkey[_hotkeys[i]];
            uint256 len = arr.length;
            
            uint256[] memory tokenIds = new uint256[](len);
            address[] memory poolAddrs = new address[](len);
            
            for (uint256 j = 0; j < len; j++) {
                uint256 tokenId = arr[j];
                tokenIds[j] = tokenId;
                poolAddrs[j] = stakesByToken[tokenId].poolAddress;
            }
            
            allTokenIds[i] = tokenIds;
            allPoolAddrs[i] = poolAddrs;
        }
        
        return (allTokenIds, allPoolAddrs);
    }

    // Get all Active supported pool addresses
    function getAllPools() external view returns (address[] memory) {
        address[] memory activePools = new address[](poolsCount);
        uint256 idx = 0;
        for (uint256 i = 1; i <= poolsCount; i++) {
            if (pools[i].isActive) {
                activePools[idx] = pools[i].poolAddress;
                unchecked { idx++; }
            }
        }
        assembly {
            mstore(activePools, idx)
        }
        return activePools;
    }

    // Get pool address by pool ID
    function getPoolAddress(uint256 _poolId) external view returns (address) {
        require(_poolId > 0 && _poolId <= poolsCount, "Invalid pool ID");
        return pools[_poolId].poolAddress;
    }

    function getPoolIndex(address _poolAddress) external view returns (uint256) {
        return poolIdByAddress[_poolAddress];
    }

    // Returns the number of stakes under a hotkey (for pagination)
    function getHotkeyStakeCount(
        string calldata _hotkey
    ) external view returns (uint256) {
        return tokenIdsByHotkey[_hotkey].length;
    }

    // Paginated retrieval of stakes for a hotkey: [offset, offset+limit)
    function getStakesByHotkeyRange(
        string calldata _hotkey,
        uint256 _offset,
        uint256 _limit
    )
        external
        view
        returns (uint256[] memory tokenIds, address[] memory poolAddrs)
    {
        uint256[] storage arr = tokenIdsByHotkey[_hotkey];
        uint256 n = arr.length;
        if (_offset >= n) {
            return (new uint256[](0), new address[](0));
        }
        uint256 endExclusive = _offset + _limit;
        if (endExclusive > n) {
            endExclusive = n;
        }
        uint256 outLen = endExclusive - _offset;
        tokenIds = new uint256[](outLen);
        poolAddrs = new address[](outLen);
        for (uint256 i = 0; i < outLen; i++) {
            uint256 t = arr[_offset + i];
            tokenIds[i] = t;
            poolAddrs[i] = stakesByToken[t].poolAddress;
        }
        return (tokenIds, poolAddrs);
    }

    // Unstake position: collect fees to this contract, then transfer NFT back to original owner
    function unstakePosition(uint256 _tokenId) external nonReentrant {
        Stake storage s = stakesByToken[_tokenId];
        require(s.active, "not staked");
        require(s.owner == msg.sender, "not stake owner");

        // collect all fees owed to the position and send to this contract
        // amountMax uses max uint128 to collect all
        INonfungiblePositionManager.CollectParams
            memory params = INonfungiblePositionManager.CollectParams({
                tokenId: _tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            });
        // Call collect directly on the position manager interface
        (uint256 amount0, uint256 amount1) = positionManager.collect(params);

        // mark stake inactive
        s.active = false;

        // remove from hotkey index: swap-pop
        string memory hk = s.hotkey;
        uint256 idxPlus1 = tokenIndexInHotkey[_tokenId];
        if (idxPlus1 != 0) {
            uint256 idx = idxPlus1 - 1;
            uint256[] storage list = tokenIdsByHotkey[hk];
            uint256 last = list[list.length - 1];
            if (idx != list.length - 1) {
                list[idx] = last;
                tokenIndexInHotkey[last] = idx + 1;
            }
            list.pop();
            tokenIndexInHotkey[_tokenId] = 0;
        }

        // transfer NFT back to owner
        IERC721(s.nftAddress).safeTransferFrom(
            address(this),
            s.owner,
            _tokenId
        );

        emit PositionUnstaked(
            s.nftAddress,
            _tokenId,
            s.owner,
            s.poolAddress,
            hk
        );

        emit FeesCollected(amount0, amount1);
    }

    // Admin: withdraw ERC20 tokens (e.g., collected fees) from contract
    function withdrawTradingFees(
        address _token,
        uint256 _amount
    ) external onlyOwner {
        require(_token != address(0), "zero token");
        IERC20(_token).safeTransfer(owner(), _amount);
    }

    // ERC721Receiver impl so contract can accept NFTs via safeTransferFrom
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
