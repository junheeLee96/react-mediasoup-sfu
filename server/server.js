const express = require("express");
const app = express();
const cors = require("cors");
const mediasoup = require("mediasoup");
const fs = require("fs");

const PORT = 8000;
const option = {
  key: fs.readFileSync("./key.pem", "utf-8"),
  cert: fs.readFileSync("./crt.pem", "utf-8"),
};
const server = require("https").createServer(option, app);
const io = require("socket.io")(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});
const corsOptions = {
  origin: "http://localhost:3000",
  credentials: true,
};

app.use(cors(corsOptions));

app.get("/", (req, res) => {
  res.send("hi");
});

const connections = io.of("/mediasoup");
let worker;
let rooms = {}; // { roomName1: { Router, rooms: [ sicketId1, ... ] }, ...}
let peers = {}; // { socketId1: { roomName1, socket, transports = [id1, id2,] }, producers = [id1, id2,] }, consumers = [id1, id2,], peerDetails }, ...}
let transports = []; // [ { socketId1, roomName1, transport, consumer }, ... ]
let producers = []; // [ { socketId1, roomName1, producer, }, ... ]
let consumers = []; // [ { socketId1, roomName1, consumer, }, ... ]
let users = {}; //

const createWorker = async () => {
  // 우커 생성, 최소/최대 포트 지정
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });
  console.log(`worker pid ${worker.pid}`);

  worker.on("died", (error) => {
    // mediasoup worker가 종료되면 애플리케이션 종료
    console.error("mediasoup worker has died");
    setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
  });

  return worker;
};

worker = createWorker();

// 미디어 코덱 리스트, 지원 코덱 목록
const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

