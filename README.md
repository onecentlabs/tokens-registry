# Token Registry API

This is a simple Express-based API for managing and fetching token information across multiple blockchain networks. The API allows you to get token data from a local registry and, if unavailable, fetch it from an RPC endpoint.

## Table of Contents
- [Token Registry API](#token-registry-api)
  - [Table of Contents](#table-of-contents)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [API Endpoints](#api-endpoints)
    - [**GET /**](#get-)
    - [**GET /tokens**](#get-tokens)
    - [**GET /token**](#get-token)
  - [Project Structure](#project-structure)
  - [License](#license)
  - [Current Deployment](#current-deployment)

---

## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/onecentlabs/tokens_registry.git
   cd tokens_registry
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the server:**
   ```bash
   npm run build
   ```

4. **Start the server:**
   ```bash
   npm run start
   ```
   The server will run at `http://localhost:3000`.

---

## Configuration

- Ensure you have the following files:
  - `./registry`: Contains token registry data.
  - `./chains/metadata.json`: Contains metadata for different blockchain networks.

---

## API Endpoints

### **GET /**
Returns a simple greeting message.

**Request:**
```bash
curl http://localhost:3000/
```

**Response:**
```json
Hello, world!
```

---

### **GET /tokens**
Fetches all tokens, optionally filtered by specified chains.

**Query Parameters:**
- `chains` (optional): A comma-separated list of chain names.

**Request Example:**
```bash
curl "http://localhost:3000/tokens?chains=ETH,BNB"
```

**Response Example:**
```json
{
  "tokens": {
    "1": [
      { "symbol": "ETH", "address": "0x..." },
      { "symbol": "USDC", "address": "0x..." }
    ],
    "56": [
      { "symbol": "BNB", "address": "0x..." }
    ]
  }
}
```

---

### **GET /token**
Fetches token information for a specific chain and token symbol.

**Query Parameters:**
- `chain` (required): Name of the blockchain.
- `token` (required): Token symbol or Token's contract Address.

**Request Example:**
```bash
curl "http://localhost:3000/token?chain=ethereum&token=ETH"
```

**Response Example (from registry):**
```json
{
  "symbol": "ETH",
  "address": "0x..."
}
```

**Response Example (if not in registry, fetched from RPC):**
```json
{
  "symbol": "ETH",
  "address": "0x...",
  "decimals": 18
}
```


---

## Project Structure

```
├── src
│   ├── index.ts              # Main server file
│   ├── routes
│   │   ├── index.ts          # TokenRegistry class
│   │   ├── rpc.ts            # RPCFetch class
│   │   ├── token.ts            # Tokens route class
│   ├── chains
│   │   ├── metadata.json     # Blockchain metadata
├── registry                  # Token registry files
├── package.json
├── README.md
```

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Current Deployment

Currently deployed at 
```
https://exchange-rates.onecentlabs.xyz
```