import { useEffect, useRef, useState } from "react";
import Users from "./Users";
import styled from "@emotion/styled";
import useInitialConfig from "./hooks/useInitialConfig";
import { Socket } from "socket.io-client";
import useAudio from "./useAudio";

const MeetRoom = () => {
  const localVideo = useRef<null | HTMLVideoElement>(null);
  const [stream, setStream] = useState<null | MediaStream>(null);
  const [socket, setSocket] = useState<null | Socket>(null);

  const updateSocket = (socket: Socket) => {
    setSocket(socket);
  };
  const { users } = useInitialConfig({ stream, updateSocket });
  useAudio({ stream, socket, event: "speak" });
  const getLocalStream = () => {
    navigator.mediaDevices
      .getUserMedia({
        audio: true,
        video: true,
      })
      .then((stream: MediaStream) => {
        if (!localVideo.current) return;
        setStream(stream);
        localVideo.current.srcObject = stream;
      });
  };

  useEffect(() => {
    getLocalStream();
  }, []);

  return (
    <RoomStyle id="app">
      <Container>
        <div>
          <video
            ref={localVideo}
            autoPlay
            playsInline
            muted={true}
            id="local-video"
            style={{ width: "100%" }}
          />
        </div>
        {Object.keys(users).map((user) => (
          <Users user={users[user]} key={user} id={user} socket={socket} />
        ))}
      </Container>
    </RoomStyle>
  );
};

export default MeetRoom;

const RoomStyle = styled.div`
  width: 100vw;
  min-height: 100vh;
  height: 100%;
  background: rgb(17, 23, 30);
  display: flex;
  align-items: center;
  justify-content: center;
`;

const Container = styled.div`
  width: 100%;
  padding: 50px;
  min-height: 200px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(500px, 413px));
  grid-template-rows: auto;
  @media (max-width: 1024px) {
    width: 100%;
  }
`;
