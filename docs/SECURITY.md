# Security Best Practices

Stellarcade follows "Security First" principles to protect user assets and ensure platform integrity.

## ⛓ Smart Contract Security

- **Access Control**: Administrative functions (like upgrading or withdrawing house fees) are protected by ownership checks.
- **Arithmetic Safety**: We use Soroban's built-in safety features to prevent overflows and underflows.
- **Reentrancy Protection**: Contracts are designed to avoid reentrancy vulnerabilities.
- **Formal Verification**: (Goal) We aim to formally verify critical logic using toolsets like `halmos`.

## 🛠 API & Backend Security

- **Rate Limiting**: Protection against DDoS and brute-force attacks.
- **Input Sanitization**: All user inputs are validated via `express-validator`.
- **JWT Best Practices**: Tokens have short TTLs; secrets are rotated regularly.
- **Dependency Vetting**: Use `npm audit` and `cargo audit` to identify vulnerable packages.

## 💾 Database Security

- **Encryption at Rest**: All production databases are encrypted.
- **Least Privilege**: The API connects using a database role with only necessary permissions.
- **No Hardcoded Secrets**: All credentials are managed via environment variables and secrets managers.

## 👛 Wallet Security

- **Server-Side Signatures**: Backend signing keys are stored in secure Vaults (e.g., AWS KMS, HashiCorp Vault).
- **User Keys**: Stellarcade never stores or sees a user's private key. Signing happens client-side via Freighter or other Stellar wallets.

## ✅ Audit Checklist

Before any major release, ensure:

1. [ ] All functions have comprehensive unit tests.
2. [ ] No TODOs remain in production-bound code.
3. [ ] Contracts have been run through an automated analyzer.
4. [ ] Backend endpoints have 100% integration test coverage.
