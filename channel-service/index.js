const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = 3001; // Force port 3001 to avoid Render PORT env conflict

app.use(cors());
app.use(express.json());

// Simulation configuration
let config = {
  failureRate: 0.05,        // 5% chance of initial gateway delivery failure
  rateLimitPerSec: 10,      // Max messages sent to gateway per second
  delayScale: 1.0,          // 1.0 = normal speed, 0.1 = 10x faster (good for testing)
};

// State
let messageQueue = [];
let processingLogs = [];
let stats = {
  totalReceived: 0,
  totalDelivered: 0,
  totalFailed: 0,
  totalRead: 0,
  totalClicked: 0,
  totalConverted: 0,
  activeSimulatorJobs: 0,
  callbackRetries: 0
};

// Probability matrix for channels (boosted for interactive demo/testing visibility)
const CHANNEL_PROBABILITIES = {
  whatsapp: { read: 0.95, click: 0.75, convert: 0.45 },
  sms:      { read: 0.90, click: 0.60, convert: 0.35 },
  email:    { read: 0.70, click: 0.50, convert: 0.25 },
  rcs:      { read: 0.85, click: 0.70, convert: 0.40 }
};

// Helper for adding logs
function logEvent(type, message, details = {}) {
  const log = {
    timestamp: new Date().toISOString(),
    type,
    message,
    ...details
  };
  processingLogs.unshift(log);
  if (processingLogs.length > 100) processingLogs.pop();
  console.log(`[Channel Service] [${type}] ${message}`);
}

// Background Queue Processor (respects rateLimitPerSec)
let queueInterval = null;
function startQueueProcessor() {
  if (queueInterval) clearInterval(queueInterval);
  
  const tickRateMs = Math.max(10, Math.floor(1000 / config.rateLimitPerSec));
  
  queueInterval = setInterval(() => {
    if (messageQueue.length === 0) return;
    
    // Process one message from queue
    const task = messageQueue.shift();
    processMessage(task);
  }, tickRateMs);
}

// Helper to execute callback with retry capability
async function sendCallbackWithRetry(url, payload, attempt = 1, maxAttempts = 3) {
  try {
    await axios.post(url, payload, { timeout: 3000 });
    return true;
  } catch (error) {
    stats.callbackRetries++;
    logEvent('CALLBACK_RETRY_WARNING', `CRM Callback failed (Attempt ${attempt}/${maxAttempts}) for ${payload.status}. Error: ${error.message}`, {
      communicationId: payload.communicationId
    });
    
    if (attempt < maxAttempts) {
      const backoffDelay = attempt * 1000 * config.delayScale;
      await new Promise(resolve => setTimeout(resolve, backoffDelay));
      return sendCallbackWithRetry(url, payload, attempt + 1, maxAttempts);
    } else {
      logEvent('CALLBACK_FAILED_CRITICAL', `CRM Callback completely failed after ${maxAttempts} attempts. State lost for ${payload.status}.`, {
        communicationId: payload.communicationId
      });
      return false;
    }
  }
}

