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

// const connections = io.of("/mediasoup");

// connections.on("connection", (socket) => {
//   console.log("zzz");
// });
const peers = io.of("/mediasoup");

/**
 * Worker
 * |-> Router(s)
 *     |-> Producer Transport(s)
 *         |-> Producer
 *     |-> Consumer Transport(s)
 *         |-> Consumer
 **/
let worker;
let router;
let producerTransport;
let consumerTransport;
let producer;
let consumer;

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });
  console.log(`worker pid ${worker.pid}`);

  worker.on("died", (error) => {
    // This implies something serious happened, so kill the application
    console.error("mediasoup worker has died");
    setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
  });

  return worker;
};

// We create a Worker as soon as our application starts
worker = createWorker();

// This is an Array of RtpCapabilities
// https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/#RtpCodecCapability
// list of media codecs supported by mediasoup ...
// https://github.com/versatica/mediasoup/blob/v3/src/supportedRtpCapabilities.ts
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

peers.on("connection", async (socket) => {
  console.log(socket.id);
  socket.emit("connection-success", {
    socketId: socket.id,
    existsProducer: producer ? true : false,
  });

  socket.on("disconnect", () => {
    // do some cleanup
    console.log("peer disconnected");
  });

  socket.on("createRoom", async (callback) => {
    if (router === undefined) {
      // worker.createRouter(options)
      // options = { mediaCodecs, appData }
      // mediaCodecs -> defined above
      // appData -> custom application data - we are not supplying any
      // none of the two are required
      router = await worker.createRouter({ mediaCodecs });
    }

    getRtpCapabilities(callback);
  });

  const getRtpCapabilities = (callback) => {
    const rtpCapabilities = router.rtpCapabilities;
    callback({ rtpCapabilities });
  };
  // router = await worker.createRouter({ mediaCodecs });
  // Client emits a request for RTP Capabilities
  // This event responds to the request
  socket.on("getRtpCapabilities", (callback) => {
    const rtpCapabilities = router.rtpCapabilities;

    // console.log("rtp Capabilities", rtpCapabilities);

    callback({ rtpCapabilities });
  });

  // Client emits a request to create server side Transport
  // We need to differentiate between the producer and consumer transports
  socket.on("createWebRtcTransport", async ({ sender }, callback) => {
    // console.log(`Is this a sender request? ${sender}`);
    // The client indicates if it is a producer or a consumer
    // if sender is true, indicates a producer else a consumer
    if (sender) producerTransport = await createWebRtcTransport(callback);
    else consumerTransport = await createWebRtcTransport(callback);
  });

  // see client's socket.emit('transport-connect', ...)
  socket.on("transport-connect", async ({ dtlsParameters }) => {
    // console.log("DTLS PARAMS... ", { dtlsParameters });
    await producerTransport.connect({ dtlsParameters });
  });

  // see client's socket.emit('transport-produce', ...)
  socket.on(
    "transport-produce",
    async ({ kind, rtpParameters, appData }, callback) => {
      // call produce based on the prameters from the client
      producer = await producerTransport.produce({
        kind,
        rtpParameters,
      });
      console.log("producer after await", producer);

      console.log("Producer ID: ", producer.id, producer.kind);

      producer.on("transportclose", () => {
        console.log("transport for this producer closed ");
        producer.close();
      });

      // Send back to the client the Producer's id
      callback({
        id: producer.id,
      });
    }
  );

  // see client's socket.emit('transport-recv-connect', ...)
  socket.on("transport-recv-connect", async ({ dtlsParameters }) => {
    // console.log(`DTLS PARAMS: ${dtlsParameters}`);
    console.log("transport-recv-connect producer = ", producer);
    await consumerTransport.connect({ dtlsParameters });
  });

  socket.on("consume", async ({ rtpCapabilities }, callback) => {
    console.log("consume producer = ", producer);
    try {
      // check if the router can consume the specified producer
      if (
        router.canConsume({
          producerId: producer.id,
          rtpCapabilities,
        })
      ) {
        // transport can now consume and return a consumer
        consumer = await consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: true,
        });

        consumer.on("transportclose", () => {
          console.log("transport close from consumer");
        });

        consumer.on("producerclose", () => {
          console.log("producer of consumer closed");
        });

        // from the consumer extract the following params
        // to send back to the Client
        const params = {
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        };

        // send the parameters to the client
        callback({ params });
      }
    } catch (error) {
      console.log("err!", error.message);
      callback({
        params: {
          error: error,
        },
      });
    }
  });

  socket.on("consumer-resume", async () => {
    console.log("producer = ", producer);
    console.log("consumer resume");
    await consumer.resume();
  });
});

const createWebRtcTransport = async (callback) => {
  try {
    // https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
    const webRtcTransport_options = {
      listenIps: [
        {
          ip: "127.0.0.1", // replace with relevant IP address
          // announcedIp: "127.0.0.1",
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    };

    // https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport
    let transport = await router.createWebRtcTransport(webRtcTransport_options);
    console.log(`transport id: ${transport.id}`);

    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") {
        transport.close();
      }
    });

    transport.on("close", () => {
      console.log("transport closed");
    });

    // send back to the client the following prameters
    callback({
      // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    });

    return transport;
  } catch (error) {
    console.log(error);
    callback({
      params: {
        error: error,
      },
    });
  }
};

server.listen(PORT, () => {
  console.log("server is running on", PORT);
});
