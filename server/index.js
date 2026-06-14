const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { 
  initDatabase, 
  runQuery, 
  getQuery, 
  allQuery,
  BRAND_CONFIGS
} = require('./db');
const { 
  parsePromptLocally, 
  parsePromptWithGemini, 
  generateAIInsights,
  askAIAboutDatabase,
  generateRatingsInsights
} = require('./ai-engine');
const { addClient, broadcastEvent } = require('./sse');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Multi-tenant brand mapping middleware
app.use((req, res, next) => {
  const brandHeader = req.headers['x-brand'] || 'starbucks';
  req.brand = brandHeader.toLowerCase();
  next();
});

// Brand code prefixes for async webhook callbacks routing
const BRAND_CODES = {
  starbucks: 'STA',
  zara: 'ZAR',
  sephora: 'SEP',
  nike: 'NIK',
  apple: 'APP',
  tesla: 'TES',
  ikea: 'IKE',
  amazon: 'AMA'
};

function getBrandFromId(id) {
  if (!id) return 'starbucks';
  const parts = id.split('-');
  if (parts.length < 2) return 'starbucks';
  const code = parts[1].toUpperCase();
  for (const [brandName, prefix] of Object.entries(BRAND_CODES)) {
    if (prefix === code) return brandName;
  }
  return 'starbucks';
}

// Initialize all 8 tenant databases concurrently at startup
const BRANDS = Object.keys(BRAND_CONFIGS);
Promise.all(BRANDS.map(brand => initDatabase(brand)))
  .then(() => {
    console.log('[CRM Server] All 8 tenant databases initialized and seeded successfully.');
  })
  .catch(err => {
    console.error('[CRM Server] Failed to initialize SQLite databases:', err);
  });

// SSE connection endpoint for real-time dashboard updates (scopes client by brand)
app.get('/api/live-metrics', (req, res) => {
  addClient(req, res);
});

