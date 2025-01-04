interface IDataSource {
    getRoomUsers(roomId: string): Promise<RoomUser[]>;

    getRoomPublishers(roomId: string, userId: string): Promise<RoomUser[]>;

    // getOtherRoomPublishers(roomId: string, userId: string): Promise<Map<string, RoomUser>>;

    getOtherRoomUsers(roomId: string, userId: string): Promise<RoomUser[]>;

    addUser(userId: string, roomId: string, user: RoomUser): Promise<any>;

    getUser(userId: string, roomId): Promise<RoomUser>;

    removeUser(userId: string, roomId: string): Promise<RoomUser>;

    setRole(userId: string, roomId: string, role: string): Promise<any>;
}

class InMemoryDatasource implements IDataSource {
    static rooms: Map<string, Room> = new Map(); // roomId -> { users: Map, subscribers: Map, publishers: Set }

    async getRoomUsers(roomId: string): Promise<RoomUser[]> {
        return [...(InMemoryDatasource.rooms.get(roomId)?.users?.values() || [])];
    }

    async getRoomPublishers(roomId: string, userId: string): Promise<RoomUser[]> {
        const room = InMemoryDatasource.rooms.get(roomId);
        if (room === null) return;

        const pubs: RoomUser[] = [];
        room.users.forEach((user, _) => {
            if (user.role === Roles.SPEAKER && user.id !== userId) pubs.push(user);
        })

        return pubs;
    }

    async getOtherRoomUsers(roomId: string, userId: string): Promise<RoomUser[]> {
        let users = await this.getRoomUsers(roomId);
        return users.filter((user) => user.id !== userId);
    }

    async addUser(userId: string, roomId: string, user: RoomUser) : Promise<any> {
        user.id = userId;
        let room = InMemoryDatasource.rooms.get(roomId);
        if (!room) {
            room = new Room();
            InMemoryDatasource.rooms.set(roomId, room);
        }
        room.users.set(userId, user);
    }

    async getUser(userId: string, roomId): Promise<RoomUser> {
        return InMemoryDatasource.rooms.get(roomId)?.users?.get(userId);
    }

    async removeUser(userId: string, roomId: string): Promise<RoomUser> {
        const room = InMemoryDatasource.rooms.get(roomId);
        const user = room.users.get(userId);
        if (!user) return;
        room.users.delete(userId);

        room.subscribers.forEach((subscriber, subscribingId) => {
            if (subscriber.subscriberId === userId || subscriber.publisherId === userId)
                room.subscribers.delete(subscribingId);
        });
        return user;
    }

    async setRole(userId: string, roomId: string, role: string): Promise<any> {
        const room = InMemoryDatasource.rooms.get(roomId);
        const user = room.users.get(userId);
        if (!user || user.role === role) return;
        user.role = role;
        if (role === Roles.LISTENER) {
            room.subscribers.forEach((subscriber, subscribingId) => {
                if (subscriber.publisherId === userId) room.subscribers.delete(subscribingId);
            });
        }
    }
}
