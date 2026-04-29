// Step 1: Restart channel with default capture device
// Step 2: Get the RTP port from channel processing config
// Step 3: Kill the GStreamer pipeline and inject our own audio

const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:7778');

const CHANNEL_ID = '781215e5-e940-4cd0-a138-b1c535f6db4e';
const DEFAULT_CAPTURE = 'local:wasapi2:{2EEF81BE-33FA-4800-9670-1CD474972C3F}';

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'identify', payload: { role: 'admin' } }));

  // Get channel info to see the RTP port
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'channels:list' }));
  }, 500);

  // Get streaming status to find PlainTransport tuple
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'streaming:status' }));
  }, 1000);
});

ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.type === 'levels:update') return;
  console.log(JSON.stringify(m, null, 2));
});

setTimeout(() => { ws.close(); process.exit(0); }, 4000);
