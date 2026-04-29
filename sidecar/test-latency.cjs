const WebSocket = require('ws');
console.log('Connecting to ws://127.0.0.1:7778...');
const ws = new WebSocket('ws://127.0.0.1:7778');

ws.on('error', function(err) {
  console.log('ERROR:', err.message);
});

ws.on('open', function() {
  console.log('Connected! Sending identify...');
  ws.send(JSON.stringify({ type: 'identify', payload: { role: 'admin' } }));
});

ws.on('close', function() {
  console.log('Connection closed');
});

ws.on('message', function(d) {
  const m = JSON.parse(d);
  if (m.type === 'welcome') {
    console.log('Got welcome! Sending config:get...');
    ws.send(JSON.stringify({ type: 'config:get', payload: {} }));
  } else if (m.type === 'config:response') {
    console.log('Config keys:', Object.keys(m.payload));
    const ch = m.payload.channels || m.payload.audio?.channels || [];
    console.log('=== CHANNELS ===');
    ch.forEach(function(c) {
      console.log(c.id + ' - ' + c.name + ' - source: ' + (c.sourceId || 'none'));
    });
    if (ch.length > 0) {
      const id = ch[0].id;
      console.log('\n=== TESTING LATENCY FOR: ' + id + ' ===');
      ws.send(JSON.stringify({ type: 'streaming:channel-latency', payload: { channelId: id } }));
    } else {
      console.log('No channels configured');
      ws.close();
    }
  } else if (m.type === 'streaming:channel-latency') {
    console.log(JSON.stringify(m, null, 2));
    console.log('\n=== TESTING WORKERS ===');
    ws.send(JSON.stringify({ type: 'streaming:workers', payload: {} }));
  } else if (m.type === 'streaming:workers') {
    console.log(JSON.stringify(m, null, 2));
    console.log('\n=== TESTING LISTENERS (all) ===');
    ws.send(JSON.stringify({ type: 'streaming:listeners', payload: { displayMode: 'all' } }));
  } else if (m.type === 'streaming:listeners') {
    console.log(JSON.stringify(m, null, 2));
    ws.close();
  }
});

setTimeout(function() {
  console.log('Timeout - closing');
  ws.close();
  process.exit(1);
}, 8000);
