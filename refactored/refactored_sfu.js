// 'use strict';

//
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
if (serverOptions.useHttps) {
    webServer = https.createServer(sslOptions, app);
    webServer.listen(serverOptions.listenPort);
} else {
    webServer = http.createServer(app);
    webServer.listen(serverOptions.listenPort);
}

let rooms = new Map(); // Store rooms and their participants
let peers = new Map();
let consumers = new Map();

function handleTrackEvent(e, peer, ws, roomId) {
    if (e.streams && e.streams[0]) {
        rooms.get(roomId).peers.get(peer).stream = e.streams[0];

        const payload = {
            type: 'newProducer',
            id: peer,
            username: rooms.get(roomId).peers.get(peer).username
        };

        broadcastToRoom(roomId, JSON.stringify(payload));
    }
}

function createPeer() {
    return new webrtc.RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.stunprotocol.org:3478' },
            { urls: 'stun:stun.l.google.com:19302' },
        ]
    });
}

// Create a server for handling websocket calls
const wss = new WebSocketServer({ server: webServer });

wss.on('connection', function (ws) {
    let peerId = uuidv4();
    ws.id = peerId;
    // console.log(`${peerId} ::::::::::::::::::::::::::: ${peerId}`)
    ws.on('close', () => {
        if (peers.has(peerId)) {
            const roomId = peers.get(peerId).roomId;
            if (roomId && rooms.has(roomId)) {
                const room = rooms.get(roomId);
                room.peers.delete(peerId);
                if (room.peers.size === 0) {
                    rooms.delete(roomId); // Delete room if empty
                } else {
                    broadcastToRoom(roomId, JSON.stringify({
                        type: 'user_left',
                        id: peerId
                    }));
                }
            }
            peers.delete(peerId);
            consumers.delete(peerId);
        }
    });

    ws.send(JSON.stringify({ type: 'welcome', id: peerId }));

    ws.on('message', async function (message) {
        const body = JSON.parse(message);
        // console.log(body);
        // console.log(`${ws.id} ::::::::::::::::::::::::::: ${peerId}`)

        switch (body.type) {
            case 'joinRoom':
                {
                    const { roomId, username } = body;
                    if (!rooms.has(roomId)) {
                        rooms.set(roomId, { peers: new Map() });
                    }
                    rooms.get(roomId).peers.set(peerId, { socket: ws, username });
                    peers.set(peerId, { roomId, socket: ws });

                    ws.send(JSON.stringify({ type: 'roomJoined', roomId }));
                    broadcastToRoom(roomId, JSON.stringify({
                        type: 'user_joined',
                        id: peerId,
                        username
                    }));
                }
                break;

            case 'connect':
                {
                    const { uqid, sdp } = body;

                    // console.log(body);
                    // console.log(uqid);
                    // console.log(peers.get(uqid));
                    // console.log("==========================================");
                    // console.log(peers);
                    // console.log(rooms);
                    // console.log(consumers);
                    // console.log("==========================================");

                    const roomId = peers.get(uqid).roomId;
                    const room = rooms.get(roomId);

                    const peer = createPeer();
                    room.peers.get(uqid).peer = peer;
                    peer.ontrack = (e) => handleTrackEvent(e, uqid, ws, roomId);

                    const desc = new webrtc.RTCSessionDescription(sdp);
                    await peer.setRemoteDescription(desc);
                    const answer = await peer.createAnswer();
                    await peer.setLocalDescription(answer);

                    // ws.send(JSON.stringify({ type: 'answer', sdp: peer.localDescription }));
                    ws.send(JSON.stringify({ type: 'answer', sdp: answer }));
                }
                break;

            case 'getPeers':
                {
                    const { uqid } = body;
                    const roomId = peers.get(uqid).roomId;
                    const room = rooms.get(roomId);

                    const list = Array.from(room.peers.entries())
                        .filter(([id]) => id !== uqid)
                        .map(([id, { username }]) => ({ id, username }));

                    ws.send(JSON.stringify({ type: 'peers', peers: list }));
                }
                break;

            case 'ice':
                {
                    const { uqid, ice } = body;
                    // console.log(peers);
                    // console.log("[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[");
                    // console.log(uqid);

                    const roomId = peers.get(uqid).roomId;
                    const room = rooms.get(roomId);

                    const user = room.peers.get(uqid);
                    if (user.peer) {
                        user.peer.addIceCandidate(new webrtc.RTCIceCandidate(ice)).catch(console.error);
                    }
                }
                break;

            case 'consume':
                {
                    const { producerId, sdp, consumerId } = body;

                    console.log("id");
                    console.log(producerId);
                    console.log("consumerId ");
                    console.log(consumerId);


                    const roomId = peers.get(producerId).roomId;
                    const room = rooms.get(roomId);

                    const remoteUser = room.peers.get(producerId);
                    const newPeer = createPeer();
                    consumers.set(consumerId, newPeer);

                    const _desc = new webrtc.RTCSessionDescription(sdp);
                    await newPeer.setRemoteDescription(_desc);

                    remoteUser.stream.getTracks().forEach(track => {
                        newPeer.addTrack(track, remoteUser.stream);
                    });

                    const _answer = await newPeer.createAnswer();
                    await newPeer.setLocalDescription(_answer);

                    ws.send(JSON.stringify({
                        type: 'consumeAnswer',
                        sdp: _answer, // newPeer.localDescription,
                        username: remoteUser.username,
                        producerId,
                        consumerId
                    }));
                }
                break;

            case 'consumer_ice':
                {
                    const { consumerId, ice } = body;
                    if (consumers.has(consumerId)) {
                        consumers.get(consumerId).addIceCandidate(new webrtc.RTCIceCandidate(ice)).catch(console.error);
                    }
                }
                break;

            default:
                console.log('Unknown message type:', body.type);
        }
    });

    ws.on('error', console.error);
});

function broadcastToRoom(roomId, data) {
    if (rooms.has(roomId)) {
        rooms.get(roomId).peers.forEach(({ socket }) => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(data);
            }
        });
    }
}

console.log('Server running.');