connections.on("connection", async (socket) => {
  users[socket.id] = {};
  const removeItems = (items, socketId, type) => {
    items.forEach((item) => {
      if (item.socketId === socket.id) {
        item[type].close();
      }
    });
    items = items.filter((item) => item.socketId !== socket.id);

    return items;
  };

  socket.on("disconnect", () => {
    // 유저 나감
    delete users[socket.id];
    consumers = removeItems(consumers, socket.id, "consumer");
    producers = removeItems(producers, socket.id, "producer");
    transports = removeItems(transports, socket.id, "transport");
    console.log(peers);
    if (!peers[socket.id] || !peers[socket.id].roomName) {
      return;
    }
    const { roomName } = peers[socket.id];
    delete peers[socket.id];

    // 방에서 소켓 제거
    rooms[roomName] = {
      router: rooms[roomName].router,
      peers: rooms[roomName].peers.filter((socketId) => socketId !== socket.id),
    };
  });

  socket.on("joinRoom", async ({ roomName }, callback) => {
    // 라우터가 존재하는지 확인
    const router1 = await createRoom(roomName, socket.id);

    peers[socket.id] = {
      socket,
      roomName, //피어가 합류한 라우터 이름
      transports: [],
      producers: [],
      consumers: [],
      peerDetails: {
        name: "",
        isAdmin: false, //피어 관리자 여부
      },
    };

    // Router RTP Capabilities 가져오기
    const rtpCapabilities = router1.rtpCapabilities;

    // 클라이언트의 콜백 호출 및 rtpCapabilities 반환
    callback({ rtpCapabilities });
  });

  const createRoom = async (roomName, socketId) => {
    let router1;
    let peers = [];
    if (rooms[roomName]) {
      router1 = rooms[roomName].router;
      peers = rooms[roomName].peers || [];
    } else {
      router1 = await worker.createRouter({ mediaCodecs });
    }

    console.log(`Router ID: ${router1.id}`, peers.length);

    rooms[roomName] = {
      router: router1,
      peers: [...peers, socketId],
    };

    return router1;
  };

  // 클라이언트가 서버 측 Transport 생성을 요청 // 프로듀서와 컨슈머 트랜스포트 구분 필요
  socket.on("createWebRtcTransport", async ({ consumer }, callback) => {
    // 피어에서 방 이름 가져오기
    if (!peers[socket.id] || !peers[socket.id].roomName) {
      return;
    }
    const roomName = peers[socket.id].roomName;

    // RoomName을 기반으로 피어가 잇는 라우터 가져오기
    const router = rooms[roomName].router;

    createWebRtcTransport(router).then(
      (transport) => {
        callback({
          params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          },
        });

        //피어 속성에 transport추가
        addTransport(transport, roomName, consumer);
      },
      (error) => {
        console.log(error);
      }
    );
  });

  const addTransport = (transport, roomName, consumer) => {
    transports = [
      ...transports,
      { socketId: socket.id, transport, roomName, consumer },
    ];

    peers[socket.id] = {
      ...peers[socket.id],
      transports: [...peers[socket.id].transports, transport.id],
    };
  };

  const addProducer = (producer, roomName) => {
    producers = [...producers, { socketId: socket.id, producer, roomName }];

    peers[socket.id] = {
      ...peers[socket.id],
      producers: [...peers[socket.id].producers, producer.id],
    };
  };

  const addConsumer = (consumer, roomName) => {
    // consumer 리스트에 추가
    consumers = [...consumers, { socketId: socket.id, consumer, roomName }];

    // 피어 리스트에 소비자 id 추가
    peers[socket.id] = {
      ...peers[socket.id],
      consumers: [...peers[socket.id].consumers, consumer.id],
    };
  };

  socket.on("getProducers", (callback) => {
    // 모든 프로듀서 트랜스포트 리턴
    const { roomName } = peers[socket.id];

    let producerList = [];
    producers.forEach((producerData) => {
      if (
        producerData.socketId !== socket.id &&
        producerData.roomName === roomName
      ) {
        producerList = [...producerList, producerData.producer.id];
      }
    });

    // 클라이언트에게 프로듀서 리스트 리턴
    callback(producerList);
  });

  const informConsumers = (roomName, socketId, id) => {
    console.log(`just joined, id ${id} ${roomName}, ${socketId}`);
    // 새 유저 참여
    // 모든 참여자에게 프로듀서를 소비(?)하도록 알림
    producers.forEach((producerData) => {
      if (
        producerData.socketId !== socketId &&
        producerData.roomName === roomName
      ) {
        const producerSocket = peers[producerData.socketId].socket;
        //  프로듀서 id를 프로듀서에게 전송
        producerSocket.emit("new-producer", { producerId: id });
      }
    });
  };

  const getTransport = (socketId) => {
    const [producerTransport] = transports.filter(
      (transport) => transport.socketId === socketId && !transport.consumer
    );
    return producerTransport.transport;
  };

  // 클라이언트의 socket.emit('transport-connect', ...) 확인하셈
  socket.on("transport-connect", ({ dtlsParameters }) => {
    console.log("DTLS PARAMS... ", { dtlsParameters });

    getTransport(socket.id).connect({ dtlsParameters });
  });

  // 클라이언트의 socket.emit('transport-produce', ...) 확인하셈
  socket.on(
    "transport-produce",
    async ({ kind, rtpParameters, appData }, callback) => {
      // 클라이언트의 매게변수를 기반으로 produce호출
      const producer = await getTransport(socket.id).produce({
        kind,
        rtpParameters,
      });

      const { roomName } = peers[socket.id];

      addProducer(producer, roomName);

      informConsumers(roomName, socket.id, producer.id);

      console.log("Producer ID: ", producer.id, producer.kind);

      producer.on("transportclose", () => {
        console.log("transport for this producer closed ");
        producer.close();
      });

      // Send back to the client the Producer's id
      callback({
        id: producer.id,
        producersExist: producers.length > 1 ? true : false,
      });
    }
  );

  // 클라이언트의 socket.emit('transport-recv-connect', ...)확인
  socket.on(
    "transport-recv-connect",
    async ({ dtlsParameters, serverConsumerTransportId }) => {
      console.log(`DTLS PARAMS: ${dtlsParameters}`);
      const consumerTransport = transports.find(
        (transportData) =>
          transportData.consumer &&
          transportData.transport.id == serverConsumerTransportId
      ).transport;
      await consumerTransport.connect({ dtlsParameters });
    }
  );

  socket.on(
    "consume",
    async (
      { rtpCapabilities, remoteProducerId, serverConsumerTransportId },
      callback
    ) => {
      try {
        const { roomName } = peers[socket.id];
        const router = rooms[roomName].router;
        let consumerTransport = transports.find(
          (transportData) =>
            transportData.consumer &&
            transportData.transport.id == serverConsumerTransportId
        ).transport;

        // 지정된 프로듀서를 소비할수잇는지 라우터 확인
        if (
          router.canConsume({
            producerId: remoteProducerId,
            rtpCapabilities,
          })
        ) {
          // transport 사용할 수 잇으므로 consumer리턴
          const consumer = await consumerTransport.consume({
            producerId: remoteProducerId,
            rtpCapabilities,
            paused: true,
          });

          consumer.on("transportclose", () => {
            console.log("transport close from consumer");
          });

          consumer.on("producerclose", () => {
            console.log("producer of consumer closed");
            socket.emit("producer-closed", { remoteProducerId });

            consumerTransport.close([]);
            transports = transports.filter(
              (transportData) =>
                transportData.transport.id !== consumerTransport.id
            );
            consumer.close();
            consumers = consumers.filter(
              (consumerData) => consumerData.consumer.id !== consumer.id
            );
          });

          addConsumer(consumer, roomName);

          // consumer에서 다음 매개변수를 사용
          //클라이언트에게 리턴
          const params = {
            id: consumer.id,
            producerId: remoteProducerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            serverConsumerId: consumer.id,
          };

          callback({ params });
        }
      } catch (error) {
        console.log(error.message);
        callback({
          params: {
            error: error,
          },
        });
      }
    }
  );

  socket.on("consumer-resume", async ({ serverConsumerId }) => {
    console.log("consumer resume");
    const { consumer } = consumers.find(
      (consumerData) => consumerData.consumer.id === serverConsumerId
    );
    await consumer.resume();
  });

  socket.on("sounds", (event) => {
    const date = new Date();
    const mit = date.getMinutes();
    const sec = date.getSeconds();
    const millSec = date.getMilliseconds();
    users[socket.id] = {
      ...users[socket.id],
      [event]: `${mit}분 ${sec}초 ${millSec}`,
    };
    console.log(users);
  });
});

const createWebRtcTransport = async (router) => {
  return new Promise(async (resolve, reject) => {
    try {
      // https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
      const webRtcTransport_options = {
        listenIps: [
          {
            ip: "127.0.0.1", // replace with relevant IP address
            // announcedIp: "10.0.0.115",
          },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      };

      // https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport
      let transport = await router.createWebRtcTransport(
        webRtcTransport_options
      );
      console.log(`transport id: ${transport.id}`);

      transport.on("dtlsstatechange", (dtlsState) => {
        if (dtlsState === "closed") {
          transport.close();
        }
      });

      transport.on("close", () => {
        console.log("transport closed");
      });

      resolve(transport);
    } catch (error) {
      reject(error);
    }
  });
};
server.listen(PORT, () => {
  console.log("server is running on", PORT);
});
