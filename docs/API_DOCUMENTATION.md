# API Documentation

The Stellarcade Backend provides a RESTful API for interacting with games, users, and wallets.

## 🔐 Authentication

Most endpoints require a JWT token in the `Authorization` header.

```
Authorization: Bearer <your_token>
```

## 📍 Endpoints

### 🎮 Games

- **GET** `/api/games` - Retrieve a list of available games.
- **GET** `/api/games/:id` - Get details of a specific game.
- **POST** `/api/games/play` - Initiate a game play request.
  - Body: `{ "gameType": "coin-flip", "betAmount": "10", "choice": "heads" }`

### 👤 Users

- **GET** `/api/users/profile` - Get the current user's profile.
- **POST** `/api/users/create` - Create a new user account (linked to Stellar address).
- **GET** `/api/users/balance` - Get the user's on-platform balance.

### 💳 Wallet

- **POST** `/api/wallet/deposit` - Get instructions for depositing Stellar assets.
- **POST** `/api/wallet/withdraw` - Withdraw assets to a Stellar address.
- **GET** `/api/wallet/transactions` - List all deposit/withdrawal transactions.

### 🏥 Health

- **GET** `/api/health` - Check the status of the API and its dependencies.

## ⚠️ Error Codes

- `400 Bad Request`: Invalid input parameters.
- `401 Unauthorized`: Missing or invalid authentication token.
- `403 Forbidden`: Insufficient permissions or balance.
- `429 Too Many Requests`: Rate limit exceeded.
- `500 Internal Server Error`: Unexpected server error.

## 📊 Rate Limiting

- Default limit: 60 requests per minute per IP.
- Authenticated limit: 200 requests per minute per user.
