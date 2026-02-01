#!/bin/bash

# setup-testnet.sh
# Configures local environment for Stellar Testnet.

echo "Setting up Stellarcade identities..."

# Create identities if they don't exist
# soroban config identity create admin
# soroban config identity create player1

echo "Funding identities via Friendbot..."
# curl -X POST "https://friendbot.stellar.org?addr=$(soroban config identity address admin)"
# curl -X POST "https://friendbot.stellar.org?addr=$(soroban config identity address player1)"

echo "Testnet setup complete (SKELETON ONLY)."
