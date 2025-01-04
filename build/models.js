class Roles {
}
Roles.SPEAKER = "speaker";
Roles.LISTENER = "listener";
// function uniqueId(len: number = 32): string {
//     const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
//     let uniqueId = "";
//     for (let i = 0; i < len; i++) {
//         uniqueId += chars.charAt(Math.floor(Math.random() * chars.length));
//     }
//     return uniqueId;
// }
class Subscriber {
}
class Room {
    constructor() {
        this.users = new Map();
        this.subscribers = new Map();
    }
}
class RoomUser {
}
