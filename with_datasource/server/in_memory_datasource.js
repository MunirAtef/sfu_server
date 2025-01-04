const {roles} = require("./constants");

class Subscriber {
  subId;
  pubId;
  peer;

  constructor(subId, pubId, peer) {
    this.subId = subId;
    this.pubId = pubId;
    this.peer = peer;
  }
}

class Room {
  users = new Map(); // : Map<string, RoomUser>
  subscribers = new Map();  // : Map<string, Subscriber>
}

// class RoomUser {
//   id;
//   socket;
//   stream;
//   peer;
//   username;
//   role;
// }


class InMemoryDatasource {
  static rooms = new Map(); // roomId -> { users: Map, subscribers: Map, publishers: Set }

  getRoomUsers(roomId) {
    return [...(InMemoryDatasource.rooms.get(roomId)?.users?.values() || [])];
  }

  getRoomPublishers(roomId, userId) {
    const room = InMemoryDatasource.rooms.get(roomId);
    if (!room) return;

    const pubs = [];
    room.users.forEach((user) => {
      if (user.role === roles.speaker && user.id !== userId) pubs.push(user);
    });

    return pubs;
  }

  getOtherRoomUsers(roomId, userId) {
    const users = this.getRoomUsers(roomId);
    return users.filter((user) => user.id !== userId);
  }

  addUser(userId, roomId, user) {
    user.id = userId;
    let room = InMemoryDatasource.rooms.get(roomId);
    if (!room) {
      room = new Room();
      InMemoryDatasource.rooms.set(roomId, room);
    }
    room.users.set(userId, user);
  }

  getUser(userId, roomId) {
    return InMemoryDatasource.rooms.get(roomId)?.users?.get(userId);
  }

  removeUser(userId, roomId) {
    const room = InMemoryDatasource.rooms.get(roomId);
    if (!room) return;

    const user = room.users.get(userId);
    if (!user) return;

    room.users.delete(userId);

    room.subscribers.forEach((subscriber, subscribingId) => {
      if (subscriber.subscriberId === userId || subscriber.publisherId === userId) {
        room.subscribers.delete(subscribingId);
      }
    });

    return user;
  }

  setRole(userId, roomId, role) {
    const room = InMemoryDatasource.rooms.get(roomId);
    if (!room) return;

    const user = room.users.get(userId);
    if (!user || user.role === role) return;

    user.role = role;
    if (role === roles.listener) {
      room.subscribers.forEach((subscriber, subscribingId) => {
        if (subscriber.publisherId === userId) {
          room.subscribers.delete(subscribingId);
        }
      });
    }
  }

  addSubscriber(roomId, subId, pubId, peer) {
    const id = `${subId}:${pubId}`;
    InMemoryDatasource.rooms.get(roomId)?.subscribers.set(id, new Subscriber(subId, pubId, peer));
  }

  getSubscriberPeer(roomId, subId, pubId) {
    const id = `${subId}:${pubId}`;
    return InMemoryDatasource.rooms.get(roomId)?.subscribers?.get(id)?.peer;
  }
}

// const inMemoryDatastore = new InMemoryDatasource();
module.exports = new InMemoryDatasource();