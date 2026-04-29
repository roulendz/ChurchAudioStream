const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:7778');

const CHANNEL_ID = '781215e5-e940-4cd0-a138-b1c535f6db4e';
const VAC_INPUT_ID = 'local:wasapi2:\\\\?\\SWD#MMDEVAPI#{0.0.1.00000000}.{510cca43-1c42-43a8-9bfd-dcdbfd6dc0de}#{2eef81be-33fa-4800-9670-1cd474972c3f}';

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'identify', payload: { role: 'admin' } }));

  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'channel:stop', payload: { channelId: CHANNEL_ID } }));
  }, 500);

  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'channel:source:remove', payload: { channelId: CHANNEL_ID, sourceIndex: 0 } }));
  }, 1000);

  setTimeout(() => {
    ws.send(JSON.stringify({
      type: 'channel:source:add',
      payload: { channelId: CHANNEL_ID, sourceId: VAC_INPUT_ID, selectedChannels: [0] }
    }));
  }, 1500);

  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'channel:start', payload: { channelId: CHANNEL_ID } }));
  }, 2000);
});

ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.type === 'levels:update') return;
  console.log(m.type, JSON.stringify(m.payload || {}).substring(0, 400));
});

setTimeout(() => { ws.close(); process.exit(0); }, 7000);
