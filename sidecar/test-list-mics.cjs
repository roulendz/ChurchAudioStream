const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:7778');
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'identify', payload: { role: 'admin' } }));
  setTimeout(() => ws.send(JSON.stringify({ type: 'sources:list' })), 500);
});
ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.type === 'sources:list') {
    const sources = m.payload.sources;
    console.log('\n=== CAPTURE DEVICES (non-loopback) ===');
    sources.filter(s => s.isLoopback === false).forEach(s => {
      console.log(`  ${s.name}`);
      console.log(`    ID: ${s.id}`);
      console.log(`    Channels: ${s.channelCount}, Rate: ${s.sampleRate}`);
      console.log('');
    });
  }
});
setTimeout(() => { ws.close(); process.exit(0); }, 3000);
