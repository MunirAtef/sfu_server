

// sfu server

'use strict'

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
const {serverMethods, clientMethods, roles, configuration} = require("./constants");
const path = require('path');


app.use(express.static('with_datasource/client/'));
app.get('/:filename', (req, res) => {
  const filename = req.params.filename;
  res.sendFile(path.join(__dirname, '..', 'client', filename));
});


const WebSocketServer = WebSocket.Server;

let serverOptions = {
  listenPort: 5000,
  useHttps: false,
  httpsCertFile: '/path/to/cert/',
  httpsKeyFile: '/path/to/key/',
};

let sslOptions = {};
if (serverOptions.useHttps) {
  sslOptions.key = fs.readFileSync(serverOptions.httpsKeyFile).toString();
  sslOptions.cert = fs.readFileSync(serverOptions.httpsCertFile).toString();
}

let webServer;
if(serverOptions.useHttps) {
  webServer = https.createServer(sslOptions, app);
  webServer.listen(serverOptions.listenPort);
} else {
  webServer = http.createServer(app);
  webServer.listen(serverOptions.listenPort);
}


function handleTrackEvent(event, userId, roomId) {
  if (event.streams && event.streams[0]) {
    const user = datastore.getUser(userId, roomId);
    user.stream = event.streams[0];

    notifyOtherRoomUsers(roomId, userId, {
      type: clientMethods.newPublisher,
      id: userId,
      username: user.username
    });
  }
}

function createPeer() {
  return new webrtc.RTCPeerConnection(configuration);
}

async function produceStream(user, userId, roomId, sdp) {
  const peer = createPeer();
  user.peer = peer;
  user.role = roles.speaker;

  peer.ontrack = (e) => { handleTrackEvent(e, userId, roomId) };
  const desc = new webrtc.RTCSessionDescription(sdp);
  await peer.setRemoteDescription(desc);
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);

  const payload = {
    type: clientMethods.answer,
    sdp: peer.localDescription
  }

  user.socket.send(JSON.stringify(payload));
}

function notifyOtherRoomUsers(roomId, userId, payload) {
  const payloadString = JSON.stringify(payload);

  (datastore.getOtherRoomUsers(roomId, userId) || []).forEach((user) => {
    user.socket.send(payloadString);
  });
}

const wss = new WebSocketServer({ server: webServer });

// ============================== Attach TURN server =================================
// const turnServer = new Turn({
//   authMech: 'long-term',
//   credentials: {
//     username: 'munir123456',
//   },
//   server: webServer, // Attach TURN to the existing server
// });
//
// turnServer.addUser("munir_m_atef", "munir123456");
// turnServer.start();
// ===================================================================================


wss.on('connection', function (ws, req) {
  let userId = uuid();
  ws.id = userId;
  ws.send(JSON.stringify({ type: clientMethods.welcome, id: userId }));
  const queryParams = url.parse(req.url, true).query;
  const roomId = queryParams.roomId;

  ws.on('close', (_) => {
    try {
      const user = datastore.removeUser(userId, roomId);

      if (user.role === roles.speaker) notifyOtherRoomUsers(roomId, userId, {
        type: clientMethods.publisherLeft,
        id: userId
      });
    } catch (e) {
      console.log(`ExceptionOnClose: ${e}`);
    }
  });

  ws.on('message', async function (message) {
    const body = JSON.parse(message);
    console.log(`${userId} sends: ${message}`);

    try {
      switch (body.type) {
        case serverMethods.connect: {
          const roomId = body.roomId;
          const role = body.role;
          const user = {id: userId, socket: ws, username: body.username, roomId, role};

          datastore.addUser(userId, roomId, user);
          if (role === roles.listener) return;

          await produceStream(user, userId, roomId, body.sdp);
          break;
        }
        case serverMethods.setRole: {
          const role = body.role;
          const user = datastore.getUser(userId, roomId);
          if (user.role === role) return;
          datastore.setRole(userId, roomId, role);

          if (role === roles.listener) {
            notifyOtherRoomUsers(roomId, userId, {type: clientMethods.publisherLeft, id: userId});
            return;
          }
          await produceStream(user, userId, user.roomId, body.sdp);

          break;
        }
        case serverMethods.getPublishers:
          const pubs = datastore.getRoomPublishers(roomId, userId);

          const publishersPayload = {
            type: clientMethods.publishers,
            publishers: pubs.map((user) => { return {id: user.id, username: user.username} })
          }

          ws.send(JSON.stringify(publishersPayload));
          break;
        case serverMethods.ice: {
          const user = datastore.getUser(userId, roomId);
          if (user.peer)
            user.peer.addIceCandidate(new webrtc.RTCIceCandidate(body.ice)).catch(e => console.log(e));
          break;
        }
        case serverMethods.subscribe:
          try {
            let { pubId, sdp } = body;
            const remoteUser = datastore.getUser(pubId, roomId);
            const newPeer = createPeer();
            datastore.addSubscriber(roomId, userId, pubId, newPeer);
            await newPeer.setRemoteDescription(new webrtc.RTCSessionDescription(sdp));

            remoteUser.stream.getTracks().forEach(track => {
              newPeer.addTrack(track, remoteUser.stream);
            });
            const _answer = await newPeer.createAnswer();
            await newPeer.setLocalDescription(_answer);

            const _payload = {
              type: clientMethods.subscriptionAnswer,
              sdp: _answer,
              username: remoteUser.username,
              pubId
            }

            ws.send(JSON.stringify(_payload));
          } catch (error) {
            console.log(error)
          }

          break;
        case serverMethods.consumerIce:
          const pubId = body.pubId;
          const peer = datastore.getSubscriberPeer(roomId, userId, pubId);
          peer.addIceCandidate(new webrtc.RTCIceCandidate(body.ice)).catch(e => console.log(e));
          break;
        default:
          console.log(`UnknownMessage: ${message}`);
      }
    } catch (e) {
      console.log(`Exception: ${e}`)
    }
  });
  ws.on('error', (e) => console.log(e));
});


console.log('Server running..');
