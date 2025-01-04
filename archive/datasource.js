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
            if (user.role === Roles.SPEAKER && user.id !== userId) pubs.push(user);
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
        if (role === Roles.LISTENER) {
            room.subscribers.forEach((subscriber, subscribingId) => {
                if (subscriber.publisherId === userId) {
                    room.subscribers.delete(subscribingId);
                }
            });
        }
    }
}
