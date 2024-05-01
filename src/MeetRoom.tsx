import { Device } from "mediasoup-client";
import React, { useEffect, useRef } from "react";
import { io } from "socket.io-client";

const MeetRoom = () => {
  const localVideo = useRef<any>(null);
  const remoteVideo = useRef<any>(null);
  const socket = useRef<any>(null);
  const device = useRef<any>(null);
  const rtpCapabilities = useRef<any>(null);
  const producerTransport = useRef<any>(null);
  const consumerTransport = useRef<any>(null);
  const producer = useRef<any>(null);
  const consumer = useRef<any>(null);
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

  const connectRecvTransport = async () => {
    await socket.current.emit(
      "consume",
      {
        rtpCapabilities: device.current.rtpCapabilities,
      },
      async ({ params }: any) => {
        if (params.error) {
          console.log("Cannot Consume");
          return;
        }

        console.log(params);
        // then consume with the local consumer transport
        // which creates a consumer
        consumer.current = await consumerTransport.current.consume({
          id: params.id,
          producerId: params.producerId,
          kind: params.kind,
          rtpParameters: params.rtpParameters,
        });

        // destructure and retrieve the video track from the producer
        const { track } = consumer.current;
        console.log(track);
        remoteVideo.current.srcObject = new MediaStream([track]);

        // the server consumer started with media paused
        // so we need to inform the server to resume
        socket.current.emit("consumer-resume");
      }
    );
  };

  const createRecvTransport = async () => {
    await socket.current.emit(
      "createWebRtcTransport",
      { sender: false },
      ({ params }: any) => {
        if (params.error) {
          console.error(params.error);
          return;
        }

        consumerTransport.current = device.current.createRecvTransport(params);
        consumerTransport.current.on(
          "connect",
          async ({ dtlsParameters }: any, callback: any, errback: any) => {
            try {
              // Signal local DTLS parameters to the server side transport
              // see server's socket.on('transport-recv-connect', ...)
              await socket.current.emit("transport-recv-connect", {
                dtlsParameters,
              });

              // Tell the transport that parameters were transmitted.
              callback();
            } catch (error) {
              // Tell the transport that something was wrong
              errback(error);
            }
          }
        );
      }
    );
  };

  const connectSendTransport = async () => {
    console.log(producerTransport.current, params.current);
    // return;
    producer.current = await producerTransport.current.produce(params.current);
    // console.log(producer.current);
    producer.current.on("trackended", () => {
      console.log("track ended");
    });

    producer.current.on("transportclose", () => {
      console.log("transport ended");
    });
  };

  const createSendTransport = () => {
    socket.current.emit(
      "createWebRtcTransport",
      { sender: true },
      ({ params }: any) => {
        if (params.error) {
          console.error(params);
          return;
        }
        producerTransport.current = device.current.createSendTransport(params);
        producerTransport.current.on(
          "connect",
          async ({ dtlsParameters }: any, callback: any, errback: any) => {
            try {
              await socket.current.emit("transport-connect", {
                // transportId: producerTransport.current.id,
                dtlsParameters,
              });
              callback();
            } catch (e) {
              errback(e);
            }
          }
        );
        producerTransport.current.on(
          "produce",
          async (parameters: any, callback: any, errback: any) => {
            console.log(parameters);

            try {
              await socket.current.emit(
                "transport-produce",
                {
                  //   transportId: producerTransport.current.id,
                  kind: parameters.kind,
                  rtpParameters: parameters.rtpParameters,
                  appData: parameters.appData,
                },
                ({ id }: any) => {
                  callback({ id });
                }
              );
            } catch (e) {
              errback(e);
            }
          }
        );
      }
    );
  };

  const streamSuccess = (stream: MediaStream) => {
    localVideo.current.srcObject = stream;
    const track = stream.getVideoTracks()[0];

    params.current = {
      ...params.current,
      track,
    };
  };

  const createDevice = async () => {
    try {
      device.current = new Device();
      await device.current.load({
        routerRtpCapabilities: rtpCapabilities.current,
      });
      console.log(`device.current = `, device.current);
      console.log("rtp!!", rtpCapabilities.current);
    } catch (e) {
      console.error(e);
      // if(e.name ==='')
    }
  };

  const getRtpCapabilities = () => {
    socket.current.emit("getRtpCapabilities", (data: any) => {
      rtpCapabilities.current = data.rtpCapabilities;
      console.log(`rtpCapabilities`, rtpCapabilities.current);
    });
  };

  const getLocalStream = () => {
    navigator.mediaDevices
      .getUserMedia({ audio: false, video: true })
      .then(streamSuccess);
  };

  useEffect(() => {
    socket.current = io("https://localhost:8000/mediasoup");
  }, []);

  return (
    <div>
      <video ref={localVideo} autoPlay playsInline />
      <video ref={remoteVideo} autoPlay playsInline />
      <button onClick={getLocalStream}>Get local Video</button>
      <button onClick={getRtpCapabilities}>Get TRP Capabilites</button>
      <button onClick={createDevice}>Create Device</button>
      <button onClick={createSendTransport}>Create Send Transport</button>
      <button onClick={connectSendTransport}>
        Connect Send Transport & Produce
      </button>
      <button onClick={createRecvTransport}>Create Recv Transport</button>
      <button onClick={connectRecvTransport}>
        Connect Recv Transport & Consume
      </button>
    </div>
  );
};

export default MeetRoom;
