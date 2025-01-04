
const roles = {
  speaker: 'speaker',
  listener: 'listener'
}

const clientMethods = {
  welcome: 'welcome',
  newPublisher: 'newPublisher',
  publisherLeft: 'publisherLeft',
  publishers: 'publishers',
  subscriptionAnswer: 'subscriptionAnswer',
  answer: 'answer'
};


const serverMethods = {
  connect: 'connect',
  setRole: 'setRole',
  getPublishers: 'getPublishers',
  ice: 'ice',
  subscribe: 'subscribe',
  consumerIce: 'consumerIce'
};

// const configuration = {
//   iceServers: [
//     {urls: "stun:stun.relay.metered.ca:80"},
//     {
//       urls: "turn:global.relay.metered.ca:80",
//       username: "941563fc8b5b8e8c1a5424cb",
//       credential: "spoMfi7SzsfGP9bk"
//     },
//     {
//       urls: "turn:global.relay.metered.ca:80?transport=tcp",
//       username:"941563fc8b5b8e8c1a5424cb",
//       credential:"spoMfi7SzsfGP9bk"
//     },
//     {
//       urls: "turn:global.relay.metered.ca:443",
//       username:"941563fc8b5b8e8c1a5424cb",
//       credential:"spoMfi7SzsfGP9bk"
//     },
//     {
//       urls: "turns:global.relay.metered.ca:443?transport=tcp",
//       username:"941563fc8b5b8e8c1a5424cb",
//       credential:"spoMfi7SzsfGP9bk"
//     }
//   ]
// }

const configuration = {
  iceServers: [
    // {urls: "stun:stun.relay.metered.ca:80"},
    {
      urls: "turn:relay1.expressturn.com:3478",
      username: "941563fc8b5b8e8c1a5424cb",
      credential: "spoMfi7SzsfGP9bk"
    }
  ]
}

// const configuration = {
//   iceServers: [
//     // {urls: "turn:localhost:3000"},
//     {
//       urls: "turn:188.245.96.46:3000",
//       username: "munir_m_atef0",
//       credential: "munir1234560"
//     }
//   ]
// }




module.exports = {
  clientMethods,
  serverMethods,
  roles,
  configuration
}