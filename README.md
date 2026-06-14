# Xeno CRM - Backend Services

This repository contains the backend engines for **Xeno**, an AI-native CRM for consumer brands. It operates two services in parallel:
1. **CRM API Server (Port 3000)**: Serves endpoints for shopper data, campaigns, ratings, and AI parsing.
2. **Channel Service Simulator (Port 3001)**: Stubbed messaging gateway that simulates message delivery, open rates, link clicks, and checkout conversions.

---

## ✦ Features

* **Multi-Tenant Isolation**: Supports 8 separate brand databases (Starbucks, Zara, Sephora, Nike, Apple, Tesla, IKEA, Amazon) using dynamic SQLite connection pools.
* **AI-Native Parser**: Uses Google's Gemini API to parse natural language campaign prompts into executable SQLite queries.
* **Asynchronous Webhook Callback Loop**: Simulated message gateway processes sent campaigns and POSTs receipt callbacks back to the CRM webhook `/api/receipt` to attribute sales conversions.
* **Real-time Live Metrics**: Streams logs to the client interface using Server-Sent Events (SSE).

---

## ✦ Directory Structure

```
├── channel-service/     # Express gateway simulator (Port 3001)
│   ├── index.js         # Simulator queue & event loop
│   └── package.json
├── server/              # Express CRM Server (Port 3000)
│   ├── index.js         # API endpoints & receipt webhook
│   ├── db.js            # Isolated SQLite connection pooling & seeding
│   └── ai-engine.js     # Gemini API configurations & local NLP fallbacks
├── start-all.js         # Unified runner that spawns both services
├── package.json
└── README.md
```

---

## ✦ Getting Started (Local Development)

### 1. Install Dependencies
Run npm install in the root backend directory:
```bash
npm install
```
*(This will set up all CRM server dependencies. If you need to install channel service dependencies separately, run `npm install` inside the `channel-service/` directory).*

### 2. Configure Environment Variables
Create a `.env` file in the root directory:
```env
GEMINI_API_KEY=your_google_gemini_api_key
PORT=3000
```
*Note: If no `GEMINI_API_KEY` is provided, the backend will automatically fallback to a localized regex NLP parser.*

### 3. Run the Services
Start both the CRM Server (port 3000) and Channel Service (port 3001) concurrently:
```bash
npm run dev
```

---

## ✦ Deployment (Render Web Service)

This backend is optimized for deployment on Render as a **Web Service**:

1. Create a new **Web Service** on Render and link this repository.
2. Configure settings:
   * **Language**: `Node`
   * **Branch**: `main`
   * **Build Command**: `npm install`
   * **Start Command**: `npm start` *(Crucial: This triggers `node start-all.js` to run both services).*
3. Add Environment Variables:
   * `GEMINI_API_KEY`: `your_gemini_api_key_value`
4. Deploy the service.

The CRM server will listen publicly on Render's assigned port (`process.env.PORT` / `10000`), while the Channel Service runs internally on port `3001`.
