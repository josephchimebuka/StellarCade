#!/bin/bash

# deploy-contracts.sh
# Builds and deploys Stellarcade contracts to the specified network.

set -e

NETWORK="testnet"
SOURCE="default"

usage() {
  echo "Usage: $0 [options]"
  echo "Options:"
  echo "  --network <name>  Network to deploy to (default: testnet)"
  echo "  --source <name>   Identity to use for deployment (default: default)"
  echo "  --build           Build contracts before deploying"
  exit 1
}

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --network) NETWORK="$2"; shift ;;
    --source) SOURCE="$2"; shift ;;
    --build) BUILD=true ;;
    *) usage ;;
  esac
  shift
done

if [ "$BUILD" = true ]; then
  echo "Building contracts..."
  cargo build --target wasm32-unknown-unknown --release
fi

echo "Deploying to $NETWORK using $SOURCE..."

# Function to deploy and save ID
deploy_contract() {
  local name=$1
  local wasm="target/wasm32-unknown-unknown/release/${name//-/_}.wasm"
  
  echo "Deploying $name..."
  # ID=$(soroban contract deploy --wasm "$wasm" --source "$SOURCE" --network "$NETWORK")
  # echo "$name deployed! ID: $ID"
  echo "$name deployment placeholder"
}

# deploy_contract "prize-pool"
# deploy_contract "random-generator"
# deploy_contract "coin-flip"

echo "Deployment cycle finished (SKELETON ONLY)."
