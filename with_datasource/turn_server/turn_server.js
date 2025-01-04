const Turn = require("node-turn");

const server = new Turn({
  authMech: 'long-term',
  listenPort: 3000,
  credentials: {
    username: 'munir123456'
  }
});

server.addUser("munir_m_atef", "munir123456");
server.start();
