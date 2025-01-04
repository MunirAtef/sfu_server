'use strict'

const webrtc = require("wrtc");
// const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const express = require('express');
const app = express();

app.use(express.static('public'));
// based on examples at https://www.npmjs.com/package/ws
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

let publishers = new Map();
let consumers = new Map();


function handleTrackEvent(event, uuid, roomId) {
  if (event.streams && event.streams[0]) {
    publishers.get(uuid).stream = event.streams[0];

    const payloadString = JSON.stringify({
      type: 'newPublisher',
      id: uuid,
      username: publishers.get(uuid).username
    })

    publishers.forEach((val, key) => {
      if (val.roomId === roomId && key !== uuid) val.socket.send(payloadString);
    });
    // wss.broadcast(payloadString);
  }
}

function createPeer() {
  let configuration = {
    iceServers: [
      {urls: "stun:stun.relay.metered.ca:80"},
      {
        urls: "turn:global.relay.metered.ca:80",
        username: "941563fc8b5b8e8c1a5424cb",
        credential: "spoMfi7SzsfGP9bk"
      },
      {
        urls: "turn:global.relay.metered.ca:80?transport=tcp",
        username:"941563fc8b5b8e8c1a5424cb",
        credential:"spoMfi7SzsfGP9bk"
      },
      {
        urls: "turn:global.relay.metered.ca:443",
        username:"941563fc8b5b8e8c1a5424cb",
        credential:"spoMfi7SzsfGP9bk"
      },
      {
        urls: "turns:global.relay.metered.ca:443?transport=tcp",
        username:"941563fc8b5b8e8c1a5424cb",
        credential:"spoMfi7SzsfGP9bk"
      }
    ]
  }

  return new webrtc.RTCPeerConnection(configuration);
}

async function produceStream(user, uuid, roomId, sdp) {
  const peer = createPeer();
  user.peer = peer;
  user.role = 'speaker'
  // publishers.set(uuid, { socket: ws, username: body.username, peer, roomId, role });

  peer.ontrack = (e) => { handleTrackEvent(e, uuid, roomId) };
  const desc = new webrtc.RTCSessionDescription(sdp);
  await peer.setRemoteDescription(desc);
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);

  const payload = {
    type: 'answer',
    sdp: peer.localDescription
  }

  user.socket.send(JSON.stringify(payload));
}

function changePublisherToLister(peerId) {
  const user = publishers.get(peerId);
  user.role = 'listener';

  wss.broadcast(JSON.stringify({
    type: 'publisherLeft',
    id: peerId
  }));

  for (const consumerId in consumers) {
    if (consumers.get(consumerId).publisherId === peerId) {
      consumers.delete(consumerId);
    }
  }
  // consumers.delete(ws.id);
}

const wss = new WebSocketServer({ server: webServer });


wss.on('connection', function (ws) {
  let peerId = uuidv4();
  ws.id = peerId;
  ws.send(JSON.stringify({ 'type': 'welcome', id: peerId }));

  ws.on('close', (_) => {
    if (!publishers.has(peerId)) return;
    const { role } = publishers.get(peerId);
    publishers.delete(ws.id);
    consumers.delete(ws.id);

    if (role === 'speaker') wss.broadcast(JSON.stringify({
      type: 'publisherLeft',
      id: peerId
    }));
  });

  ws.on('message', async function (message) {
    const body = JSON.parse(message);
    switch (body.type) {
      case 'connect': {
        const roomId = body.roomId;
        const role = body.role;
        const user = {socket: ws, username: body.username, roomId, role};
        console.log("===========================================");
        console.log(peerId)
        console.log("===========================================");

        publishers.set(peerId, user);
        if (role === 'listener') return;

        await produceStream(user, peerId, roomId, body.sdp);

        // const peer = createPeer();
        // publishers.set(body.uuid, {socket: ws, username: body.username, peer, roomId, role});
        //
        // peer.ontrack = (e) => {
        //   handleTrackEvent(e, body.uuid, roomId)
        // };
        // const desc = new webrtc.RTCSessionDescription(body.sdp);
        // await peer.setRemoteDescription(desc);
        // const answer = await peer.createAnswer();
        // await peer.setLocalDescription(answer);
        //
        // const payload = {
        //   type: 'answer',
        //   sdp: peer.localDescription
        // }
        //
        // ws.send(JSON.stringify(payload));
        break;
      }
      case 'setRole': {
        const role = body.role;
        const user = publishers.get(peerId);
        if (user.role === role) return;
        if (role === 'listener') {
          changePublisherToLister(peerId);
          return;
        }
        await produceStream(user, peerId, user.roomId, body.sdp);

        break;
      }
      case 'getPublishers':
        let uuid = body.uuid;
        const list = [];
        console.log(publishers)
        console.log(peerId)
        const myRoomId = publishers.get(peerId).roomId;
        console.log("-----------------------------------------------")
        publishers.forEach((peer, key) => {
          if (peer.roomId === myRoomId && key !== uuid && peer.role === 'speaker') {
            list.push({
              id: key,
              username: peer.username,
            });
          }
        });

        const publishersPayload = {
          type: 'publishers',
          publishers: list
        }

        ws.send(JSON.stringify(publishersPayload));
        break;
      case 'ice': {
        const user = publishers.get(body.uuid);
        if (user.peer)
          user.peer.addIceCandidate(new webrtc.RTCIceCandidate(body.ice)).catch(e => console.log(e));
        break;
      }
      case 'subscribe':
        try {
          let { id, sdp, consumerId } = body;
          const remoteUser = publishers.get(id);
          const newPeer = createPeer();
          newPeer.publisherId = id;
          consumers.set(consumerId, newPeer);
          // const _desc = new webrtc.RTCSessionDescription(sdp);
          await newPeer.setRemoteDescription(new webrtc.RTCSessionDescription(sdp));

          remoteUser.stream.getTracks().forEach(track => {
            newPeer.addTrack(track, remoteUser.stream);
          });
          const _answer = await newPeer.createAnswer();
          await newPeer.setLocalDescription(_answer);

          const _payload = {
            type: 'subscriptionAnswer',
            sdp: _answer,
            username: remoteUser.username,
            id,
            consumerId
          }

          ws.send(JSON.stringify(_payload));
        } catch (error) {
          console.log(error)
        }

        break;
      case 'consumerIce':
        if (consumers.has(body.consumerId)) {
          consumers.get(body.consumerId).addIceCandidate(new webrtc.RTCIceCandidate(body.ice)).catch(e => console.log(e));
        }
        break;
      default:
        wss.broadcast(message);
    }
  });

  ws.on('error', (e) => console.log(e));  // ws.terminate()
});

wss.broadcast = function (data) {
  publishers.forEach(function (peer) {
    if (peer.socket.readyState === WebSocket.OPEN) {
      peer.socket.send(data);
    }
  });
};


console.log('Server running..');