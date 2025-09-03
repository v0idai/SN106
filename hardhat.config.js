require("@nomicfoundation/hardhat-toolbox");
require("hardhat-deploy");
const path = require("path");

require("dotenv").config({
  path: path.resolve(process.cwd(), process.env.HARDHAT_NETWORK === 'sepolia' ? '.env.local' : '.env'),
  override: true
});

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  defaultNetwork: "hardhat",
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  networks: {
    hardhat: {
      // Default Hardhat network config
    },
  },
};