// Get customer and order statistics for all 8 tenant brands
app.get('/api/brands/stats', async (req, res) => {
  try {
    const stats = {};
    for (const brand of BRANDS) {
      try {
        const custCount = await getQuery(brand, 'SELECT COUNT(*) as count FROM customers');
        const orderCount = await getQuery(brand, 'SELECT COUNT(*) as count FROM orders');
        stats[brand] = {
          customers: custCount ? custCount.count : 0,
          orders: orderCount ? orderCount.count : 0
        };
      } catch (err) {
        console.error(`[CRM Server] Error querying stats for brand ${brand}:`, err.message);
        stats[brand] = { customers: 0, orders: 0 };
      }
    }
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Seed/Reset database endpoint for current brand
app.post('/api/seed', async (req, res) => {
  const brand = req.brand;
  try {
    await runQuery(brand, 'DROP TABLE IF EXISTS events');
    await runQuery(brand, 'DROP TABLE IF EXISTS communications');
    await runQuery(brand, 'DROP TABLE IF EXISTS campaigns');
    await runQuery(brand, 'DROP TABLE IF EXISTS orders');
    await runQuery(brand, 'DROP TABLE IF EXISTS customers');
    await runQuery(brand, 'DROP TABLE IF EXISTS reviews');
    
    // Re-initialize tables and seed data
    await initDatabase(brand);
    
    // Broadcast reset event to clients of this brand
    broadcastEvent(brand, 'DATABASE_RESET', { message: `Database for brand ${brand} reset and re-seeded successfully` });
    
    res.json({ success: true, message: `Database reset complete for brand: ${brand}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get recent customers list with totals for current brand
app.get('/api/customers', async (req, res) => {
  const brand = req.brand;
  try {
    const query = `
      SELECT c.*, COUNT(o.id) as total_orders, SUM(o.amount) as total_spent
      FROM customers c
      LEFT JOIN orders o ON c.id = o.customer_id AND o.status = 'COMPLETED'
      GROUP BY c.id
      ORDER BY total_spent DESC
      LIMIT 100
    `;
    const rows = await allQuery(brand, query);
    const parsedRows = rows.map(r => ({
      ...r,
      metadata: JSON.parse(r.metadata || '{}')
    }));
    res.json(parsedRows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get recent orders list for current brand
app.get('/api/orders', async (req, res) => {
  const brand = req.brand;
  try {
    const query = `
      SELECT o.*, c.name as customer_name
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      ORDER BY o.created_at DESC
      LIMIT 50
    `;
    const rows = await allQuery(brand, query);
    const parsedRows = rows.map(r => ({
      ...r,
      items: JSON.parse(r.items || '[]')
    }));
    res.json(parsedRows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ingestion: Add custom shopper profile to current brand
app.post('/api/customers', async (req, res) => {
  const brand = req.brand;
  const { name, email, phone, metadata } = req.body;
  if (!name || !email || !phone) {
    return res.status(400).json({ error: 'Missing name, email, or phone' });
  }
  const prefix = BRAND_CODES[brand] || 'STA';
  const id = `CUST-${prefix}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  try {
    await runQuery(brand,
      'INSERT INTO customers (id, name, email, phone, metadata) VALUES (?, ?, ?, ?, ?)',
      [id, name, email, phone, JSON.stringify(metadata || {})]
    );
    broadcastEvent(brand, 'CUSTOMER_INGESTED', { id, name, email });
    res.json({ success: true, customerId: id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ingestion: Bulk add customer profiles to current brand
app.post('/api/customers/bulk', async (req, res) => {
  const brand = req.brand;
  const { customers } = req.body;
  if (!Array.isArray(customers) || customers.length === 0) {
    return res.status(400).json({ error: 'Customers array is required and must not be empty' });
  }

  const prefix = BRAND_CODES[brand] || 'STA';
  const insertedIds = [];
  
  try {
    for (const c of customers) {
      const { name, email, phone, metadata } = c;
      if (!name || !email || !phone) {
        continue;
      }
      const id = `CUST-${prefix}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      await runQuery(brand,
        'INSERT INTO customers (id, name, email, phone, metadata) VALUES (?, ?, ?, ?, ?)',
        [id, name, email, phone, JSON.stringify(metadata || {})]
      );
      insertedIds.push(id);
    }
    
    broadcastEvent(brand, 'CUSTOMER_BULK_INGESTED', { count: insertedIds.length });
    res.json({ success: true, count: insertedIds.length, customerIds: insertedIds });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ingestion: Add custom order transaction to current brand
app.post('/api/orders', async (req, res) => {
  const brand = req.brand;
  const { customer_id, amount, status, items } = req.body;
  if (!customer_id || amount === undefined || !status) {
    return res.status(400).json({ error: 'Missing customer_id, amount, or status' });
  }
  const prefix = BRAND_CODES[brand] || 'STA';
  const id = `ORD-${prefix}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  const timestamp = new Date().toISOString();
  try {
    await runQuery(brand,
      'INSERT INTO orders (id, customer_id, amount, status, items, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, customer_id, parseFloat(amount), status, JSON.stringify(items || []), timestamp]
    );
    broadcastEvent(brand, 'ORDER_INGESTED', { id, customer_id, amount });
    res.json({ success: true, orderId: id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ingestion: Bulk add orders to current brand
app.post('/api/orders/bulk', async (req, res) => {
  const brand = req.brand;
  const { orders } = req.body;
  if (!Array.isArray(orders) || orders.length === 0) {
    return res.status(400).json({ error: 'Orders array is required and must not be empty' });
  }

  const prefix = BRAND_CODES[brand] || 'STA';
  const insertedIds = [];
  const timestamp = new Date().toISOString();

  try {
    for (const o of orders) {
      const { customer_id, amount, status, items } = o;
      if (!customer_id || amount === undefined || !status) {
        continue;
      }
      const id = `ORD-${prefix}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      await runQuery(brand,
        'INSERT INTO orders (id, customer_id, amount, status, items, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, customer_id, parseFloat(amount), status, JSON.stringify(items || []), timestamp]
      );
      insertedIds.push(id);
    }

    broadcastEvent(brand, 'ORDER_BULK_INGESTED', { count: insertedIds.length });
    res.json({ success: true, count: insertedIds.length, orderIds: insertedIds });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AI Copilot Endpoint: Parse natural language prompt to generate campaigns for current brand
app.post('/api/ai/parse', async (req, res) => {
  const brand = req.brand;
  const { prompt, apiKey } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

  const activeApiKey = apiKey || process.env.GEMINI_API_KEY;

  try {
    let result;
    if (activeApiKey) {
      result = await parsePromptWithGemini(prompt, activeApiKey);
    } else {
      result = parsePromptLocally(prompt);
    }

    // Run query in sandbox mode to preview count
    try {
      const shoppers = await allQuery(brand, result.sqlQuery, result.queryParams || []);
      result.matchCount = shoppers.length;
      result.sampleShoppers = shoppers.slice(0, 5).map(s => ({
        id: s.id,
        name: s.name,
        email: s.email,
        phone: s.phone,
        metadata: JSON.parse(s.metadata || '{}')
      }));
    } catch (sqlErr) {
      console.error('[CRM Server] AI query execution error, falling back to all customers:', sqlErr.message);
      // Fallback query if AI returned bad SQL
      result.sqlQuery = 'SELECT * FROM customers';
      result.queryParams = [];
      const shoppers = await allQuery(brand, result.sqlQuery);
      result.matchCount = shoppers.length;
      result.sampleShoppers = shoppers.slice(0, 5).map(s => ({
        id: s.id,
        name: s.name,
        email: s.email,
        phone: s.phone,
        metadata: JSON.parse(s.metadata || '{}')
      }));
      result.explanation = "Query adjusted: targeting all shoppers (original SQL error resolved automatically).";
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Segment Preview Endpoint (for Visual Dynamic Rule Builder)
app.post('/api/segments/preview', async (req, res) => {
  const brand = req.brand;
  const { sqlQuery, queryParams } = req.body;
  if (!sqlQuery) {
    return res.status(400).json({ error: 'sqlQuery is required' });
  }

  try {
    const shoppers = await allQuery(brand, sqlQuery, queryParams || []);
    const sampleShoppers = shoppers.slice(0, 5).map(s => ({
      id: s.id,
      name: s.name,
      email: s.email,
      phone: s.phone,
      metadata: JSON.parse(s.metadata || '{}')
    }));

    res.json({
      matchCount: shoppers.length,
      sampleShoppers
    });
  } catch (error) {
    console.error('[CRM Server] Segment preview SQL error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get brand-specific order categories with customer distribution stats
app.get('/api/segments/categories', async (req, res) => {
  const brand = req.brand;
  try {
    const config = BRAND_CONFIGS[brand] || BRAND_CONFIGS.starbucks;
    // Query the actual distinct favorite_category values from real customer data
    const categoryRows = await allQuery(brand, `
      SELECT 
        json_extract(c.metadata, '$.favorite_category') AS category,
        COUNT(DISTINCT c.id) AS customer_count,
        COUNT(o.id) AS order_count,
        COALESCE(SUM(o.amount), 0) AS total_revenue
      FROM customers c
      LEFT JOIN orders o ON c.id = o.customer_id AND o.status = 'COMPLETED'
      WHERE json_extract(c.metadata, '$.favorite_category') IS NOT NULL
      GROUP BY category
      ORDER BY order_count DESC
    `);

    // Fallback to config categories if DB is empty
    const categories = categoryRows.length > 0
      ? categoryRows.map(r => ({
          name: r.category,
          customerCount: r.customer_count,
          orderCount: r.order_count,
          totalRevenue: Math.round(r.total_revenue)
        }))
      : config.categories.map(c => ({ name: c, customerCount: 0, orderCount: 0, totalRevenue: 0 }));

    res.json({ brand, categories });
  } catch (error) {
    console.error('[CRM Server] Category fetch error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Create and Launch Campaign for current brand
app.post('/api/campaigns', async (req, res) => {
  const brand = req.brand;
  const { name, sqlQuery, queryParams, channel, messageTemplates } = req.body;
  
  if (!name || !sqlQuery || !channel || !messageTemplates || !messageTemplates.A || !messageTemplates.B) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const prefix = BRAND_CODES[brand] || 'STA';
  const campaignId = `CAMP-${prefix}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

  try {
    // 1. Fetch target shoppers first to validate the SQL query
    const shoppers = await allQuery(brand, sqlQuery, queryParams || []);
    
    if (shoppers.length === 0) {
      // Create campaign directly as COMPLETED since there are no shoppers
      await runQuery(brand,
        'INSERT INTO campaigns (id, name, segment_rules, message_template, channel, status) VALUES (?, ?, ?, ?, ?, ?)',
        [campaignId, name, JSON.stringify({ sqlQuery, queryParams }), JSON.stringify(messageTemplates), channel, 'COMPLETED']
      );
      return res.json({ success: true, campaignId, message: 'Campaign completed. No matching shoppers.' });
    }

    // 2. Insert Campaign
    await runQuery(brand,
      'INSERT INTO campaigns (id, name, segment_rules, message_template, channel, status) VALUES (?, ?, ?, ?, ?, ?)',
      [campaignId, name, JSON.stringify({ sqlQuery, queryParams }), JSON.stringify(messageTemplates), channel, 'ACTIVE']
    );

    // 3. Generate individual communications
    const commsToInsert = [];
    shoppers.forEach((shopper, idx) => {
      const commId = `COMM-${prefix}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      
      // Determine variant (A/B)
      const variant = idx % 2 === 0 ? 'A' : 'B';
      const template = messageTemplates[variant];
      
      // Personalize template
      let shopperMeta = {};
      try { shopperMeta = JSON.parse(shopper.metadata || '{}'); } catch(e){}
      
      let messageBody = template
        .replace(/\{\{name\}\}/g, shopper.name)
        .replace(/\{\{first_name\}\}/g, shopper.name.split(' ')[0])
        .replace(/\{\{favorite_category\}\}/g, shopperMeta.favorite_category || 'our selection')
        .replace(/\{\{link\}\}/g, `http://xno.sh/c/${commId}`);

      commsToInsert.push({
        id: commId,
        shopperId: shopper.id,
        phone: shopper.phone,
        email: shopper.email,
        messageBody,
        variant
      });
    });

    // Bulk insert inside a single SQLite transaction
    await runQuery(brand, 'BEGIN TRANSACTION');
    try {
      for (const comm of commsToInsert) {
        await runQuery(brand,
          'INSERT INTO communications (id, campaign_id, customer_id, channel, status, message_body) VALUES (?, ?, ?, ?, ?, ?)',
          [comm.id, campaignId, comm.shopperId, channel, 'PENDING', comm.messageBody]
        );
        await runQuery(brand,
          'INSERT INTO events (id, communication_id, event_type, metadata) VALUES (?, ?, ?, ?)',
          [`EV-${prefix}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`, comm.id, 'ASSIGN_VARIANT', JSON.stringify({ variant: comm.variant })]
        );
      }
      await runQuery(brand, 'COMMIT');
    } catch (dbErr) {
      await runQuery(brand, 'ROLLBACK');
      throw dbErr;
    }

    // 4. Asynchronously dispatch campaigns to Channel Service
    dispatchCampaign(brand, campaignId, commsToInsert, channel);

    res.json({ success: true, campaignId, totalQueued: commsToInsert.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function to dispatch communications to Channel Service in parallel batches
async function dispatchCampaign(brand, campaignId, communicationsList, channel) {
  console.log(`[CRM Server] Dispatching campaign ${campaignId} for brand ${brand} with ${communicationsList.length} messages...`);
  
  const chunkSize = 10;
  for (let i = 0; i < communicationsList.length; i += chunkSize) {
    const chunk = communicationsList.slice(i, i + chunkSize);
    
    await Promise.all(chunk.map(async (comm) => {
      const recipient = channel === 'email' ? comm.email : comm.phone;
      
      // Update CRM status to SENT
      await runQuery(brand,
        'UPDATE communications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['SENT', comm.id]
      );

      broadcastEvent(brand, 'COMMUNICATION_SENT', {
        campaignId,
        communicationId: comm.id,
        recipient,
        channel,
        status: 'SENT',
        timestamp: new Date().toISOString()
      });

      try {
        // POST to simulated channel service
        await axios.post('http://localhost:3001/send', {
          communicationId: comm.id,
          recipient,
          message: comm.messageBody,
          channel,
          callbackUrl: `http://localhost:3000/api/receipt`
        });
      } catch (error) {
        // If Channel Service is down, mark as FAILED in CRM
        console.error(`[CRM Server] Channel gateway offline while sending ${comm.id}:`, error.message);
        await runQuery(brand,
          'UPDATE communications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          ['FAILED', comm.id]
        );
        const prefix = BRAND_CODES[brand] || 'STA';
        await runQuery(brand,
          'INSERT INTO events (id, communication_id, event_type, metadata) VALUES (?, ?, ?, ?)',
          [`EV-${prefix}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`, comm.id, 'failed', JSON.stringify({ error: 'Gateway offline' })]
        );
        
        broadcastEvent(brand, 'COMMUNICATION_FAILED', {
          campaignId,
          communicationId: comm.id,
          status: 'FAILED',
          error: 'Gateway offline'
        });
      }
    }));
  }

  // After routing all messages, update campaign status to COMPLETED
  await runQuery(brand, 'UPDATE campaigns SET status = ? WHERE id = ?', ['COMPLETED', campaignId]);
}

// Receipt Webhook Callback Endpoint (Called by Channel Service)
// Automatically resolves target brand database from prefix mapping of incoming communicationId
app.post('/api/receipt', async (req, res) => {
  const { communicationId, status, timestamp, metadata, error } = req.body;

  if (!communicationId || !status) {
    return res.status(400).json({ error: 'Missing communicationId or status' });
  }

  const brand = getBrandFromId(communicationId);

  try {
    // 1. Get communication details
    const comm = await getQuery(brand, 'SELECT campaign_id, customer_id, channel, status FROM communications WHERE id = ?', [communicationId]);
    if (!comm) {
      return res.status(404).json({ error: `Communication ${communicationId} not found in ${brand}` });
    }

    // 2. Insert event
    const prefix = BRAND_CODES[brand] || 'STA';
    const eventId = `EV-${prefix}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    await runQuery(brand,
      'INSERT INTO events (id, communication_id, event_type, timestamp, metadata) VALUES (?, ?, ?, ?, ?)',
      [eventId, communicationId, status.toLowerCase(), timestamp, JSON.stringify(metadata || { error })]
    );

    // 3. Update communication status
    const statusPrecedence = { PENDING: 0, SENT: 1, FAILED: 2, DELIVERED: 3, READ: 4, CLICKED: 5, CONVERTED: 6 };
    
    if (statusPrecedence[status] > statusPrecedence[comm.status]) {
      await runQuery(brand,
        'UPDATE communications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [status, communicationId]
      );
    }

    // 4. Ingest conversions back to orders database (Attributed Purchase!)
    if (status === 'CONVERTED' && metadata && metadata.amount) {
      const orderId = metadata.order_id || `ORD-ATTR-${prefix}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      
      // Check if order exists
      const existingOrder = await getQuery(brand, 'SELECT id FROM orders WHERE id = ?', [orderId]);
      if (!existingOrder) {
        // Load favorite items for customer to log realistic purchase items
        const customer = await getQuery(brand, 'SELECT metadata FROM customers WHERE id = ?', [comm.customer_id]);
        
        let items = ['Campaign Refreshed Items'];
        const config = BRAND_CONFIGS[brand] || BRAND_CONFIGS.starbucks;
        if (customer) {
          try {
            const meta = JSON.parse(customer.metadata);
            // Default to selecting dynamic items from brand config matching their favorite category index
            const catIndex = Math.max(0, config.categories.indexOf(meta.favorite_category));
            items = [config.items[catIndex % config.items.length]];
          } catch(e){}
        }

        await runQuery(brand,
          'INSERT INTO orders (id, customer_id, amount, status, items, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [orderId, comm.customer_id, metadata.amount, 'COMPLETED', JSON.stringify(items), timestamp]
        );
        console.log(`[CRM Server] Converted sale ingested: ${orderId} - ₹${metadata.amount} for customer ${comm.customer_id} in brand: ${brand}`);
      }
    }

    // 5. Query campaign rollups and broadcast updates
    const campaignStats = await getCampaignRollup(brand, comm.campaign_id);
    
    broadcastEvent(brand, 'RECEIPT_PROCESSED', {
      rawEvent: { communicationId, campaignId: comm.campaign_id, status, timestamp, metadata },
      stats: campaignStats
    });

    res.json({ success: true });
  } catch (error) {
    console.error(`[CRM Server] Receipt handler error for brand ${brand}:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Fetch all campaigns with rollup metrics for current brand
app.get('/api/campaigns', async (req, res) => {
  const brand = req.brand;
  try {
    const campaigns = await allQuery(brand, 'SELECT * FROM campaigns ORDER BY created_at DESC');
    const rolledUpCampaigns = [];
    
    for (const campaign of campaigns) {
      const rollup = await getCampaignRollup(brand, campaign.id);
      rolledUpCampaigns.push({
        ...campaign,
        message_template: JSON.parse(campaign.message_template || '{}'),
        segment_rules: JSON.parse(campaign.segment_rules || '{}'),
        stats: rollup
      });
    }
    
    res.json(rolledUpCampaigns);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fetch detailed stats for single campaign
app.get('/api/campaigns/:id', async (req, res) => {
  const brand = req.brand;
  const campaignId = req.params.id;
  try {
    const campaign = await getQuery(brand, 'SELECT * FROM campaigns WHERE id = ?', [campaignId]);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    
    const stats = await getCampaignRollup(brand, campaignId);
    
    const communications = await allQuery(brand, `
      SELECT 
        comm.*, 
        cust.name as customer_name, 
        cust.email, 
        cust.phone,
        (SELECT json_extract(metadata, '$.error') FROM events WHERE communication_id = comm.id AND event_type = 'failed' ORDER BY timestamp DESC LIMIT 1) as failure_reason
      FROM communications comm
      JOIN customers cust ON comm.customer_id = cust.id
      WHERE comm.campaign_id = ?
      ORDER BY comm.updated_at DESC
    `, [campaignId]);

    // Fetch variant assignment mapped from audit trail
    for (const c of communications) {
      const variantEvent = await getQuery(brand,
        "SELECT metadata FROM events WHERE communication_id = ? AND event_type = 'ASSIGN_VARIANT'",
        [c.id]
      );
      c.variant = variantEvent ? JSON.parse(variantEvent.metadata).variant : 'A';
    }

    res.json({
      ...campaign,
      message_template: JSON.parse(campaign.message_template || '{}'),
      segment_rules: JSON.parse(campaign.segment_rules || '{}'),
      stats,
      communications
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Retry a failed message dispatch (Resolves target brand automatically from ID)
app.post('/api/communications/:id/retry', async (req, res) => {
  const commId = req.params.id;
  const brand = getBrandFromId(commId);
  try {
    // 1. Fetch communication details
    const comm = await getQuery(brand,
      `SELECT c.*, cust.name as customer_name, cust.email, cust.phone 
       FROM communications c 
       JOIN customers cust ON c.customer_id = cust.id 
       WHERE c.id = ?`,
      [commId]
    );
    if (!comm) return res.status(404).json({ error: `Communication ${commId} not found` });

    // 2. Set status to PENDING in CRM
    await runQuery(brand, 'UPDATE communications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['PENDING', commId]);
    
    // Broadcast status change immediately to clear error visual state
    let stats = await getCampaignRollup(brand, comm.campaign_id);
    broadcastEvent(brand, 'RECEIPT_PROCESSED', {
      rawEvent: { communicationId: commId, campaignId: comm.campaign_id, status: 'PENDING', timestamp: new Date().toISOString() },
      stats
    });

    // 3. Re-dispatch to Channel Service Simulator
    const recipient = comm.channel === 'email' ? comm.email : comm.phone;
    
    // Update CRM status to SENT
    await runQuery(brand, 'UPDATE communications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['SENT', commId]);
    
    broadcastEvent(brand, 'COMMUNICATION_SENT', {
      campaignId: comm.campaign_id,
      communicationId: commId,
      recipient,
      channel: comm.channel,
      status: 'SENT',
      timestamp: new Date().toISOString()
    });

    // Send HTTP POST to gateway service
    axios.post('http://localhost:3001/send', {
      communicationId: commId,
      recipient,
      message: comm.message_body,
      channel: comm.channel,
      callbackUrl: `http://localhost:3000/api/receipt`
    }).catch(err => {
      console.error(`[CRM Server] Retry dispatch offline for ${commId}:`, err.message);
    });

    res.json({ success: true });
  } catch (error) {
    console.error('[CRM Server] Retry handler error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get AI performance insights for current brand
app.post('/api/campaigns/:id/insights', async (req, res) => {
  const brand = req.brand;
  const campaignId = req.params.id;
  const { apiKey } = req.body;
  try {
    const stats = await getCampaignRollup(brand, campaignId);
    const activeApiKey = apiKey || process.env.GEMINI_API_KEY;
    const insights = await generateAIInsights(stats, activeApiKey);
    res.json({ insights });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AI Database Assistant Chatbot Endpoint for current brand
app.post('/api/ai/chat', async (req, res) => {
  const brand = req.brand;
  const { question, apiKey } = req.body;
  if (!question) {
    return res.status(400).json({ error: 'Question is required' });
  }
  try {
    const activeApiKey = apiKey || process.env.GEMINI_API_KEY;
    const response = await askAIAboutDatabase(question, activeApiKey, brand);
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET Ratings and Reviews analysis for current brand
app.get('/api/ratings', async (req, res) => {
  const brand = req.brand;
  const { apiKey } = req.query;
  try {
    const reviews = await allQuery(brand, 'SELECT * FROM reviews ORDER BY created_at DESC');
    
    // Group and calculate stats
    const stats = {
      app_store: { total: 0, count: 0, ratings: [0, 0, 0, 0, 0] },
      play_store: { total: 0, count: 0, ratings: [0, 0, 0, 0, 0] },
      trustpilot: { total: 0, count: 0, ratings: [0, 0, 0, 0, 0] }
    };
    
    reviews.forEach(r => {
      const p = r.platform;
      if (stats[p]) {
        stats[p].total += r.rating;
        stats[p].count++;
        const ratingIdx = Math.max(1, Math.min(5, r.rating)) - 1;
        stats[p].ratings[ratingIdx]++;
      }
    });

    const platforms = {};
    for (const [key, value] of Object.entries(stats)) {
      const average = value.count > 0 ? parseFloat((value.total / value.count).toFixed(1)) : 0;
      
      const platformReviews = reviews.filter(r => r.platform === key);
      const topRatings = platformReviews.filter(r => r.rating >= 4).slice(0, 5);
      const worstRatings = platformReviews.filter(r => r.rating <= 2).slice(0, 5);

      platforms[key] = {
        average,
        count: value.count,
        ratingsDistribution: value.ratings,
        topRatings,
        worstRatings
      };
    }

    const activeApiKey = apiKey || process.env.GEMINI_API_KEY;
    const insights = await generateRatingsInsights(reviews, activeApiKey, brand);

    res.json({
      platforms,
      insights
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper: Calculate campaign rollup metrics for specific brand
async function getCampaignRollup(brand, campaignId) {
  const c = await getQuery(brand, 'SELECT channel FROM campaigns WHERE id = ?', [campaignId]);
  const channel = c ? c.channel : 'unknown';

  const summary = await getQuery(brand, `
    SELECT 
      COUNT(id) as sent,
      SUM(CASE WHEN status = 'DELIVERED' OR status = 'READ' OR status = 'CLICKED' OR status = 'CONVERTED' THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'READ' OR status = 'CLICKED' OR status = 'CONVERTED' THEN 1 ELSE 0 END) as read,
      SUM(CASE WHEN status = 'CLICKED' OR status = 'CONVERTED' THEN 1 ELSE 0 END) as clicked,
      SUM(CASE WHEN status = 'CONVERTED' THEN 1 ELSE 0 END) as converted
    FROM communications
    WHERE campaign_id = ?
  `, [campaignId]);

  // Attributed Revenue from conversion events
  const revenueRow = await getQuery(brand, `
    SELECT SUM(CAST(JSON_EXTRACT(e.metadata, '$.amount') AS REAL)) as revenue
    FROM events e
    JOIN communications comm ON e.communication_id = comm.id
    WHERE comm.campaign_id = ? AND e.event_type = 'converted'
  `, [campaignId]);

  // A/B Variant specific counters
  const comList = await allQuery(brand, 'SELECT id FROM communications WHERE campaign_id = ?', [campaignId]);
  
  const variantStats = {
    A: { sent: 0, delivered: 0, read: 0, clicked: 0, converted: 0, revenue: 0 },
    B: { sent: 0, delivered: 0, read: 0, clicked: 0, converted: 0, revenue: 0 }
  };

  for (const item of comList) {
    const variantEvent = await getQuery(brand,
      "SELECT metadata FROM events WHERE communication_id = ? AND event_type = 'ASSIGN_VARIANT'",
      [item.id]
    );
    const variant = variantEvent ? JSON.parse(variantEvent.metadata).variant : 'A';
    
    const statusRow = await getQuery(brand, 'SELECT status FROM communications WHERE id = ?', [item.id]);
    const status = statusRow ? statusRow.status : 'PENDING';
    
    variantStats[variant].sent++;
    if (['DELIVERED', 'READ', 'CLICKED', 'CONVERTED'].includes(status)) variantStats[variant].delivered++;
    if (['READ', 'CLICKED', 'CONVERTED'].includes(status)) variantStats[variant].read++;
    if (['CLICKED', 'CONVERTED'].includes(status)) variantStats[variant].clicked++;
    if (status === 'CONVERTED') {
      variantStats[variant].converted++;
      const convertEvent = await getQuery(brand, "SELECT metadata FROM events WHERE communication_id = ? AND event_type = 'converted'", [item.id]);
      if (convertEvent) {
        try {
          variantStats[variant].revenue += JSON.parse(convertEvent.metadata).amount || 0;
        } catch(e){}
      }
    }
  }

  return {
    campaignId,
    channel,
    sent: summary.sent || 0,
    delivered: summary.delivered || 0,
    failed: summary.failed || 0,
    read: summary.read || 0,
    clicked: summary.clicked || 0,
    converted: summary.converted || 0,
    revenue: parseFloat((revenueRow.revenue || 0).toFixed(2)),
    variantStats
  };
}

// Start CRM service
app.listen(PORT, () => {
  console.log(`[CRM Service] CRM Backend API server running on http://localhost:${PORT}`);
});
