# System Architecture

This document describes the high-level architecture of the Stellarcade platform.

## 🏗 High-Level Diagram

```ascii
      +-------------------+
      |      Frontend     | (React/Vite)
      +---------+---------+
                |
                v
      +---------+---------+
      |    Backend API    | (Node.js/Express)
      +----+----+----+----+
           |    |    |
           |    |    +------------------------+
           v    v                             v
      +----+----+----+                +-------+-------+
      |  PostgreSQL  |                |     Redis     |
      +--------------+                +-------+-------+
                                              |
                                              v
      +---------------------------------------+-------+
      |           Stellar Network / Soroban           |
      +----+------------------+------------------+----+
           |                  |                  |
           v                  v                  v
    +------+------+    +------+------+    +------+------+
    |  Prize Pool |    |     RNG      |    |  Coin Flip  |
    |   Contract  |    |   Contract   |    |   Contract  |
    +-------------+    +--------------+    +-------------+
```

## 🛠 Component Overview

### 1. Smart Contracts (Soroban)

- **Prize Pool**: Manages the accumulation and distribution of tokens.
- **RNG**: A provably fair random number generator.
- **Game Contracts**: Specific logic for games like Coin Flip.

### 2. Backend (Node.js)

- Acts as a gateway between the frontend and the Stellar network.
- Manages user sessions, game history, and off-chain data.
- Submits transactions to the network and listens for events.

### 3. Database (PostgreSQL)

- Stores user profiles, transaction logs, and game results for quick retrieval and analytics.

### 4. Cache (Redis)

- Used for session management and rate limiting.
- Caches contract states to reduce load on Horizon/RPC.

## 🔄 Data Flow

1. **Player Interaction**: Player initiates a game from the frontend.
2. **Backend Submission**: Backend validates the request and prepares a Soroban transaction.
3. **Stellar Network**: Transaction is submitted to the Stellar network.
4. **Contract Execution**: The specific Game Contract executed, interacting with the RNG and Prize Pool.
5. **Event Emission**: The contract emits an event with the game result.
6. **Backend Tracking**: Backend listens for the event, updates the PostgreSQL database, and notifies the player.

## 🔒 Security Architecture

- **JWT Authentication**: Secure communication between frontend and backend.
- **Input Validation**: Strict schema validation for all API requests.
- **Contract Safety**: Use of `Result` types, access control, and thorough unit testing.
- **RNG Integrity**: Provably fair implementation using cryptographic seeds.
