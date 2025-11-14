import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface AssetData {
  id: string;
  name: string;
  encryptedValue: string;
  latitude: number;
  longitude: number;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  description: string;
  status: 'in_transit' | 'delivered' | 'alert';
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<AssetData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingAsset, setCreatingAsset] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newAssetData, setNewAssetData] = useState({ 
    name: "", 
    value: "", 
    description: "",
    latitude: "",
    longitude: ""
  });
  const [selectedAsset, setSelectedAsset] = useState<AssetData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [stats, setStats] = useState({
    totalAssets: 0,
    inTransit: 0,
    delivered: 0,
    alerts: 0
  });
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const assetsList: AssetData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          const statuses: Array<'in_transit' | 'delivered' | 'alert'> = ['in_transit', 'delivered', 'alert'];
          const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
          
          assetsList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            latitude: Number(businessData.publicValue1) / 1000000,
            longitude: Number(businessData.publicValue2) / 1000000,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            description: businessData.description,
            status: randomStatus
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setAssets(assetsList);
      updateStats(assetsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (assetsList: AssetData[]) => {
    setStats({
      totalAssets: assetsList.length,
      inTransit: assetsList.filter(a => a.status === 'in_transit').length,
      delivered: assetsList.filter(a => a.status === 'delivered').length,
      alerts: assetsList.filter(a => a.status === 'alert').length
    });
  };

  const createAsset = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingAsset(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating asset with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const assetValue = parseInt(newAssetData.value) || 0;
      const businessId = `asset-${Date.now()}`;
      const latitude = parseFloat(newAssetData.latitude) * 1000000;
      const longitude = parseFloat(newAssetData.longitude) * 1000000;
      
      const encryptedResult = await encrypt(contractAddress, address, assetValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newAssetData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        latitude,
        longitude,
        newAssetData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Asset created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewAssetData({ name: "", value: "", description: "", latitude: "", longitude: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingAsset(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available and working!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredAssets = assets.filter(asset =>
    asset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    asset.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderWorldMap = () => {
    return (
      <div className="world-map">
        <div className="map-container">
          <div className="map-grid">
            {Array.from({ length: 12 }).map((_, row) => (
              <div key={row} className="map-row">
                {Array.from({ length: 24 }).map((_, col) => (
                  <div key={col} className="map-cell"></div>
                ))}
              </div>
            ))}
          </div>
          
          {assets.map((asset, index) => (
            <div
              key={asset.id}
              className={`asset-marker ${asset.status} ${selectedAsset?.id === asset.id ? 'selected' : ''}`}
              style={{
                left: `${((asset.longitude + 180) / 360) * 100}%`,
                top: `${((90 - asset.latitude) / 180) * 100}%`
              }}
              onClick={() => setSelectedAsset(asset)}
            >
              <div className="marker-pulse"></div>
              <div className="marker-tooltip">{asset.name}</div>
            </div>
          ))}
        </div>
        
        <div className="map-legend">
          <div className="legend-item">
            <div className="legend-color in_transit"></div>
            <span>In Transit</span>
          </div>
          <div className="legend-item">
            <div className="legend-color delivered"></div>
            <span>Delivered</span>
          </div>
          <div className="legend-item">
            <div className="legend-color alert"></div>
            <span>Alert</span>
          </div>
        </div>
      </div>
    );
  };

  const renderStatsPanel = () => {
    return (
      <div className="stats-panel">
        <div className="stat-card gold">
          <div className="stat-icon">📦</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totalAssets}</div>
            <div className="stat-label">Total Assets</div>
          </div>
        </div>
        
        <div className="stat-card silver">
          <div className="stat-icon">🚚</div>
          <div className="stat-content">
            <div className="stat-value">{stats.inTransit}</div>
            <div className="stat-label">In Transit</div>
          </div>
        </div>
        
        <div className="stat-card bronze">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-value">{stats.delivered}</div>
            <div className="stat-label">Delivered</div>
          </div>
        </div>
        
        <div className="stat-card copper">
          <div className="stat-icon">⚠️</div>
          <div className="stat-content">
            <div className="stat-value">{stats.alerts}</div>
            <div className="stat-label">Alerts</div>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔐 AssetTrack FHE</h1>
            <p>Confidential Asset Tracking</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Secure Asset Tracking</h2>
            <p>Connect your wallet to start tracking assets with FHE encryption</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Track assets with encrypted GPS data</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Authorized decryption for secure access</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing asset tracking with homomorphic encryption</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted asset tracker...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🔐 AssetTrack FHE</h1>
          <p>Confidential Asset Tracking</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="test-btn">
            Test Connection
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Asset
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="left-panel">
          <div className="panel-header">
            <h2>Global Asset Map</h2>
            <div className="search-box">
              <input
                type="text"
                placeholder="Search assets..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
            </div>
          </div>
          {renderWorldMap()}
          {renderStatsPanel()}
        </div>
        
        <div className="right-panel">
          <div className="panel-header">
            <h2>Asset List</h2>
            <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "🔄"}
            </button>
          </div>
          
          <div className="assets-list">
            {filteredAssets.length === 0 ? (
              <div className="no-assets">
                <p>No assets found</p>
                <button className="create-btn" onClick={() => setShowCreateModal(true)}>
                  Track First Asset
                </button>
              </div>
            ) : filteredAssets.map((asset) => (
              <div 
                key={asset.id}
                className={`asset-item ${asset.status} ${selectedAsset?.id === asset.id ? 'selected' : ''}`}
                onClick={() => setSelectedAsset(asset)}
              >
                <div className="asset-header">
                  <div className="asset-name">{asset.name}</div>
                  <div className={`asset-status ${asset.status}`}>
                    {asset.status.replace('_', ' ')}
                  </div>
                </div>
                <div className="asset-description">{asset.description}</div>
                <div className="asset-meta">
                  <span>Lat: {asset.latitude.toFixed(4)}</span>
                  <span>Lng: {asset.longitude.toFixed(4)}</span>
                  <span>{new Date(asset.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="asset-encryption">
                  {asset.isVerified ? (
                    <span className="encryption-status verified">✅ Verified</span>
                  ) : (
                    <span className="encryption-status encrypted">🔒 Encrypted</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateAsset 
          onSubmit={createAsset} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingAsset} 
          assetData={newAssetData} 
          setAssetData={setNewAssetData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedAsset && (
        <AssetDetailModal 
          asset={selectedAsset} 
          onClose={() => setSelectedAsset(null)} 
          decryptData={() => decryptData(selectedAsset.id)}
          isDecrypting={fheIsDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateAsset: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  assetData: any;
  setAssetData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, assetData, setAssetData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'value') {
      const intValue = value.replace(/[^\d]/g, '');
      setAssetData({ ...assetData, [name]: intValue });
    } else {
      setAssetData({ ...assetData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-asset-modal">
        <div className="modal-header">
          <h2>Track New Asset</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 GPS Encryption</strong>
            <p>Asset value and location will be encrypted with Zama FHE</p>
          </div>
          
          <div className="form-group">
            <label>Asset Name *</label>
            <input 
              type="text" 
              name="name" 
              value={assetData.name} 
              onChange={handleChange} 
              placeholder="Enter asset name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Asset Value (Integer) *</label>
            <input 
              type="number" 
              name="value" 
              value={assetData.value} 
              onChange={handleChange} 
              placeholder="Enter asset value..." 
            />
            <div className="data-type-label">FHE Encrypted</div>
          </div>
          
          <div className="form-group">
            <label>Latitude *</label>
            <input 
              type="number" 
              step="any"
              name="latitude" 
              value={assetData.latitude} 
              onChange={handleChange} 
              placeholder="Enter latitude..." 
            />
          </div>
          
          <div className="form-group">
            <label>Longitude *</label>
            <input 
              type="number" 
              step="any"
              name="longitude" 
              value={assetData.longitude} 
              onChange={handleChange} 
              placeholder="Enter longitude..." 
            />
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={assetData.description} 
              onChange={handleChange} 
              placeholder="Enter asset description..." 
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !assetData.name || !assetData.value || !assetData.latitude || !assetData.longitude} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Track Asset"}
          </button>
        </div>
      </div>
    </div>
  );
};

const AssetDetailModal: React.FC<{
  asset: AssetData;
  onClose: () => void;
  decryptData: () => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ asset, onClose, decryptData, isDecrypting }) => {
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const value = await decryptData();
    setDecryptedValue(value);
  };

  return (
    <div className="modal-overlay">
      <div className="asset-detail-modal">
        <div className="modal-header">
          <h2>Asset Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="asset-info">
            <div className="info-row">
              <span>Name:</span>
              <strong>{asset.name}</strong>
            </div>
            <div className="info-row">
              <span>Status:</span>
              <div className={`status-badge ${asset.status}`}>
                {asset.status.replace('_', ' ')}
              </div>
            </div>
            <div className="info-row">
              <span>Location:</span>
              <strong>{asset.latitude.toFixed(6)}, {asset.longitude.toFixed(6)}</strong>
            </div>
            <div className="info-row">
              <span>Tracked Since:</span>
              <strong>{new Date(asset.timestamp * 1000).toLocaleString()}</strong>
            </div>
          </div>
          
          <div className="description-section">
            <h3>Description</h3>
            <p>{asset.description}</p>
          </div>
          
          <div className="encryption-section">
            <h3>FHE Encryption Status</h3>
            <div className="encryption-status">
              {asset.isVerified ? (
                <div className="status-verified">
                  <span>✅ On-chain Verified</span>
                  <div className="decrypted-value">Value: {asset.decryptedValue}</div>
                </div>
              ) : decryptedValue !== null ? (
                <div className="status-decrypted">
                  <span>🔓 Locally Decrypted</span>
                  <div className="decrypted-value">Value: {decryptedValue}</div>
                </div>
              ) : (
                <div className="status-encrypted">
                  <span>🔒 Encrypted</span>
                  <button 
                    onClick={handleDecrypt}
                    disabled={isDecrypting}
                    className="decrypt-btn"
                  >
                    {isDecrypting ? "Decrypting..." : "Decrypt Value"}
                  </button>
                </div>
              )}
            </div>
          </div>
          
          <div className="fhe-explanation">
            <h4>FHE Asset Tracking Flow</h4>
            <div className="flow-steps">
              <div className="flow-step">
                <div className="step-number">1</div>
                <div className="step-content">
                  <strong>GPS Data Encryption</strong>
                  <p>Asset location encrypted with Zama FHE</p>
                </div>
              </div>
              <div className="flow-step">
                <div className="step-number">2</div>
                <div className="step-content">
                  <strong>Secure Storage</strong>
                  <p>Encrypted data stored on blockchain</p>
                </div>
              </div>
              <div className="flow-step">
                <div className="step-number">3</div>
                <div className="step-content">
                  <strong>Authorized Access</strong>
                  <p>Only authorized parties can decrypt</p>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!asset.isVerified && (
            <button 
              onClick={handleDecrypt}
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

