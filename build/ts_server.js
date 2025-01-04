var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// @ts-ignore
// import * as webrtc from "wrtc";
// import { v4 as uuidv4 } from "uuid";
// // @ts-ignore
// import * as fs from "fs";
// // @ts-ignore
// import * as http from "http";
// // @ts-ignore
// import * as https from "https";
// // @ts-ignore
// import WebSocket, { Server as WebSocketServer } from "ws";
// @ts-ignore
// import express from "express";


const webrtc = require("wrtc");
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const express = require('express');
// const app = express();



const app = express();
app.use(express.static("public"));
const serverOptions = {
    listenPort: 5000,
    useHttps: false,
    httpsCertFile: "/path/to/cert/",
    httpsKeyFile: "/path/to/key/",
};
let sslOptions = {};
if (serverOptions.useHttps) {
    sslOptions.key = fs.readFileSync(serverOptions.httpsKeyFile, "utf-8");
    sslOptions.cert = fs.readFileSync(serverOptions.httpsCertFile, "utf-8");
}
const webServer = serverOptions.useHttps
    ? https.createServer(sslOptions, app).listen(serverOptions.listenPort)
    : http.createServer(app).listen(serverOptions.listenPort);
const publishers = new Map();
const consumers = new Map();
function handleTrackEvent(event, uuid, roomId) {
    const user = publishers.get(uuid);
    if (!user || !event.streams || !event.streams[0])
        return;
    user.stream = event.streams[0];
    const payloadString = JSON.stringify({
        type: "newPublisher",
        id: uuid,
        username: user.username,
    });
    publishers.forEach((val, key) => {
        if (val.roomId === roomId && key !== uuid) {
            val.socket.send(payloadString);
        }
    });
}
function createPeer() {
    const configuration = {
        iceServers: [
            { urls: "stun:stun.relay.metered.ca:80" },
            {
                urls: "turn:global.relay.metered.ca:80",
                username: "941563fc8b5b8e8c1a5424cb",
                credential: "spoMfi7SzsfGP9bk",
            },
            {
                urls: "turn:global.relay.metered.ca:80?transport=tcp",
                username: "941563fc8b5b8e8c1a5424cb",
                credential: "spoMfi7SzsfGP9bk",
            },
            {
                urls: "turn:global.relay.metered.ca:443",
                username: "941563fc8b5b8e8c1a5424cb",
                credential: "spoMfi7SzsfGP9bk",
            },
            {
                urls: "turns:global.relay.metered.ca:443?transport=tcp",
                username: "941563fc8b5b8e8c1a5424cb",
                credential: "spoMfi7SzsfGP9bk",
            },
        ],
    };
    return new webrtc.RTCPeerConnection(configuration);
}
function produceStream(user, uuid, roomId, sdp) {
    return __awaiter(this, void 0, void 0, function* () {
        const peer = createPeer();
        user.peer = peer;
        user.role = "speaker";
        peer.ontrack = (event) => handleTrackEvent(event, uuid, roomId);
        const desc = new webrtc.RTCSessionDescription(sdp);
        yield peer.setRemoteDescription(desc);
        const answer = yield peer.createAnswer();
        yield peer.setLocalDescription(answer);
        const payload = {
            type: "answer",
            sdp: peer.localDescription,
        };
        user.socket.send(JSON.stringify(payload));
    });
}
function changePublisherToListener(peerId) {
    const user = publishers.get(peerId);
    if (!user)
        return;
    user.role = "listener";
    wss.broadcast(JSON.stringify({
        type: "publisherLeft",
        id: peerId,
    }));
    Array.from(consumers.entries()).forEach(([consumerId, peer]) => {
        if (peer.publisherId === peerId) {
            consumers.delete(consumerId);
        }
    });
}
const wss = new WebSocketServer({ server: webServer });
wss.on("connection", (ws) => {
    const peerId = uuidv4();
    ws.send(JSON.stringify({ type: "welcome", id: peerId }));
    ws.on("close", () => {
        const user = publishers.get(peerId);
        if (!user)
            return;
        publishers.delete(peerId);
        consumers.delete(peerId);
        if (user.role === "speaker") {
            wss.broadcast(JSON.stringify({
                type: "publisherLeft",
                id: peerId,
            }));
        }
    });
    ws.on("message", (message) => __awaiter(void 0, void 0, void 0, function* () {
        const body = JSON.parse(message.toString());
        switch (body.type) {
            case "connect":
                const user = {
                    socket: ws,
                    username: body.username,
                    roomId: body.roomId,
                    role: body.role,
                };
                publishers.set(peerId, user);
                if (user.role === "listener")
                    return;
                yield produceStream(user, peerId, user.roomId, body.sdp);
                break;
            case "setRole":
                const role = body.role;
                const currentUser = publishers.get(peerId);
                if (!currentUser || currentUser.role === role)
                    return;
                if (role === "listener") {
                    changePublisherToListener(peerId);
                    return;
                }
                yield produceStream(currentUser, peerId, currentUser.roomId, body.sdp);
                break;
            case "getPublishers":
                const list = Array.from(publishers.values())
                    .filter((peer) => {
                    var _a;
                    return peer.roomId === ((_a = publishers.get(peerId)) === null || _a === void 0 ? void 0 : _a.roomId) &&
                        peer.role === "speaker" &&
                        peer.socket !== ws;
                })
                    .map((peer) => ({
                    id: peer.socket.id,
                    username: peer.username,
                }));
                ws.send(JSON.stringify({
                    type: "publishers",
                    publishers: list,
                }));
                break;
            case "ice":
                const iceUser = publishers.get(body.uuid);
                if (iceUser === null || iceUser === void 0 ? void 0 : iceUser.peer) {
                    yield iceUser.peer.addIceCandidate(new webrtc.RTCIceCandidate(body.ice));
                }
                break;
            case "subscribe":
                try {
                    const { id, sdp, consumerId } = body;
                    const remoteUser = publishers.get(id);
                    if (!(remoteUser === null || remoteUser === void 0 ? void 0 : remoteUser.stream))
                        return;
                    const newPeer = createPeer();
                    consumers.set(consumerId, newPeer);
                    yield newPeer.setRemoteDescription(new webrtc.RTCSessionDescription(sdp));
                    remoteUser.stream.getTracks().forEach((track) => {
                        newPeer.addTrack(track, remoteUser.stream);
                    });
                    const answer = yield newPeer.createAnswer();
                    yield newPeer.setLocalDescription(answer);
                    ws.send(JSON.stringify({
                        type: "subscriptionAnswer",
                        sdp: answer,
                        username: remoteUser.username,
                        id,
                        consumerId,
                    }));
                }
                catch (error) {
                    console.error(error);
                }
                break;
            case "consumerIce":
                const consumerPeer = consumers.get(body.consumerId);
                if (consumerPeer) {
                    yield consumerPeer.addIceCandidate(new webrtc.RTCIceCandidate(body.ice));
                }
                break;
            default:
                wss.broadcast(message.toString());
                break;
        }
    }));
    ws.on("error", (error) => console.error(error));
});
wss.broadcast = function (data) {
    publishers.forEach((peer) => {
        if (peer.socket.readyState === WebSocket.OPEN) {
            peer.socket.send(data);
        }
    });
};
console.log("Server running...");
