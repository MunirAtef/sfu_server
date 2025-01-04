const Turn = require("node-turn");
const webrtc = require("wrtc");
const { v4: uuid } = require('uuid');
const fs = require('fs');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const express = require('express');
const url = require("url");
const app = express();
const datastore = require("./in_memory_datasource");
const { serverMethods, clientMethods, roles, configuration } = require("./constants");
const path = require('path');

// Common server instance
const serverOptions = {
  listenPort: 3000,
  useHttps: false,
  httpsCertFile: '/path/to/cert/',
  httpsKeyFile: '/path/to/key/',
};

let sslOptions = {};
if (serverOptions.useHttps) {
  sslOptions.key = fs.readFileSync(serverOptions.httpsKeyFile).toString();
  sslOptions.cert = fs.readFileSync(serverOptions.httpsCertFile).toString();
}

const webServer = serverOptions.useHttps
  ? https.createServer(sslOptions, app)
  : http.createServer(app);

webServer.listen(serverOptions.listenPort, () => {
  console.log(`Server running on port ${serverOptions.listenPort}`);
});

// Attach TURN server
const turnServer = new Turn({
  authMech: 'long-term',
  credentials: {
    username: 'munir123456',
  },
  server: webServer, // Attach TURN to the existing server
});

turnServer.addUser("munir_m_atef", "munir123456");
turnServer.start();

// Attach SFU WebSocket server
const wss = new WebSocket.Server({ server: webServer });
wss.on('connection', (ws, req) => {
  let userId = uuid();
  ws.id = userId;
  ws.send(JSON.stringify({ type: clientMethods.welcome, id: userId }));

  const queryParams = url.parse(req.url, true).query;
  const roomId = queryParams.roomId;

  ws.on('message', async (message) => {
    const body = JSON.parse(message);
    console.log(`${userId} sends: ${message}`);
    // Handle SFU logic here (similar to your existing SFU code)
  });

  ws.on('close', () => {
    // Handle disconnection logic
  });

  ws.on('error', (e) => console.log(e));
});

// Serve static files
app.use(express.static('with_datasource/client/'));
app.get('/:filename', (req, res) => {
  const filename = req.params.filename;
  res.sendFile(path.join(__dirname, '..', 'client', filename));
});

console.log('Merged TURN and SFU server is running...');
