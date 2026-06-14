const { spawn } = require('child_process');
const path = require('path');

console.log('\x1b[35m[System] Starting Xeno Backend Services (CRM & Channel Service)...\x1b[0m');

// 1. Start CRM Server
const crm = spawn('node', [path.join(__dirname, 'server', 'index.js')], {
  shell: true,
  stdio: 'inherit'
});

// 2. Start simulated Channel Service
const channel = spawn('node', [path.join(__dirname, 'channel-service', 'index.js')], {
  shell: true,
  stdio: 'inherit'
});

process.on('SIGINT', () => {
  console.log('\n\x1b[35m[System] Shutting down backend services...\x1b[0m');
  crm.kill();
  channel.kill();
  process.exit();
});
