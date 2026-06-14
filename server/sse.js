const clients = [];

function addClient(req, res) {
  const brand = (req.query.brand || 'starbucks').toLowerCase();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Unique client ID
  const clientId = Date.now();
  const newClient = {
    id: clientId,
    brand,
    res,
  };

  clients.push(newClient);
  console.log(`[SSE] Client connected for brand: ${brand}. Active clients: ${clients.length}`);

  // Send initial message
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', message: `SSE Connection Established for ${brand}` })}\n\n`);

  req.on('close', () => {
    const index = clients.findIndex((c) => c.id === clientId);
    if (index !== -1) {
      clients.splice(index, 1);
    }
    console.log(`[SSE] Client disconnected for brand: ${brand}. Active clients: ${clients.length}`);
  });
}

function broadcastEvent(brand, type, payload) {
  const brandKey = (brand || 'starbucks').toLowerCase();
  const data = JSON.stringify({ type, payload });
  clients.forEach((client) => {
    if (client.brand === brandKey) {
      client.res.write(`data: ${data}\n\n`);
    }
  });
}

module.exports = {
  addClient,
  broadcastEvent,
};
