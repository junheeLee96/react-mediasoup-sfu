import { Device } from "mediasoup-client";
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import Users from "./Users";
import { useParams } from "react-router-dom";
import styled from "@emotion/styled";
import useInitialConfig from "./hooks/useInitialConfig";

const MeetRoom = () => {
  const localVideo = useRef<null | HTMLVideoElement>(null);
  const [stream, setStream] = useState<null | MediaStream>(null);
  const { users } = useInitialConfig({ stream });

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
          <Users user={users[user]} key={user} id={user} />
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
