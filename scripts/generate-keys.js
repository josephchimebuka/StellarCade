/**
 * generate-keys.js
 * Generates Stellar keypairs for local testing.
 */
const StellarSdk = require('stellar-sdk');

function generate() {
  const pair = StellarSdk.Keypair.random();
  console.log('New Stellar Keypair Generated:');
  console.log('Public Key (Address):', pair.publicKey());
  console.log('Secret Key:', pair.secret());
  console.log('------------------------------');
}

generate();
