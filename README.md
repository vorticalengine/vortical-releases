# Vortical — Pump.fun Automation Bot

**Download the latest release below. Full functionality details and security model explained here.**

---

## Download

| Platform | File |
|---|---|
| Windows 10/11 (64-bit) | [Vortical Setup 1.0.65.exe](https://github.com/vorticaltools/vortical-releases/releases/latest) |
| macOS Intel | [Vortical-1.0.65.dmg](https://github.com/vorticaltools/vortical-releases/releases/latest) |
| macOS Apple Silicon | [Vortical-1.0.65-arm64.dmg](https://github.com/vorticaltools/vortical-releases/releases/latest) |

> **Website:** [vortical.io](https://vortical.io)

---

## What is Vortical?

Vortical is a desktop application that automates Pump.fun token launches on Solana. It runs entirely on your local machine — no cloud, no shared servers, no third-party access to your funds or wallets.

The bot handles the full lifecycle of a Pump.fun token launch across 6 automated phases.

---

## 6-Phase Automation Workflow

### Phase 1 — Token Creation
- Creates a Metaplex token with your custom name, symbol, image and social links
- Uploads token metadata to **Arweave** (permanent, decentralised storage — not our servers)
- Initialises the Pump.fun liquidity pool on-chain

### Phase 2 — Creator Buy
- Creator wallet purchases tokens immediately at launch
- Establishes an initial price signal
- Positions creator tokens for recovery sell in Phase 4

### Phase 3 — Coordinated Bulk Buy
- 10–50+ buyer wallets fire in rapid sequential bursts through your own Solana RPC endpoint
- Each burst appears organic on-chain
- Recommended RPC: **Alchemy Prepay** for lowest latency and highest rate limits

### Phase 4 — Graduated Sell
- Creator wallet sells tokens to recover the initial SOL investment
- Removes approximately 90% of tokens from circulation
- Triggers natural price appreciation from reduced supply

### Phase 5 — Progressive Profit Taking
- Continuous WebSocket price monitoring via Pump.fun live feed
- Automatic sell triggers at configurable milestones: **2×, 5×, 10×**
- Progressive partial sells lock in gains at each milestone

### Phase 6 — Emergency Exit
- If the token stalls for longer than the configured timeout (default: 2 hours)
- Bot detects insufficient bonding curve progress
- Force-sells all remaining positions to prevent indefinite capital lock-up

---

## System Requirements

| | |
|---|---|
| OS | Windows 10/11 (64-bit) or macOS |
| RAM | 2 GB minimum |
| Internet | Required (Solana RPC endpoint) |
| Recommended RPC | Alchemy Prepay |
| Wallet files | SPL-compatible keypairs (.json) |

---

## Security Model

### Your wallets never leave your machine

Vortical is a local desktop application. Your private keys and wallet files exist **only on your computer**. The application does not upload, transmit, or share wallet data with any server — including ours.

**What stays local:**
- All private keys (encrypted on-disk, see below)
- Master password
- Wallet balances and addresses
- Bot configuration and strategy settings

**What our relay server knows:**
- A hardware fingerprint (`machineId`) used for license verification
- Your license key
- Launch event counts and timestamps (for usage analytics only)

The relay server is a **license gate only**. It has zero knowledge of your wallets, balances, or trading activity.

### Wallet encryption

Private keys generated or imported into Vortical are encrypted at rest using:

- **Algorithm:** AES-256-GCM (authenticated encryption — tamper-proof)
- **Key derivation:** scrypt with a unique random salt generated per installation
- **Salt storage:** Stored in your local SQLite database — never transmitted
- **IV:** Fresh `crypto.randomBytes(16)` per encryption — no IV reuse

The wallet encryption code is published in this repository as [`wallet-manager.js`](./wallet-manager.js) for full transparency and independent audit.

### Keypair generation

New wallets are generated using `Keypair.generate()` from `@solana/web3.js`, which internally uses `crypto.randomBytes()` — a cryptographically secure random number generator provided by Node.js/OpenSSL.

Vanity keypairs (custom token addresses) are loaded from local `.json` files you provide. The bot never generates or stores vanity seeds on any remote server.

### Arweave uploads

Token metadata images are uploaded to the Arweave network (permanent decentralised storage). To do this, an Arweave wallet is required. Vortical fetches a shared Arweave wallet from our relay server **only at the moment of upload** via an authenticated request using your license key. The Arweave wallet is never stored locally.

---

## Published Code

This repository publishes the wallet security layer for independent verification:

| File | Purpose |
|---|---|
| [`wallet-manager.js`](./wallet-manager.js) | Wallet generation, encryption, storage and decryption |

The full bot source code is not published. The core trading logic is proprietary and obfuscated in the distributed build to protect the system from exploitation.

---

## Disclaimer

- Vortical is **beta software**. Execution is not guaranteed.
- Trading losses are the user's sole responsibility.
- Transaction failures, RPC delays and market volatility may cause partial or total capital loss.
- Use **Test Mode** before committing real funds.
- Users **under 18** must not use this software.
- vortical.io is not liable for any losses, failed trades or misconfiguration.

By downloading and using Vortical you accept these risks in full.

---

## Links

- **Website:** [vortical.io](https://vortical.io)
- **Releases:** [GitHub Releases](https://github.com/vorticaltools/vortical-releases/releases)
