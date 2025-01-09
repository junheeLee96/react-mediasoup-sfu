import { Device } from "mediasoup-client";
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

type useInitialConfigProps = {
  stream: MediaStream | null;
  updateSocket: (socket: Socket) => void;
};

const useInitialConfig = ({ stream, updateSocket }: useInitialConfigProps) => {
  const { roomName } = useParams();
  const [users, setUsers] = useState<userType>({});
  const usersRef = useRef<userType>({});
  const socket = useRef<null | Socket>(null);
  const device = useRef<DeviceType | null>(null);

  const rtpCapabilities = useRef<rtpCapabilitesType | null>(null);
  const producerTransport = useRef<producerTransportType | null>(null);
  const consumerTransports = useRef<consumerTransportsType[]>([]);

  const params = useRef<any>({
    // mediasoup 인코딩 파라미터
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
    // 코덱 옵션
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
    codecOptions: {
      videoGoogleStartBitrate: 1000,
    },
  });

  const audioProducer = useRef<any>(null);
  const videoProducer = useRef<any>(null);
  const audioParams = useRef<any>(null);
  const videoParams = useRef<any>({ ...params.current });
  const consumingTransports = useRef<string[]>([]);

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
        //rtpCapabilites = router.rtp...
        rtpCapabilities.current = data.rtpCapabilities;
        createDevice();
      }
    );
  };

  const createDevice = async () => {
    if (!rtpCapabilities.current) return;
    try {
      //디바이스 생성
      // 서버의 rtpCapabilities로 device load
      device.current = new Device();
      await device.current.load({
        routerRtpCapabilities: rtpCapabilities.current,
      });
      createSendTransport();
    } catch (error: any) {
      if (error.name === "UnsupportedError")
        console.warn("browser not supported");
    }
  };

  const createSendTransport = () => {
    if (!socket.current) return;

    //트랜스포트생성
    socket.current.emit(
      "createWebRtcTransport",
      { consumer: false },
      ({ params }: any) => {
        // 서버에서 필요한 매개변수 반환
        // 클라이언트에서 전송 트랜스포트 생성
        if (params.error) {
          console.error(params.error);
          return;
        }
        if (!device.current) return;

        // 미디어 전송을 위한 새 WebRTC 트랜스포트 생성
        producerTransport.current = device.current.createSendTransport(params);

        // transport.produce이벤트 처음 호출 시 발동되는 이벤트 등록

        producerTransport.current.on(
          "connect",
          async (
            { dtlsParameters }: any,
            callback: funcType,
            errback: funcType
          ) => {
            if (!socket.current) return;
            try {
              await socket.current.emit("transport-connect", {
                dtlsParameters,
              });
              callback();
            } catch (error) {
              errback(error);
            }
          }
        );

        producerTransport.current.on(
          "produce",
          async (parameters: any, callback: funcType, errback: funcType) => {
            if (!socket.current) return;
            try {
              // 서버에 프로듀서 생성 요청
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
                  callback({ id });
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
      // 각 프로듀서에 consumer 생성
      producerIds.forEach(signalNewConsumerTransport);
    });
  };

  const connectSendTransport = async () => {
    if (!producerTransport.current) return;
    // procue()호출
    //producer transport로 미디어를 서버로 전송
    //connect produce 트리거
    audioProducer.current = await producerTransport.current.produce(
      audioParams.current
    );
    videoProducer.current = await producerTransport.current.produce(
      videoParams.current
    );

    // 트랙 종료
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
  };

  const signalNewConsumerTransport = async (remoteProducerId: string) => {
    // remoteProducerId를 사용중인지 확인
    if (!socket.current) return;
    if (consumingTransports.current.includes(remoteProducerId)) return;
    consumingTransports.current.push(remoteProducerId);
    await socket.current.emit(
      "createWebRtcTransport",
      { consumer: true },
      ({ params }: any) => {
        if (params.error) {
          return;
        }
        if (!device.current) return;
        let consumerTransport;
        try {
          consumerTransport = device.current.createRecvTransport(params);
        } catch (error) {
          console.log(error);
          return;
        }

        consumerTransport.on(
          "connect",
          async ({ dtlsParameters }: any, callback: any, errback: any) => {
            if (!socket.current) return;
            try {
              await socket.current.emit("transport-recv-connect", {
                dtlsParameters,
                serverConsumerTransportId: params.id,
              });
              callback();
            } catch (error) {
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
    // consumer의 경우
    //서버에서 rtpCapabilities를 기반으로 consumer 생성
    //and return this parameters
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
        // 로컬 consumer transport consume
        // consumer 생성
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
        // 서버에 consumer가 미디어르 일시 중단한 상태로 시작
        // 서버에 다시 시작을 알림
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
    updateSocket(socket.current);
    socket.current.on("new-producer", ({ producerId }: any) => {
      signalNewConsumerTransport(producerId);
    });

    //유저가 나갔을때
    socket.current.on("producer-closed", ({ remoteProducerId }: any) => {
      // clean up
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
