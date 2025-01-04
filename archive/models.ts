class Roles {
    static SPEAKER: string = "speaker";
    static LISTENER: string = "listener";
}

// function uniqueId(len: number = 32): string {
//     const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
//     let uniqueId = "";
//     for (let i = 0; i < len; i++) {
//         uniqueId += chars.charAt(Math.floor(Math.random() * chars.length));
//     }
//     return uniqueId;
// }

class Subscriber {
    subscriberId: string;
    publisherId: string;
    peer: any;
}

class Room {
    users: Map<string, RoomUser> = new Map();
    subscribers: Map<string, Subscriber> = new Map();
}

class RoomUser {
    id: string;
    socket: WebSocket;
    stream: any;
    peer: any;
    username: String;
    role: String;
}