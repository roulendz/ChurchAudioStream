const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:7778');

const CHANNEL_ID = '781215e5-e940-4cd0-a138-b1c535f6db4e';
// NVIDIA Broadcast mic (WASAPI) - virtual mic, should be accessible
const NVIDIA_MIC = 'local:wasapi2:\\\\?\\SWD#MMDEVAPI#{0.0.1.00000000}.{9590b9b1-0295-4b10-9325-62ab34addaf0}#{2eef81be-33fa-4800-9670-1cd474972c3f}';

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'identify', payload: { role: 'admin' } }));

  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'channel:stop', payload: { channelId: CHANNEL_ID } }));
  }, 300);

  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'channel:source:remove', payload: { channelId: CHANNEL_ID, sourceIndex: 0 } }));
  }, 800);

  setTimeout(() => {
    ws.send(JSON.stringify({
      type: 'channel:source:add',
      payload: { channelId: CHANNEL_ID, sourceId: NVIDIA_MIC, selectedChannels: [0] }
    }));
  }, 1300);

  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'channel:start', payload: { channelId: CHANNEL_ID } }));
  }, 1800);
});

ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.type === 'levels:update') return;
  console.log(m.type, ':', JSON.stringify(m.payload || {}).substring(0, 300));
});

setTimeout(() => { ws.close(); process.exit(0); }, 7000);