// Message Simulation Engine
function processMessage(task) {
  const { communicationId, recipient, message, channel, callbackUrl } = task;
  stats.activeSimulatorJobs++;
  
  // 1. Check for initial gateway failure
  const isFailed = Math.random() < config.failureRate;
  
  setTimeout(async () => {
    if (isFailed) {
      stats.totalFailed++;
      stats.activeSimulatorJobs--;
      logEvent('DELIVERY_FAILED', `Failed to deliver ${channel} to ${recipient}`, { communicationId });
      await sendCallbackWithRetry(callbackUrl, {
        communicationId,
        status: 'FAILED',
        timestamp: new Date().toISOString(),
        error: 'Carrier network timeout'
      });
      return;
    }
    
    // Successfully delivered
    stats.totalDelivered++;
    logEvent('DELIVERED', `Delivered ${channel} to ${recipient}`, { communicationId });
    await sendCallbackWithRetry(callbackUrl, {
      communicationId,
      status: 'DELIVERED',
      timestamp: new Date().toISOString()
    });
    
    // Simulate read event
    const probs = CHANNEL_PROBABILITIES[channel] || CHANNEL_PROBABILITIES.sms;
    const isRead = Math.random() < probs.read;
    
    if (!isRead) {
      stats.activeSimulatorJobs--;
      return;
    }
    
    // Delay for reading
    setTimeout(async () => {
      stats.totalRead++;
      logEvent('READ', `Recipient read ${channel} message`, { communicationId });
      await sendCallbackWithRetry(callbackUrl, {
        communicationId,
        status: 'READ',
        timestamp: new Date().toISOString()
      });
      
      // Simulate click event
      const isClicked = Math.random() < probs.click;
      if (!isClicked) {
        stats.activeSimulatorJobs--;
        return;
      }
      
      // Delay for clicking link
      setTimeout(async () => {
        stats.totalClicked++;
        logEvent('CLICKED', `Recipient clicked link in ${channel} message`, { communicationId });
        await sendCallbackWithRetry(callbackUrl, {
          communicationId,
          status: 'CLICKED',
          timestamp: new Date().toISOString()
        });
        
        // Simulate conversion/purchase
        const isConverted = Math.random() < probs.convert;
        if (!isConverted) {
          stats.activeSimulatorJobs--;
          return;
        }
        
        // Delay for making purchase
        setTimeout(async () => {
          stats.totalConverted++;
          stats.activeSimulatorJobs--;
          const purchaseAmount = parseFloat((Math.random() * 80 + 20).toFixed(2)); // $20 to $100
          logEvent('CONVERTED', `Recipient completed purchase of $${purchaseAmount} via ${channel} link`, { communicationId });
          await sendCallbackWithRetry(callbackUrl, {
            communicationId,
            status: 'CONVERTED',
            timestamp: new Date().toISOString(),
            metadata: {
              amount: purchaseAmount,
              order_id: 'ORD-' + Math.random().toString(36).substr(2, 9).toUpperCase()
            }
          });
        }, 3000 * config.delayScale);
        
      }, 2000 * config.delayScale);
      
    }, 2000 * config.delayScale);
    
  }, 1000 * config.delayScale);
}

// Endpoints
app.post('/send', (req, res) => {
  const { communicationId, recipient, message, channel, callbackUrl } = req.body;
  
  if (!communicationId || !recipient || !message || !channel || !callbackUrl) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  
  stats.totalReceived++;
  
  // Push to queue
  messageQueue.push({
    communicationId,
    recipient,
    message,
    channel,
    callbackUrl
  });
  
  logEvent('QUEUED', `Queued message ${communicationId} for ${recipient} via ${channel}`);
  
  res.json({ success: true, queuePosition: messageQueue.length });
});

app.get('/status', (req, res) => {
  res.json({
    config,
    stats: {
      ...stats,
      queueLength: messageQueue.length
    },
    logs: processingLogs.slice(0, 50)
  });
});

app.post('/config', (req, res) => {
  const { failureRate, rateLimitPerSec, delayScale } = req.body;
  
  if (failureRate !== undefined) config.failureRate = parseFloat(failureRate);
  if (rateLimitPerSec !== undefined) {
    config.rateLimitPerSec = parseInt(rateLimitPerSec);
    startQueueProcessor(); // restart with new tick rate
  }
  if (delayScale !== undefined) config.delayScale = parseFloat(delayScale);
  
  logEvent('CONFIG_CHANGE', 'Configuration updated', { config });
  res.json({ success: true, config });
});

app.post('/reset', (req, res) => {
  messageQueue = [];
  processingLogs = [];
  stats = {
    totalReceived: 0,
    totalDelivered: 0,
    totalFailed: 0,
    totalRead: 0,
    totalClicked: 0,
    totalConverted: 0,
    activeSimulatorJobs: 0,
    callbackRetries: 0
  };
  logEvent('RESET', 'Service stats and logs reset');
  res.json({ success: true });
});

// Start service
app.listen(PORT, () => {
  console.log(`[Channel Service] Simulated message gateway running on http://localhost:${PORT}`);
  startQueueProcessor();
});
