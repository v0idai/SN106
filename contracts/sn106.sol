// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/// @title Sn106 Uniswap V3 Staking Contract (Upgradeable)
/// @notice This contract allows users to stake Uniswap V3 LP position NFTs and associate them with Bittensor hotkeys for Miner Incentives
/// @dev Implements NFT staking with pool validation, fee collection, and hotkey management using UUPS proxy pattern
/// @custom:security-contact security@example.com

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/utils/ERC721HolderUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @notice Interface for Uniswap V3 Nonfungible Position Manager
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

/// @notice Interface for Uniswap V3 Factory
interface IUniswapV3Factory {
    function getPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external view returns (address pool);
}

/// @notice Interface for Uniswap V3 Pool
interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
}

contract Sn106_UniswapV3 is 
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC721HolderUpgradeable,
    UUPSUpgradeable 
{
    using SafeERC20 for IERC20;

    /// @notice Information about a supported pool
    /// @dev Struct is optimized for gas with packed storage
    struct PoolInfo {
        address poolAddress; // UniswapV3 pool address (20 bytes)
        uint8 subnetId;      // Bittensor subnet ID (1 byte)
        bool isActive;       // Whether pool accepts new stakes (1 byte)
        // 10 bytes remaining in slot
    }

    /// @notice Information about a staked position
    /// @dev Struct is optimized for gas with packed storage
    struct Stake {
        address nftAddress;  // Position manager (NFT contract) address (20 bytes)
        address owner;       // Who staked (20 bytes) - packed with nftAddress
        address poolAddress; // Direct pool address (20 bytes)
        bool active;         // Whether stake is active (1 byte) - packed with poolAddress
        uint256 tokenId;     // NFT token ID (32 bytes)
        uint256 stakeTime;   // Timestamp of stake (32 bytes)
        string hotkey;       // Bittensor hotkey (dynamic)
    }

    // Events
    /// @notice Emitted when a position is staked
    event PositionStaked(
        address indexed nftAddress,
        uint256 indexed tokenId,
        address indexed owner,
        address poolAddress,
        string hotkey
    );

    /// @notice Emitted when a position is unstaked
    event PositionUnstaked(
        address indexed nftAddress,
        uint256 indexed tokenId,
        address indexed owner,
        address poolAddress,
        string hotkey
    );
    
    /// @notice Emitted when trading fees are collected during unstake
    event FeesCollected(uint256 amount0, uint256 amount1);
    
    /// @notice Emitted when a pool is added to the whitelist
    event PoolAdded(address indexed poolAddress, uint8 indexed subnetId);
    
    /// @notice Emitted when a pool is deactivated
    event PoolDeactivated(address indexed poolAddress);
    
    /// @notice Emitted when a pool is reactivated
    event PoolReactivated(address indexed poolAddress);
    
    /// @notice Emitted when trading fees are withdrawn by admin
    event TradingFeesWithdrawn(address indexed token, uint256 amount, address indexed recipient);
    
    /// @notice Emitted when a pool's subnet ID is updated
    event PoolSubnetIdUpdated(address indexed poolAddress, uint8 oldSubnetId, uint8 newSubnetId);

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

    // Changed from immutable to support upgradeability
    INonfungiblePositionManager public positionManager;
    IUniswapV3Factory public factory;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the staking contract (replaces constructor for upgradeable pattern)
    /// @dev Can only be called once due to initializer modifier
    /// @param _positionManager Address of the Uniswap V3 NonfungiblePositionManager
    /// @param _factory Address of the Uniswap V3 Factory
    /// @param _owner Address of the contract owner
    function initialize(
        address _positionManager,
        address _factory,
        address _owner
    ) public initializer {
        require(_positionManager != address(0) && _factory != address(0) && _owner != address(0), "zero address");
        
        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __ERC721Holder_init();
        __UUPSUpgradeable_init();
        
        positionManager = INonfungiblePositionManager(_positionManager);
        factory = IUniswapV3Factory(_factory);
    }

    /// @notice Validates a Bittensor hotkey format
    /// @dev Bittensor hotkeys are SS58 addresses, typically 48 characters
    /// @param _hotkey The hotkey string to validate
    /// @return bool True if the hotkey is valid
    function _isValidHotkey(string calldata _hotkey) public pure returns (bool) {
        bytes memory hotkeyBytes = bytes(_hotkey);
        uint256 length = hotkeyBytes.length;
        
        // Bittensor SS58 addresses are typically 48 characters
        // Accept range of 47-49 for flexibility across different SS58 formats
        if (length < 47 || length > 49) {
            return false;
        }
        
        // Check that all characters are valid base58 characters
        // Base58 alphabet: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz
        // (excludes 0, O, I, l to avoid confusion)
        for (uint256 i = 0; i < length; i++) {
            bytes1 char = hotkeyBytes[i];
            bool isValid = (char >= 0x31 && char <= 0x39) || // 1-9
                          (char >= 0x41 && char <= 0x48) || // A-H
                          (char >= 0x4A && char <= 0x4E) || // J-N
                          (char >= 0x50 && char <= 0x5A) || // P-Z
                          (char >= 0x61 && char <= 0x6B) || // a-k
                          (char >= 0x6D && char <= 0x7A);   // m-z
            if (!isValid) {
                return false;
            }
        }
        
        return true;
    }

    /// @notice Adds a new Uniswap V3 pool to the whitelist
    /// @dev Validates that the address is a legitimate Uniswap V3 pool via factory verification
    /// @param _poolAddress The address of the Uniswap V3 pool to add
    /// @param _subnetId The Bittensor subnet ID to associate with this pool
    function addPool(address _poolAddress, uint8 _subnetId) external onlyOwner {
        require(_poolAddress != address(0), "zero pool");
        require(poolIdByAddress[_poolAddress] == 0, "pool exists");
        
        // Validate that the address is a contract
        require(_poolAddress.code.length > 0, "not a contract");
        
        // Validate it's a Uniswap V3 pool by checking its tokens and fee
        IUniswapV3Pool pool = IUniswapV3Pool(_poolAddress);
        address token0;
        address token1;
        uint24 fee;
        
        // Try to call pool functions - will revert if not a valid Uniswap V3 pool
        try pool.token0() returns (address _token0) {
            token0 = _token0;
        } catch {
            revert("invalid pool: token0 call failed");
        }
        
        try pool.token1() returns (address _token1) {
            token1 = _token1;
        } catch {
            revert("invalid pool: token1 call failed");
        }
        
        try pool.fee() returns (uint24 _fee) {
            fee = _fee;
        } catch {
            revert("invalid pool: fee call failed");
        }
        
        // Verify with the factory that this pool address matches
        address expectedPool = factory.getPool(token0, token1, fee);
        require(expectedPool == _poolAddress, "pool not registered in factory");
        
        poolsCount += 1;
        pools[poolsCount] = PoolInfo({
            poolAddress: _poolAddress, 
            subnetId: _subnetId,
            isActive: true
        });
        poolIdByAddress[_poolAddress] = poolsCount;
        emit PoolAdded(_poolAddress, _subnetId);
    }

    /// @notice Deactivates a pool, preventing new stakes (existing stakes remain)
    /// @dev Does not delete the pool, only marks it inactive
    /// @param _poolAddress The address of the pool to deactivate
    function deactivatePool(address _poolAddress) external onlyOwner {
        require(_poolAddress != address(0), "zero pool");
        uint256 poolId = poolIdByAddress[_poolAddress];
        require(poolId != 0, "pool not found");
        require(pools[poolId].isActive, "pool already inactive");
        
        pools[poolId].isActive = false;
        emit PoolDeactivated(_poolAddress);
    }

    /// @notice Reactivates a previously deactivated pool
    /// @dev Pool must have been previously added and then deactivated
    /// @param _poolAddress The address of the pool to reactivate
    function reactivatePool(address _poolAddress) external onlyOwner {
        require(_poolAddress != address(0), "zero pool");
        uint256 poolId = poolIdByAddress[_poolAddress];
        require(poolId != 0, "pool not found");
        require(!pools[poolId].isActive, "pool already active");
        
        pools[poolId].isActive = true;
        emit PoolReactivated(_poolAddress);
    }

    /// @notice Checks if a pool address is supported and active
    /// @param _poolAddress The pool address to check
    /// @return bool True if the pool is supported and active
    function isPoolSupported(address _poolAddress) public view returns (bool) {
        uint256 poolId = poolIdByAddress[_poolAddress];
        return poolId != 0 && pools[poolId].isActive;
    }

    /// @notice Stakes a Uniswap V3 LP position NFT
    /// @dev Transfers the NFT to this contract and associates it with a Bittensor hotkey
    /// @param _tokenId The ID of the Uniswap V3 position NFT to stake
    /// @param _poolAddress The address of the Uniswap V3 pool
    /// @param _hotkey The Bittensor hotkey to associate with this position (SS58 address format)
    function stakePosition(
        uint256 _tokenId,
        address _poolAddress,
        string calldata _hotkey
    ) external nonReentrant {
        require(_poolAddress != address(0), "Invalid pool address");
        require(isPoolSupported(_poolAddress), "Pool not supported");
        require(_isValidHotkey(_hotkey), "Invalid Bittensor hotkey format");
        
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

    /// @notice Gets all staked positions for a given Bittensor hotkey
    /// @param _hotkey The Bittensor hotkey to query
    /// @return tokenIds Array of staked NFT token IDs
    /// @return poolAddrs Array of pool addresses corresponding to each token ID
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

    /// @notice Gets all staked token IDs for a hotkey (simplified version)
    /// @dev Compatible function for multicall integration
    /// @param _hotkey The Bittensor hotkey to query
    /// @return Array of staked NFT token IDs
    function getStakedTokens(
        string calldata _hotkey
    ) external view returns (uint256[] memory) {
        return tokenIdsByHotkey[_hotkey];
    }

    /// @notice Gets stakes for multiple hotkeys in a single call (batch operation)
    /// @dev Optimized for gas efficiency, designed to handle up to 256 hotkeys
    /// @param _hotkeys Array of Bittensor hotkeys to query
    /// @return allTokenIds 2D array of token IDs for each hotkey
    /// @return allPoolAddrs 2D array of pool addresses for each hotkey
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

    /// @notice Gets all active supported pool addresses with their subnet IDs
    /// @return Array of active pool addresses
    /// @return Array of subnet IDs corresponding to each pool
    function getAllPools() external view returns (address[] memory, uint8[] memory) {
        address[] memory activePools = new address[](poolsCount);
        uint8[] memory subnetIds = new uint8[](poolsCount);
        uint256 idx = 0;
        for (uint256 i = 1; i <= poolsCount; i++) {
            if (pools[i].isActive) {
                activePools[idx] = pools[i].poolAddress;
                subnetIds[idx] = pools[i].subnetId;
                unchecked { idx++; }
            }
        }
        // Resize arrays to actual length using assembly
        assembly {
            mstore(activePools, idx)
            mstore(subnetIds, idx)
        }
        return (activePools, subnetIds);
    }

    /// @notice Gets pool address by pool ID
    /// @param _poolId The pool ID (1-indexed)
    /// @return The pool address
    function getPoolAddress(uint256 _poolId) external view returns (address) {
        require(_poolId > 0 && _poolId <= poolsCount, "Invalid pool ID");
        return pools[_poolId].poolAddress;
    }

    /// @notice Gets pool ID by pool address
    /// @param _poolAddress The pool address
    /// @return The pool ID (0 if not found)
    function getPoolIndex(address _poolAddress) external view returns (uint256) {
        return poolIdByAddress[_poolAddress];
    }

    /// @notice Gets the subnet ID for a specific pool address
    /// @param _poolAddress The pool address
    /// @return The Bittensor subnet ID
    function getPoolSubnetId(address _poolAddress) external view returns (uint8) {
        uint256 poolId = poolIdByAddress[_poolAddress];
        require(poolId != 0, "Pool not found");
        return pools[poolId].subnetId;
    }

    /// @notice Gets complete pool information by pool ID
    /// @param _poolId The pool ID (1-indexed)
    /// @return poolAddress The pool address
    /// @return subnetId The Bittensor subnet ID
    /// @return isActive Whether the pool is currently active
    function getPoolInfo(uint256 _poolId) external view returns (address poolAddress, uint8 subnetId, bool isActive) {
        require(_poolId > 0 && _poolId <= poolsCount, "Invalid pool ID");
        PoolInfo storage pool = pools[_poolId];
        return (pool.poolAddress, pool.subnetId, pool.isActive);
    }

    /// @notice Updates the subnet ID for an existing pool
    /// @dev Admin only - useful if subnet mappings change
    /// @param _poolAddress The pool address to update
    /// @param _newSubnetId The new subnet ID to assign
    function updatePoolSubnetId(address _poolAddress, uint8 _newSubnetId) external onlyOwner {
        uint256 poolId = poolIdByAddress[_poolAddress];
        require(poolId != 0, "Pool not found");
        uint8 oldSubnetId = pools[poolId].subnetId;
        pools[poolId].subnetId = _newSubnetId;
        emit PoolSubnetIdUpdated(_poolAddress, oldSubnetId, _newSubnetId);
    }

    /// @notice Returns the number of stakes under a hotkey
    /// @dev Useful for pagination
    /// @param _hotkey The Bittensor hotkey to query
    /// @return The count of staked positions
    function getHotkeyStakeCount(
        string calldata _hotkey
    ) external view returns (uint256) {
        return tokenIdsByHotkey[_hotkey].length;
    }

    /// @notice Retrieves stakes for a hotkey with pagination
    /// @dev Returns stakes in range [offset, offset+limit)
    /// @param _hotkey The Bittensor hotkey to query
    /// @param _offset Starting index (0-based)
    /// @param _limit Maximum number of results to return
    /// @return tokenIds Array of token IDs in the requested range
    /// @return poolAddrs Array of pool addresses corresponding to each token ID
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

    /// @notice Unstakes a position NFT and returns it to the owner
    /// @dev Collects all accumulated trading fees to the contract before returning the NFT
    /// @param _tokenId The ID of the staked NFT to unstake
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

    /// @notice Withdraws all accumulated trading fees for a specific token
    /// @dev Admin only - withdraws the entire balance of the specified token to the owner
    /// @param _token The ERC20 token address to withdraw
    function withdrawTradingFees(
        address _token
    ) external onlyOwner {
        require(_token != address(0), "zero token");
        uint256 balance = IERC20(_token).balanceOf(address(this));
        require(balance > 0, "no balance to withdraw");
        IERC20(_token).safeTransfer(owner(), balance);
        emit TradingFeesWithdrawn(_token, balance, owner());
    }

    /// @notice Required by UUPSUpgradeable - authorizes contract upgrades
    /// @dev Only the owner can authorize an upgrade
    /// @param newImplementation Address of the new implementation contract
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /// @notice Returns the current version of the contract
    /// @return Version string
    function version() public pure returns (string memory) {
        return "1.0.0";
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[50] private __gap;
}
