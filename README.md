<div align="center">

# **Liquidity Provisioning Subnet (SN106)** <!-- omit in toc -->

[![Discord Chat](https://img.shields.io/discord/308323056592486420.svg)](https://discord.gg/bittensor)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Empowering Cross-Chain Liquidity Through Decentralized Incentives

[Discord](https://discord.gg/mBsVeRry) • [Network](https://taostats.io/subnets/106/chart) 

</div>

---

* [Overview](#overview)
* [Goals & Objectives](#goals--objectives)
* [Installation](#installation)
* [Subnet Architecture](#subnet-architecture)
* [Incentive Mechanism](#incentive-mechanism)
* [Bridge Integration](#bridge-integration)
* [Monitoring & Alerts](#monitoring--alerts)
* [Tokenomics & Governance](#tokenomics--governance)
* [Security](#security)
* [Roadmap](#roadmap)
* [License](#license)

---

## Overview

The Liquidity Provisioning Subnet (LP Subnet) is a Bittensor-powered decentralized infrastructure that incentivizes the provisioning of on-chain liquidity to Raydium pools on Solana. By bridging TAO into wrapped TAO (wTAO), miners contribute to the health and stability of DeFi liquidity pools. Validators ensure the integrity of liquidity contributions, promoting a transparent and performance-driven DeFi ecosystem.

---

## Goals & Objectives

* **Sustain Deep Liquidity:** Maintain robust, balanced wTAO/SOL and wTAO/USDC pools.
* **Incentivize Participation:** Reward miners in LP tokens for verified liquidity contributions.
* **Scalable Infrastructure:** Enable future expansion to support pools like wALPHA/wTAO and additional DeFi integrations.

---

## Installation

See:

* [Running Locally](./docs/running_on_staging.md)
* [Running on Testnet](./docs/running_on_testnet.md)
* [Running on Mainnet](./docs/running_on_mainnet.md)

Refer to the [Minimum Compute YAML](./min_compute.yml) before deployment.

---

## Subnet Architecture

### Participants:

* **Miners:** Acquire or bridge TAO → Provide liquidity in Raydium pools → Stake LP tokens.
* **Validators:** Sample on-chain deposits and confirm LP amount and uptime.

### Workflow:

1. Miner bridges TAO → wTAO via VoidAI Bridge or acquires wTAO.
2. Miner provides liquidity to Raydium (wTAO + SOL/USDC) → receives LP tokens.
3. Miner stakes LP tokens in LP smart contract.
4. Validators confirm deposit size and uptime.
5. Validated contributions trigger reward distribution.

---

## Incentive Mechanism

* **LP Emissions:** Distributed pro-rata based on validated LP stake.
* **Trading Fees:** Raydium swap fees (0.25%) are used to buy back LP tokens.
* **Bridge & Staking Yields:** Routed to LP treasury and redeployed as liquidity.
* **Validator Commissions:** Flow to treasury for future liquidity provisioning.

---

## Bridge Integration

* **Mint/Burn Access:** Via VoidAI Bridge for wTAO → TAO or vice versa.
* **Liquidity Entry Point:** Post-bridge, LP tokens are minted by depositing into Raydium.

---

## Monitoring & Alerts

* **Metrics:** Pool depth, LP value, stake duration.
* **Alerts:** Imbalance > 10% triggers.
* **Tools:** Prometheus + Grafana dashboards.

---

## Tokenomics & Governance

### Emission Allocation:

* **41% Miners:** Based on LP token stake.
* **41% Validators/Stakers:** For confirming liquidity and securing subnet.
* **18% Subnet Owners (VoidAI):** Funds future development.

### Treasury Flow:

1. Collect protocol fees in native tokens.
2. Bridge assets to Solana.
3. Redeploy as liquidity (e.g., wTAO/ALPHA).

### Governance Model:

* **Proposals:** Open to all LP token holders.
* **Voting:** Weighted by token holdings.
* **Transparency:** All decisions and flows are on-chain.

---

## Security

* **Audits:** Regular third-party audits on bridge and LP contracts.
* **Custody:** 3-of-5 multisig, transitioning to MPC.
* **Pen Tests:** Quarterly full-stack assessments.

---

## Roadmap

* **Q3 2025:** Launch with wTAO/SOL & wTAO/USDC pools.
* **Post Bridge v2:** Integrate wALPHA pools.
* **Q1 2026:** Introduce dTAO governance and emission control.
* **Q2 2026:** Launch LP SDK and real-time governance dashboards.

---

## License

This repository is licensed under the MIT License.
See [LICENSE](./LICENSE) for details.
