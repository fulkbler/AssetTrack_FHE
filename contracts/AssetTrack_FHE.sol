pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract AssetTrack_FHE is ZamaEthereumConfig {
    struct Asset {
        string assetId;
        euint32 encryptedLocation;
        uint256 timestamp;
        address owner;
        bool isVerified;
        uint32 decryptedLocation;
    }

    mapping(string => Asset) public assets;
    string[] public assetIds;

    event AssetRegistered(string indexed assetId, address indexed owner);
    event LocationVerified(string indexed assetId, uint32 decryptedLocation);

    constructor() ZamaEthereumConfig() {}

    function registerAsset(
        string calldata assetId,
        externalEuint32 encryptedLocation,
        bytes calldata inputProof
    ) external {
        require(bytes(assets[assetId].assetId).length == 0, "Asset already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedLocation, inputProof)), "Invalid encrypted input");

        assets[assetId] = Asset({
            assetId: assetId,
            encryptedLocation: FHE.fromExternal(encryptedLocation, inputProof),
            timestamp: block.timestamp,
            owner: msg.sender,
            isVerified: false,
            decryptedLocation: 0
        });

        FHE.allowThis(assets[assetId].encryptedLocation);
        FHE.makePubliclyDecryptable(assets[assetId].encryptedLocation);

        assetIds.push(assetId);
        emit AssetRegistered(assetId, msg.sender);
    }

    function verifyLocation(
        string calldata assetId,
        bytes memory abiEncodedClearLocation,
        bytes memory decryptionProof
    ) external {
        require(bytes(assets[assetId].assetId).length > 0, "Asset does not exist");
        require(!assets[assetId].isVerified, "Location already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(assets[assetId].encryptedLocation);

        FHE.checkSignatures(cts, abiEncodedClearLocation, decryptionProof);

        uint32 decodedLocation = abi.decode(abiEncodedClearLocation, (uint32));
        assets[assetId].decryptedLocation = decodedLocation;
        assets[assetId].isVerified = true;

        emit LocationVerified(assetId, decodedLocation);
    }

    function getEncryptedLocation(string calldata assetId) external view returns (euint32) {
        require(bytes(assets[assetId].assetId).length > 0, "Asset does not exist");
        return assets[assetId].encryptedLocation;
    }

    function getAssetDetails(string calldata assetId) external view returns (
        string memory assetId_,
        uint256 timestamp,
        address owner,
        bool isVerified,
        uint32 decryptedLocation
    ) {
        require(bytes(assets[assetId].assetId).length > 0, "Asset does not exist");
        Asset storage asset = assets[assetId];

        return (
            asset.assetId,
            asset.timestamp,
            asset.owner,
            asset.isVerified,
            asset.decryptedLocation
        );
    }

    function getAllAssetIds() external view returns (string[] memory) {
        return assetIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

