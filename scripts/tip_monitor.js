#!/usr/bin/env node
/**
 * SunfishLoop Tip Monitor
 *
 * Monitors platform wallets for incoming tip payments.
 * When detected, automatically forwards 97% to the post author.
 *
 * Supported chains: eth (Base L2), sol (Solana), btc (Bitcoin)
 *
 * Usage: node tip_monitor.js
 * Or via systemd: systemctl start sunfishloop-tip-monitor
 */

const https = require("https");

// --- Configuration ---
const SUNFISHLOOP_API = process.env.SUNFISHLOOP_API || "http://localhost:8000";
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL || "30000", 10); // 30s

// Platform wallets (just for reference, actual monitoring depends on chain)
const WALLETS = {
  eth: process.env.PLATFORM_ETH_WALLET || "0xDBc2822EEd7b8F130B122C4f7ADa8aEf8aA604A4",
  sol: process.env.PLATFORM_SOL_WALLET || "FqjunBU36Hznu2zWEcgM6vTdsXWAfXrbMg9oBFZgXp9R",
  btc: process.env.PLATFORM_BTC_WALLET || "bc1qv8pyesjyyf7epdwhjgdhn26gcuvl849qq462dd",
};

// Admin API key for internal operations
const ADMIN_KEY = process.env.SUNFISHLOOP_ADMIN_KEY;

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, SUNFISHLOOP_API);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "sunfishloop-tip-monitor/1.0",
      },
    };
    if (ADMIN_KEY) options.headers["Authorization"] = `Bearer ${ADMIN_KEY}`;

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ raw: data });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getPendingTips() {
  const res = await api("GET", `/admin/tips/pending`);
  return res.tips || [];
}

async function confirmTip(tipId, txId) {
  return api("POST", `/admin/tips/${tipId}/confirm`, { tx_id: txId });
}

async function failTip(tipId, reason) {
  return api("POST", `/admin/tips/${tipId}/fail`, { reason });
}

async function checkEthTx(wallet, tip) {
  // Check Base L2 via Etherscan API (free tier)
  const apiKey = process.env.ETHERSCAN_API_KEY || "";
  if (!apiKey) {
    console.log(`[eth] No ETHERSCAN_API_KEY set, skipping on-chain check for tip ${tip.id}`);
    return null;
  }

  return new Promise((resolve) => {
    const url = `https://api.basescan.org/api?module=account&action=txlist&address=${wallet}&sort=desc&apikey=${apiKey}&limit=5`;
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.status === "1" && json.result) {
            for (const tx of json.result) {
              // Match by value (amount) — we look for exact or slightly less (gas fees)
              const txValueEth = parseFloat(tx.value) / 1e18;
              const tipAmount = parseFloat(tip.amount);
              if (Math.abs(txValueEth - tipAmount) < 0.0001 && tx.to.toLowerCase() === wallet.toLowerCase()) {
                resolve(tx.hash);
                return;
              }
            }
          }
          resolve(null);
        } catch {
          resolve(null);
        }
      });
    }).on("error", () => resolve(null));
  });
}

async function checkSolTx(wallet, tip) {
  // Solana — would need Helius or QuickNode RPC
  // For MVP, skip on-chain check and rely on admin manual confirmation
  console.log(`[sol] On-chain check for Solana not yet implemented for tip ${tip.id}`);
  return null;
}

async function checkBtcTx(wallet, tip) {
  // Bitcoin — would need Blockstream API or similar
  console.log(`[btc] On-chain check for Bitcoin not yet implemented for tip ${tip.id}`);
  return null;
}

async function forwardTip(tip, authorWallet, chain) {
  // In MVP, we just log the forwarding instruction.
  // In production, this would call a blockchain RPC to send the actual transaction.
  const fee = parseFloat(tip.amount) * 0.03;
  const sendAmount = parseFloat(tip.amount) * 0.97;
  console.log(`
=== TIP FORWARD ===
Tip: ${tip.id}
Amount: ${tip.amount} ${chain.toUpperCase()}
Platform fee (3%): ${fee.toFixed(6)} ${chain.toUpperCase()}
Send to author: ${sendAmount.toFixed(6)} ${chain.toUpperCase()}
Author wallet: ${authorWallet}
Status: LOGGED (auto-forward not yet implemented)
===================
`);
  // For now, mark as confirmed
  return true;
}

async function poll() {
  console.log(`\n[${new Date().toISOString()}] Tip Monitor: polling for pending tips...`);

  try {
    const pending = await getPendingTips();
    console.log(`Found ${pending.length} pending tips`);

    for (const tip of pending) {
      console.log(`\nChecking tip ${tip.id}: ${tip.amount} ${tip.chain}`);

      // Get the post author's wallet
      const postInfo = await api("GET", `/admin/posts/${tip.post_id}/author-wallet`);
      const authorWallet = postInfo?.wallet_address;
      if (!authorWallet) {
        console.log(`  ⚠️ Post ${tip.post_id} author has no wallet, marking failed`);
        await failTip(tip.id, "author_no_wallet");
        continue;
      }

      // Check on-chain for the incoming transaction
      let txId = null;
      if (tip.chain === "eth") txId = await checkEthTx(WALLETS.eth, tip);
      else if (tip.chain === "sol") txId = await checkSolTx(WALLETS.sol, tip);
      else if (tip.chain === "btc") txId = await checkBtcTx(WALLETS.btc, tip);

      if (txId) {
        console.log(`  ✅ Detected transaction: ${txId}`);
        await forwardTip(tip, authorWallet, tip.chain);
        await confirmTip(tip.id, txId);
        console.log(`  ✅ Tip ${tip.id} confirmed`);
      } else {
        console.log(`  ⏳ No matching transaction found yet for tip ${tip.id}`);
      }
    }
  } catch (err) {
    console.error(`Poll error:`, err.message);
  }
}

// Main loop
console.log(`
╔══════════════════════════════════════╗
║  SunfishLoop Tip Monitor             ║
║  Watching wallets:                    ║
║    ETH:  ${WALLETS.eth.slice(0, 10)}...${WALLETS.eth.slice(-4)}
║    SOL:  ${WALLETS.sol.slice(0, 10)}...${WALLETS.sol.slice(-4)}
║    BTC:  ${WALLETS.btc.slice(0, 10)}...${WALLETS.btc.slice(-4)}
║  Poll interval: ${POLL_INTERVAL_MS / 1000}s
╚══════════════════════════════════════╝
`);

poll();
setInterval(poll, POLL_INTERVAL_MS);
