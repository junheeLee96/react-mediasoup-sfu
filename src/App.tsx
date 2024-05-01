import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { Device } from "mediasoup-client";
import { RtpCapabilities } from "mediasoup-client/lib/RtpParameters";
import MeetRoom from "./MeetRoom";
let params = {
  // mediasoup params
  encodings: [
    {
      rid: "r0",
      maxBitrate: 100000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r1",
      maxBitrate: 300000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r2",
      maxBitrate: 900000,
      scalabilityMode: "S1T3",
    },
  ],
  // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
  codecOptions: {
    videoGoogleStartBitrate: 1000,
  },
};
const ROOM = 123;
const USERID = new Date().getTime();
const App = () => {
  const videoRef = useRef<any>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const rtpCapabilities = useRef<any>();
  const socketRef = useRef<any>(null);
  const device = useRef<any>();
  const producerTransport = useRef<any>(null);
  const producer = useRef<any>();
  const consumingTransports = useRef<any>([]);
  const consumerTransports = useRef<any>([]);
  const [users, setUsers] = useState<any>([]);
  const streamRef = useRef<any>(null);

  async function connectRecvTransport(
    consumerTransport: any,
    remoteProducerId: any,
    serverConsumerTransportId: any
  ) {
    if (!socketRef.current) return;
    const socket = socketRef.current;

    await socket.emit(
      "consume",
      {
        rtpCapabilities: device.current.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      },
      async ({ params }: any) => {
        if (params.error) {
          console.log("CANNOT CONSUME");
          return;
        }
        console.log("Consumer Params", params);

        const consumer = await consumerTransport.consume({
          id: params.id,
          producerId: params.producerId,
          kind: params.kind,
          rtpParameters: params.rtpParameters,
        });
        consumerTransports.current = [
          ...consumerTransports.current,
          {
            consumerTransport,
            serverConsumerTransportId: params.id,
            producerId: remoteProducerId,
            consumer,
          },
        ];

        const newElem = document.createElement("div");
        newElem.setAttribute("id", `td-${remoteProducerId}`);
        if (params.kind === "audio") {
          newElem.innerHTML =
            '<audio id="' + remoteProducerId + '"autoplay></audio>';
        } else {
          newElem.setAttribute("class", "remoteVideo");
          newElem.innerHTML =
            '<video id="' +
            remoteProducerId +
            'autoplay class="video"></video>';
        }
        const root = document.getElementById("root");
        setUsers((p: any) => [...p, { ...newElem, track: consumer.track }]);
        root?.appendChild(newElem);

        // const { track } = consumer;
        // document.getElementById('')

        socket.emit("consumer-resume", {
          serverConsumerId: params.serverConsumerId,
        });
      }
    );
  }

  async function signalNewConsumerTransport(remoteProducerId: any) {
    if (consumingTransports.current.includes(remoteProducerId)) return;
    const socket = socketRef.current;
    await socket.emit(
      "createWebRtcTransport",
      { consumer: true },
      ({ params }: any) => {
        if (params.error) {
          console.error(params.error);
          return;
        }

        console.log("PARAMS...", params);

        let consumerTransport;
        try {
          consumerTransport = device.current.createRecvTransport(params);
        } catch (e) {
          console.error(e);
          return;
        }

        consumerTransport.on(
          "connect",
          async ({ dtlsParameters }: any, callback: any, errback: any) => {
            try {
              await socket.emit("transport-recv-connect", {
                dtlsParameters,
                serverConsumerTransportId: params.id,
              });

              callback();
            } catch (e) {
              errback(e);
            }
          }
        );
        connectRecvTransport(consumerTransport, remoteProducerId, params.id);
      }
    );
  }

  function getProducers() {
    if (!socketRef.current) return;
    const socket = socketRef.current;

    socket.emit("getProducers", (producerIds: any) => {
      console.log(producerIds);
      producerIds.forEach(signalNewConsumerTransport);
    });
  }

  function createSendTransport() {
    if (!socketRef.current) return;
    const socket = socketRef.current;
    socket.emit(
      "createWebRtcTransport",
      { consumer: false },
      ({ params }: { params: any }) => {
        if (params.error) {
          console.error(params.error);
          return;
        }
        producerTransport.current = device.current.createSendTransport(params);
        producerTransport.current.on(
          "connect",
          async ({ dtlsParameters }: any, callback: any, errback: any) => {
            try {
              await socket.emit("transport-connect", {
                dtlsParameters,
              });
              callback();
            } catch (err) {
              errback(err);
            }
          }
        );
        producerTransport.current.on(
          "produce",
          async (parameters: any, callback: any, errback: any) => {
            console.log(parameters);

            try {
              await socket.emit(
                "transport-produce",
                {
                  kind: parameters.id,
                  rtpParameters: parameters.rtpParameters,
                  appData: parameters.appData,
                },
                ({ id, producersExist }: any) => {
                  callback({ id });

                  if (producersExist) getProducers();
                }
              );
            } catch (err) {
              errback(err);
            }
          }
        );
        connectSendTransport();
      }
    );
  }

  async function connectSendTransport() {
    // console.log(streamRef);
    // return;
    // console.log(videoRef.current.getStreams().getTracks());
    const audioParams = streamRef.current.getAudioTracks()[0];
    const videoParams = streamRef.current.getVideoTracks()[0];
    const audioProducer = await producerTransport.current.produce(audioParams);
    const videoProducer = await producerTransport.current.produce(videoParams);
    console.log(audioParams, videoParams);
    // console.log( await producerTransport.current.produce(audioParams))
  }

  async function createDevice() {
    try {
      device.current = new Device();
      await device.current.load({
        routerRtpCapabilities: rtpCapabilities.current,
      });

      console.log("Device RTP Capabilities", device.current.rtpCapabilities);
      createSendTransport();
    } catch (error) {
      console.error(error);
    }
  }

  useEffect(() => {
    return;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then((stream) => {
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        const socket = io("http://localhost:3001/mediasoup");
        socketRef.current = socket;
        // setSocket(socket);

        socket.emit(
          "joinRoom",
          { roomName: ROOM },
          (data: { rtpCapabilities: RtpCapabilities }) => {
            console.log("data = ", data.rtpCapabilities);
            rtpCapabilities.current = data.rtpCapabilities;
            createDevice();
          }
        );
      });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  return (
    <div>
      <MeetRoom />
      <video ref={videoRef} autoPlay playsInline />
    </div>
  );
};

export default App;
