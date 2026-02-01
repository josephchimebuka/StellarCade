-- 001_initial_schema.sql
-- Initial database schema for Stellarcade users, games, and transactions.

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    wallet_address VARCHAR(56) UNIQUE NOT NULL, -- G... address
    username VARCHAR(50),
    balance NUMERIC(20, 7) DEFAULT 0, -- XLM or other assets
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Games Table
CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_type VARCHAR(30) NOT NULL, -- coin-flip, trivia, etc.
    bet_amount NUMERIC(20, 7) NOT NULL,
    result VARCHAR(20) NOT NULL, -- win, loss, pending
    payout NUMERIC(20, 7) DEFAULT 0,
    tx_hash VARCHAR(64), -- Stellar transaction hash
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Transactions Table
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL, -- deposit, withdrawal
    amount NUMERIC(20, 7) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- pending, success, failed
    tx_hash VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_users_wallet_address ON users(wallet_address);
CREATE INDEX idx_games_user_id ON games(user_id);
CREATE INDEX idx_transactions_user_id ON transactions(user_id);

-- TODO: Add triggers for updated_at timestamps
