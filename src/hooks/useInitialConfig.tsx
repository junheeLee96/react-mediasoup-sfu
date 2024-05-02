// import { } from "mediasoup-client";
import { Device, types } from "mediasoup-client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import {
  DeviceType,
  consumerTransportsType,
  funcType,
  producerTransportType,
  rtpCapabilitesType,
  userType,
} from "./types";

const useInitialConfig = ({ stream }: { stream: MediaStream | null }) => {
  const { roomName } = useParams();
  const [users, setUsers] = useState<userType>({});
  const usersRef = useRef<userType>({});
  const socket = useRef<null | Socket>(null);
  const device = useRef<DeviceType | null>(null);

  const rtpCapabilities = useRef<rtpCapabilitesType | null>(null);
  const producerTransport = useRef<producerTransportType | null>(null);
  const consumerTransports = useRef<consumerTransportsType[]>([]);

  const params = useRef<any>({
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
  });

  const audioProducer = useRef<any>(null);
  const videoProducer = useRef<any>(null);
  const audioParams = useRef<any>(null);
  const videoParams = useRef<any>({ ...params.current });
  const consumingTransports = useRef<any>([]);

  const streamSuccess = (stream: MediaStream) => {
    audioParams.current = {
      track: stream.getAudioTracks()[0],
      ...audioParams.current,
    };
    videoParams.current = {
      track: stream.getVideoTracks()[0],
      ...videoParams.current,
    };

    joinRoom();
  };

  const joinRoom = () => {
    if (!socket.current) return;
    socket.current.emit(
      "joinRoom",
      { roomName },
      (data: { rtpCapabilities: rtpCapabilitesType }) => {
        // console.log(`Router Rtp Capa`)
        rtpCapabilities.current = data.rtpCapabilities;

        createDevice();
      }
    );
  };

  const createDevice = async () => {
    if (!rtpCapabilities.current) return;
    try {
      device.current = new Device();

      // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-load
      // Loads the device with RTP capabilities of the Router (server side)
      await device.current.load({
        // see getRtpCapabilities() below
        routerRtpCapabilities: rtpCapabilities.current,
      });

      // once the device loads, create transport
      createSendTransport();
    } catch (error: any) {
      console.log(error);
      if (error.name === "UnsupportedError")
        console.warn("browser not supported");
    }
  };

  const createSendTransport = () => {
    if (!socket.current) return;

    // see server's socket.on('createWebRtcTransport', sender?, ...)
    // this is a call from Producer, so sender = true
    socket.current.emit(
      "createWebRtcTransport",
      { consumer: false },
      ({ params }: any) => {
        // The server sends back params needed
        // to create Send Transport on the client side
        if (params.error) {
          console.error(params.error);
          return;
        }
        if (!device.current) return;

        // creates a new WebRTC Transport to send media
        // based on the server's producer transport params
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
        producerTransport.current = device.current.createSendTransport(params);

        // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
        // this event is raised when a first call to transport.produce() is made
        // see connectSendTransport() below
        producerTransport.current.on(
          "connect",
          async (
            { dtlsParameters }: any,
            callback: funcType,
            errback: funcType
          ) => {
            if (!socket.current) return;
            try {
              // Signal local DTLS parameters to the server side transport
              // see server's socket.on('transport-connect', ...)
              await socket.current.emit("transport-connect", {
                dtlsParameters,
              });

              // Tell the transport that parameters were transmitted.
              callback();
            } catch (error) {
              errback(error);
            }
          }
        );

        producerTransport.current.on(
          "produce",
          async (parameters: any, callback: funcType, errback: funcType) => {
            console.log(parameters);
            if (!socket.current) return;
            try {
              // tell the server to create a Producer
              // with the following parameters and produce
              // and expect back a server side producer id
              // see server's socket.on('transport-produce', ...)
              await socket.current.emit(
                "transport-produce",
                {
                  kind: parameters.kind,
                  rtpParameters: parameters.rtpParameters,
                  appData: parameters.appData,
                },
                ({
                  id,
                  producersExist,
                }: {
                  id: string;
                  producersExist: boolean;
                }) => {
                  // Tell the transport that parameters were transmitted and provide it with the
                  // server side producer's id.
                  callback({ id });

                  // if producers exist, then join room
                  if (producersExist) getProducers();
                }
              );
            } catch (error) {
              errback(error);
            }
          }
        );

        connectSendTransport();
      }
    );
  };

  const getProducers = () => {
    if (!socket.current) return;
    socket.current.emit("getProducers", (producerIds: Array<string>) => {
      // for each of the producer create a consumer
      // producerIds.forEach(id => signalNewConsumerTransport(id))
      producerIds.forEach(signalNewConsumerTransport);
    });
  };

  const connectSendTransport = async () => {
    if (!producerTransport.current) return;
    // we now call produce() to instruct the producer transport
    // to send media to the Router
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
    // this action will trigger the 'connect' and 'produce' events above

    audioProducer.current = await producerTransport.current.produce(
      audioParams.current
    );
    videoProducer.current = await producerTransport.current.produce(
      videoParams.current
    );

    /* close tracks*/
    audioProducer.current.on("trackended", () => {
      console.log("audio track ended");
    });

    audioProducer.current.on("transportclose", () => {
      console.log("audio transport ended");
    });

    videoProducer.current.on("trackended", () => {
      console.log("video track ended");
    });

    videoProducer.current.on("transportclose", () => {
      console.log("video transport ended");
    });
    /* close tracks*/
  };

  const signalNewConsumerTransport = async (remoteProducerId: string) => {
    //check if we are already consuming the remoteProducerId
    if (!socket.current) return;
    if (consumingTransports.current.includes(remoteProducerId)) return;
    consumingTransports.current.push(remoteProducerId);
    await socket.current.emit(
      "createWebRtcTransport",
      { consumer: true },
      ({ params }: any) => {
        // The server sends back params needed
        // to create Send Transport on the client side
        if (params.error) {
          console.log(params.error);
          return;
        }
        console.log(`PARAMS... ${params}`);
        if (!device.current) return;
        let consumerTransport;
        try {
          consumerTransport = device.current.createRecvTransport(params);
        } catch (error) {
          // exceptions:
          // {InvalidStateError} if not loaded
          // {TypeError} if wrong arguments.
          console.log(error);
          return;
        }

        consumerTransport.on(
          "connect",
          async ({ dtlsParameters }: any, callback: any, errback: any) => {
            if (!socket.current) return;
            try {
              // Signal local DTLS parameters to the server side transport
              // see server's socket.on('transport-recv-connect', ...)
              await socket.current.emit("transport-recv-connect", {
                dtlsParameters,
                serverConsumerTransportId: params.id,
              });

              // Tell the transport that parameters were transmitted.
              callback();
            } catch (error) {
              // Tell the transport that something was wrong
              errback(error);
            }
          }
        );

        connectRecvTransport(consumerTransport, remoteProducerId, params.id);
      }
    );
  };

  const connectRecvTransport = async (
    consumerTransport: producerTransportType,
    remoteProducerId: string,
    serverConsumerTransportId: producerTransportType
  ) => {
    if (!device.current) return;
    if (!socket.current) return;
    // for consumer, we need to tell the server first
    // to create a consumer based on the rtpCapabilities and consume
    // if the router can consume, it will send back a set of params as below
    await socket.current.emit(
      "consume",
      {
        rtpCapabilities: device.current.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      },
      async ({ params }: any) => {
        if (params.error) {
          console.log("Cannot Consume");
          return;
        }
        if (!consumerTransports.current) return;
        console.log(consumerTransports.current, producerTransport.current);
        // then consume with the local consumer transport
        // which creates a consumer
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
        console.log("consumerTransports.current, ", consumerTransports.current);
        // create a new div element for the new consumer media
        // const newElem = document.createElement("div");
        // newElem.setAttribute("id", `td-${remoteProducerId}`);

        // destructure and retrieve the video track from the producer
        const { track } = consumer;
        const stream: MediaStream = new MediaStream([track]);

        setUsers((p: any) => {
          return { ...p, [remoteProducerId]: { stream } };
        });
        usersRef.current = {
          ...usersRef.current,
          [remoteProducerId]: { stream },
        };
        if (!socket.current) return;
        // the server consumer started with media paused
        // so we need to inform the server to resume
        socket.current.emit("consumer-resume", {
          serverConsumerId: params.serverConsumerId,
        });
      }
    );
  };

  useEffect(() => {
    if (!stream) return;
    streamSuccess(stream);
  }, [stream]);

  useEffect(() => {
    socket.current = io("https://localhost:8000/mediasoup");
    socket.current.on(
      "connection-success",
      ({ socketId, existsProducer }: any) => {
        // getLocalStream();
      }
    );

    socket.current.on("new-producer", ({ producerId }: any) => {
      signalNewConsumerTransport(producerId);
    });

    socket.current.on("producer-closed", ({ remoteProducerId }: any) => {
      if (!consumerTransports.current) return;
      const copyUsers = { ...usersRef.current };
      delete copyUsers[remoteProducerId];
      setUsers(copyUsers);

      const producerTocClose: any = consumerTransports.current.find(
        (transportData: any) => transportData.producerId === remoteProducerId
      );
      producerTocClose.consumerTransport.close();

      producerTocClose.consumer.close();

      consumerTransports.current = consumerTransports.current.filter(
        (transportData: any) => transportData.producerId !== remoteProducerId
      );
    });
  }, []);
  return { users };
};

export default useInitialConfig;
